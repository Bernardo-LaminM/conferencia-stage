/* =========================================================
   P&G ITATIAIA — POWER BI LIVE (ON-TIME)
   O Power BI (view WMS SHIPPING_PCKWRK_VIEW_SIMPLIFICADA) é a FONTE DA VERDADE da base.

   Como funciona:
   1. A cada ciclo (padrão 2 min) UM aparelho do canal consulta o Power BI:
        servidor local (/api/sync-powerbi) → API REST com token → snapshot da nuvem (stage_data.js do GitHub Actions).
      Os demais veem o aviso de versão e não repetem a consulta (evita N aparelhos batendo na API).
   2. A base é SUBSTITUÍDA pelo retorno do Power BI (embarque que saiu da view sai da base),
      exceto o embarque que está em conferência neste aparelho.
   3. Cada base tem uma versão (hash do conteúdo). Se nada mudou, nada é redesenhado nem transmitido.
   4. Mudou: só os embarques alterados vão pelo On-Time (PBI_DIFF). Quem estiver fora de versão pede a base inteira,
      que vai em pedaços pequenos (o broker MQTT público não aceita mensagens grandes).
   ========================================================= */

(function () {
  const POWERBI_CONFIG_KEY = 'pg_powerbi_api_config_v1';
  const META_KEY = 'pg_powerbi_meta_v1';
  const DB_KEY = 'dhl_stage_database_custom_v1';

  const DEFAULT_CONFIG = {
    workspaceId: 'f0810a12-fd37-4f7a-ba46-4a447e425649',
    datasetId: 'fefdda8c-aa69-48a6-b2bf-75daba388cd4',
    tableName: 'itatiaia AD80',
    daxQuery: `DEFINE\n  VAR __DS0Core = SUMMARIZECOLUMNS(\n    'itatiaia AD80'[car_move_id],\n    'itatiaia AD80'[ORDNUM],\n    'itatiaia AD80'[PALLET_ID],\n    'itatiaia AD80'[DSTLOC],\n    'itatiaia AD80'[Atividade],\n    'itatiaia AD80'[PRTNUM],\n    'itatiaia AD80'[LOT],\n    "QTD_CAIXAS", CALCULATE(SUM('itatiaia AD80'[QTD_CAIXAS])),\n    "SPS", CALCULATE(SUM('itatiaia AD80'[SPS]))\n  )\nEVALUATE TOPN(500000, __DS0Core, 'itatiaia AD80'[car_move_id], 1, 'itatiaia AD80'[ORDNUM], 1, 'itatiaia AD80'[PALLET_ID], 1)`,
    savedToken: '',
    intervalSec: 120
  };

  const isLocalServer = window.location.protocol === 'http:' || /^(localhost|127\.0\.0\.1|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(window.location.hostname);

  function getConfig() {
    try {
      const saved = localStorage.getItem(POWERBI_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.datasetId === '5939ef54-f0ca-4d0b-8821-f8cfc989bf80') {
          parsed.datasetId = DEFAULT_CONFIG.datasetId;
          parsed.tableName = DEFAULT_CONFIG.tableName;
          parsed.daxQuery = DEFAULT_CONFIG.daxQuery;
        }
        return Object.assign({}, DEFAULT_CONFIG, parsed);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(POWERBI_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  /* ---------------- Estado ---------------- */
  const state = {
    version: null,      // hash da base atual
    ts: null,           // momento (ISO) em que os dados foram lidos do Power BI
    source: '',         // de onde veio a base atual
    syncing: false,
    lastError: null,
    failures: 0,
    nextAt: 0,
    peerFreshAt: 0,     // último aviso de outro aparelho com base fresca
    fullRequestedAt: 0
  };
  try { Object.assign(state, JSON.parse(localStorage.getItem(META_KEY) || '{}')); } catch (e) {}
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify({ version: state.version, ts: state.ts, source: state.source })); } catch (e) {}
  }
  const hhmm = (iso) => { if (!iso) return '--:--'; const d = new Date(iso); return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

  /* ---------------- Token (JWT): validade ---------------- */
  function tokenInfo(tok) {
    const t = String(tok || '').replace(/^Bearer\s+/i, '').trim();
    if (!t) return { ok: false, motivo: 'sem token' };
    try {
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (p.exp && p.exp * 1000 < Date.now() + 60000) return { ok: false, motivo: 'token expirado às ' + hhmm(new Date(p.exp * 1000).toISOString()), token: t };
      return { ok: true, token: t, expira: p.exp ? new Date(p.exp * 1000).toISOString() : null };
    } catch (e) {
      return { ok: true, token: t }; // não é JWT legível: tenta mesmo assim
    }
  }

  /* ---------------- Linhas DAX -> embarques ---------------- */
  function construirEmbarques(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) throw new Error('Nenhum registro encontrado no retorno do Power BI.');
    const cleanRow = (r) => {
      const o = {};
      Object.keys(r).forEach(k => {
        const shortKey = k.replace(/^.*\[/, '').replace(/[\[\]']/g, '').trim().toLowerCase();
        o[shortKey] = r[k];
      });
      return o;
    };
    const dict = {};
    let linhas = 0;
    rawRows.forEach(row => {
      const it = cleanRow(row);
      const embId = String(it.car_move_id || it.car_move || it.embarque || '').trim();
      const palId = String(it.pallet_id || it.palete_id || it.lpn || it.etiqueta || '').trim();
      if (!embId || !palId) return;
      const ordId = String(it.ordnum || it.order_num || '').trim();
      const stg = String(it.dstloc || it.stage || '').trim();
      const sku = String(it.prtnum || it.sku || '').trim();
      const lote = String(it.lot || it.lotnum || it.lote || '').trim();
      const qtd = Math.round(parseFloat(it.qtd_caixas || it.sumqtd_caixas || it.caixas || it.pckqty || it.qtd || 0)) || 0;
      const e = dict[embId] || (dict[embId] = { embarque: embId, total_pecas: 0, stages: new Set(), pal: new Map() });
      if (stg) e.stages.add(stg);
      if (!e.pal.has(palId)) e.pal.set(palId, { palete: palId, stage: stg, order_num: ordId, lote: lote, itens: [], _itemMap: new Map(), qtd_total: 0, sku_resumo: sku || 'Material', desc_resumo: sku ? `SKU ${sku}` : 'Material' });
      const p = e.pal.get(palId);
      const itemKey = `${sku}|${lote}`;
      if (p._itemMap.has(itemKey)) {
        p._itemMap.get(itemKey).qtd += qtd;
      } else {
        const itemObj = { sku: sku || 'Material', lote: lote, qtd: qtd, order_num: ordId };
        p._itemMap.set(itemKey, itemObj);
        p.itens.push(itemObj);
      }
      p.qtd_total += qtd; e.total_pecas += qtd; linhas++;
    });
    const out = {};
    Object.values(dict).forEach(e => {
      const paletes = Array.from(e.pal.values());
      paletes.forEach(p => { delete p._itemMap; });
      out[e.embarque] = { embarque: e.embarque, total_paletes: paletes.length, total_pecas: e.total_pecas, stages: Array.from(e.stages), paletes: paletes };
    });
    if (!Object.keys(out).length) throw new Error('Não foi possível identificar paletes ou embarques válidos nos dados recebidos.');
    return { embarques: out, linhas: linhas };
  }

  /* embarques únicos (a base guarda também o alias sem zeros à esquerda) */
  function unicos(embs) {
    const o = {};
    Object.keys(embs || {}).forEach(k => { const e = embs[k]; if (e && e.embarque && !o[e.embarque]) o[e.embarque] = e; });
    return o;
  }
  function comAliases(embs) {
    const o = {};
    Object.keys(embs).forEach(k => {
      o[k] = embs[k];
      const c = k.replace(/^0+/, '');
      if (c && c !== k) o[c] = embs[k];
    });
    return o;
  }

  /* ---------------- Versão (hash FNV-1a) ---------------- */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function hashEmbarque(e) {
    return fnv((e.paletes || []).map(p => p.palete + ':' + (p.stage || '') + ':' + (p.qtd_total || 0) + ':' + (p.sku_resumo || '')).sort().join('|'));
  }
  function versionOf(u) {
    const keys = Object.keys(u).sort();
    const per = {};
    keys.forEach(k => { per[k] = hashEmbarque(u[k]); });
    return { version: fnv(keys.map(k => k + '=' + per[k]).join(';')) + '-' + keys.length, per: per };
  }

  /* ---------------- Aplicar base ---------------- */
  function embarqueEmConferencia() {
    const ac = window.activeConference;
    return ac && ac.embarqueId ? String(ac.embarqueId) : null;
  }
  function refreshUIs() {
    ['updateBaseInfoUI', 'updateUI', 'renderYardGrid', 'renderConsolidacao'].forEach(fn => { if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) { console.warn(fn, e); } } });
    const dash = document.getElementById('viewDashboard');
    if (dash && dash.style.display !== 'none' && typeof window.renderDashboard === 'function') { try { window.renderDashboard(); } catch (e) {} }
    window.dispatchEvent(new Event('stagemap:refresh'));
  }

  /* Substitui a base pela do Power BI. Retorna { mudou, diff } */
  function aplicarBase(novosUnicos, meta) {
    const db = window.database || (window.database = { embarques: {} });
    const antes = unicos(db.embarques);
    const ativo = embarqueEmConferencia();
    const novos = Object.assign({}, novosUnicos);
    // não derruba o embarque que está sendo conferido agora, mesmo que tenha saído da view
    if (ativo && !novos[ativo] && antes[ativo]) novos[ativo] = Object.assign({}, antes[ativo], { foraDoPbi: true });

    const vNovo = versionOf(novos), vAntes = versionOf(antes);
    const prevVersion = state.version;
    state.ts = meta.ts; state.source = meta.source; state.lastError = null;
    if (vNovo.version === vAntes.version) {
      state.version = vNovo.version; saveMeta();
      return { mudou: false, from: prevVersion, to: vNovo.version };
    }

    const set = {}, del = [];
    Object.keys(vNovo.per).forEach(k => { if (vNovo.per[k] !== vAntes.per[k]) set[k] = novos[k]; });
    Object.keys(vAntes.per).forEach(k => { if (!(k in vNovo.per)) del.push(k); });

    db.embarques = comAliases(novos);
    window.database = db; // passa pela ponte do app.js (atualiza a variável do app e a lista de stages)
    state.version = vNovo.version; saveMeta();
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { console.warn('Armazenamento local cheio, mantendo a base em memória:', e); }

    let totalPal = 0; Object.values(novos).forEach(e => { totalPal += (e.paletes || []).length; });
    if (typeof window.saveBaseVersion === 'function') {
      window.saveBaseVersion({
        data: new Date().toLocaleString('pt-BR'),
        arquivo: meta.source,
        totalEmbarques: Object.keys(novos).length,
        totalPaletes: totalPal,
        detalhes: `Power BI: ${Object.keys(set).length} embarque(s) novos/alterados, ${del.length} removido(s).`
      });
    }
    refreshUIs();
    if (vAntes.version !== versionOf({}).version && typeof window.showToast === 'function' && (Object.keys(set).length || del.length)) {
      window.showToast(`⚡ <b>Power BI:</b> ${Object.keys(set).length} embarque(s) atualizados${del.length ? ', ' + del.length + ' saíram da view' : ''}.`);
    }
    return { mudou: true, from: prevVersion, to: vNovo.version, set: set, del: del, totalPal: totalPal };
  }

  /* ---------------- Fontes ---------------- */
  async function lerServidorLocal() {
    const r = await fetch('/api/sync-powerbi', { method: 'POST' });
    if (!r.ok) throw new Error('Servidor local respondeu ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Servidor local não conseguiu consultar o Power BI');
    const r2 = await fetch('stage_data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r2.ok) throw new Error('stage_data.json indisponível (' + r2.status + ')');
    const db = await r2.json();
    if (!db || !db.embarques) throw new Error('stage_data.json sem embarques');
    return { embarques: unicos(db.embarques), source: 'Power BI (servidor local)', ts: new Date().toISOString() };
  }

  async function lerApiPowerBi(token) {
    const cfg = getConfig();
    const bodyPayload = JSON.stringify({ queries: [{ query: cfg.daxQuery || `EVALUATE '${cfg.tableName}'` }], serializerSettings: { includeNulls: true } });
    const urls = [
      `https://api.powerbi.com/v1.0/myorg/datasets/${cfg.datasetId}/executeQueries`,
      `https://api.powerbi.com/v1.0/myorg/groups/${cfg.workspaceId}/datasets/${cfg.datasetId}/executeQueries`
    ];
    let res = null;
    for (const url of urls) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: bodyPayload
      });
      if (res.ok || res.status === 401 || res.status === 403) break;
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || JSON.stringify(j); } catch (e) { msg = await res.text().catch(() => ''); }
      const err = new Error(`API Power BI ${res.status}: ${msg}`);
      err.auth = res.status === 401 || res.status === 403;
      throw err;
    }
    const data = await res.json();
    const tables = data && data.results && data.results[0] && data.results[0].tables;
    if (!tables || !tables.length || !Array.isArray(tables[0].rows)) throw new Error('A API do Power BI não retornou linhas.');
    const b = construirEmbarques(tables[0].rows);
    return { embarques: b.embarques, linhas: b.linhas, source: 'Power BI Live (itatiaia AD80)', ts: new Date().toISOString() };
  }

  /* Snapshot publicado ou base embutida no pacote SPFx. */
  async function lerNuvem() {
    if (!isLocalServer && window.location && /sharepoint\.com/i.test(window.location.hostname)) {
      const embSp = window.EMBEDDED_STAGE_DATA && window.EMBEDDED_STAGE_DATA.embarques;
      if (embSp && Object.keys(embSp).length > 0) {
        const tsSp = window.EMBEDDED_STAGE_DATA.atualizado_em || new Date().toISOString();
        if (state.ts && new Date(tsSp) <= new Date(state.ts)) return null;
        return { embarques: unicos(embSp), source: 'Base SharePoint (SPFx)', ts: tsSp };
      }
    }
    const res = await fetch('stage_data.js?nocache=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) {
      const embFallback = window.EMBEDDED_STAGE_DATA && window.EMBEDDED_STAGE_DATA.embarques;
      if (embFallback && Object.keys(embFallback).length > 0) {
        const tsFb = window.EMBEDDED_STAGE_DATA.atualizado_em || new Date().toISOString();
        if (state.ts && new Date(tsFb) <= new Date(state.ts)) return null;
        return { embarques: unicos(embFallback), source: 'Base Embutida (SPFx)', ts: tsFb };
      }
      throw new Error('stage_data.js indisponível (' + res.status + ')');
    }
    const lm = res.headers.get('Last-Modified');
    const ts = lm ? new Date(lm).toISOString() : null;
    if (ts && state.ts && new Date(ts) <= new Date(state.ts)) return null; // não é mais novo
    const txt = await res.text();
    const sandbox = {};
    new Function('window', txt)(sandbox);
    const emb = sandbox.EMBEDDED_STAGE_DATA && sandbox.EMBEDDED_STAGE_DATA.embarques;
    if (!emb) throw new Error('stage_data.js sem EMBEDDED_STAGE_DATA');
    window.EMBEDDED_STAGE_DATA = sandbox.EMBEDDED_STAGE_DATA;
    return { embarques: unicos(emb), source: 'Power BI (nuvem/GitHub)', ts: ts || new Date().toISOString() };
  }

  /* Tenta as fontes em ordem. direto=false: só a nuvem (quando outro aparelho já consultou). */
  async function buscarBase(tokenManual, direto) {
    const erros = [];
    if (direto !== false) {
      if (isLocalServer) {
        try { return await lerServidorLocal(); } catch (e) { erros.push(e.message); }
      }
      const cfg = getConfig();
      let tok = tokenManual || cfg.savedToken;
      if (!tok && window.spContext && window.spContext.aadTokenProviderFactory) {
        try {
          const tp = await window.spContext.aadTokenProviderFactory.getTokenProvider();
          tok = await tp.getToken('https://analysis.windows.net/powerbi/api');
        } catch (e) {}
      }
      const ti = tokenInfo(tok);
      if (tokenManual && ti.token) { cfg.savedToken = ti.token; saveConfig(cfg); }
      if (ti.ok) {
        try { return await lerApiPowerBi(ti.token); }
        catch (e) {
          erros.push(e.message);
          if (e.auth) { cfg.savedToken = ''; saveConfig(cfg); erros.push('token recusado e removido'); }
        }
      } else if (ti.token) erros.push(ti.motivo);
    }
    try { const n = await lerNuvem(); if (n) return n; return null; } catch (e) { erros.push(e.message); }
    throw new Error(erros.join(' · ') || 'Nenhuma fonte disponível');
  }

  /* ---------------- Ciclo de sincronização ---------------- */
  function sync() { return window.DHL_SYNC; }

  async function sincronizar(opts) {
    opts = opts || {};
    if (state.syncing) return null;
    state.syncing = true; atualizarBadge();
    try {
      const r = await buscarBase(opts.token, opts.direto);
      if (!r) { // nuvem sem novidade
        state.failures = 0; state.lastError = null;
        return { mudou: false };
      }
      const res = aplicarBase(r.embarques, { ts: r.ts, source: r.source });
      state.failures = 0;
      const s = sync();
      if (s && typeof s.broadcastLarge === 'function') {
        if (res.mudou) s.broadcastLarge('PBI_DIFF', { from: res.from, to: res.to, ts: state.ts, source: state.source, set: res.set, del: res.del });
        else s.broadcastMessage('PBI_VERSION', { version: state.version, ts: state.ts, source: state.source });
      }
      return Object.assign({ linhas: r.linhas }, res);
    } catch (e) {
      state.failures++; state.lastError = e.message;
      console.warn('⚡ [Power BI] Falha ao sincronizar:', e.message);
      throw e;
    } finally {
      state.syncing = false;
      agendar();
      atualizarBadge();
    }
  }

  function agendar() {
    const iv = Math.max(30, +getConfig().intervalSec || 120) * 1000;
    const delay = state.failures ? Math.min(iv, 30000 * Math.pow(2, state.failures - 1)) : iv * (0.9 + Math.random() * 0.2);
    state.nextAt = Date.now() + delay;
  }

  async function tick() {
    atualizarBadge();
    if (state.syncing || Date.now() < state.nextAt) return;
    const iv = Math.max(30, +getConfig().intervalSec || 120) * 1000;
    // outro aparelho do canal consultou o Power BI há pouco: não repete a consulta
    if (Date.now() - state.peerFreshAt < iv * 0.75) { agendar(); return; }
    try { await sincronizar(); } catch (e) {}
  }

  /* ---------------- Mensagens On-Time de outros aparelhos ---------------- */
  function maisNovo(ts) { return ts && (!state.ts || new Date(ts) > new Date(state.ts)); }

  function pedirBaseCompleta() {
    if (Date.now() - state.fullRequestedAt < 15000) return;
    state.fullRequestedAt = Date.now();
    const s = sync(); if (s) s.broadcastMessage('PBI_FULL_REQUEST', { have: state.version });
  }

  function onVersion(p) {
    if (!p) return;
    if (p.version === state.version) { state.peerFreshAt = Date.now(); if (maisNovo(p.ts)) { state.ts = p.ts; saveMeta(); atualizarBadge(); } return; }
    if (maisNovo(p.ts)) { state.peerFreshAt = Date.now(); pedirBaseCompleta(); }
  }

  function onDiff(p) {
    if (!p || !maisNovo(p.ts)) return;
    state.peerFreshAt = Date.now();
    if (p.to === state.version) return;
    const db = window.database || (window.database = { embarques: {} });
    if (p.from && p.from === state.version) {
      const u = unicos(db.embarques);
      (p.del || []).forEach(k => { delete u[k]; });
      Object.keys(p.set || {}).forEach(k => { u[k] = p.set[k]; });
      if (versionOf(u).version === p.to) { aplicarBase(u, { ts: p.ts, source: p.source + ' via On-Time' }); return; }
    }
    pedirBaseCompleta(); // fora de versão: pede a base inteira
  }

  let respondTimer = null;
  function onFullRequest(p) {
    if (!state.version || !p || p.have === state.version) return;
    // responde com pequeno atraso aleatório; se outro aparelho responder antes, cancela
    clearTimeout(respondTimer);
    respondTimer = setTimeout(() => {
      const s = sync(); const db = window.database;
      if (!s || !db || !db.embarques) return;
      s.broadcastLarge('PBI_FULL', { version: state.version, ts: state.ts, source: state.source, embarques: unicos(db.embarques) });
    }, 300 + Math.random() * 1200);
  }

  function onFull(p) {
    clearTimeout(respondTimer);
    if (!p || !p.embarques || p.version === state.version) return;
    if (state.version && !maisNovo(p.ts)) return;
    state.peerFreshAt = Date.now();
    aplicarBase(p.embarques, { ts: p.ts, source: p.source + ' via On-Time' });
  }

  function ligarOnTime() {
    const s = sync();
    if (!s || typeof s.on !== 'function') return setTimeout(ligarOnTime, 500);
    s.on('PBI_VERSION', m => onVersion(m.payload));
    s.on('PBI_DIFF', m => onDiff(m.payload));
    s.on('PBI_FULL_REQUEST', m => onFullRequest(m.payload));
    s.on('PBI_FULL', m => onFull(m.payload));
  }

  /* ---------------- Indicador na barra superior ---------------- */
  function status() {
    const cfg = getConfig(), ti = tokenInfo(cfg.savedToken);
    const iv = Math.max(30, +cfg.intervalSec || 120);
    const atrasado = state.ts && (Date.now() - new Date(state.ts).getTime()) > iv * 3000;
    return {
      version: state.version, ts: state.ts, source: state.source, syncing: state.syncing,
      erro: state.lastError, atrasado: !!atrasado, proximaEm: Math.max(0, Math.round((state.nextAt - Date.now()) / 1000)),
      token: ti.ok ? 'válido' : ti.motivo, intervalo: iv
    };
  }

  function atualizarBadge() {
    const btn = document.getElementById('btnPowerBiModal');
    if (!btn) return;
    const st = status();
    const s = st.proximaEm, t = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    let dotColor = '#94A3B8', label = 'Power BI', tip = '';
    if (st.syncing) {
      dotColor = '#2563EB';
      label = 'Power BI…';
      tip = 'Consultando o Power BI';
    } else if (st.erro && (!st.ts || st.atrasado)) {
      dotColor = '#F59E0B';
      tip = 'Power BI (' + (st.ts ? 'dados de ' + hhmm(st.ts) : 'base local ativa') + ') · Próxima verificação em ' + t;
    } else {
      dotColor = st.ts ? '#10B981' : '#94A3B8';
      tip = (st.ts ? `Base do Power BI lida às ${hhmm(st.ts)} (${st.source})` : 'Aguardando leitura') + ` · próxima verificação em ${t}`;
    }
    btn.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;"></span> <span>${label}</span>`;
    btn.title = tip;
    const box = document.getElementById('pbiStatusBox');
    if (box && box.offsetParent !== null) renderStatusBox();
  }

  function renderStatusBox() {
    const box = document.getElementById('pbiStatusBox'); if (!box) return;
    const st = status();
    const linha = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#64748B;">${k}</span><b style="text-align:right;">${v}</b></div>`;
    box.innerHTML =
      linha('Última leitura', st.ts ? new Date(st.ts).toLocaleString('pt-BR') : '—') +
      linha('Origem', st.source || '—') +
      linha('Versão da base', st.version || '—') +
      linha('Próxima verificação', st.syncing ? 'agora' : `em ${st.proximaEm}s (a cada ${st.intervalo}s)`) +
      linha('Token da API', st.token) +
      (st.erro ? `<div style="margin-top:6px;color:#B91C1C;font-size:.74rem;">Última falha: ${String(st.erro).replace(/</g, '&lt;')}</div>` : '');
  }

  /* ---------------- Modal ---------------- */
  window.openPowerBiModal = function () {
    let modal = document.getElementById('modalPowerBiSync');
    if (!modal) { modal = criarModalPowerBi(); (document.querySelector('.elb-container') || document.body).appendChild(modal); }
    const cfg = getConfig();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('pbiInputWorkspaceId', cfg.workspaceId);
    set('pbiInputDatasetId', cfg.datasetId);
    set('pbiInputDaxQuery', cfg.daxQuery);
    set('pbiInputToken', '');
    set('pbiInputIntervalo', String(cfg.intervalSec || 120));
    document.getElementById('pbiFeedbackBox').style.display = 'none';
    renderStatusBox();
    modal.style.display = 'flex';
  };
  window.closePowerBiModal = function () {
    const modal = document.getElementById('modalPowerBiSync');
    if (modal) modal.style.display = 'none';
  };

  const POWERBI_REPORT_URL = "https://app.powerbi.com/groups/me/reports/3cf5dcbd-f996-4d3e-afd5-564fbf1a6761/9d415a94aa4fce655114?ctid=3596192b-fdf5-4e2c-a6fa-acb706c963d8&experience=power-bi";
  const POWERBI_EMBED_URL = "https://app.powerbi.com/reportEmbed?reportId=3cf5dcbd-f996-4d3e-afd5-564fbf1a6761&autoAuth=true&ctid=3596192b-fdf5-4e2c-a6fa-acb706c963d8";

  window.POWERBI_REPORT_URL = POWERBI_REPORT_URL;
  window.POWERBI_EMBED_URL = POWERBI_EMBED_URL;

  window.abrirModalPowerBiIframe = function () {
    const modal = document.getElementById('modalPowerBiIframe');
    const iframe = document.getElementById('iframePowerBi');
    if (modal && iframe) {
      if (!iframe.src || iframe.src === 'about:blank' || iframe.src === window.location.href) {
        iframe.src = POWERBI_EMBED_URL;
      }
      modal.style.display = 'flex';
    }
  };

  window.fecharModalPowerBiIframe = function () {
    const modal = document.getElementById('modalPowerBiIframe');
    if (modal) modal.style.display = 'none';
  };

  window.salvarConfigPowerBi = function () {
    const cfg = getConfig();
    const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    if (val('pbiInputWorkspaceId')) cfg.workspaceId = val('pbiInputWorkspaceId');
    if (val('pbiInputDatasetId')) cfg.datasetId = val('pbiInputDatasetId');
    if (val('pbiInputDaxQuery')) cfg.daxQuery = val('pbiInputDaxQuery');
    cfg.intervalSec = Math.max(30, parseInt(val('pbiInputIntervalo'), 10) || 120);
    saveConfig(cfg); agendar(); renderStatusBox();
    if (typeof window.showToast === 'function') window.showToast('Configuração do Power BI salva.');
  };

  window.acionarExecucaoPowerBi = async function () {
    const btn = document.getElementById('btnPbiExecutar');
    const feedback = document.getElementById('pbiFeedbackBox');
    const tokenInput = document.getElementById('pbiInputToken');
    btn.disabled = true;
    btn.innerHTML = '⏳ Consultando o Power BI...';
    feedback.style.display = 'block';
    feedback.className = 'pbi-feedback-info';
    feedback.innerHTML = 'Consultando a view WMS no Power BI…';
    try {
      const r = await sincronizar({ token: tokenInput && tokenInput.value });
      if (tokenInput) tokenInput.value = '';
      const db = unicos((window.database || {}).embarques);
      let pal = 0; Object.values(db).forEach(e => { pal += (e.paletes || []).length; });
      feedback.className = 'pbi-feedback-success';
      feedback.innerHTML = r && r.mudou
        ? `✔ <b>Base atualizada</b> (${state.source})<br>• <b>${Object.keys(db).length}</b> embarques · <b>${pal}</b> paletes<br>• ${Object.keys(r.set || {}).length} embarque(s) novos/alterados, ${(r.del || []).length} removido(s)<br><small>📡 Alterações enviadas aos outros aparelhos do canal.</small>`
        : `✔ <b>Base já está em dia</b> com o Power BI (${state.source || 'nuvem'}) · ${Object.keys(db).length} embarques · ${pal} paletes.`;
    } catch (err) {
      feedback.className = 'pbi-feedback-error';
      feedback.innerHTML = `✖ <b>Não foi possível ler o Power BI:</b><br>${String(err.message).replace(/</g, '&lt;')}<br><br>` +
        `<button type="button" class="btn-clean-primary" style="margin:0;font-size:.78rem;padding:6px 12px;background:#003DA5;" data-csp-onclick="closePowerBiModal(); if(typeof openUploadModal === 'function') openUploadModal();">📥 Carregar Planilha Excel</button>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Sincronizar com o Power BI agora';
      renderStatusBox();
    }
  };

  window.processarJsonDaxColado = function () {
    const txt = document.getElementById('pbiJsonInput');
    const feedback = document.getElementById('pbiFeedbackBox');
    const raw = (txt && txt.value || '').trim();
    if (!raw) { alert('Cole o JSON ou a tabela da consulta DAX no campo de texto.'); return; }
    try {
      let rows = null;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) rows = parsed;
        else if (parsed.results && parsed.results[0] && parsed.results[0].tables && parsed.results[0].tables[0]) rows = parsed.results[0].tables[0].rows;
        else if (parsed.rows) rows = parsed.rows;
        else rows = Object.values(parsed);
      } catch (e) {
        const lines = raw.split(/\r?\n/).filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split('\t').map(h => h.trim());
          rows = lines.slice(1).map(l => { const c = l.split('\t'), o = {}; headers.forEach((h, i) => { o[h] = c[i] !== undefined ? c[i].trim() : ''; }); return o; });
        }
      }
      if (!rows || !rows.length) throw new Error('Formato não reconhecido. Cole o JSON da API ou a tabela com cabeçalho.');
      const stats = processarLinhasPowerBi(rows, 'Power BI (colado manualmente)');
      feedback.style.display = 'block';
      feedback.className = 'pbi-feedback-success';
      feedback.innerHTML = `✔ <b>Dados processados:</b> ${stats.totalEmbarques} embarques · ${stats.totalPaletes} paletes.`;
    } catch (err) {
      feedback.style.display = 'block';
      feedback.className = 'pbi-feedback-error';
      feedback.innerHTML = `✖ <b>Erro ao processar dados colados:</b><br>${String(err.message).replace(/</g, '&lt;')}`;
    }
  };

  /* Compatível com a versão anterior: processa linhas e aplica como base do Power BI */
  function processarLinhasPowerBi(rawRows, fonteDesc) {
    const b = construirEmbarques(rawRows);
    const r = aplicarBase(b.embarques, { ts: new Date().toISOString(), source: fonteDesc || 'Power BI' });
    const s = sync();
    if (r.mudou && s && typeof s.broadcastLarge === 'function') s.broadcastLarge('PBI_DIFF', { from: r.from, to: r.to, ts: state.ts, source: state.source, set: r.set, del: r.del });
    let pal = 0; Object.values(b.embarques).forEach(e => { pal += e.paletes.length; });
    return { totalEmbarques: Object.keys(b.embarques).length, totalPaletes: pal, totalLinhas: b.linhas };
  }

  window.setPbiTab = function (tabName) {
    document.querySelectorAll('.pbi-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pbi-tab-content').forEach(c => { c.style.display = 'none'; });
    const b = document.getElementById(`tabBtnPbi_${tabName}`), c = document.getElementById(`tabContentPbi_${tabName}`);
    if (b) b.classList.add('active');
    if (c) c.style.display = 'block';
  };

  function criarModalPowerBi() {
    const div = document.createElement('div');
    div.id = 'modalPowerBiSync';
    div.className = 'modal-backdrop';
    div.style.display = 'none';
    div.innerHTML = `
      <div class="modal-clean-box modal-lg" style="max-width: 600px; border-top: 4px solid #003DA5;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1.5px solid #F1F5F9;padding-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.6rem;">⚡</span>
            <div>
              <h2 style="font-size:1.12rem;font-weight:800;color:#003DA5;margin:0;">Power BI Live • AD HOC 80</h2>
              <span style="font-size:.76rem;color:#64748B;">Base de embarques e paletes vinda da view WMS, distribuída a todos os aparelhos On-Time</span>
            </div>
          </div>
          <button type="button" class="btn-close-x" data-csp-onclick="closePowerBiModal()">&times;</button>
        </div>

        <div id="pbiFeedbackBox" style="display:none;padding:12px;border-radius:8px;margin-bottom:14px;font-size:.85rem;line-height:1.45;"></div>

        <div id="pbiStatusBox" style="display:grid;gap:4px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:.8rem;color:#1E293B;"></div>

        <button id="btnPbiExecutar" type="button" class="btn-clean-primary" style="margin-top:0;background:#003DA5;padding:13px;font-size:.98rem;font-weight:800;border-radius:8px;width:100%;" data-csp-onclick="acionarExecucaoPowerBi()">
          ⚡ Sincronizar com o Power BI agora
        </button>
        <div style="margin-top:8px;font-size:.72rem;color:#64748B;line-height:1.4;">
          Ordem das fontes: servidor local da operação → API do Power BI (token) → snapshot publicado na nuvem (GitHub Actions).
          Só um aparelho do canal consulta por ciclo; os demais recebem apenas o que mudou.
        </div>

        <details style="margin-top:14px;border-top:1px solid #E2E8F0;padding-top:10px;">
          <summary style="font-size:.78rem;color:#475569;cursor:pointer;font-weight:700;">⚙️ Configuração (intervalo, token, consulta DAX)</summary>
          <div style="display:grid;gap:10px;margin-top:10px;font-size:.78rem;">
            <label style="font-weight:700;color:#475569;">Intervalo de verificação (segundos, mínimo 30)
              <input id="pbiInputIntervalo" type="number" min="30" step="10" class="input-clean" style="margin-top:4px;">
            </label>
            <label style="font-weight:700;color:#475569;">Token de acesso da API (opcional, expira em ~1h)
              <input id="pbiInputToken" type="password" class="input-clean" autocomplete="off" placeholder="Cole aqui o token Bearer para consultar direto deste aparelho" style="margin-top:4px;">
            </label>
            <label style="font-weight:700;color:#475569;">Workspace ID <input id="pbiInputWorkspaceId" class="input-clean" style="margin-top:4px;"></label>
            <label style="font-weight:700;color:#475569;">Dataset ID <input id="pbiInputDatasetId" class="input-clean" style="margin-top:4px;"></label>
            <label style="font-weight:700;color:#475569;">Consulta DAX
              <textarea id="pbiInputDaxQuery" rows="6" class="input-clean" style="margin-top:4px;text-align:left;font-family:monospace;font-size:.72rem;"></textarea>
            </label>
            <button type="button" class="btn-secondary-clean" style="justify-self:start;margin-left:0;" data-csp-onclick="salvarConfigPowerBi()">Salvar configuração</button>
          </div>
        </details>

        <details style="margin-top:10px;">
          <summary style="font-size:.78rem;color:#475569;cursor:pointer;font-weight:700;">📋 Colar resultado da consulta DAX manualmente</summary>
          <div style="margin-top:10px;">
            <textarea id="pbiJsonInput" rows="4" class="input-clean" style="text-align:left;font-family:monospace;font-size:.75rem;padding:8px;" placeholder="Cole o JSON da API ou a tabela copiada do DAX Query View (com cabeçalho)"></textarea>
            <button type="button" class="btn-secondary-clean" style="margin-top:6px;margin-left:0;font-size:.78rem;" data-csp-onclick="processarJsonDaxColado()">📥 Processar dados colados</button>
          </div>
        </details>

        <div style="display:flex;justify-content:flex-end;margin-top:16px;border-top:1px solid #E2E8F0;padding-top:12px;">
          <button type="button" class="btn-secondary-clean" data-csp-onclick="closePowerBiModal()">Fechar</button>
        </div>
      </div>`;
    return div;
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .pbi-feedback-info { background:#EFF6FF; border:1px solid #BFDBFE; color:#1E40AF; }
    .pbi-feedback-success { background:#F0FDF4; border:1px solid #BBF7D0; color:#166534; }
    .pbi-feedback-error { background:#FEF2F2; border:1px solid #FECACA; color:#991B1B; }
    .pbi-badge-sub { font-size:.74rem; font-weight:700; background:rgba(0,0,0,.08); padding:2px 6px; border-radius:4px; font-variant-numeric:tabular-nums; margin-left:2px; }
    @keyframes pbi-spin { to { transform: rotate(360deg); } }
    .pbi-spin { display:inline-block; animation:pbi-spin 1s linear infinite; }
  `;
  document.head.appendChild(styleEl);

  function iniciar() {
    ligarOnTime();
    state.nextAt = Date.now() + 2500; // primeira leitura logo após abrir (dá tempo do On-Time conectar)
    setInterval(tick, 1000);
    atualizarBadge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.POWERBI_SYNC = {
    getConfig: getConfig,
    saveConfig: saveConfig,
    status: status,
    sincronizar: sincronizar,
    executarPowerBiApi: (token) => sincronizar({ token: token }),
    triggerAutoSyncNow: () => sincronizar().catch(() => null),
    processarLinhasPowerBi: processarLinhasPowerBi,
    startContinuousAutoSync: (sec) => { const c = getConfig(); c.intervalSec = Math.max(30, +sec || 120); saveConfig(c); agendar(); }
  };
})();
