/* =========================================================
   DHL SUPPLY CHAIN — SINCRONIZAÇÃO EM TEMPO REAL (ON-TIME)
   Bipagens, trocas de stage, bloqueios e versões da base (Power BI) entre todos os aparelhos do canal.
   Transportes: MQTT (WebSockets, internet/GitHub Pages) · BroadcastChannel (abas do mesmo PC) ·
                evento storage (fallback entre janelas) · /api/sync (servidor local na rede do galpão).

   Mensagens grandes (base inteira) são divididas em pedaços de até 48 KB (CHUNK) e remontadas no destino:
   os brokers MQTT públicos descartam mensagens grandes sem avisar.
   Outros módulos escutam tipos de mensagem com DHL_SYNC.on('TIPO', fn).
   ========================================================= */

(function () {
  const SYNC_STORAGE_CHANNEL_KEY = 'pg_sync_channel_name_v1';
  const DEFAULT_CHANNEL = 'PG_ITATIAIA_EXPEDICAO';
  // mesmas chaves usadas pelo app.js
  const DB_KEY = 'dhl_stage_database_custom_v1';
  const PARTIALS_KEY = 'dhl_stage_partial_conferences_v2';
  const CHUNK_SIZE = 48 * 1024;

  const myClientId = 'client_' + Math.random().toString(36).substring(2, 9);
  let currentChannel = localStorage.getItem(SYNC_STORAGE_CHANNEL_KEY) || DEFAULT_CHANNEL;

  let broadcastChan = null;
  let mqttClient = null;
  let isMqttConnected = false;
  const activePeers = new Map();
  const listeners = {};
  const chunkBuffers = new Map();
  const seenPackets = new Map(); // dedupe: o mesmo pacote chega por mais de um transporte

  const WSS_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  let currentBrokerIdx = 0;

  const isLocalServer = window.location.protocol === 'http:' || window.location.port === '8080' || /^(localhost|127\.0\.0\.1|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(window.location.hostname);
  let lastHttpPacketTimestamp = null;

  const topic = () => `dhl/conferencia_stage/v1/${currentChannel}`;
  const refreshMap = () => window.dispatchEvent(new Event('stagemap:refresh'));
  const call = (fn, ...a) => { if (typeof window[fn] === 'function') { try { return window[fn](...a); } catch (e) { console.warn(fn, e); } } };

  /* ---------------- Inicialização ---------------- */
  function initSyncEngine() {
    initBroadcastChannel();
    initMqttClient();
    setupStorageEventListener();
    startLocalHttpPolling();
    startHeartbeatTimer();
    updateSyncUI();
    setTimeout(requestSyncFromPeers, 1200);
  }

  function startLocalHttpPolling() {
    if (!isLocalServer) return;
    setInterval(() => {
      fetch('/api/sync').then(r => r.json()).then(data => {
        if (data && data.senderId && data.senderId !== myClientId && data.timestamp !== lastHttpPacketTimestamp) {
          lastHttpPacketTimestamp = data.timestamp;
          receive(data);
        }
      }).catch(() => {});
    }, 1200);
  }

  function initBroadcastChannel() {
    try {
      if (!window.BroadcastChannel) return;
      if (broadcastChan) broadcastChan.close();
      broadcastChan = new BroadcastChannel(`dhl_stage_sync_${currentChannel}`);
      broadcastChan.onmessage = (evt) => receive(evt.data);
    } catch (e) { console.warn('BroadcastChannel indisponível:', e); }
  }

  function initMqttClient() {
    if (typeof mqtt === 'undefined') { console.info('MQTT não carregado: sincronizando só entre abas deste PC.'); updateSyncUI(); return; }
    const brokerUrl = WSS_BROKERS[currentBrokerIdx];
    try {
      if (mqttClient) { try { mqttClient.end(true); } catch (e) {} }
      mqttClient = mqtt.connect(brokerUrl, { keepalive: 30, clientId: myClientId, clean: true, connectTimeout: 8000, reconnectPeriod: 5000 });
      mqttClient.on('connect', () => {
        isMqttConnected = true;
        mqttClient.subscribe(topic(), { qos: 1 }, (err) => {
          if (!err) { console.log(`✔ [ON-TIME] Canal '${currentChannel}' via ${brokerUrl}`); updateSyncUI(); requestSyncFromPeers(); }
        });
      });
      mqttClient.on('message', (t, buf) => { try { receive(JSON.parse(buf.toString())); } catch (e) { console.warn('Mensagem On-Time inválida:', e); } });
      mqttClient.on('offline', () => { isMqttConnected = false; updateSyncUI(); });
      mqttClient.on('error', (err) => {
        console.warn('Falha MQTT em', brokerUrl, err);
        isMqttConnected = false; updateSyncUI();
        currentBrokerIdx = (currentBrokerIdx + 1) % WSS_BROKERS.length;
        setTimeout(initMqttClient, 3000); // troca de broker de fato
      });
    } catch (e) { console.warn('Erro ao iniciar MQTT:', e); isMqttConnected = false; updateSyncUI(); }
  }

  function setupStorageEventListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'dhl_last_sync_packet' && e.newValue) { try { receive(JSON.parse(e.newValue)); } catch (err) {} }
    });
  }

  /* ---------------- Envio ---------------- */
  function sendPacket(packet) {
    if (broadcastChan) { try { broadcastChan.postMessage(packet); } catch (e) {} }
    if (packet.type !== 'CHUNK') { try { localStorage.setItem('dhl_last_sync_packet', JSON.stringify(packet)); } catch (e) {} }
    if (mqttClient && isMqttConnected) {
      try { mqttClient.publish(topic(), JSON.stringify(packet), { qos: 1 }); } catch (e) { console.warn('Erro ao publicar MQTT:', e); }
    }
    if (isLocalServer && packet.type !== 'CHUNK') {
      fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) }).catch(() => {});
    }
  }

  function makePacket(type, payload) {
    return {
      id: myClientId + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      senderId: myClientId,
      channel: currentChannel,
      operador: (window.activeConference && window.activeConference.operador) || 'Operador DHL',
      timestamp: new Date().toISOString(),
      type: type,
      payload: payload || {}
    };
  }

  function broadcastMessage(type, payload) { sendPacket(makePacket(type, payload)); }

  /* Mensagem grande: vai em pedaços; o destino remonta e entrega como uma mensagem normal do tipo original */
  function broadcastLarge(type, payload) {
    const packet = makePacket(type, payload);
    const str = JSON.stringify(packet);
    if (str.length <= CHUNK_SIZE) return sendPacket(packet);
    const n = Math.ceil(str.length / CHUNK_SIZE);
    for (let i = 0; i < n; i++) {
      sendPacket(Object.assign(makePacket('CHUNK', { tid: packet.id, i: i, n: n, data: str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) }), { operador: packet.operador }));
    }
  }

  /* ---------------- Recebimento ---------------- */
  function receive(msg) {
    if (!msg || !msg.type || msg.senderId === myClientId) return;
    if (msg.id) {
      if (seenPackets.has(msg.id)) return;
      seenPackets.set(msg.id, Date.now());
      if (seenPackets.size > 2000) { const lim = Date.now() - 120000; for (const [k, t] of seenPackets) if (t < lim) seenPackets.delete(k); }
    }
    if (msg.type === 'CHUNK') return receiveChunk(msg);
    handleIncomingSyncMessage(msg);
  }

  function receiveChunk(msg) {
    const p = msg.payload || {};
    if (!p.tid || p.n == null) return;
    let b = chunkBuffers.get(p.tid);
    if (!b) { b = { n: p.n, parts: new Array(p.n), got: 0, t: Date.now() }; chunkBuffers.set(p.tid, b); }
    if (b.parts[p.i] == null) { b.parts[p.i] = p.data; b.got++; }
    if (b.got === b.n) {
      chunkBuffers.delete(p.tid);
      try { const full = JSON.parse(b.parts.join('')); full.id = null; receive(full); } catch (e) { console.warn('Falha ao remontar mensagem On-Time:', e); }
    }
    const lim = Date.now() - 60000;
    for (const [k, v] of chunkBuffers) if (v.t < lim) chunkBuffers.delete(k);
  }

  function handleIncomingSyncMessage(msg) {
    registerPeerPresence(msg.senderId, msg.operador);
    switch (msg.type) {
      case 'SCAN_EVENT': applyIncomingScan(msg.payload, msg.operador); break;
      case 'SESSION_FULL_SYNC': applyIncomingFullSession(msg.payload, msg.operador); break;
      case 'REQUEST_SYNC': respondWithCurrentState(); break;
      case 'STAGE_SWITCH_EVENT': applyIncomingStageSwitch(msg.payload); break;
      case 'BASE_UPDATED_EVENT': applyIncomingBaseUpdate(msg.payload, msg.operador); break;
      case 'STAGE_BLOCK_TOGGLE': applyIncomingBlock(msg.payload, msg.operador); break;
      default: break;
    }
    (listeners[msg.type] || []).forEach(fn => { try { fn(msg); } catch (e) { console.warn('Listener On-Time', msg.type, e); } });
  }

  /* ---------------- Conferências parciais (mesma estrutura do app.js) ---------------- */
  function readPartials() { try { return JSON.parse(localStorage.getItem(PARTIALS_KEY) || '{}'); } catch (e) { return {}; } }
  function writePartials(p) { try { localStorage.setItem(PARTIALS_KEY, JSON.stringify(p)); } catch (e) { console.warn('Sem espaço para salvar conferências parciais:', e); } }

  function mergeSlot(slots, stgFisico, slot, scan, operadorName) {
    slots[stgFisico] = slots[stgFisico] || {};
    const cur = slots[stgFisico][slot] || {};
    const list = Array.isArray(cur.paletes) ? cur.paletes.slice() : [];
    if (cur.palete && !list.length) list.push({ palete: cur.palete, lpn: cur.lpn || cur.palete, nivel: 1, status: cur.status, isMatch: cur.isMatch, timestamp: cur.timestamp });
    const idx = list.findIndex(p => p.lpn === scan.lpn || p.palete === scan.lpn);
    const item = {
      slot: slot, nivel: scan.nivel || (idx >= 0 ? list[idx].nivel : list.length + 1), locCode: scan.locCode,
      palete: scan.lpn, lpn: scan.lpn, stageFisico: stgFisico, stageSistemico: scan.stageSistemico,
      isMatch: scan.isMatch, isRamification: scan.isRamification, status: scan.status, timestamp: scan.timestamp,
      auditDivergence: scan.auditDivergence, auditNotes: scan.auditNotes, operador: operadorName
    };
    if (idx >= 0) list[idx] = item; else list.push(item);
    slots[stgFisico][slot] = Object.assign({}, item, { paletes: list, totalPaletesNaVaga: list.length, isDuplado: list.length === 2, isFracionado: list.length >= 3 });
  }
  function conferidoInfo(scan, operadorName) {
    const div = scan.status === 'divergent';
    return { timestamp: scan.timestamp, stageFisico: scan.stageFisico, stage: scan.stageFisico, slot: scan.slot, locCode: scan.locCode, isMatch: !div && !!scan.isMatch, isRamification: scan.isRamification, isDivergent: div, status: div ? 'divergent' : 'done', operador: operadorName };
  }

  /* Bipagem feita em outro aparelho */
  function applyIncomingScan(scan, operadorName) {
    if (!scan || !scan.embarqueId || !scan.lpn) return;
    const ac = window.activeConference;
    const conta = scan.status === 'divergent' || (scan.isMatch && scan.status === 'done');

    if (ac && ac.embarqueId && String(ac.embarqueId) === String(scan.embarqueId)) {
      // mesmo embarque aberto aqui: atualiza a conferência ativa e as telas
      ac.stageSlots = ac.stageSlots || {};
      mergeSlot(ac.stageSlots, scan.stageFisico, scan.slot, scan, operadorName);
      if (conta && ac.conferidos && typeof ac.conferidos.set === 'function') ac.conferidos.set(scan.lpn, conferidoInfo(scan, operadorName));
      (ac.historico = ac.historico || []).unshift({
        tipo: scan.status === 'divergent' ? 'erro' : 'ok', palete: scan.lpn, desc: scan.sku || 'Material',
        stageFisico: scan.stageFisico, stageSistemico: scan.stageSistemico, locCode: scan.locCode,
        isMatch: scan.isMatch, timestamp: scan.timestamp, syncNote: `Bipado por ${operadorName}`
      });
      if (typeof window.calculateNextTargetSlot === 'function') ac.activeSlot = window.calculateNextTargetSlot(scan.stageFisico);
      call('savePartialConferenceSession');
      call('persistActiveSession');
      ['renderStageSlotsGrid', 'updateUI', 'renderDistribuicaoPaletes', 'renderHistorico'].forEach(fn => call(fn));
      call('showToast', `📡 <b>On-Time:</b> Palete <code>${scan.lpn}</code> bipado por <b>${operadorName}</b>`);
    } else {
      // outro embarque: registra na conferência parcial dele (mapa de stages e dashboard passam a mostrar)
      const partials = readPartials();
      const s = partials[scan.embarqueId] || (partials[scan.embarqueId] = { embarqueId: scan.embarqueId, operador: operadorName, conferidos: [], stageSlots: {}, iniciadoEm: scan.timestamp });
      s.stageSlots = s.stageSlots || {};
      mergeSlot(s.stageSlots, scan.stageFisico, scan.slot, scan, operadorName);
      if (conta) {
        const m = new Map(s.conferidos || []);
        m.set(scan.lpn, conferidoInfo(scan, operadorName));
        s.conferidos = Array.from(m.entries());
      }
      s.currentPhysicalStage = scan.stageFisico;
      s.lastUpdated = new Date().toISOString();
      writePartials(partials);
    }
    renderPatio();
  }

  function renderPatio() {
    const dash = document.getElementById('viewDashboard');
    if (dash && dash.style.display !== 'none') call('renderDashboard');
    refreshMap();
  }

  /* Estado completo de uma conferência (resposta a REQUEST_SYNC ou "Transmitir minha sessão") */
  function applyIncomingFullSession(data) {
    if (!data || !data.embarqueId) return;
    const partials = readPartials();
    const prev = partials[data.embarqueId] || {};
    partials[data.embarqueId] = Object.assign({}, prev, data, { lastUpdated: new Date().toISOString() });
    writePartials(partials);

    const ac = window.activeConference;
    if (ac && String(ac.embarqueId) === String(data.embarqueId)) {
      if (data.conferidos) ac.conferidos = new Map(data.conferidos);
      if (data.stageSlots) ac.stageSlots = data.stageSlots;
      if (data.divergencias) ac.divergencias = data.divergencias;
      if (data.historico) ac.historico = data.historico;
      if (data.currentPhysicalStage) ac.currentPhysicalStage = data.currentPhysicalStage;
      if (data.activeSlot) ac.activeSlot = data.activeSlot;
      ['renderStageSlotsGrid', 'updateUI', 'renderDistribuicaoPaletes', 'renderHistorico'].forEach(fn => call(fn));
    }
    renderPatio();
    call('renderConsolidacao');
  }

  function applyIncomingStageSwitch(data) {
    const ac = window.activeConference;
    if (!data || !ac || String(ac.embarqueId) !== String(data.embarqueId)) return;
    ac.currentPhysicalStage = data.newStage;
    if (data.targetSlot) ac.activeSlot = data.targetSlot;
    call('renderStageSlotsGrid'); call('updateUI');
    refreshMap();
  }

  /* Base carregada por outro operador (planilha Excel / SQL) */
  function applyIncomingBaseUpdate(baseData, operadorName) {
    if (!baseData || !baseData.database || !baseData.database.embarques) return;
    window.database = baseData.database; // app.js expõe a base em window.database (ponte no fim do app.js)
    try { localStorage.setItem(DB_KEY, JSON.stringify(baseData.database)); } catch (e) { console.warn('Sem espaço para salvar a base recebida:', e); }
    call('updateBaseInfoUI');
    renderPatio();
    call('renderConsolidacao');
    call('showToast', `📥 <b>Base sincronizada:</b> carregada por <b>${operadorName}</b> (${baseData.fileName || 'planilha'})`);
  }

  function applyIncomingBlock(p, operadorName) {
    if (!p || !(p.stage || p.rawStage)) return;
    const stg = p.stage || p.rawStage;
    if (typeof window.setStageBlocked === 'function') {
      window.setStageBlocked(stg, !!p.blocked);
      if (p.rawStage && p.rawStage !== stg) window.setStageBlocked(p.rawStage, !!p.blocked);
    }
    renderPatio();
    call('renderStageSlotsGrid');
    call('showToast', `${p.blocked ? '🔒' : '🔓'} <b>Stage ${p.rawStage || stg} ${p.blocked ? 'BLOQUEADO' : 'DESBLOQUEADO'}</b> por ${operadorName || 'outro operador'}.`);
  }

  function respondWithCurrentState() {
    const ac = window.activeConference;
    if (!ac || !ac.embarqueId) return;
    broadcastLarge('SESSION_FULL_SYNC', {
      embarqueId: ac.embarqueId,
      operador: ac.operador,
      conferidos: Array.from((ac.conferidos && ac.conferidos.entries ? ac.conferidos : new Map()).entries()),
      stageSlots: ac.stageSlots || {},
      divergencias: ac.divergencias || [],
      historico: (ac.historico || []).slice(0, 200),
      currentPhysicalStage: ac.currentPhysicalStage,
      activeSlot: ac.activeSlot
    });
  }

  function requestSyncFromPeers() { broadcastMessage('REQUEST_SYNC', { clientTime: Date.now() }); }

  /* ---------------- Presença ---------------- */
  function registerPeerPresence(peerId, operador) {
    if (!peerId) return;
    activePeers.set(peerId, { timestamp: Date.now(), operador: operador || 'Operador' });
    cleanStalePeers();
    updateSyncUI();
  }
  function cleanStalePeers() {
    const now = Date.now();
    for (const [id, info] of activePeers.entries()) if (now - info.timestamp > 45000) activePeers.delete(id);
  }
  function startHeartbeatTimer() {
    setInterval(() => { broadcastMessage('HEARTBEAT', { ping: true }); cleanStalePeers(); updateSyncUI(); }, 25000);
  }

  function updateSyncUI() {
    const dot = document.getElementById('syncStatusDot');
    const txt = document.getElementById('syncStatusText');
    const badge = document.getElementById('syncPeersCount');
    const chip = document.getElementById('navSyncStatus');
    const peers = Math.max(1, activePeers.size + 1);
    if (dot) dot.className = 'sync-status-dot ' + (isMqttConnected ? 'online' : 'connecting');
    if (txt) txt.textContent = isMqttConnected ? 'On-Time' : 'Local';
    if (badge) badge.textContent = `${peers} online`;
    if (chip) chip.title = `Sincronização ${isMqttConnected ? 'On-Time' : 'Local'} · ${peers} dispositivo(s) conectado(s)`;
  }

  /* ---------------- API pública ---------------- */
  window.PG_SYNC = window.DHL_SYNC = {
    broadcastMessage: broadcastMessage,
    broadcastLarge: broadcastLarge,
    on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },

    notifyScan: function (foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, hasAuditDivergence, auditNotes, nivel) {
      broadcastMessage('SCAN_EVENT', {
        embarqueId: window.activeConference && window.activeConference.embarqueId,
        lpn: foundPallet && foundPallet.palete,
        sku: (foundPallet && foundPallet.sku_resumo) || '',
        stageFisico: stgFisico,
        stageSistemico: (foundPallet && foundPallet.stage) || '',
        slot: currentSlot,
        nivel: nivel || 1,
        locCode: locCode,
        isMatch: isMatch && !hasAuditDivergence,
        isRamification: isAdjacentRamification,
        status: (hasAuditDivergence || !isMatch) ? 'divergent' : 'done',
        timestamp: timestampStr,
        auditDivergence: hasAuditDivergence,
        auditNotes: auditNotes || ''
      });
      refreshMap();
    },

    notifyDivergentScan: function (code, stgFisico, currentSlot, locCode, stageCorreto, ticketDesc, timestampStr) {
      broadcastMessage('SCAN_EVENT', {
        embarqueId: window.activeConference && window.activeConference.embarqueId,
        lpn: code, sku: 'Material não planejado', stageFisico: stgFisico, stageSistemico: stageCorreto,
        slot: currentSlot, locCode: locCode, isMatch: false, isRamification: false, status: 'divergent',
        timestamp: timestampStr, auditDivergence: true, auditNotes: ticketDesc
      });
      refreshMap();
    },

    notifyStageSwitch: function (newStage, targetSlot) {
      broadcastMessage('STAGE_SWITCH_EVENT', { embarqueId: window.activeConference && window.activeConference.embarqueId, newStage: newStage, targetSlot: targetSlot });
      refreshMap();
    },

    // planilha carregada neste aparelho: a base vai em pedaços para os demais
    notifyBaseUpdated: function (fileName, databaseObj) {
      broadcastLarge('BASE_UPDATED_EVENT', { fileName: fileName, database: databaseObj });
      refreshMap();
    },

    notifyFullSession: respondWithCurrentState,

    setChannel: function (newChannelName) {
      const clean = (newChannelName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
      if (clean && clean !== currentChannel) {
        if (mqttClient && isMqttConnected) { try { mqttClient.unsubscribe(topic()); } catch (e) {} }
        currentChannel = clean;
        localStorage.setItem(SYNC_STORAGE_CHANNEL_KEY, clean);
        activePeers.clear();
        initBroadcastChannel();
        initMqttClient();
        updateSyncUI();
        call('showToast', `Canal de sincronização alterado para: <b>${clean}</b>`);
      }
    },
    getChannel: () => currentChannel,
    getPeersCount: () => Math.max(1, activePeers.size + 1),
    isConnected: () => isMqttConnected
  };

  /* ---------------- Modal de configuração ---------------- */
  window.openSyncModal = function () {
    const modal = document.getElementById('modalSyncConfig');
    if (!modal) return;
    const inp = document.getElementById('inputSyncRoom');
    if (inp) inp.value = currentChannel;
    const statusTxt = document.getElementById('syncModalStatusDesc');
    if (statusTxt) {
      const pbi = window.POWERBI_SYNC && window.POWERBI_SYNC.status ? window.POWERBI_SYNC.status() : null;
      statusTxt.innerHTML = (isMqttConnected
        ? `<span style="color:#16A34A;font-weight:800;">🟢 Conectado em tempo real (On-Time)</span> via ${WSS_BROKERS[currentBrokerIdx]}`
        : `<span style="color:#D97706;font-weight:800;">🟡 Operando localmente / conectando</span> ao broker`) +
        (pbi && pbi.ts ? `<br><span style="font-size:.78rem;">⚡ Base do Power BI lida às <b>${new Date(pbi.ts).toLocaleTimeString('pt-BR')}</b> (${pbi.source})</span>` : '');
    }
    const peersList = document.getElementById('syncPeersList');
    if (peersList) {
      const peers = Array.from(activePeers.values());
      peersList.innerHTML = peers.length === 0
        ? `<li style="color:#64748B;">Apenas este dispositivo conectado no momento.</li>`
        : peers.map(p => `<li style="color:#0F172A;margin-bottom:4px;"><b>👤 ${String(p.operador).replace(/</g, '&lt;')}</b> — visto há ${Math.round((Date.now() - p.timestamp) / 1000)}s</li>`).join('');
    }
    modal.style.display = 'flex';
  };

  window.salvarCanalSync = function () {
    const inp = document.getElementById('inputSyncRoom');
    if (inp && inp.value) { window.DHL_SYNC.setChannel(inp.value); document.getElementById('modalSyncConfig').style.display = 'none'; }
  };

  window.forcarSincronizacaoGeral = function () {
    requestSyncFromPeers();
    respondWithCurrentState();
    call('showToast', '📡 Sessão transmitida para todos os dispositivos conectados.');
    document.getElementById('modalSyncConfig').style.display = 'none';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSyncEngine); else initSyncEngine();
})();
