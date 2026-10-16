/* Mapa de Stages 2D/3D — DHL Supply Chain
 *
 * Uso: StageMap.mount(elemento, { loadData: () => ({ stages: [...] }) })
 *
 * De onde vêm os dados (nesta ordem):
 *   1. window.StageMapAdapter()  — função do app; pode devolver:
 *        { stages:[ { id:'SO01', embarque:'123', slots:[ {pos:'A', status, lpn, sku, lote, qtd, cap} ] } ] }
 *        ou uma lista de linhas da base (uma por palete) — convertida com StageMap.fromRows
 *        ou uma Promise de qualquer um dos dois (ex.: fetch de um JSON).
 *   2. Detecção automática da base já carregada na página (variáveis globais ou localStorage)
 *      que tenha uma coluna de LPN e uma de stage/localização (ex.: "SO01A", "ST008").
 *   3. Dados de demonstração (com aviso "Demonstração" na barra).
 *
 * Status do palete: conferido | aguardando | divergencia | ativo | livre.
 * Opcional: window.StageMapStatus(lpn, linha) -> status, para usar as bipagens do app.
 * Para forçar atualização: StageMap.refresh() ou window.dispatchEvent(new Event('stagemap:refresh')). */
(function () {
  'use strict';
  var CW = 44, CH = 44, LAB = 34, PLATE = 28, PLATE_GAP = 6, PADH = 8, ZT = 28;
  var GAPW = { parede: 44, corredor: 18, sala: 72 };
  var POS = 'ABCDEFGHIJ'.split('');

  /* Planta física do pátio (conforme o CAD da operação), da ESQUERDA para a DIREITA.
   * ruas: "10" = rua de 10 vagas · "8*3" = 3 ruas de 8 · "6/8" = 6 vagas úteis num espaço de 8 (obstáculo) · "|" = corredor estreito.
   * Entre blocos é desenhada a parede. numeracao: 'direita' = SO01 fica na ponta direita (junto à sala de operações).
   * Para trocar: window.StageMapPlanta = { ... } antes de carregar este arquivo, ou opts.planta (false = sem planta). */
  var PLANTA_CD = {
    prefixo: 'SO', prefixos: ['SO', 'ST'], numeracao: 'esquerda', docas: 30,
    // números dos stages na ordem da numeração (da esquerda para a direita) — termina no ST76 junto à sala de operações
    numeros: '1-76',
    blocos: [
      { nome: 'Stage Outbound · Bloco 1', ruas: '8*2 10*9 8*3 10*9 8*2 10*9' },
      { nome: 'Stage Outbound · Bloco 2', ruas: '10*7 8*3 6/8 10*8 8*3 10*8 8*2 | 8 10*8 10*1', sala: 'Sala de Operações (ST76)' }
    ]
  };
  function parsePlanta(pl) {
    var items = [], lanes = [];
    (pl.blocos || []).forEach(function (b, bi) {
      if (bi) items.push({ t: 'gap', kind: 'parede' });
      String(b.ruas || '').trim().split(/\s+/).forEach(function (tk) {
        if (tk === '|') return items.push({ t: 'gap', kind: 'corredor' });
        var m = /^(\d+)(?:\/(\d+))?(?:\*(\d+))?$/.exec(tk); if (!m) return;
        for (var k = 0; k < (+m[3] || 1); k++) {
          var ln = { t: 's', vagas: +m[1], len: Math.max(+m[1], +m[2] || 0), bloco: bi, nome: b.nome };
          lanes.push(ln); items.push(ln);
        }
      });
      if (b.sala) items.push({ t: 'gap', kind: 'sala', label: b.sala });
    });
    var N = lanes.length, dir = pl.numeracao !== 'esquerda', nums = [];
    String(pl.numeros || '').split(/[\s,;]+/).forEach(function (r) {
      var m = /^(\d+)(?:-(\d+))?$/.exec(r); if (!m) return;
      for (var k = +m[1]; k <= (+m[2] || +m[1]); k++) nums.push(k);
    });
    lanes.forEach(function (ln, i) {
      var seq = dir ? N - i : i + 1;
      ln.n = nums.length ? (nums[seq - 1] || nums[nums.length - 1] + (seq - nums.length)) : seq;
    });
    return { items: items, lanes: lanes };
  }
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var NAMES = { conferido: 'Conferido', aguardando: 'Aguardando conferência', divergencia: 'Divergência', ativo: 'Bipando agora', livre: 'Livre' };
  var ICON = { divergencia: '✖', ativo: '●' };
  var CNAME = { conferido: 'Conferida', parcial: 'Parcial', aguardando: 'Aguardando' };
  var PAL = ['#6D4AFF', '#00A3A3', '#D6336C', '#7A9A01', '#C2651A', '#2F6BFF', '#B8860B', '#8E44AD', '#0E8F5B', '#C0392B'];
  var SVG_GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  var SVG_SYNC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/></svg>';
  var SVG_LOCK = '<svg class="sm-lock" viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var hhmm = function (d, sec) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d ? p(d.getHours()) + ':' + p(d.getMinutes()) + (sec ? ':' + p(d.getSeconds()) : '') : ''; };

  /* ================= Leitura da base (linhas -> stages) ================= */
  var nk = function (k) { return String(k == null ? '' : k).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var ALIAS = {
    lpn: ['lpn', 'lodnum', 'lpnid', 'lpnpalete', 'palete', 'pallet', 'paleteid', 'idpalete', 'etiqueta', 'sscc', 'subnum'],
    loc: ['stagefisico', 'stagefisicoatual', 'localfisico', 'stage', 'stageid', 'stagesistemico', 'stg', 'stoloc', 'dstloc', 'localizacao', 'local', 'location', 'loc', 'endereco', 'posicaostage'],
    pos: ['pos', 'posicao', 'vaga', 'slot', 'posvaga', 'posicaovaga'],
    emb: ['embarque', 'nembarque', 'numembarque', 'numeroembarque', 'embarqueid', 'shipment', 'shipid', 'shipmentid', 'carga', 'carregamento', 'loadid'],
    status: ['status', 'situacao', 'statusconferencia', 'statuspalete', 'statuslpn'],
    conf: ['conferido', 'isconferido', 'bipado', 'validado', 'checked'],
    div: ['divergencia', 'divergente', 'isdivergente', 'divergent'],
    sku: ['sku', 'material', 'prtnum', 'codmaterial', 'codigo', 'item', 'produto'],
    lote: ['lote', 'lotnum', 'lot', 'batch'],
    qtd: ['qtd', 'quantidade', 'qty', 'untqty', 'caixas', 'volumes', 'qtdcaixas'],
    cap: ['cap', 'capacidade', 'caixaspalete', 'qtdpalete', 'cxpalete'],
    desc: ['descricao', 'desc', 'description', 'dscmaterial']
  };
  function keyMap(o) {
    var m = {}, r = { loc: [] };
    Object.keys(o).forEach(function (k) { var n = nk(k); if (!(n in m)) m[n] = k; });
    Object.keys(ALIAS).forEach(function (f) {
      ALIAS[f].forEach(function (a) { if (!(a in m)) return; if (f === 'loc') r.loc.push(m[a]); else if (!r[f]) r[f] = m[a]; });
    });
    return r;
  }
  function isRow(o) { if (!o || typeof o !== 'object' || Array.isArray(o)) return false; var k = keyMap(o); return !!k.lpn && k.loc.length > 0; }
  var LOC_RE = /^\s*([A-Z]{1,4})[\s\-_.]*0*(\d{1,4})[\s\-_.]*([A-Z])?\s*$/i;
  var LOC_LOOSE = /(?:^|[^A-Z0-9])(SO|ST|STG|STAGE)[\s\-_.]*0*(\d{1,4})([A-J])?(?![A-Z0-9])/i;
  function parseLoc(v) {
    var str = String(v == null ? '' : v), m = LOC_RE.exec(str);
    if (m && /^(STG|STAGE)$/i.test(m[1])) m = null;
    if (!m) { m = LOC_LOOSE.exec(str); if (m) m = [m[0], 'SO', m[2], m[3]]; }
    if (!m) return null;
    var n = +m[2], pre = m[1].toUpperCase();
    return { pre: pre, n: n, id: pre + (n < 10 ? '0' : '') + n, pos: m[3] ? m[3].toUpperCase() : null };
  }
  var truthy = function (v) { return v === true || /^(1|s|sim|y|yes|true|x|ok)$/i.test(String(v == null ? '' : v).trim()); };
  function statusOf(r, km) {
    if (km.div && truthy(r[km.div])) return 'divergencia';
    var s = km.status ? nk(r[km.status]) : '';
    if (s) {
      if (/diverg|erro|bloq|avaria|falta|sobra/.test(s)) return 'divergencia';
      if (/^ativo|bipando|atual/.test(s)) return 'ativo';
      if (/aguard|pend|fila|naoconf|aberto/.test(s)) return 'aguardando';
      if (/confer|^ok|valid|conclu|bipado|finaliz|done/.test(s)) return 'conferido';
    }
    if (km.conf && truthy(r[km.conf])) return 'conferido';
    return 'aguardando';
  }
  var RANK = { divergencia: 4, ativo: 3, aguardando: 2, conferido: 1 };
  function worst(g) {
    if (g.some(function (x) { return x.status === 'divergencia'; })) return 'divergencia';
    if (g.some(function (x) { return x.status === 'ativo'; })) return 'ativo';
    return g.every(function (x) { return x.status === 'conferido'; }) ? 'conferido' : 'aguardando';
  }
  function numOr(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : undefined; }

  /* Converte linhas da base (uma por palete) em { stages }. opt: positions, preencher (padrão true), totalStages. */
  function fromRows(rows, opt) {
    opt = opt || {};
    var P = opt.positions || POS, map = {}, km = null, sem = 0, hook = typeof window.StageMapStatus === 'function' ? window.StageMapStatus : null;
    (rows || []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      if (!km || !km.lpn) km = keyMap(r);
      var loc = null;
      for (var i = 0; i < km.loc.length && !loc; i++) loc = parseLoc(r[km.loc[i]]);
      if (!loc) { sem++; return; }
      var s = map[loc.id] || (map[loc.id] = { id: loc.id, pre: loc.pre, n: loc.n, items: [] });
      var pv = km.pos ? String(r[km.pos] == null ? '' : r[km.pos]).trim().toUpperCase() : '';
      var pos = /^\d+$/.test(pv) ? P[+pv - 1] : (pv ? pv.slice(-1) : loc.pos);
      if (P.indexOf(pos) < 0) pos = null;
      var lpn = km.lpn ? r[km.lpn] : null, st = statusOf(r, km);
      if (hook) { try { var h = hook(lpn, r); if (h && RANK[h]) st = h; } catch (e) { /* ignora */ } }
      s.items.push({ pos: pos, status: st, lpn: lpn, sku: km.sku ? r[km.sku] : undefined, lote: km.lote ? r[km.lote] : undefined, qtd: km.qtd ? numOr(r[km.qtd]) : undefined, cap: km.cap ? numOr(r[km.cap]) : undefined, desc: km.desc ? r[km.desc] : undefined, emb: km.emb && r[km.emb] != null && r[km.emb] !== '' ? String(r[km.emb]).trim() : (r.__emb != null ? String(r.__emb) : null) });
    });
    var stages = Object.keys(map).map(function (id) {
      var s = map[id], by = {}, loose = [], ec = {}, over = 0;
      s.items.forEach(function (it) { if (it.emb) ec[it.emb] = (ec[it.emb] || 0) + 1; if (it.pos) (by[it.pos] = by[it.pos] || []).push(it); else loose.push(it); });
      loose.forEach(function (it) { var p = P.filter(function (q) { return !by[q]; })[0]; if (p) by[p] = [it]; else over++; });
      var slots = P.filter(function (q) { return by[q]; }).map(function (q) {
        var g = by[q], f = g[0], x = { pos: q, status: worst(g), lpn: f.lpn, sku: f.sku, lote: f.lote, qtd: f.qtd, cap: f.cap, desc: f.desc };
        if (g.length > 1) x.paletes = g.map(function (y) { return { lpn: y.lpn, status: y.status, sku: y.sku }; });
        return x;
      });
      var embs = Object.keys(ec).sort(function (a, b) { return ec[b] - ec[a]; });
      return { id: s.id, pre: s.pre, n: s.n, embarque: embs[0] || null, embarques: embs, slots: slots, excedente: over };
    });
    if (opt.preencher !== false) {
      var mx = {};
      stages.forEach(function (s) { mx[s.pre] = Math.max(mx[s.pre] || 0, s.n); });
      var pres = Object.keys(mx);
      if (opt.totalStages && pres.length === 1) mx[pres[0]] = Math.max(mx[pres[0]], opt.totalStages);
      pres.forEach(function (pre) {
        for (var n = 1; n <= mx[pre]; n++) {
          var id = pre + (n < 10 ? '0' : '') + n;
          if (!map[id]) stages.push({ id: id, pre: pre, n: n, embarque: null, slots: [] });
        }
      });
    }
    var cnt = {}; stages.forEach(function (s) { cnt[s.pre] = (cnt[s.pre] || 0) + 1; });
    stages.sort(function (a, b) { return a.pre === b.pre ? a.n - b.n : (cnt[b.pre] - cnt[a.pre]) || (a.pre < b.pre ? -1 : 1); });
    stages.forEach(function (s) { delete s.pre; delete s.n; });
    return { stages: stages, semStage: sem, linhas: (rows || []).length };
  }

  /* Aceita {stages}, lista de linhas ou {rows|dados|data|paletes:[...]} */
  function coerce(v, opt) {
    if (!v || typeof v !== 'object') return null;
    if (Array.isArray(v.stages)) return v;
    if (Array.isArray(v)) return v.length && isRow(v[0]) ? fromRows(v, opt) : null;
    var arr = v.rows || v.linhas || v.dados || v.data || v.paletes;
    return Array.isArray(arr) && arr.length && isRow(arr[0]) ? fromRows(arr, opt) : null;
  }

  /* ---------- Detecção automática da base carregada ---------- */
  var PREF = ['StageMapData', 'STAGE_DATA', 'stageData', 'STAGES_DATA', 'BASE_DADOS', 'baseDados', 'dadosBase', 'baseAtual', 'BASE', 'base', 'DADOS', 'dados', 'PALETES', 'paletes', 'pallets', 'dbBase', 'stages'];
  var SKIP = /^(on|webkit|moz|ms)|^(StageMap\w*|ConsolidationPlanner|document|window|self|top|parent|frames|location|navigator|history|localStorage|sessionStorage|indexedDB|caches|crypto|performance|screen|visualViewport|customElements|external|speechSynthesis|clientInformation|styleMedia|chrome|opener|frameElement|mqtt|XLSX|console)$/;
  function asData(v, depth) {
    if (!v || typeof v !== 'object' || v.nodeType || v === window) return null;
    if (Array.isArray(v)) return v.length && isRow(v[0]) ? v : null;
    if (Array.isArray(v.stages) && v.stages[0] && v.stages[0].id != null && Array.isArray(v.stages[0].slots)) return v;
    var ks; try { ks = Object.keys(v).slice(0, 400); } catch (e) { return null; }
    var hits = [];
    ks.forEach(function (k) { var x; try { x = v[k]; } catch (e) { return; } if (Array.isArray(x) && x.length && isRow(x[0])) hits.push(k); });
    if (hits.length === 1) return v[hits[0]];
    if (hits.length > 1) {
      // objeto { embarque: [linhas] } — junta tudo marcando o embarque
      var out = [];
      hits.forEach(function (k) { v[k].forEach(function (r) { var c = {}; for (var f in r) c[f] = r[f]; c.__emb = k; out.push(c); }); });
      return out;
    }
    if (depth >= 1) return null;
    for (var i = 0; i < ks.length; i++) {
      var y; try { y = v[ks[i]]; } catch (e) { continue; }
      if (y && typeof y === 'object' && !Array.isArray(y)) { var r2 = asData(y, depth + 1); if (r2) return r2; }
    }
    return null;
  }
  function readPath(p) {
    if (p.indexOf('localStorage:') === 0) {
      var s; try { s = localStorage.getItem(p.slice(13)); } catch (e) { return null; }
      if (!s || (s[0] !== '[' && s[0] !== '{')) return null;
      try { return asData(JSON.parse(s), 0); } catch (e) { return null; }
    }
    var v; try { v = window[p]; } catch (e) { return null; }
    return asData(v, 0);
  }
  var DET = { path: null, at: 0 };
  function autoDetect() {
    if (DET.path) { var c = readPath(DET.path); if (c) return { name: DET.path, value: c }; DET.path = null; }
    if (Date.now() - DET.at < 10000) return null;
    DET.at = Date.now();
    var keys = PREF.slice(), seen = {};
    try { Object.keys(window).forEach(function (k) { if (!SKIP.test(k)) keys.push(k); }); } catch (e) { /* ignora */ }
    try { for (var i = 0; i < localStorage.length; i++) keys.push('localStorage:' + localStorage.key(i)); } catch (e) { /* ignora */ }
    for (var j = 0; j < keys.length; j++) {
      if (seen[keys[j]]) continue; seen[keys[j]] = 1;
      var d = readPath(keys[j]);
      if (d) { DET.path = keys[j]; return { name: keys[j], value: d }; }
    }
    return null;
  }
  function srcLabel(name) {
    if (!name) return '';
    if (name.indexOf('localStorage:') === 0) return 'Base salva no navegador';
    return 'Base carregada';
  }

  /* ================= Componente ================= */
  var UID = 0;
  function make() {
  var SM = {
    opts: { positions: POS, planta: undefined, loadData: null, onStage: null, onEmbarque: null, planner: false, legenda: true, resumo: true, showFill: false, autoDetect: true, totalStages: 0, inicioNoLado: 'direita', mhe: { metrosStage: 1.3, metrosPos: 1.3, velocidade: 2.0, manuseio: 69 } },
    mode: '2d', tilt: 42, yaw: 0, filter: 'all', q: '', focus: null, data: null, root: null, sig: '', sel: null, id: ++UID, zoom: 1, ct: 0, cy: 0, adv: false, real: false, raw: null, view: 'antes', po: { destino: 'completar', liberar: true, aguard: false }, plan: null,
    src: null, err: null, loading: false, updated: null, checked: null, req: 0, tw: 0
  };

  SM.mount = function (el, opts) {
    SM.root = el; el.classList.add('sm-root');
    for (var k in (opts || {})) SM.opts[k] = opts[k];
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('input', onInput);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', hideTip);
    window.addEventListener('resize', function () { if (visible()) fit(); });
    SM.refresh(true);
  };

  function visible() { return SM.root && SM.root.offsetParent !== null; }
  SM.visible = visible;

  SM.refresh = function (force) {
    var out = null, err = null;
    if (SM.opts.loadData) { try { out = SM.opts.loadData(); } catch (e) { err = e; } }
    if (out && typeof out.then === 'function') {
      var tk = ++SM.req; SM.loading = true; status();
      out.then(function (v) { if (tk === SM.req) { SM.loading = false; apply(v, null, force); } },
               function (e) { if (tk === SM.req) { SM.loading = false; apply(null, e || new Error('Falha ao carregar'), force); } });
      return;
    }
    apply(out, err, force);
  };
  function apply(out, err, force) {
    if (!force && !err && out && out === SM._last) return status(); // adaptador devolveu o mesmo objeto: nada mudou
    SM._last = out;
    var o = SM.opts, d = coerce(out, o), src = d ? (out.fonte || out.source || 'Base do app') : null;
    if (!d && o.autoDetect !== false) {
      var a = autoDetect();
      if (a) { d = coerce(a.value, o); src = srcLabel(a.name); }
    }
    if (!d) {
      if (SM.raw && !SM.raw.demo && (err || SM.src)) { SM.err = err || new Error('A fonte de dados não respondeu'); return status(); } // mantém a última leitura boa
      if (!SM.raw && window.console) console.info('[StageMap] Nenhuma fonte de dados encontrada — exibindo demonstração. Defina window.StageMapAdapter.');
      d = demo(o.planner); src = null;
    }
    SM.err = err; SM.src = src; SM.checked = new Date();
    var sig = JSON.stringify(d);
    if (!force && sig === SM.sig) return status();
    SM.sig = sig; SM.updated = new Date(); SM.raw = arrange(norm(JSON.parse(sig)));
    if (SM.raw.focus != null && !SM._f) { SM.focus = String(SM.raw.focus); SM._f = 1; }
    build(); render();
  }
  SM.setMode = function (m) { if (m === SM.mode) return; SM.mode = m; applyMode(true); };
  var CAMS = { frente: { tilt: 42, yaw: 0 }, iso: { tilt: 52, yaw: -8 } };
  SM.cam = function (name) {
    var c = CAMS[name]; if (!c) return;
    SM.tilt = c.tilt; SM.yaw = c.yaw; SM.mode = '3d'; syncSliders(); applyMode(true);
  };
  function syncSliders() {
    ['tilt', 'yaw'].forEach(function (k) { var i = SM.root.querySelector('[data-r="' + k + '"]'); if (i) i.value = Math.round(SM[k]); });
    var z = SM.root.querySelector('[data-r="zoom"]'); if (z) z.value = Math.round(SM.zoom * 100);
  }
  function refit() { if (SM.raf) cancelAnimationFrame(SM.raf); SM.raf = requestAnimationFrame(fit); }
  function onDown(ev) {
    if (ev.button !== 0 || !ev.target.closest('.sm-viewport') || ev.target.closest('.sm-plate') || ev.target.closest('.sm-pal') || ev.target.closest('button')) return;
    var vp = SM.root.querySelector('.sm-viewport');
    var st = { x: ev.clientX, sl: vp.scrollLeft, moved: false };
    var move = function (e) {
      var dx = e.clientX - st.x;
      if (!st.moved && Math.abs(dx) < 6) return;
      st.moved = true; hideTip();
      vp.scrollLeft = st.sl - dx;
    };
    var up = function () {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      if (st.moved) { SM.noClick = true; setTimeout(function () { SM.noClick = false; }, 0); }
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function onWheel(ev) {
    if (!ev.ctrlKey || !ev.target.closest('.sm-viewport')) return;
    ev.preventDefault();
    SM.zoom = Math.max(0.5, Math.min(2, SM.zoom * (ev.deltaY < 0 ? 1.08 : 1 / 1.08)));
    syncSliders(); refit();
  }
  SM.setFilter = function (f) { SM.filter = f || 'all'; syncFilter(); applyDim(); };
  SM.setSearch = function (q) { SM.q = q || ''; applyDim(); };
  SM.setFocus = function (id) { SM.focus = id == null || id === '' ? null : String(id); SM._f = 1; if (SM.raw) refocus(); };

  function build() {
    var d = SM.raw, v = { stages: d.stages, demo: d.demo, focus: d.focus, zonas: d.zonas, routes: d.routes || [], semStage: d.semStage || 0 };
    SM.plan = null;
    if (SM.opts.planner && window.ConsolidationPlanner) {
      SM.plan = window.ConsolidationPlanner.plan(d, { embarque: SM.focus, destino: SM.po.destino, liberarStages: SM.po.liberar, incluirAguardando: SM.po.aguard, positions: SM.opts.positions });
      v.routes = SM.plan.routes;
      var mh = SM.opts.mhe, ix = {}, tot = 0, seg = 0;
      d.stages.forEach(function (st, n) { var g = SM.geo && SM.geo.at[st.id]; ix[st.id] = g ? g.x / CW : n; });
      SM.plan.routes.forEach(function (r) {
        var dist = Math.abs(ix[r.to.id] - ix[r.from.id]) * mh.metrosStage + Math.abs(SM.opts.positions.indexOf(r.to.pos) - SM.opts.positions.indexOf(r.from.pos)) * mh.metrosPos;
        r.dist = Math.round(dist); r.seg = Math.round(dist / mh.velocidade + mh.manuseio);
        tot += r.dist; seg += r.seg;
      });
      SM.plan.stats.dist = tot; SM.plan.stats.seg = seg;
      SM.plan.stats.pph = seg ? Math.round(SM.plan.routes.length * 3600 / seg) : 0;
      if (SM.view === 'depois') { v.stages = SM.plan.after; v.routes = []; }
    }
    SM.data = v;
  }
  function fmtT(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), r = sec % 60; return m ? m + 'min ' + (r < 10 ? '0' : '') + r + 's' : r + 's'; }
  function refocus() { if (SM.opts.planner) { build(); render(); } else { chips(); applyDim(); } }
  function norm(d) {
    d.stages.forEach(function (s) { s.id = String(s.id); (s.slots || []).forEach(function (x) { if (x.status === 'parcial') x.status = 'aguardando'; }); });
    return d;
  }
  /* Encaixa os stages da base nas ruas da planta (por número: SO08 = ST008 = rua 8) e calcula a geometria */
  function arrange(d) {
    var o = SM.opts, P = o.positions, pl = o.planta === undefined ? (window.StageMapPlanta || PLANTA_CD) : o.planta;
    var items, lanes, side;
    if (pl && pl.blocos) {
      var G = parsePlanta(pl), pre = pl.prefixo || 'SO', alias = pl.prefixos || [pre], byN = {}, extra = [], used = {};
      d.stages.forEach(function (s) { var L = parseLoc(s.id); if (L && !L.pos && alias.indexOf(L.pre) > -1 && !byN[L.n]) byN[L.n] = s; else extra.push(s); });
      G.lanes.forEach(function (ln) {
        var s = byN[ln.n] || { id: pre + pad2(ln.n), embarque: null, slots: [] };
        used[ln.n] = 1;
        s.vagas = Math.min(P.length, +s.capacidade || +s.vagas || ln.vagas);
        s.len = Math.max(ln.len, s.vagas);
        ln.id = s.id; ln.s = s;
      });
      Object.keys(byN).forEach(function (n) { if (!used[n]) extra.push(byN[n]); });
      items = G.items; lanes = G.lanes.slice().sort(function (a, b) { return a.n - b.n; });
      if (extra.length) {
        items.push({ t: 'gap', kind: 'parede' });
        extra.forEach(function (s) { s.vagas = Math.min(P.length, +s.capacidade || +s.vagas || P.length); s.len = s.vagas; var ln = { t: 's', id: s.id, s: s, bloco: 'x', nome: 'Fora da planta' }; items.push(ln); lanes.push(ln); });
      }
      side = pl.numeracao === 'esquerda' ? 'esquerda' : 'direita';
      SM.docas = +pl.docas || 0;
    } else {
      side = o.inicioNoLado === 'direita' ? 'direita' : 'esquerda';
      lanes = d.stages.map(function (s) { s.vagas = Math.min(P.length, +s.capacidade || +s.vagas || P.length); s.len = s.vagas; return { t: 's', id: s.id, s: s, bloco: 0, nome: 'Stage Outbound' }; });
      items = side === 'direita' ? lanes.slice().reverse() : lanes;
      SM.docas = 0;
    }
    var M = 1, x = 0;
    lanes.forEach(function (ln) { M = Math.max(M, ln.s.len); });
    items.forEach(function (it) {
      if (it.t !== 's') { it.x = x; x += GAPW[it.kind] || 24; return; }
      it.x = x; it.top = ZT + LAB + (M - it.s.len) * CH; x += CW;
    });
    var at = {}; items.forEach(function (it) { if (it.t === 's') at[it.id] = it; });
    SM.geo = { items: items, at: at, maxLen: M, W: x, H: ZT + LAB + PLATE + PLATE_GAP + M * CH, side: side };
    d.stages = lanes.map(function (ln) { return ln.s; });
    return d;
  }
  function vagasOf(s) { return SM.opts.positions.slice(0, s.vagas || SM.opts.positions.length); }
  function cargaStatus(e) { return e.tot && e.ok === e.tot ? 'conferido' : e.ok > 0 ? 'parcial' : 'aguardando'; }
  function blocked(s) { try { return (typeof window.isStageBlocked === 'function' && !!window.isStageBlocked(s.id)) || !!s.isBlocked; } catch (e) { return !!s.isBlocked; } }
  function occOf(s) { return (s.slots || []).filter(function (x) { return x.status && x.status !== 'livre'; }); }

  function summary(list) {
    var k = { stages: list.length, vagas: 0, ocup: 0, pal: 0, conferido: 0, aguardando: 0, divergencia: 0, ativo: 0, livre: 0, bloq: 0 };
    list.forEach(function (s) {
      var occ = occOf(s);
      k.vagas += vagasOf(s).length;
      if (occ.length) k.ocup++; else k.livre++;
      if (blocked(s)) k.bloq++;
      occ.forEach(function (x) { var n = x.paletes && x.paletes.length > 1 ? x.paletes.length : 1; k.pal += n; if (k[x.status] != null) k[x.status] += n; });
    });
    return k;
  }

  function render() {
    var d = SM.data, o = SM.opts, P = o.positions, emb = {}, order = [];
    d.stages.forEach(function (s) {
      if (s.embarque == null) return;
      var e = emb[s.embarque];
      if (!e) { e = emb[s.embarque] = { id: s.embarque, n: 0, tot: 0, ok: 0, bad: 0, color: PAL[order.length % PAL.length] }; order.push(s.embarque); }
      e.n++;
      occOf(s).forEach(function (x) { e.tot++; if (x.status === 'conferido') e.ok++; if (x.status === 'divergencia') e.bad++; });
    });

    var h = '<div class="sm-bar"><div class="sm-seg" role="group" aria-label="Modo de visualização"><button data-m="2d">2D</button><button data-m="3d">3D</button></div>' +
      '<div class="sm-seg" data-3d role="group" aria-label="Câmera"><button data-cam="frente">Frente</button><button data-cam="iso">Isométrica</button></div>' +
      '<button class="sm-icon' + (SM.adv ? ' on' : '') + '" data-gear title="Câmera, zoom e visual" aria-label="Ajustes de câmera e visual">' + SVG_GEAR + '</button>' +
      '<div class="sm-bar-end"><span class="sm-src" aria-live="polite"></span><button class="sm-icon" data-refresh title="Atualizar agora" aria-label="Atualizar dados">' + SVG_SYNC + '</button></div></div>' +
      '<div class="sm-adv' + (SM.adv ? ' open' : '') + '">' +
      '<label class="sm-rng" data-3d>Inclinação <input type="range" min="15" max="75" value="' + SM.tilt + '" data-r="tilt"></label>' +
      '<label class="sm-rng" data-3d>Giro <input type="range" min="-60" max="60" value="' + SM.yaw + '" data-r="yaw"></label>' +
      '<label class="sm-rng">Zoom <input type="range" min="50" max="200" value="' + Math.round(SM.zoom * 100) + '" data-r="zoom"></label>' +
      '<label class="sm-tog" data-3d><input type="checkbox" data-real' + (SM.real ? ' checked' : '') + '> Visual realista</label>' +
      '<span class="sm-hint">Arraste: girar (3D) ou mover (2D) · Shift+arraste: mover · Ctrl+scroll: zoom</span></div>';

    if (o.resumo && !o.planner) {
      var k = summary(d.stages), pct = k.pal ? Math.round(100 * k.conferido / k.pal) : 0;
      var it = function (f, cls, val, lab, tip) { return '<button class="sm-kpi ' + cls + '" data-f="' + f + '" title="' + esc(tip) + '"><b>' + val + '</b><span>' + lab + '</span></button>'; };
      h += '<div class="sm-sum">' +
        it('all', 'k-all', k.ocup + '<small>/' + k.stages + '</small>', 'stages ocupados', 'Mostrar todos os stages') +
        it('all', 'k-pal', k.pal + '<small>/' + k.vagas + ' vagas</small>', 'paletes', 'Paletes no pátio / vagas físicas da planta') +
        it('conferido', 'k-ok', k.conferido + '<small>' + pct + '%</small>', 'conferidos', 'Stages 100% conferidos') +
        it('aguardando', 'k-wait', k.aguardando, 'aguardando', 'Stages com paletes aguardando conferência') +
        it('divergencia', 'k-bad', k.divergencia + (k.bloq ? '<small>' + k.bloq + ' bloq.</small>' : ''), 'divergências', 'Stages com divergência ou bloqueados') +
        it('livre', 'k-free', k.livre, 'stages livres', 'Stages sem paletes') +
        '<div class="sm-prog" title="' + pct + '% dos paletes conferidos"><i style="width:' + pct + '%"></i></div></div>';
    }

    if (order.length) h += '<div class="sm-embs">' + order.map(function (id) {
      var e = emb[id], pct = e.tot ? Math.round(100 * e.ok / e.tot) : 0, cs = cargaStatus(e);
      return '<button class="sm-chip' + (SM.focus === id ? ' on' : '') + '" data-e="' + esc(id) + '" style="--hc:' + e.color + '" title="Embarque ' + esc(id) + ' · ' + CNAME[cs] + ' · ' + e.ok + '/' + e.tot + (e.bad ? ' · ' + e.bad + ' divergência(s)' : '') + '"><u class="sm-dot s-' + cs + '"></u><b>Emb. ' + esc(id) + '</b><span>' + e.ok + '/' + e.tot + '</span>' + (e.bad ? '<i class="sm-badc">' + e.bad + '</i>' : '') + '<em style="width:calc((100% - 16px)*' + (pct / 100) + ')"></em></button>';
    }).join('') + '</div>';

    if (o.planner) {
      h += '<div class="sm-plan"><div class="sm-seg"><button data-v="antes" class="' + (SM.view === 'antes' ? 'on' : '') + '">Antes</button><button data-v="depois" class="' + (SM.view === 'depois' ? 'on' : '') + '">Depois</button></div>' +
        '<label>Destino <select data-po="destino"><option value="completar"' + (SM.po.destino === 'completar' ? ' selected' : '') + '>Completar palete existente</option><option value="novo"' + (SM.po.destino === 'novo' ? ' selected' : '') + '>Montar palete novo</option></select></label>' +
        '<label><input type="checkbox" data-po="liberar"' + (SM.po.liberar ? ' checked' : '') + '> Liberar stages inteiros</label>' +
        '<label><input type="checkbox" data-po="aguard"' + (SM.po.aguard ? ' checked' : '') + '> Incluir aguardando</label></div>';
      if (SM.plan) {
        var ks = SM.plan.stats;
        h += '<div class="sm-kpis"><div><b>' + ks.antes + ' → ' + ks.depois + '</b><span>paletes</span></div><div class="g"><b>' + ks.liberados + '</b><span>vagas (' + ks.pct + '%)</span></div><div class="g"><b>' + ks.stagesLiberados + '</b><span>stages livres</span></div><div><b>' + ks.movimentos + '</b><span>movimentos</span></div><div><b>' + (ks.dist || 0) + ' m</b><span>distância</span></div><div><b>' + fmtT(ks.seg || 0) + '</b><span>tempo</span></div></div>';
      }
    }
    var R_ = d.routes || [];
    if (R_.length) h += '<div class="sm-rlist"><span class="sm-rtitle" title="Linha cheia: juntar paletes · tracejada: mover palete">Rota · ' + R_.length + '</span>' + R_.map(function (r, i) {
      var tip = [r.qtd ? r.qtd + ' cx' : '', r.seg ? r.dist + ' m · ' + fmtT(r.seg) : '', r.label || ''].filter(Boolean).join(' · ');
      return '<button class="sm-rchip' + (r.type === 'move' ? ' mv' : '') + '" data-ri="' + i + '" title="' + esc(tip) + '"><em>' + (i + 1) + '</em>' + esc(r.from.id) + esc(r.from.pos) + ' → ' + esc(r.to.id) + esc(r.to.pos) + '</button>';
    }).join('') + '</div>';

    h += '<div class="sm-viewport"><div class="sm-floor" data-mode="' + SM.mode + '" data-look="' + (SM.real ? 'real' : 'clean') + '">';
    if (!d.stages.length) h += '<div class="sm-empty"><b>Nenhum stage na base</b><span>Atualize a base (Excel, SQL ou Power BI) para ver o pátio.</span></div>';
    else h += yard(d, emb);
    h += '</div></div>';
    if (o.legenda) {
      h += '<div class="sm-foot"><div class="sm-leg">' + ['conferido', 'aguardando', 'divergencia', 'ativo'].map(function (k) {
        return '<span><i class="st-' + k + '"></i>' + NAMES[k] + '</span>';
      }).join('') + '<span><i class="lg-livre"></i>Vaga livre</span><span><i class="lg-bloq"></i>Stage bloqueado</span><span class="sm-sep">Carga</span>' + ['conferido', 'parcial', 'aguardando'].map(function (k) {
        return '<span><u class="sm-dot s-' + k + '"></u>' + CNAME[k] + '</span>';
      }).join('') + '</div>' + (d.semStage ? '<span class="sm-warn" title="Linhas da base sem stage/localização reconhecível">' + d.semStage + ' palete(s) sem stage</span>' : '') + '</div>';
    }
    h += '<div class="sm-tip" role="tooltip"></div>';
    var vp0 = SM.root.querySelector('.sm-viewport'), sl = vp0 ? vp0.scrollLeft : 0;
    SM.root.innerHTML = h;
    SM.emb = emb;
    var vp1 = SM.root.querySelector('.sm-viewport'); if (vp1) vp1.scrollLeft = sl;
    status(); syncFilter(); applyMode(); applyDim(); selRoutes();
  }

  function yard(d, emb) {
    var G = SM.geo, P = SM.opts.positions, M = G.maxLen, byId = {}, h = '', hulls = '', blk = {}, blkOrder = [], runs = [], cur = null;
    d.stages.forEach(function (s) { byId[s.id] = s; });
    G.items.forEach(function (it) {
      if (it.t !== 's') {
        var Y0 = ZT + LAB;
        h += '<div class="sm-gap g-' + it.kind + '" style="left:' + it.x + 'px;width:' + (GAPW[it.kind] || 24) + 'px;top:' + (it.kind === 'sala' ? Y0 - LAB + 6 : Y0) + 'px;bottom:0">' + (it.label ? '<span>' + esc(it.label) + '</span>' : '') + '</div>';
        cur = null; return;
      }
      var s = byId[it.id] || it.s;
      var b = blk[it.bloco]; if (!b) { b = blk[it.bloco] = { a: it.x, l: s.id, nome: it.nome }; blkOrder.push(it.bloco); }
      b.b = it.x + CW; b.r = s.id;
      h += stageHtml(s, it.x, it.top);
      if (s.embarque != null && cur && cur.e === s.embarque) { cur.b = it.x + CW; cur.len = Math.max(cur.len, s.len); cur.n++; }
      else { cur = s.embarque != null && emb[s.embarque] ? { e: s.embarque, a: it.x, b: it.x + CW, len: s.len, n: 1 } : null; if (cur) runs.push(cur); }
    });
    var zones = blkOrder.map(function (k) {
      var b = blk[k], L = parseLoc(b.l), R = parseLoc(b.r), arrow = L && R && L.n > R.n ? ' ← ' : ' → ';
      return '<div class="sm-zone" style="left:' + b.a + 'px;width:' + (b.b - b.a) + 'px"><b>' + esc(b.nome) + '</b><span>' + esc(b.l) + arrow + esc(b.r) + '</span></div>';
    }).join('');
    runs.forEach(function (r) {
      var e = emb[r.e], cs = cargaStatus(e), top = ZT + LAB - PADH + (M - r.len) * CH;
      hulls += '<div class="sm-hull" data-e="' + esc(r.e) + '" style="--hc:' + e.color + ';left:' + r.a + 'px;top:' + top + 'px;width:' + (r.b - r.a) + 'px;height:' + (PADH + PLATE + PLATE_GAP + r.len * CH + PADH) + 'px">' +
        '<button class="sm-hlabel s-' + cs + '" data-e="' + esc(r.e) + '" title="Embarque ' + esc(r.e) + ' · ' + e.ok + '/' + e.tot + ' conferidos">' +
        '<u class="sm-dot s-' + cs + '"></u>' +
        '<b>Emb. ' + esc(r.e) + '</b>' +
        '<span>' + e.ok + '/' + e.tot + '</span>' +
        '</button></div>';
    });
    return '<div class="sm-yard" style="width:' + G.W + 'px;height:' + G.H + 'px"><div class="sm-zones">' + zones + '</div>' + h + hulls + routeSvg(d.routes || []) + '</div>' + docks(G.W, d.docas, emb);
  }

  function stageHtml(s, x, top) {
    var P = SM.opts.positions, V = vagasOf(s), isBlk = blocked(s), occ = occOf(s), len = s.len || V.length;
    var fora = occ.filter(function (q) { return V.indexOf(q.pos) < 0; }).length + (s.excedente || 0);
    var h = '<div class="sm-stage' + (isBlk ? ' is-blocked' : '') + '" data-id="' + esc(s.id) + '" style="left:' + x + 'px;top:' + top + 'px">' +
      '<button class="sm-plate' + (isBlk ? ' st-blocked' : '') + (s.liberado ? ' free' : '') + '" data-st="' + esc(s.id) + '" aria-label="Stage ' + esc(s.id) + (isBlk ? ' (bloqueado)' : '') + ', ' + occ.length + ' de ' + V.length + ' vagas ocupadas">' +
      (isBlk ? SVG_LOCK : '') + esc(s.id) +
      (s.embarque ? '<span class="sm-plate-emb" title="Embarque ' + esc(s.embarque) + '">' + esc(s.embarque) + '</span>' : '') +
      (fora ? '<sup title="Paletes sem vaga">+' + fora + '</sup>' : '') + '</button><div class="sm-slots">';
    for (var i = 0; i < len; i++) {
      if (i >= V.length) { h += '<div class="sm-slot obst" title="Sem vaga útil (obstáculo)"></div>'; continue; }
      var p = P[i], x2 = (s.slots || []).filter(function (q) { return q.pos === p; })[0] || {}, st = x2.status || 'livre';
      if (st === 'livre') { h += '<div class="sm-slot"><span class="sm-pl">' + p + '</span></div>'; continue; }
      var pc = SM.opts.showFill && x2.qtd > 0 && x2.cap > 0 ? Math.min(100, Math.round(100 * x2.qtd / x2.cap)) : null;
      var nP = x2.paletes ? x2.paletes.length : (x2.fracionado ? 3 : x2.duplado ? 2 : 1);
      h += '<div class="sm-slot has"><i class="sm-pal st-' + st + (x2.chg ? ' chg' : '') + '" data-s="' + esc(s.id) + '" data-p="' + p + '"><b>' + (isBlk ? '' : (ICON[st] || '')) + '</b>' +
        (nP > 1 ? '<span class="sm-stack-badge">' + nP + 'x</span>' : '') + (pc != null ? '<s class="sm-fill' + (pc < 100 ? ' part' : '') + '" style="width:' + pc + '%"></s>' : '') + '</i></div>';
    }
    return h + '</div></div>';
  }

  /* Corredor + docas (como no CAD). d.docas opcional: [{ doca:'DOCA05'|5, embarque:'123' }] */
  function docks(W, info, emb) {
    var n = SM.docas; if (!n) return '';
    var map = {};
    (info || []).forEach(function (x) { var m = /(\d+)/.exec(String(x.doca == null ? x.id : x.doca)); if (m) map[+m[1]] = x; });
    var sp = W / n, h = '<div class="sm-dock" style="width:' + W + 'px"><div class="sm-aisle"></div>';
    for (var i = 1; i <= n; i++) {
      var x = map[i], e = x && x.embarque != null ? emb[x.embarque] : null;
      h += '<div class="sm-door' + (x && x.embarque != null ? ' on' : '') + '" style="left:' + ((i - 1) * sp + (sp - 32) / 2) + 'px' + (e ? ';--hc:' + e.color : '') + '" title="DOCA' + pad2(i) + (x && x.embarque != null ? ' · Embarque ' + esc(x.embarque) : '') + '"><i></i><span>' + (i % 5 === 0 || i === 1 ? 'DOCA' : '') + pad2(i) + '</span></div>';
    }
    return h + '</div>';
  }

  function routeSvg(routes) {
    if (!routes.length) return '';
    var G = SM.geo, P = SM.opts.positions, at = G.at, mk = 'smar' + SM.id;
    var cx = function (id) { return at[id].x + CW / 2; };
    var cy = function (id, p) { return at[id].top + PLATE + PLATE_GAP + P.indexOf(p) * CH + CH / 2; };
    var o = '<svg class="sm-routes" width="' + G.W + '" height="' + G.H + '" viewBox="0 0 ' + G.W + ' ' + G.H + '"><defs><marker id="' + mk + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0f172a"/></marker></defs>';
    var last = -1;
    routes.forEach(function (r, i) { if (at[r.from.id] && at[r.to.id]) last = i; });
    routes.forEach(function (r, i) {
      if (!at[r.from.id] || !at[r.to.id]) return;
      var x1 = cx(r.from.id), y1 = cy(r.from.id, r.from.pos), x2 = cx(r.to.id), y2 = cy(r.to.id, r.to.pos);
      var dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy) || 1, b = Math.min(60, d * .25) * (i % 2 ? -1 : 1);
      var qx = (x1 + x2) / 2 - dy / d * b, qy = (y1 + y2) / 2 + dx / d * b, ex = x2 - qx, ey = y2 - qy, el = Math.sqrt(ex * ex + ey * ey) || 1;
      var p = 'M' + x1 + ' ' + y1 + 'Q' + qx + ' ' + qy + ' ' + (x2 - ex / el * 11) + ' ' + (y2 - ey / el * 11);
      o += '<g class="rt' + (r.type === 'move' ? ' mv' : '') + '" data-ri="' + i + '">' +
        '<rect x="' + (x2 - CW / 2 + 2) + '" y="' + (y2 - CH / 2 + 2) + '" width="' + (CW - 4) + '" height="' + (CH - 4) + '" rx="3" fill="rgba(47,107,255,.28)" stroke="#2F6BFF" stroke-width="2" stroke-dasharray="4 3"/>' +
        '<rect x="' + (x1 - CW / 2 + 2) + '" y="' + (y1 - CH / 2 + 2) + '" width="' + (CW - 4) + '" height="' + (CH - 4) + '" rx="3" fill="none" stroke="#0f172a" stroke-width="2"/>' +
        '<path d="' + p + '" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".85"/>' +
        '<path d="' + p + '" fill="none" stroke="#0f172a" stroke-width="2.6" stroke-linecap="round" marker-end="url(#' + mk + ')"/>' +
        '<circle cx="' + x1 + '" cy="' + y1 + '" r="9" fill="#0f172a" stroke="#fff" stroke-width="1.5"/>' +
        '<text x="' + x1 + '" y="' + y1 + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="10" font-weight="800">' + (i + 1) + '</text>' +
        (i === 0 ? '<g><rect x="' + (x1 - 20) + '" y="' + (y1 - CH / 2 - 14) + '" width="40" height="14" rx="3" fill="#1f9d63"/><text x="' + x1 + '" y="' + (y1 - CH / 2 - 7) + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9" font-weight="800">Início</text></g>' : '') +
        (i === last ? '<g><rect x="' + (x2 - 14) + '" y="' + (y2 - CH / 2 - 14) + '" width="28" height="14" rx="3" fill="#2563eb"/><text x="' + x2 + '" y="' + (y2 - CH / 2 - 7) + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9" font-weight="800">Fim</text></g>' : '') +
        '</g>';
    });
    return o + '</svg>';
  }
  function selRoutes() {
    var R = SM.root; if (!R) return;
    [].forEach.call(R.querySelectorAll('g.rt'), function (g) { g.classList.toggle('dim', SM.sel != null && +g.dataset.ri !== SM.sel); });
    [].forEach.call(R.querySelectorAll('.sm-rchip'), function (c) { c.classList.toggle('on', SM.sel != null && +c.dataset.ri === SM.sel); });
  }
  function chips() {
    [].forEach.call(SM.root.querySelectorAll('.sm-chip'), function (c) { c.classList.toggle('on', c.dataset.e === SM.focus); });
  }
  function syncFilter() {
    if (!SM.root) return;
    [].forEach.call(SM.root.querySelectorAll('.sm-kpi'), function (b) { b.classList.toggle('on', SM.filter !== 'all' && b.dataset.f === SM.filter); });
  }

  /* Indicador de origem/atualização dos dados */
  function status() {
    var el = SM.root && SM.root.querySelector('.sm-src'); if (!el) return;
    var btn = SM.root.querySelector('[data-refresh]'); if (btn) btn.classList.toggle('spin', SM.loading);
    var cls, txt, tip;
    if (SM.loading) { cls = 'load'; txt = 'Carregando dados…'; tip = 'Buscando a base mais recente'; }
    else if (SM.err) { cls = 'bad'; txt = 'Falha na leitura · exibindo ' + hhmm(SM.updated); tip = String(SM.err && SM.err.message || SM.err); }
    else if (!SM.src) { cls = 'demo'; txt = 'Demonstração'; tip = 'Nenhuma base encontrada. Carregue a planilha/SQL/Power BI ou defina window.StageMapAdapter no app.'; }
    else { cls = 'ok'; txt = SM.src + ' · ' + hhmm(SM.updated, true); tip = 'Última alteração: ' + hhmm(SM.updated, true) + ' · verificado às ' + hhmm(SM.checked, true) + ' · atualiza a cada 4s'; }
    el.className = 'sm-src ' + cls; el.textContent = txt; el.title = tip;
  }

  function camVars(t, y) {
    var f = SM.root.querySelector('.sm-floor'); if (!f) return;
    SM.ct = t; SM.cy = y;
    f.style.setProperty('--tilt', t + 'deg'); f.style.setProperty('--yaw', y + 'deg');
  }
  function tween(tt, ty, done) {
    var t0 = null, ft = SM.ct, fy = SM.cy, id = ++SM.tw;
    if (!visible()) { camVars(tt, ty); if (done) done(); return; }
    (function step(now) {
      if (id !== SM.tw) return;
      if (t0 == null) t0 = now;
      var k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      camVars(ft + (tt - ft) * e, fy + (ty - fy) * e); fit();
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    })(performance.now());
  }
  function applyMode(anim) {
    var R = SM.root, f = R.querySelector('.sm-floor'); if (!f) return;
    var is3 = SM.mode === '3d', tt = is3 ? SM.tilt : 0, ty = is3 ? SM.yaw : 0;
    f.dataset.mode = SM.mode;
    [].forEach.call(R.querySelectorAll('.sm-seg button[data-m]'), function (b) { b.classList.toggle('on', b.dataset.m === SM.mode); b.setAttribute('aria-pressed', b.dataset.m === SM.mode); });
    [].forEach.call(R.querySelectorAll('[data-3d]'), function (l) { l.classList.toggle('off', !is3); });
    var flat = function () { if (!is3) f.setAttribute('data-flat', ''); };
    if (is3) f.removeAttribute('data-flat');
    if (anim && visible()) tween(tt, ty, flat);
    else { SM.tw++; camVars(tt, ty); flat(); if (visible()) fit(); }
  }

  function fit() {
    var R = SM.root, vp = R.querySelector('.sm-viewport'), f = R.querySelector('.sm-floor'); if (!vp || !f) return;
    var vw = vp.clientWidth, tx = 0, ty = 0;
    var set = function () { f.style.setProperty('--z', SM.zoom); f.style.setProperty('--tx', tx + 'px'); f.style.setProperty('--ty', ty + 'px'); };
    var rel = function () { var r = f.getBoundingClientRect(), v = vp.getBoundingClientRect(); return { l: r.left - v.left + vp.scrollLeft, t: r.top - v.top, w: r.width, h: r.height }; };
    set(); vp.style.height = '9999px';
    var r;
    for (var n = 0; n < 3; n++) { r = rel(); tx += Math.max(0, (vw - r.w) / 2) - r.l; ty += 4 - r.t; set(); }
    r = rel();
    var hmax = Math.max(420, Math.round(window.innerHeight * 0.75)), hh = Math.ceil(r.h + 24);
    vp.style.height = Math.min(hh, hmax) + 'px';
    vp.style.overflowY = hh > hmax ? 'auto' : 'hidden';
    if (!SM._scrolled) {
      vp.scrollLeft = SM.geo && SM.geo.side === 'direita' ? vp.scrollWidth : 0;
      SM._scrolled = 1;
    }
  }
  SM.fit = function () { if (visible()) fit(); };

  function applyDim() {
    var R = SM.root; if (!R || !SM.data) return;
    var q = SM.q.trim().toLowerCase(), f = SM.filter, fo = SM.focus, ok = {}, ebOk = {};
    var fm = function (s) {
      var occ = occOf(s), has = function (t) { return occ.some(function (x) { return x.status === t; }); };
      if (f === 'all') return true;
      if (f === 'parcial') { var e = SM.emb[s.embarque]; return !!e && cargaStatus(e) === 'parcial'; }
      if (f === 'conferido') return occ.length > 0 && occ.every(function (x) { return x.status === 'conferido'; });
      if (f === 'aguardando') return has('aguardando');
      if (f === 'divergencia') return has('divergencia') || blocked(s);
      if (f === 'livre') return !occ.length;
      return true;
    };
    var lpnHit = function (s) { return (s.slots || []).some(function (x) { return String(x.lpn == null ? '' : x.lpn).toLowerCase().indexOf(q) > -1 || (x.paletes || []).some(function (y) { return String(y.lpn == null ? '' : y.lpn).toLowerCase().indexOf(q) > -1; }); }); };
    SM.data.stages.forEach(function (s) {
      var m = fm(s) && (!q || String(s.id).toLowerCase().indexOf(q) > -1 || String(s.embarque == null ? '' : s.embarque).toLowerCase().indexOf(q) > -1 || (q.length >= 4 && lpnHit(s))) && (fo == null || String(s.embarque) === String(fo));
      ok[s.id] = m; if (m && s.embarque != null) ebOk[s.embarque] = true;
    });
    [].forEach.call(R.querySelectorAll('.sm-stage'), function (el) { el.classList.toggle('is-dim', !ok[el.dataset.id]); });
    [].forEach.call(R.querySelectorAll('.sm-hull'), function (el) { el.classList.toggle('is-dim', !ebOk[el.dataset.e]); });
  }

  function stageById(id) { return SM.data.stages.filter(function (x) { return String(x.id) === String(id); })[0]; }
  function onClick(ev) {
    var t = ev.target, b;
    if (SM.noClick) return;
    if ((b = t.closest('[data-refresh]'))) { DET.at = 0; return SM.refresh(true); }
    if ((b = t.closest('[data-gear]'))) { SM.adv = !SM.adv; b.classList.toggle('on', SM.adv); var ad = SM.root.querySelector('.sm-adv'); if (ad) ad.classList.toggle('open', SM.adv); return; }
    if ((b = t.closest('[data-cam]'))) return SM.cam(b.dataset.cam);
    if ((b = t.closest('[data-m]'))) return SM.setMode(b.dataset.m);
    if ((b = t.closest('[data-f]'))) {
      var nf = b.dataset.f === SM.filter ? 'all' : b.dataset.f;
      SM.setFilter(nf);
      [].forEach.call(document.querySelectorAll('.dash-filter-btn'), function (x) { x.classList.toggle('active', x.dataset.filter === nf); });
      return;
    }
    if ((b = t.closest('[data-v]'))) { SM.view = b.dataset.v; SM.sel = null; build(); return render(); }
    if ((b = t.closest('[data-ri]')) && b.classList.contains('sm-rchip')) { var k = +b.dataset.ri; SM.sel = SM.sel === k ? null : k; return selRoutes(); }
    if ((b = t.closest('.sm-plate'))) {
      hideTip();
      if (SM.opts.onStage) return SM.opts.onStage(stageById(b.dataset.st));
      if (typeof window.solicitarToggleBloqueioStage === 'function') return window.solicitarToggleBloqueioStage(b.dataset.st);
      if (typeof window.openStageDetailModal === 'function') window.openStageDetailModal(b.dataset.st);
      return;
    }
    if ((b = t.closest('.sm-pal'))) {
      hideTip();
      if (typeof window.openStageDetailModal === 'function' && b.dataset.s) window.openStageDetailModal(b.dataset.s);
      return;
    }
    if ((b = t.closest('[data-e]'))) {
      var id = b.dataset.e; SM.focus = SM.focus === id ? null : id;
      refocus();
      if (SM.opts.onEmbarque) SM.opts.onEmbarque(id, SM.focus != null);
    }
  }
  function onInput(ev) {
    if (ev.target.dataset && 'real' in ev.target.dataset) { SM.real = ev.target.checked; SM.root.querySelector('.sm-floor').dataset.look = SM.real ? 'real' : 'clean'; return refit(); }
    var po = ev.target.dataset && ev.target.dataset.po;
    if (po) { SM.po[po] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; SM.sel = null; build(); return render(); }
    var r = ev.target.dataset && ev.target.dataset.r; if (!r) return;
    if (r === 'zoom') { SM.zoom = +ev.target.value / 100; return refit(); }
    SM[r] = +ev.target.value;
    SM.tw++; camVars(r === 'tilt' ? SM[r] : SM.ct, r === 'yaw' ? SM[r] : SM.cy);
    refit();
  }
  function row(l, v) { return v == null || v === '' ? '' : '<div class="tr"><small>' + l + '</small><span>' + v + '</span></div>'; }
  function onMove(ev) {
    var tip = SM.root.querySelector('.sm-tip'); if (!tip || !ev.target.closest || ev.target.closest('.sm-viewport.drag')) return;
    var p = ev.target.closest('.sm-pal'), pl = !p && ev.target.closest('.sm-plate'), html;
    if (p) {
      var s = stageById(p.dataset.s) || {}, x = (s.slots || []).filter(function (q) { return q.pos === p.dataset.p; })[0] || {}, blk = blocked(s);
      var stack = x.paletes && x.paletes.length > 1 ? x.paletes.map(function (y, i) { return row('Nível ' + (i + 1), esc(y.lpn) + (y.status && y.status !== x.status ? ' · ' + esc(NAMES[y.status] || y.status) : '')); }).join('') : '';
      html = '<div class="th"><b>' + esc(s.id) + esc(p.dataset.p) + '</b><span class="tb st-' + esc(x.status) + '">' + esc(NAMES[x.status] || '') + '</span></div>' +
        (blk ? '<div class="tw">Stage bloqueado</div>' : '') +
        (stack ? row('Pilha', x.paletes.length === 2 ? 'Duplado (2 plts)' : 'Fracionado (' + x.paletes.length + ' plts)') + stack : row('LPN', esc(x.lpn))) +
        row('SKU', x.sku ? esc(x.sku) + (x.lote ? ' · ' + esc(x.lote) : '') : '') + row('Descrição', esc(x.desc)) +
        row('Qtd', x.qtd ? x.qtd + (x.cap ? ' / ' + x.cap + ' (' + Math.round(100 * x.qtd / x.cap) + '%)' : '') : '') +
        row('Embarque', esc(s.embarque)) + '<div class="tf">Clique para ver o stage</div>';
    } else if (pl) {
      var st = stageById(pl.dataset.st) || {}, occ = occOf(st), ok = occ.filter(function (x) { return x.status === 'conferido'; }).length, bad = occ.filter(function (x) { return x.status === 'divergencia'; }).length, bk = blocked(st);
      html = '<div class="th"><b>Stage ' + esc(st.id) + '</b>' + (bk ? '<span class="tb st-divergencia">Bloqueado</span>' : '') + '</div>' +
        row('Embarque', st.embarques && st.embarques.length > 1 ? st.embarques.map(esc).join(', ') : esc(st.embarque)) +
        row('Ocupação', occ.length + ' / ' + vagasOf(st).length + ' vagas') +
        (occ.length ? row('Conferidos', ok + ' / ' + occ.length) : '') + (bad ? row('Divergências', bad) : '') +
        (st.excedente ? row('Excedente', st.excedente + ' palete(s) sem vaga') : '') +
        '<div class="tf">' + (SM.opts.onStage ? '' : typeof window.solicitarToggleBloqueioStage === 'function' ? 'Clique para ' + (bk ? 'DESBLOQUEAR' : 'BLOQUEAR') + ' o stage' : 'Clique para ver detalhes') + '</div>';
    } else return hideTip();
    tip.innerHTML = html;
    tip.style.display = 'block';
    var w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(ev.clientX + 14, window.innerWidth - w - 8)) + 'px';
    tip.style.top = (ev.clientY + 16 + hgt > window.innerHeight ? ev.clientY - hgt - 12 : ev.clientY + 16) + 'px';
  }
  function hideTip() { var t = SM.root && SM.root.querySelector('.sm-tip'); if (t) t.style.display = 'none'; }

  function demo(planner) {
    var plan = [[1, 1, 8], [2, 10, 14], [3, 15, 22], [4, 23, 26], [5, 28, 33], [6, 34, 41], [7, 42, 47], [8, 49, 60]], seed = 7, stages = [];
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var skus = [['SKU-1001', 100], ['SKU-1002', 80], ['SKU-1003', 60], ['SKU-1004', 120]];
    for (var n = 1; n <= 80; n++) {
      var e = null; plan.forEach(function (p) { if (n >= p[1] && n <= p[2]) e = String(p[0]); });
      var slots = [], fill = e ? Math.round(2 + rnd() * 6) : 0;
      for (var k = 0; k < fill; k++) {
        var r = rnd(), st = r < .55 ? 'conferido' : r < .8 ? 'aguardando' : r < .9 ? 'divergencia' : 'conferido';
        var sk = skus[Math.floor(rnd() * skus.length)], full = rnd() < .4, q = full ? sk[1] : Math.max(5, Math.round(sk[1] * (.15 + rnd() * .7)));
        slots.push({ pos: 'ABCDEFGHIJ'[k], status: st, lpn: 'LPN' + (900000 + n * 100 + k), sku: sk[0], lote: 'L' + (1 + Math.floor(rnd() * 2)), qtd: q, cap: sk[1] });
      }
      stages.push({ id: 'SO' + (n < 10 ? '0' : '') + n, embarque: e, slots: slots });
    }
    stages[4].slots[2] = { pos: 'C', status: 'ativo', lpn: 'LPN-ATUAL', sku: 'SKU-1001', lote: 'L1', qtd: 100, cap: 100 };
    return { stages: stages, demo: true, focus: planner ? '3' : null };
  }

  return SM;
  }

  var SM = window.StageMap = make();
  SM.create = make;
  SM.fromRows = fromRows;
  /* Diagnóstico no console: StageMap.detectar() mostra de onde os dados estão vindo */
  SM.detectar = function () { DET.at = 0; DET.path = null; var a = autoDetect(); return a ? { fonte: a.name, linhas: Array.isArray(a.value) ? a.value.length : (a.value.stages || []).length, adaptador: typeof window.StageMapAdapter === 'function' } : { fonte: null, adaptador: typeof window.StageMapAdapter === 'function' }; };

  /* ---- Integração com a tela "Mapa de Stages" existente (só se os elementos existirem) ---- */
  SM.showLayout = function () {
    var c = $('dashStagesContainer'); if (c) c.style.display = 'none';
    SM.root.style.display = '';
    ['btnModeLanes', 'btnModeCards'].forEach(function (id) { var b = $(id); if (b) b.classList.remove('active'); });
    var l = $('btnModeLayout'); if (l) l.classList.add('active');
    SM.refresh(true);
  };
  SM.hideLayout = function () {
    var c = $('dashStagesContainer'); if (c) c.style.display = '';
    if (SM.root) SM.root.style.display = 'none';
    var l = $('btnModeLayout'); if (l) l.classList.remove('active');
  };

  function boot() {
    var root = $('stageMapRoot'); if (!root) return;
    var mainLoad = function () { return typeof window.StageMapAdapter === 'function' ? window.StageMapAdapter() : null; };
    SM.mount(root, { loadData: mainLoad });
    var maps = [SM], cr = $('consMapRoot'), cm = null;
    if (cr) {
      cm = window.StageMapConsolidacao = make();
      cm.mount(cr, { planner: true, onStage: function () {}, loadData: function () { return typeof window.StageMapConsolidacaoAdapter === 'function' ? window.StageMapConsolidacaoAdapter() : mainLoad(); } });
      maps.push(cm);
      var tc = window.toggleConsolidacao;
      if (typeof tc === 'function') window.toggleConsolidacao = function () { var r = tc.apply(this, arguments); var v = $('viewConsolidacao'); if (v && v.style.display !== 'none') cm.refresh(true); return r; };
      var se = window.selecionarEmbarqueConsolidacao;
      if (typeof se === 'function') window.selecionarEmbarqueConsolidacao = function (v) { var r = se.apply(this, arguments); cm.setFocus(v); cm.refresh(true); return r; };
    }
    var tg = document.querySelector('.dash-view-toggle');
    if (tg) tg.addEventListener('click', function (e) { if (e.target.closest('#btnModeLanes,#btnModeCards')) SM.hideLayout(); }, true);
    [].forEach.call(document.querySelectorAll('.dash-filter-btn'), function (b) {
      b.addEventListener('click', function () { SM.setFilter(b.dataset.filter); });
    });
    var si = $('dashSearchInput'); if (si) si.addEventListener('input', function () { SM.setSearch(si.value); });
    var td = window.toggleDashboard;
    if (typeof td === 'function') window.toggleDashboard = function () { var r = td.apply(this, arguments); var v = $('viewDashboard'); if (v && v.style.display !== 'none') SM.showLayout(); return r; };

    // Atualização: a cada 4s quando visível, ao voltar para a aba, quando outra aba/aparelho grava no localStorage,
    // e sob demanda via window.dispatchEvent(new Event('stagemap:refresh')).
    var tick = function (force) { maps.forEach(function (m) { if (m.visible()) m.refresh(force); }); };
    setInterval(function () { if (!document.hidden) tick(false); }, 4000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(false); });
    window.addEventListener('storage', function () { tick(false); });
    window.addEventListener('stagemap:refresh', function () { tick(true); });
    // Telas abertas por código do app (sem passar pelos wrappers acima): reajusta ao ficarem visíveis
    if (window.MutationObserver) {
      ['viewDashboard', 'viewConsolidacao'].forEach(function (id) {
        var v = $(id); if (!v) return;
        var was = v.style.display !== 'none';
        new MutationObserver(function () { var now = v.style.display !== 'none'; if (now && !was) setTimeout(function () { tick(true); }, 0); was = now; }).observe(v, { attributes: true, attributeFilter: ['style', 'class'] });
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
