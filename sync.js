/* =========================================================
   DHL SUPPLY CHAIN — MÓDULO DE SINCRONIZAÇÃO EM TEMPO REAL (ON-TIME)
   Garante que todas as bipagens, ajustes de stage, divergências e
   atualizações de base sejam vistas por todos os operadores em tempo real
   (WebSockets via MQTT público / BroadcastChannel / Rede Local / GitHub Pages).
   ========================================================= */

(function() {
  const SYNC_STORAGE_CHANNEL_KEY = 'pg_sync_channel_name_v1';
  const DEFAULT_CHANNEL = 'PG_ITATIAIA_EXPEDICAO';

  // ID único e volátil deste cliente / aba
  const myClientId = 'client_' + Math.random().toString(36).substring(2, 9);
  let currentChannel = localStorage.getItem(SYNC_STORAGE_CHANNEL_KEY) || DEFAULT_CHANNEL;
  
  let broadcastChan = null;
  let mqttClient = null;
  let isMqttConnected = false;
  let activePeers = new Map(); // peerId -> { timestamp, operator, lastSeen }

  // Brokers MQTT públicos de alta disponibilidade com suporte a WSS (WebSockets SSL/HTTPS)
  const WSS_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  let currentBrokerIdx = 0;

  /* ---------------------------------------------------------
     INICIALIZAÇÃO DO CANAL DE SINCRONIZAÇÃO
     --------------------------------------------------------- */
  function initSyncEngine() {
    initBroadcastChannel();
    initMqttClient();
    setupStorageEventListener();
    startHeartbeatTimer();
    updateSyncUI();

    // Solicita o estado mais recente aos outros dispositivos após 1 segundo
    setTimeout(() => {
      requestSyncFromPeers();
    }, 1200);
  }

  /* 1. BroadcastChannel (Sincronização instantânea entre abas no mesmo PC) */
  function initBroadcastChannel() {
    try {
      if (window.BroadcastChannel) {
        if (broadcastChan) broadcastChan.close();
        broadcastChan = new BroadcastChannel(`dhl_stage_sync_${currentChannel}`);
        broadcastChan.onmessage = (evt) => {
          if (evt.data && evt.data.senderId !== myClientId) {
            handleIncomingSyncMessage(evt.data);
          }
        };
      }
    } catch(e) {
      console.warn('BroadcastChannel não suportado neste navegador:', e);
    }
  }

  /* 2. MQTT over WebSockets (Sincronização Global no GitHub Pages e Internet) */
  function initMqttClient() {
    if (typeof mqtt === 'undefined') {
      console.info('Biblioteca MQTT não carregada ou offline. Operando com BroadcastChannel local.');
      updateSyncUI();
      return;
    }

    const brokerUrl = WSS_BROKERS[currentBrokerIdx];
    const topic = `dhl/conferencia_stage/v1/${currentChannel}`;

    try {
      const options = {
        keepalive: 30,
        clientId: myClientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 5000
      };

      if (mqttClient) {
        try { mqttClient.end(true); } catch(e) {}
      }

      mqttClient = mqtt.connect(brokerUrl, options);

      mqttClient.on('connect', () => {
        isMqttConnected = true;
        mqttClient.subscribe(topic, { qos: 1 }, (err) => {
          if (!err) {
            console.log(`✔ [ON-TIME SYNC] Conectado ao canal '${currentChannel}' via ${brokerUrl}`);
            updateSyncUI();
            requestSyncFromPeers();
          }
        });
      });

      mqttClient.on('message', (t, msgBuffer) => {
        try {
          const msg = JSON.parse(msgBuffer.toString());
          if (msg && msg.senderId !== myClientId) {
            handleIncomingSyncMessage(msg);
          }
        } catch(err) {
          console.warn('Erro ao decodificar mensagem de sincronização:', err);
        }
      });

      mqttClient.on('offline', () => {
        isMqttConnected = false;
        updateSyncUI();
      });

      mqttClient.on('error', (err) => {
        console.warn('Falha na conexão MQTT com', brokerUrl, err);
        isMqttConnected = false;
        updateSyncUI();
        // Alterna para broker de backup
        currentBrokerIdx = (currentBrokerIdx + 1) % WSS_BROKERS.length;
      });

    } catch(e) {
      console.warn('Erro ao inicializar cliente MQTT:', e);
      isMqttConnected = false;
      updateSyncUI();
    }
  }

  /* 3. Storage Event (Fallback nativo entre janelas) */
  function setupStorageEventListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'dhl_last_sync_packet' && e.newValue) {
        try {
          const packet = JSON.parse(e.newValue);
          if (packet && packet.senderId !== myClientId) {
            handleIncomingSyncMessage(packet);
          }
        } catch(err) {}
      }
    });
  }

  /* ---------------------------------------------------------
     TRANSMISSÃO DE MENSAGENS ON-TIME
     --------------------------------------------------------- */
  function broadcastMessage(type, payload = {}) {
    const packet = {
      senderId: myClientId,
      channel: currentChannel,
      operador: (window.activeConference && window.activeConference.operador) || 'Operador DHL',
      timestamp: new Date().toISOString(),
      type: type,
      payload: payload
    };

    // 1. Envia via BroadcastChannel (local)
    if (broadcastChan) {
      try { broadcastChan.postMessage(packet); } catch(e) {}
    }

    // 2. Envia via Storage Event (local)
    try {
      localStorage.setItem('dhl_last_sync_packet', JSON.stringify(packet));
    } catch(e) {}

    // 3. Envia via MQTT WebSockets (global / GitHub Pages)
    if (mqttClient && isMqttConnected) {
      const topic = `dhl/conferencia_stage/v1/${currentChannel}`;
      try {
        mqttClient.publish(topic, JSON.stringify(packet), { qos: 1 });
      } catch(e) {
        console.warn('Erro ao publicar mensagem MQTT:', e);
      }
    }

    // 4. Se estiver rodando no servidor local (servidor_web.ps1), envia via POST /api/sync
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || /^192\.168\./.test(window.location.hostname)) {
      try {
        fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packet)
        }).catch(() => {});
      } catch(e) {}
    }
  }

  /* ---------------------------------------------------------
     PROCESSAMENTO DE MENSAGENS RECEBIDAS ON-TIME
     --------------------------------------------------------- */
  function handleIncomingSyncMessage(msg) {
    if (!msg || !msg.type) return;

    // Registra presença do peer
    registerPeerPresence(msg.senderId, msg.operador);

    switch(msg.type) {
      case 'SCAN_EVENT':
        applyIncomingScan(msg.payload, msg.operador);
        break;

      case 'SESSION_FULL_SYNC':
        applyIncomingFullSession(msg.payload, msg.operador);
        break;

      case 'REQUEST_SYNC':
        // Outro operador acabou de entrar e pediu os dados atuais: responde com nosso estado
        respondWithCurrentState();
        break;

      case 'STAGE_SWITCH_EVENT':
        applyIncomingStageSwitch(msg.payload, msg.operador);
        break;

      case 'BASE_UPDATED_EVENT':
        applyIncomingBaseUpdate(msg.payload, msg.operador);
        break;

      case 'STAGE_BLOCK_TOGGLE':
        if (msg.payload && (msg.payload.stage || msg.payload.rawStage)) {
          const stg = msg.payload.stage || msg.payload.rawStage;
          if (typeof window.setStageBlocked === 'function') {
            window.setStageBlocked(stg, !!msg.payload.blocked);
            if (msg.payload.rawStage && msg.payload.rawStage !== stg) {
              window.setStageBlocked(msg.payload.rawStage, !!msg.payload.blocked);
            }
          }
          if (typeof window.renderDashboard === 'function') window.renderDashboard();
          if (window.StageMap && typeof window.StageMap.refresh === 'function') window.StageMap.refresh(true);
          if (typeof window.renderStageSlotsGrid === 'function') window.renderStageSlotsGrid();
          if (typeof window.showToast === 'function') {
            const icon = msg.payload.blocked ? '🔒' : '🔓';
            const acao = msg.payload.blocked ? 'BLOQUEADO' : 'DESBLOQUEADO';
            window.showToast(`${icon} <b>Stage ${msg.payload.rawStage || stg} ${acao}</b> pela operação (${msg.operador || 'remoto'}).`);
          }
        }
        break;

      case 'HEARTBEAT':
        // Apenas atualiza a contagem de peers ativos
        break;

      default:
        break;
    }
  }

  /* Aplica bipagem realizada por outro operador */
  function applyIncomingScan(scanData, operadorName) {
    if (!scanData || !window.activeConference) return;
    
    // Se a conferência ativa for a do mesmo embarque
    if (window.activeEmbarque && window.activeConference.embarqueId === scanData.embarqueId) {
      const stgFisico = scanData.stageFisico;
      const slot = scanData.slot;
      const lpn = scanData.lpn;

      // 1. Atualiza stageSlots
      if (!window.activeConference.stageSlots) window.activeConference.stageSlots = {};
      if (!window.activeConference.stageSlots[stgFisico]) window.activeConference.stageSlots[stgFisico] = {};

      window.activeConference.stageSlots[stgFisico][slot] = {
        slot: slot,
        locCode: scanData.locCode,
        palete: lpn,
        lpn: lpn,
        stageFisico: stgFisico,
        stageSistemico: scanData.stageSistemico,
        isMatch: scanData.isMatch,
        isRamification: scanData.isRamification,
        status: scanData.status,
        timestamp: scanData.timestamp,
        auditDivergence: scanData.auditDivergence,
        auditNotes: scanData.auditNotes,
        operador: operadorName
      };

      // 2. Atualiza conferidos caso seja palete do embarque
      if (scanData.isMatch && scanData.status === 'done') {
        window.activeConference.conferidos.set(lpn, {
          timestamp: scanData.timestamp,
          stageFisico: stgFisico,
          stage: stgFisico,
          slot: slot,
          locCode: scanData.locCode,
          isMatch: true,
          isRamification: scanData.isRamification,
          isDivergent: false,
          status: 'done',
          operador: operadorName
        });
      } else if (scanData.status === 'divergent') {
        // Se for divergente
        window.activeConference.conferidos.set(lpn, {
          timestamp: scanData.timestamp,
          stageFisico: stgFisico,
          stage: stgFisico,
          slot: slot,
          locCode: scanData.locCode,
          isMatch: false,
          isDivergent: true,
          status: 'divergent',
          operador: operadorName
        });
      }

      // 3. Atualiza histórico local
      window.activeConference.historico.unshift({
        tipo: scanData.status === 'divergent' ? 'erro' : 'ok',
        palete: lpn,
        desc: scanData.sku || 'Material',
        stageFisico: stgFisico,
        stageSistemico: scanData.stageSistemico,
        locCode: scanData.locCode,
        isMatch: scanData.isMatch,
        timestamp: scanData.timestamp,
        syncNote: `Bipado por ${operadorName}`
      });

      // 4. Próxima vaga
      if (typeof window.calculateNextTargetSlot === 'function') {
        window.activeConference.activeSlot = window.calculateNextTargetSlot(stgFisico);
      }

      // 5. Atualiza telas e gráficos
      if (typeof window.renderStageSlotsGrid === 'function') window.renderStageSlotsGrid();
      if (typeof window.updateUI === 'function') window.updateUI();
      if (typeof window.renderDistribuicaoPaletes === 'function') window.renderDistribuicaoPaletes();
      if (typeof window.renderHistorico === 'function') window.renderHistorico();
      if (typeof window.renderDashboard === 'function') window.renderDashboard();

      if (typeof window.showToast === 'function') {
        window.showToast(`📡 <b>On-Time:</b> Palete <code>${lpn}</code> conferido por <b>${operadorName}</b>`);
      }
    }
  }

  /* Aplica sincronização completa de sessão de conferência */
  function applyIncomingFullSession(sessionData, operadorName) {
    if (!sessionData || !sessionData.embarqueId) return;

    // Atualiza base de parciais no storage
    try {
      let partials = JSON.parse(localStorage.getItem('dhl_conferencia_stage_partials_v1') || '{}');
      partials[sessionData.embarqueId] = sessionData;
      localStorage.setItem('dhl_conferencia_stage_partials_v1', JSON.stringify(partials));
    } catch(e) {}

    // Se estivermos com este embarque aberto na tela do scanner
    if (window.activeEmbarque && window.activeConference && window.activeConference.embarqueId === sessionData.embarqueId) {
      if (sessionData.conferidos) {
        window.activeConference.conferidos = new Map(sessionData.conferidos);
      }
      if (sessionData.stageSlots) {
        window.activeConference.stageSlots = sessionData.stageSlots;
      }
      if (sessionData.divergencias) {
        window.activeConference.divergencias = sessionData.divergencias;
      }
      if (sessionData.historico) {
        window.activeConference.historico = sessionData.historico;
      }
      if (sessionData.currentPhysicalStage) {
        window.activeConference.currentPhysicalStage = sessionData.currentPhysicalStage;
      }
      if (sessionData.activeSlot) {
        window.activeConference.activeSlot = sessionData.activeSlot;
      }

      if (typeof window.renderStageSlotsGrid === 'function') window.renderStageSlotsGrid();
      if (typeof window.updateUI === 'function') window.updateUI();
      if (typeof window.renderDistribuicaoPaletes === 'function') window.renderDistribuicaoPaletes();
      if (typeof window.renderHistorico === 'function') window.renderHistorico();
    }

    // Se o dashboard de pátio estiver em exibição, atualiza mapa geral
    if (typeof window.renderDashboard === 'function') {
      window.renderDashboard();
    }

    if (typeof window.renderConsolidacao === 'function') {
      window.renderConsolidacao();
    }
  }

  /* Aplica troca de stage físico efetuada por outro operador */
  function applyIncomingStageSwitch(data, operadorName) {
    if (!data || !window.activeConference || window.activeConference.embarqueId !== data.embarqueId) return;
    window.activeConference.currentPhysicalStage = data.newStage;
    if (data.targetSlot) window.activeConference.activeSlot = data.targetSlot;
    if (typeof window.renderStageSlotsGrid === 'function') window.renderStageSlotsGrid();
    if (typeof window.updateUI === 'function') window.updateUI();
  }

  /* Aplica nova base importada (ex: adhoc80.xlsx enviada por outro operador) */
  function applyIncomingBaseUpdate(baseData, operadorName) {
    if (!baseData || !baseData.database || !baseData.database.embarques) return;
    window.database = baseData.database;
    try {
      localStorage.setItem('dhl_conferencia_stage_database_override_v1', JSON.stringify(window.database));
    } catch(e) {}

    if (typeof window.updateBaseInfoUI === 'function') window.updateBaseInfoUI();
    if (typeof window.renderDashboard === 'function') window.renderDashboard();
    if (typeof window.renderConsolidacao === 'function') window.renderConsolidacao();
    
    if (typeof window.showToast === 'function') {
      window.showToast(`📥 <b>Base Sincronizada:</b> Nova planilha carregada por <b>${operadorName}</b> (${baseData.fileName || 'adhoc80.xlsx'})`);
    }
  }

  /* Responde a um novo operador que acabou de entrar com o estado atual */
  function respondWithCurrentState() {
    if (!window.activeConference || !window.activeConference.embarqueId) return;

    const payload = {
      embarqueId: window.activeConference.embarqueId,
      operador: window.activeConference.operador,
      conferidos: Array.from(window.activeConference.conferidos.entries()),
      stageSlots: window.activeConference.stageSlots || {},
      divergencias: window.activeConference.divergencias || [],
      historico: window.activeConference.historico || [],
      currentPhysicalStage: window.activeConference.currentPhysicalStage,
      activeSlot: window.activeConference.activeSlot
    };

    broadcastMessage('SESSION_FULL_SYNC', payload);
  }

  function requestSyncFromPeers() {
    broadcastMessage('REQUEST_SYNC', { clientTime: Date.now() });
  }

  /* ---------------------------------------------------------
     REGISTRO DE OPERADORES ONLINE (HEARTBEAT)
     --------------------------------------------------------- */
  function registerPeerPresence(peerId, operador) {
    activePeers.set(peerId, {
      timestamp: Date.now(),
      operador: operador || 'Operador'
    });
    cleanStalePeers();
    updateSyncUI();
  }

  function cleanStalePeers() {
    const now = Date.now();
    for (const [id, info] of activePeers.entries()) {
      if (now - info.timestamp > 45000) {
        activePeers.delete(id);
      }
    }
  }

  function startHeartbeatTimer() {
    setInterval(() => {
      broadcastMessage('HEARTBEAT', { ping: true });
      cleanStalePeers();
      updateSyncUI();
    }, 25000);
  }

  /* ---------------------------------------------------------
     ATUALIZAÇÃO DO INDICADOR VISUAL NA BARRA SUPERIOR
     --------------------------------------------------------- */
  function updateSyncUI() {
    const dot = document.getElementById('syncStatusDot');
    const txt = document.getElementById('syncStatusText');
    const badge = document.getElementById('syncPeersCount');
    const totalPeers = Math.max(1, activePeers.size + 1); // Nós + peers

    if (dot) {
      dot.className = 'sync-status-dot ' + (isMqttConnected ? 'online' : 'connecting');
    }

    if (txt) {
      if (isMqttConnected) {
        txt.textContent = 'On-Time';
      } else if (typeof mqtt === 'undefined') {
        txt.textContent = 'Local (Aba)';
      } else {
        txt.textContent = 'Conectando...';
      }
    }

    if (badge) {
      badge.textContent = `${totalPeers} online`;
    }
  }

  /* ---------------------------------------------------------
     EXPOSIÇÃO DE APIS GLOBAIS PARA APP.JS
     --------------------------------------------------------- */
  window.PG_SYNC = window.DHL_SYNC = {
    broadcastMessage: broadcastMessage,

    notifyScan: function(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, hasAuditDivergence, auditNotes) {
      broadcastMessage('SCAN_EVENT', {
        embarqueId: window.activeConference?.embarqueId,
        lpn: foundPallet?.palete,
        sku: foundPallet?.sku_resumo || '',
        stageFisico: stgFisico,
        stageSistemico: foundPallet?.stage || '',
        slot: currentSlot,
        locCode: locCode,
        isMatch: isMatch && !hasAuditDivergence,
        isRamification: isAdjacentRamification,
        status: (hasAuditDivergence || !isMatch) ? 'divergent' : 'done',
        timestamp: timestampStr,
        auditDivergence: hasAuditDivergence,
        auditNotes: auditNotes || ''
      });
    },

    notifyDivergentScan: function(code, stgFisico, currentSlot, locCode, stageCorreto, ticketDesc, timestampStr) {
      broadcastMessage('SCAN_EVENT', {
        embarqueId: window.activeConference?.embarqueId,
        lpn: code,
        sku: 'Material não planejado',
        stageFisico: stgFisico,
        stageSistemico: stageCorreto,
        slot: currentSlot,
        locCode: locCode,
        isMatch: false,
        isRamification: false,
        status: 'divergent',
        timestamp: timestampStr,
        auditDivergence: true,
        auditNotes: ticketDesc
      });
    },

    notifyStageSwitch: function(newStage, targetSlot) {
      broadcastMessage('STAGE_SWITCH_EVENT', {
        embarqueId: window.activeConference?.embarqueId,
        newStage: newStage,
        targetSlot: targetSlot
      });
    },

    notifyBaseUpdated: function(fileName, databaseObj) {
      broadcastMessage('BASE_UPDATED_EVENT', {
        fileName: fileName,
        database: databaseObj
      });
    },

    notifyFullSession: function() {
      respondWithCurrentState();
    },

    setChannel: function(newChannelName) {
      const clean = (newChannelName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
      if (clean && clean !== currentChannel) {
        currentChannel = clean;
        localStorage.setItem(SYNC_STORAGE_CHANNEL_KEY, clean);
        initBroadcastChannel();
        initMqttClient();
        updateSyncUI();
        if (typeof window.showToast === 'function') {
          window.showToast(`Canal de sincronização alterado para: <b>${clean}</b>`);
        }
      }
    },

    getChannel: function() {
      return currentChannel;
    },

    getPeersCount: function() {
      return Math.max(1, activePeers.size + 1);
    },

    isConnected: function() {
      return isMqttConnected;
    }
  };

  /* Modal de Configurações de Sincronização */
  window.openSyncModal = function() {
    const modal = document.getElementById('modalSyncConfig');
    if (!modal) return;

    const inp = document.getElementById('inputSyncRoom');
    if (inp) inp.value = currentChannel;

    const statusTxt = document.getElementById('syncModalStatusDesc');
    if (statusTxt) {
      statusTxt.innerHTML = isMqttConnected 
        ? `<span style="color:#16A34A; font-weight:800;">🟢 Conectado em Tempo Real (On-Time)</span> via WebSockets (${WSS_BROKERS[currentBrokerIdx]})`
        : `<span style="color:#D97706; font-weight:800;">🟡 Operando Localmente / Conectando</span> ao Broker Cloud`;
    }

    const peersList = document.getElementById('syncPeersList');
    if (peersList) {
      const peers = Array.from(activePeers.values());
      if (peers.length === 0) {
        peersList.innerHTML = `<li style="color:#64748B;">Apenas este dispositivo conectado no momento. Abra o link no GitHub em outro computador ou celular para ver a sincronização instantânea!</li>`;
      } else {
        peersList.innerHTML = peers.map(p => `
          <li style="color:#0F172A; margin-bottom:4px;">
            <b>👤 ${p.operador}</b> — Conectado e sincronizado há poucos segundos
          </li>
        `).join('');
      }
    }

    modal.style.display = 'flex';
  };

  window.salvarCanalSync = function() {
    const inp = document.getElementById('inputSyncRoom');
    if (inp && inp.value) {
      window.DHL_SYNC.setChannel(inp.value);
      document.getElementById('modalSyncConfig').style.display = 'none';
    }
  };

  window.forcarSincronizacaoGeral = function() {
    requestSyncFromPeers();
    respondWithCurrentState();
    if (typeof window.showToast === 'function') {
      window.showToast('📡 Pacote de sincronização transmitido para todos os dispositivos conectados.');
    }
    document.getElementById('modalSyncConfig').style.display = 'none';
  };

  // Inicializa quando a página estiver carregada
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncEngine);
  } else {
    initSyncEngine();
  }
})();
