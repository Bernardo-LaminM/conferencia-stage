/* =========================================================
   AUDIO & FALA SINTETIZADA (Web Audio API + SpeechSynthesis)
   ========================================================= */
class SoundFX {
  constructor() {
    this.ctx = null;
    this.soundEnabled = true;
    this.voiceEnabled = true;
  }
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  speak(text) {
    if (!this.voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'pt-BR';
      utter.rate = 1.30;
      window.speechSynthesis.speak(utter);
    } catch(e) {}
  }
  playSuccess(customMsg) {
    if (!this.soundEnabled) return;
    this.init();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    }
    this.speak(customMsg || 'Confirmado');
  }
  playWarning(customMsg) {
    if (!this.soundEnabled) return;
    this.init();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      [0, 0.11].forEach(offset => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(750, now + offset);
        gain.gain.setValueAtTime(0.3, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.08);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.08);
      });
    }
    this.speak(customMsg || 'Já conferido');
  }
  playError(customMsg) {
    if (!this.soundEnabled) return;
    this.init();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.setValueAtTime(120, now + 0.18);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    }
    this.speak(customMsg || 'Divergência');
  }
}

const sound = new SoundFX();

/* =========================================================
   CHAVES DE ARMAZENAMENTO PERMANENTE (LOCALSTORAGE)
   ========================================================= */
const STORAGE_HISTORY_KEY = 'dhl_stage_audit_history_v1';
const STORAGE_DATABASE_OVERRIDE_KEY = 'dhl_stage_database_custom_v1';
const STORAGE_ACTIVE_SESSION_KEY = 'dhl_stage_active_session_v1';
const STORAGE_INVENTORY_ALERTS_KEY = 'dhl_stage_inventory_alerts_v1';
const STORAGE_BASE_VERSIONS_KEY = 'dhl_stage_base_versions_v1';
const STORAGE_PARTIAL_CONFERENCES_KEY = 'dhl_stage_partial_conferences_v2';
const STORAGE_STAGE_CAPACITIES_KEY = 'dhl_stage_capacities_v2';
const STORAGE_STAGE_BLOCKED_SLOTS_KEY = 'dhl_stage_blocked_slots_v2';
const STORAGE_STAGE_BLOCKED_MANUAL_KEY = 'dhl_stage_blocked_manual_v1';

let database = null;

// Gerador de todos os stages do armazém (Faixas 1 a 3 contínuas até o último stage SO142 + stages da base)
function getAllMasterStages() {
  const set = new Set();
  // Faixa 1: Docas SO001 a SO034
  for (let i = 1; i <= 34; i++) {
    set.add('SO' + String(i).padStart(3, '0'));
  }
  // Faixa 2: Docas SO040 a SO076 (termina no ST76 ao lado da Sala de Operações)
  for (let i = 40; i <= 76; i++) {
    set.add('SO' + String(i).padStart(3, '0'));
  }
  // Faixa 3: Docas SO129 a SO142 (até o último stage físico do armazém)
  for (let i = 129; i <= 142; i++) {
    set.add('SO' + String(i).padStart(3, '0'));
  }

  // Inclui dinamicamente qualquer stage extra presente na base/planilhas carregadas
  if (database && database.embarques) {
    Object.values(database.embarques).forEach(e => {
      if (!e) return;
      const sList = Array.isArray(e.stages) ? e.stages : (e.stages ? String(e.stages).split(/[\s,]+/) : []);
      sList.forEach(s => {
        const m = String(s).match(/\d+/);
        if (m) set.add('SO' + String(m[0]).padStart(3, '0'));
      });
      if (e.paletes && Array.isArray(e.paletes)) {
        e.paletes.forEach(p => {
          if (p && p.stage) {
            const m = String(p.stage).match(/\d+/);
            if (m) set.add('SO' + String(m[0]).padStart(3, '0'));
          }
        });
      }
    });
  }

  return Array.from(set).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB; // Ordem sequencial do 1 ao 76 (terminando ao lado da Sala de Operações)
  });
}

// Lista mestre inicial de todos os stages do galpão
let MASTER_STAGES = getAllMasterStages();

/* =========================================================
   ESTADO DA APLICAÇÃO
   ========================================================= */
let activeEmbarque = null;
let activeConference = {
  embarqueId: '',
  operador: '',
  iniciadoEm: null,
  finalizadoEm: null,
  conferidos: new Map(),
  divergencias: [],
  historico: [],
  currentPhysicalStage: '', // Stage físico atual bipado ou selecionado
  lastComparison: null,     // { lpn, sistemico, fisico, isMatch, timestamp }
  stageSlots: {},           // { [stageCode]: { [slotNum]: slotData } }
  slots: {},                // { 1: { slot, lpn, status, sku, lote, qtd, timestamp }, ... }
  activeSlot: 1,            // Próxima vaga alvo
  capacity: 10,             // 6, 8 ou 10
  direction: 'asc'          // 'asc' (1->10) ou 'desc' (10->1)
};

let currentDashFilter = 'all';
let currentDashSearch = '';

let scanDebounceTimer = null;
let isProcessingBarcode = false;

function formatStages(stages) {
  if (!stages) return 'N/A';
  if (Array.isArray(stages)) return stages.join(', ');
  return String(stages);
}

function normalizeBarcode(code) {
  if (!code) return '';
  return code.toString().trim().replace(/[\s\(\)\-]/g, '');
}

function normalizeStageName(stg) {
  if (!stg) return '';
  const s = String(stg).toUpperCase().trim().replace(/[\s\-_]/g, '');
  // Reconhece ST, SO, STG, STAGE indistintamente, com ou sem sufixo de letra/vaga (ex: ST008, SO008, ST01A, SO01A, SO1A, ST02B -> SO001A, SO002B)
  const m = s.match(/^(?:SO|ST|STG|STAGE)0*(\d+)([A-Z]*)$/i);
  if (m) {
    const num = parseInt(m[1], 10);
    const suffix = m[2] ? m[2].toUpperCase() : '';
    return 'SO' + String(num).padStart(3, '0') + suffix;
  }
  return s;
}

function getBaseStage(stg) {
  if (!stg) return '';
  const norm = normalizeStageName(stg);
  return norm.replace(/[A-Z]+$/, '');
}

function formatStageSlotDisplay(stage, slotNum) {
  if (!stage) return '';
  const clean = String(stage).toUpperCase().trim().replace(/[\s\-_]/g, '');
  
  // 1. Se já tem letra no final (ex: SO01A, SO1A, SO001A, ST02B)
  const matchWithLetter = clean.match(/^(?:SO|ST|STG|STAGE)0*(\d+)([A-Z])$/i);
  if (matchWithLetter) {
    const n = parseInt(matchWithLetter[1], 10);
    const letter = matchWithLetter[2].toUpperCase();
    const numStr = n < 10 ? '0' + n : String(n);
    return `SO${numStr}${letter}`;
  }

  // 2. Se é código de Stage padrão (ex: SO001, SO1, ST02, SO16)
  const matchBase = clean.match(/^(?:SO|ST|STG|STAGE)0*(\d+)$/i);
  if (matchBase) {
    const n = parseInt(matchBase[1], 10);
    const numStr = n < 10 ? '0' + n : String(n);
    const baseStr = `SO${numStr}`;
    
    if (slotNum && slotNum >= 1 && slotNum <= 10) {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      const letter = letters[slotNum - 1] || slotNum;
      return `${baseStr}${letter}`;
    }
    return baseStr;
  }

  // 3. Fallback genérico
  if (slotNum && slotNum >= 1 && slotNum <= 10) {
    const letter = String.fromCharCode(64 + slotNum);
    return `${clean}${letter}`;
  }
  return clean;
}

function isStageBarcode(rawCode) {
  if (!rawCode) return false;
  const s = String(rawCode).toUpperCase().trim().replace(/[\s\-_]/g, '');
  // Reconhece códigos com prefixos SO, ST, STG ou STAGE seguidos de números e letra opcional (ex: SO004, ST008, SO01A, ST02B)
  if (/^(?:SO|ST|STG|STAGE)\d+[A-Z]?$/i.test(s)) return true;
  const base = s.replace(/[A-Z]$/i, '');
  if (MASTER_STAGES.some(ms => normalizeStageName(ms) === normalizeStageName(base) || normalizeStageName(ms) === normalizeStageName(s))) return true;
  if (activeEmbarque && activeEmbarque.stages) {
    const list = Array.isArray(activeEmbarque.stages) ? activeEmbarque.stages : [activeEmbarque.stages];
    if (list.some(st => normalizeStageName(st) === normalizeStageName(base) || normalizeStageName(st) === normalizeStageName(s))) return true;
  }
  return false;
}

// Identifica qual embarque está alocado em um stage específico (evita cobrir outro embarque)
function getStageOccupant(stageCode, excludeEmbarqueId = '') {
  if (!database || !database.embarques) return null;
  const normTarget = normalizeStageName(stageCode);
  if (!normTarget) return null;

  const targetCleanEmb = excludeEmbarqueId ? normalizeBarcode(excludeEmbarqueId).replace(/^0+/, '') : '';

  for (const embId of Object.keys(database.embarques)) {
    const emb = database.embarques[embId];
    if (emb.embarque !== embId) continue; // ignora aliases duplicados
    const currentClean = normalizeBarcode(emb.embarque).replace(/^0+/, '');
    if (targetCleanEmb && currentClean === targetCleanEmb) {
      continue;
    }

    const sList = Array.isArray(emb.stages) ? emb.stages : String(emb.stages || '').split(/[\s,]+/);
    if (sList.some(s => normalizeStageName(s) === normTarget)) {
      return emb;
    }
    if (emb.paletes && Array.isArray(emb.paletes)) {
      if (emb.paletes.some(p => normalizeStageName(p.stage) === normTarget)) {
        return emb;
      }
    }
  }
  return null;
}

// Retorna o stage vizinho/adjacente sequencial (ex: SO006 -> SO007)
function getAdjacentStage(currentStageCode, step = 1) {
  const norm = normalizeStageName(currentStageCode);
  const m = norm.match(/\d+/);
  if (m) {
    const num = parseInt(m[0], 10) + step;
    if (num > 0) {
      return 'SO' + String(num).padStart(3, '0');
    }
  }
  return null;
}

// Busca a próxima doca/stage fisicamente LIVRE para transbordo seguro (sem cobrir outro embarque)
function findNextFreeAdjacentStage(currentStageCode, currentEmbarqueId) {
  const norm = normalizeStageName(currentStageCode);
  const m = norm.match(/\d+/);
  const baseNum = m ? parseInt(m[0], 10) : 0;

  for (let offset = 1; offset <= 15; offset++) {
    const candidate = 'SO' + String(baseNum + offset).padStart(3, '0');
    const occupant = getStageOccupant(candidate, currentEmbarqueId);
    if (!occupant) {
      return { stage: candidate, status: 'free' };
    }
  }
  return null;
}

/* =========================================================
   PERSISTÊNCIA DO HISTÓRICO DE AUDITORIAS (NUNCA SE PERDE)
   ========================================================= */
function getStoredHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.warn('Erro ao ler histórico:', e);
    return [];
  }
}

function saveStoredHistory(historyList) {
  try {
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(historyList));
    updateHistoryBadge();
  } catch(e) {
    console.error('Erro ao gravar histórico:', e);
  }
}

function updateHistoryBadge() {
  const historyList = getStoredHistory();
  const alerts = getStoredInventoryAlerts();
  const versions = getStoredBaseVersions();

  const badge = document.getElementById('navHistCount');
  if (badge) badge.textContent = historyList.length;

  const tabBadgeConf = document.getElementById('tabBadgeConf');
  const tabBadgeOcorr = document.getElementById('tabBadgeOcorr');
  const tabBadgeEvol = document.getElementById('tabBadgeEvol');

  if (tabBadgeConf) tabBadgeConf.textContent = historyList.length;
  if (tabBadgeOcorr) tabBadgeOcorr.textContent = alerts.length;
  if (tabBadgeEvol) tabBadgeEvol.textContent = versions.length;

  const totalCountElem = document.getElementById('histTotalCount');
  const totalPaletesElem = document.getElementById('histTotalPaletes');
  const totalDivElem = document.getElementById('histTotalDivergencias');

  if (totalCountElem) totalCountElem.textContent = historyList.length;

  let totalAudPaletes = 0;
  let totalAudDivs = 0;
  historyList.forEach(h => {
    totalAudPaletes += (h.conferidosCount || 0);
    totalAudDivs += (h.divergenciasCount || 0);
  });

  if (totalPaletesElem) totalPaletesElem.textContent = totalAudPaletes;
  if (totalDivElem) totalDivElem.textContent = totalAudDivs;
}

function updateAlertsBadge() {
  updateHistoryBadge();
}

/* =========================================================
   PERSISTÊNCIA DE OCORRÊNCIAS DE INVENTÁRIO (PALETES TROCADOS)
   ========================================================= */
function getStoredInventoryAlerts() {
  try {
    const raw = localStorage.getItem(STORAGE_INVENTORY_ALERTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveInventoryAlert(alertObj) {
  try {
    const list = getStoredInventoryAlerts();
    list.unshift(alertObj);
    localStorage.setItem(STORAGE_INVENTORY_ALERTS_KEY, JSON.stringify(list));
    updateHistoryBadge();
  } catch(e) {}
}

/* =========================================================
   PERSISTÊNCIA DA EVOLUÇÃO E VERSIONAMENTO DA BASE
   ========================================================= */
function getStoredBaseVersions() {
  try {
    const raw = localStorage.getItem(STORAGE_BASE_VERSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveBaseVersion(versionObj) {
  try {
    const list = getStoredBaseVersions();
    list.unshift(versionObj);
    localStorage.setItem(STORAGE_BASE_VERSIONS_KEY, JSON.stringify(list));
  } catch(e) {}
}

function recordActiveConferenceToHistory(status = 'Em Andamento') {
  if (!activeEmbarque || !activeConference.embarqueId) return;

  const historyList = getStoredHistory();
  const total = activeEmbarque.total_paletes;
  const confCount = activeConference.conferidos.size;
  const pendCount = Math.max(0, total - confCount);
  const divCount = activeConference.divergencias.length;

  const serializedRecord = {
    id: activeConference.iniciadoEm ? activeConference.iniciadoEm.getTime() : Date.now(),
    embarqueId: activeConference.embarqueId,
    operador: activeConference.operador,
    stages: activeEmbarque.stages,
    iniciadoEm: activeConference.iniciadoEm ? activeConference.iniciadoEm.toISOString() : new Date().toISOString(),
    finalizadoEm: activeConference.finalizadoEm ? activeConference.finalizadoEm.toISOString() : (status === 'Concluído' ? new Date().toISOString() : null),
    status: status,
    totalPaletes: total,
    conferidosCount: confCount,
    pendentesCount: pendCount,
    divergenciasCount: divCount,
    percentual: total > 0 ? Math.round((confCount / total) * 100) : 0,
    conferidos: Array.from(activeConference.conferidos.entries()),
    divergencias: activeConference.divergencias,
    historico: activeConference.historico,
    currentPhysicalStage: activeConference.currentPhysicalStage,
    lastComparison: activeConference.lastComparison,
    stageSlots: activeConference.stageSlots || {},
    slots: activeConference.slots || {},
    capacity: activeConference.capacity || 10,
    direction: activeConference.direction || 'asc'
  };

  const existingIdx = historyList.findIndex(h => h.id === serializedRecord.id || (h.embarqueId === serializedRecord.embarqueId && h.status === 'Em Andamento'));
  if (existingIdx >= 0) {
    historyList[existingIdx] = serializedRecord;
  } else {
    historyList.unshift(serializedRecord);
  }

  saveStoredHistory(historyList);
}

function persistActiveSession() {
  if (!activeEmbarque || !activeConference.embarqueId) {
    localStorage.removeItem(STORAGE_ACTIVE_SESSION_KEY);
    return;
  }
  const session = {
    embarqueId: activeConference.embarqueId,
    operador: activeConference.operador,
    iniciadoEm: activeConference.iniciadoEm ? activeConference.iniciadoEm.toISOString() : new Date().toISOString(),
    conferidos: Array.from(activeConference.conferidos.entries()),
    divergencias: activeConference.divergencias,
    historico: activeConference.historico,
    currentPhysicalStage: activeConference.currentPhysicalStage,
    lastComparison: activeConference.lastComparison,
    stageSlots: activeConference.stageSlots || {},
    slots: activeConference.slots || {}
  };
  try {
    localStorage.setItem(STORAGE_ACTIVE_SESSION_KEY, JSON.stringify(session));
  } catch(e) {}
}

/* =========================================================
   CARREGAMENTO E MESCLAGEM DA BASE DE DADOS
   ========================================================= */
function loadData() {
  // 1. Base customizada salva via Upload de Excel no navegador (prioridade operacional de hoje)
  let loadedFromCustom = false;
  try {
    const savedCustom = localStorage.getItem(STORAGE_DATABASE_OVERRIDE_KEY);
    if (savedCustom) {
      const customDb = JSON.parse(savedCustom);
      if (customDb && customDb.embarques && Object.keys(customDb.embarques).length > 0) {
        database = customDb;
        loadedFromCustom = true;
      }
    }
  } catch(e) {
    console.warn('Erro ao carregar base salva no storage:', e);
  }

  // 2. Base embutida (stage_data.js) caso não haja base customizada salva
  if (!loadedFromCustom) {
    if (window.EMBEDDED_STAGE_DATA && window.EMBEDDED_STAGE_DATA.embarques && Object.keys(window.EMBEDDED_STAGE_DATA.embarques).length > 0) {
      database = JSON.parse(JSON.stringify(window.EMBEDDED_STAGE_DATA));
    } else {
      database = { embarques: {} };
      // Fallback assíncrono para stage_data.json se stage_data.js estiver em cache/atrasado
      try {
        fetch('stage_data.json?t=' + Date.now())
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (j && j.embarques && Object.keys(j.embarques).length > 0) {
              database = j;
              updateBaseInfoUI();
              updateHistoryBadge();
              if (typeof renderYardGrid === 'function') renderYardGrid();
            }
          }).catch(() => {});
      } catch (e) {}
    }
  }

  updateBaseInfoUI();
  updateHistoryBadge();
}

window.limparBaseCustomizada = function() {
  if (confirm('Deseja remover as planilhas customizadas carregadas e restaurar a base padrão de stage_data.js?')) {
    localStorage.removeItem(STORAGE_DATABASE_OVERRIDE_KEY);
    loadData();
    if (document.getElementById('viewDashboard')?.style.display === 'block') {
      renderDashboard();
    }
    showToast('Base customizada limpa. Restaurada base padrão.');
  }
};

function updateBaseInfoUI() {
  const uniqueEmbs = new Set();
  if (database && database.embarques) {
    Object.values(database.embarques).forEach(e => {
      if (e && e.embarque) uniqueEmbs.add(e.embarque);
    });
  }
  const total = uniqueEmbs.size;
  const navBadge = document.getElementById('navBaseCount');
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const dataBase = database?.data_base || (database?.gerado_em ? database.gerado_em.split(' ')[0] : dataHoje);

  if (navBadge) {
    navBadge.textContent = `📊 Base (${dataBase}): ${total} Cargas`;
  }

  const infoDetails = document.getElementById('infoBaseDetails');
  if (infoDetails) {
    infoDetails.innerHTML = `
      <b>Data da Base Operacional:</b> ${dataBase} (Hoje: ${dataHoje})<br>
      <b>Total de Registros de Embarques:</b> ${total}<br>
      <b>Status de Sincronização:</b> Memória Local & Persistente Ativa.<br>
      <b>Última Carga / Atualização:</b> ${database?.gerado_em || 'Recente'}
    `;
  }
}

function showToast(message, duration = 4000) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.innerHTML = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

/* =========================================================
   PARSER NATIVO DE CSV DIRETO NO NAVEGADOR (SEM DEPENDÊNCIAS)
   ========================================================= */
function parseDirectCsvText(csvText) {
  if (!csvText) return {};
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);

  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return {};

  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/[\[\]'"]/g, '').trim().toLowerCase());

  let idxEmb = -1, idxPal = -1, idxStage = -1, idxSku = -1, idxQtd = -1, idxOrd = -1, idxLote = -1;
  headers.forEach((h, idx) => {
    if (h.includes('car_move') || h.includes('embarque') || h.includes('carmove')) idxEmb = idx;
    if (h.includes('pallet') || h.includes('palete') || h.includes('lpn') || h.includes('etiqueta')) idxPal = idx;
    if (h.includes('stage') || h.includes('dstloc') || h.includes('destino')) idxStage = idx;
    if (h.includes('sku') || h.includes('prtnum') || h.includes('material')) idxSku = idx;
    if (h.includes('qtd') || h.includes('caixa') || h.includes('quantidade') || h.includes('pckqty')) idxQtd = idx;
    if (h.includes('ordnum') || h.includes('order')) idxOrd = idx;
    if (h.includes('lote') || h.includes('lotnum')) idxLote = idx;
  });

  if (idxEmb === -1 || idxPal === -1) {
    idxEmb = 0; idxOrd = 1; idxPal = 2; idxStage = 3; idxSku = 4; idxQtd = 5;
  }

  const dict = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep);
    const embId = (parts[idxEmb] || '').trim();
    const palId = (parts[idxPal] || '').trim();
    if (!embId || !palId) continue;

    const ordNum = idxOrd !== -1 ? (parts[idxOrd] || '').trim() : '';
    const stage = idxStage !== -1 ? (parts[idxStage] || '').trim() : '';
    const sku = idxSku !== -1 ? (parts[idxSku] || '').trim() : '';
    const lote = idxLote !== -1 ? (parts[idxLote] || '').trim() : '';
    const qtd = idxQtd !== -1 ? (parseInt(parts[idxQtd], 10) || 0) : 0;

    if (!dict[embId]) {
      dict[embId] = {
        embarque: embId,
        total_paletes: 0,
        total_pecas: 0,
        stages: new Set(),
        pal: new Map()
      };
    }

    const e = dict[embId];
    if (stage) e.stages.add(stage);

    if (!e.pal.has(palId)) {
      e.pal.set(palId, {
        palete: palId,
        stage: stage,
        order_num: ordNum,
        lote: lote,
        itens: [],
        qtd_total: 0,
        sku_resumo: sku || 'Material',
        desc_resumo: sku ? 'SKU ' + sku : 'Material'
      });
    }

    const p = e.pal.get(palId);
    p.itens.push({
      sku: sku,
      desc_produto: sku ? 'SKU ' + sku : 'Material',
      lote: lote,
      qtd: qtd,
      order_num: ordNum
    });
    p.qtd_total += qtd;
    e.total_pecas += qtd;
  }

  const out = {};
  Object.values(dict).forEach(e => {
    const paletes = Array.from(e.pal.values());
    out[e.embarque] = {
      embarque: e.embarque,
      total_paletes: paletes.length,
      total_pecas: e.total_pecas,
      stages: Array.from(e.stages),
      paletes: paletes
    };
    const alias = e.embarque.replace(/^0+/, '');
    if (alias && alias !== e.embarque) {
      out[alias] = out[e.embarque];
    }
  });

  return out;
}

window.processarTextoCsvColado = function() {
  const textarea = document.getElementById('txtCsvManual');
  if (!textarea || !textarea.value.trim()) {
    if (typeof showToast === 'function') showToast('Cole o conteúdo do CSV primeiro.');
    return;
  }

  try {
    const parsed = parseDirectCsvText(textarea.value);
    const count = Object.keys(parsed).length;
    if (count === 0) {
      throw new Error('Não foi possível identificar colunas válidas no CSV colado.');
    }
    injetarParsedEmbarquesNoSistema(parsed, 'CSV_Colado_Direto.csv', false);
    if (typeof showToast === 'function') {
      showToast(`✔ CSV colado processado! ${count} embarques carregados no sistema.`);
    }
    textarea.value = '';
  } catch (err) {
    if (typeof showToast === 'function') showToast('❌ Erro no CSV: ' + err.message);
  }
};

/* =========================================================
   PARSER DE PLANILHAS EXCEL & CSV (TABULAR + GUIA + WMS)
   ========================================================= */
function processExcelFile(file) {
  const feedback = document.getElementById('uploadFeedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.innerHTML = `<div style="color: var(--text-secondary); padding: 10px;">⏳ Lendo e processando <b>${file.name}</b>...</div>`;
  }

  // 1. Processamento ultra-rápido nativo se for arquivo .CSV
  if (file.name.toLowerCase().endsWith('.csv')) {
    const textReader = new FileReader();
    textReader.onload = function(ev) {
      try {
        const text = ev.target.result;
        const parsedEmbarques = parseDirectCsvText(text);
        if (Object.keys(parsedEmbarques).length === 0) {
          throw new Error('Não foi possível identificar dados no CSV. Verifique os cabeçalhos.');
        }
        injetarParsedEmbarquesNoSistema(parsedEmbarques, file.name, false);
      } catch (err) {
        if (feedback) {
          feedback.innerHTML = `<div style="background: var(--status-diverg-bg); border: 1px solid var(--status-diverg-border); color: #B91C1C; padding: 14px; border-radius: var(--radius-sm);"><b>❌ Erro ao ler CSV:</b> ${err.message}</div>`;
        }
      }
    };
    textReader.readAsText(file, 'utf-8');
    return;
  }

  // 2. Processamento via SheetJS para planilhas .XLSX / .XLS
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      if (typeof XLSX === 'undefined') {
        throw new Error('Biblioteca XLSX não carregada.');
      }
      const workbook = XLSX.read(data, { type: 'array' });
      
      let parsedEmbarques = {};

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

      const firstRowStr = (rawRows[0] || []).join(' ').toLowerCase();
      let isGuia = false;
      if (firstRowStr.includes('car_move') || firstRowStr.includes('etiqueta') || firstRowStr.includes('ordnum')) {
        isGuia = false;
      } else {
        for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
          const rowStr = (rawRows[r] || []).join(' ').toUpperCase();
          if (rowStr.includes('GUIA DE CONFERÊNCIA') || (rowStr.includes('EMBARQUE:') && rowStr.includes('STAGE:'))) {
            isGuia = true;
            break;
          }
        }
      }

      if (isGuia) {
        parsedEmbarques = parseGuiaConferenciaSheet(rawRows);
      } else {
        parsedEmbarques = parseWmsWorkbook(workbook);
      }

      injetarParsedEmbarquesNoSistema(parsedEmbarques, file.name, isGuia);
    } catch(err) {
      if (feedback) {
        feedback.innerHTML = `<div style="background: var(--status-diverg-bg); border: 1px solid var(--status-diverg-border); color: #B91C1C; padding: 14px; border-radius: var(--radius-sm);"><b>❌ Erro ao processar arquivo:</b> ${err.message}</div>`;
      }
    }
  };
  reader.readAsArrayBuffer(file);
}

function injetarParsedEmbarquesNoSistema(parsedEmbarques, nomeOrigem, isGuia = false) {
  const feedback = document.getElementById('uploadFeedback');
  const embKeys = Object.keys(parsedEmbarques);
  if (embKeys.length === 0) {
    throw new Error('Não foi possível identificar dados de embarque/paletes. Verifique o formato.');
  }

  // 1. Mapear stage -> embarque anterior
  const prevStageEmbarque = {};
  if (database && database.embarques) {
    Object.values(database.embarques).forEach(e => {
      if (e && e.embarque && e.stages) {
        const sList = Array.isArray(e.stages) ? e.stages : String(e.stages).split(/[\s,]+/);
        sList.forEach(s => {
          const norm = normalizeStageName(s);
          if (norm) prevStageEmbarque[norm] = e.embarque;
        });
      }
    });
  }

  // 2. Mapear stage -> novo embarque na planilha carregada
      const newStageEmbarque = {};
      Object.values(parsedEmbarques).forEach(e => {
        if (e && e.embarque && e.stages) {
          const sList = Array.isArray(e.stages) ? e.stages : String(e.stages).split(/[\s,]+/);
          sList.forEach(s => {
            const norm = normalizeStageName(s);
            if (norm) newStageEmbarque[norm] = e.embarque;
          });
        }
      });

      // 3. Regra de sincronização dos stages:
      // "Se for o mesmo embarque ok, mas caso não, ele deve atualizar de acordo com o upload."
      let partials = {};
      try {
        partials = JSON.parse(localStorage.getItem(STORAGE_PARTIAL_CONFERENCES_KEY) || '{}');
      } catch(e) { partials = {}; }

      let stagesResetados = 0;
      let stagesMantidos = 0;

      MASTER_STAGES.forEach(stgCode => {
        const norm = normalizeStageName(stgCode);
        const oldEmb = prevStageEmbarque[norm];
        const newEmb = newStageEmbarque[norm];

        if (!newEmb) {
          // Stage agora está LIVRE na nova planilha!
          // Remove conferências parciais anteriores associadas a este stage
          if (oldEmb && partials[oldEmb]?.stageSlots?.[norm]) {
            delete partials[oldEmb].stageSlots[norm];
            stagesResetados++;
          }
        } else if (newEmb !== oldEmb) {
          // Mudou de embarque no stage!
          // Limpa conferência e slots anteriores para iniciar limpo (AGUARDANDO / 0%)
          if (oldEmb && partials[oldEmb]?.stageSlots?.[norm]) {
            delete partials[oldEmb].stageSlots[norm];
          }
          if (partials[newEmb]?.stageSlots?.[norm]) {
            delete partials[newEmb].stageSlots[norm];
          }
          stagesResetados++;
        } else {
          // Mesmo embarque no stage -> Mantém progresso ("se for o mesmo embarque ok")
          stagesMantidos++;
        }
      });

      const now = new Date();
      const dataHoje = now.toLocaleDateString('pt-BR');
      const dataHoraHoje = now.toLocaleString('pt-BR');

      // 4. Substituição / Atualização da Base Operacional
      if (!isGuia || !database || !database.embarques || Object.keys(database.embarques).length === 0) {
        // Planilha diária (WMS): substitui a base ativa pelos embarques de hoje
        database = {
          total_embarques: embKeys.length,
          data_base: dataHoje,
          gerado_em: dataHoraHoje,
          arquivo_origem: nomeOrigem,
          embarques: parsedEmbarques
        };
      } else {
        // Guia avulsa de embarque específico: atualiza/adiciona na base existente
        if (!database) database = { embarques: {} };
        database.data_base = dataHoje;
        database.gerado_em = dataHoraHoje;
        database.arquivo_origem = nomeOrigem;
        embKeys.forEach(embId => {
          database.embarques[embId] = parsedEmbarques[embId];
        });
      }

      // Limpa do storage conferências de embarques que não existem mais na base ativa
      Object.keys(partials).forEach(embId => {
        const cleanId = embId.replace(/^0+/, '');
        if (!database.embarques[embId] && !database.embarques[cleanId] && !database.embarques['00' + embId]) {
          delete partials[embId];
        }
      });

      try {
        localStorage.setItem(STORAGE_PARTIAL_CONFERENCES_KEY, JSON.stringify(partials));
      } catch(e) {}

      let totalPaletesDepois = 0;
      Object.values(database.embarques).forEach(e => {
        if (e && e.embarque) totalPaletesDepois += (e.total_paletes || 0);
      });
      const uniqueCount = new Set(Object.values(database.embarques).map(e => e.embarque)).size;

      // Grava snapshot na Evolução da Base
      const evolSnapshot = {
        data: dataHoraHoje,
        arquivo: nomeOrigem,
        totalEmbarques: uniqueCount,
        totalPaletes: totalPaletesDepois,
        detalhes: `Upload de hoje processado: ${embKeys.length} embarques sincronizados. ${stagesMantidos} stages com mesmo embarque mantidos, ${stagesResetados} stages atualizados/resetados de acordo com a planilha.`
      };
      saveBaseVersion(evolSnapshot);

      // Salva no localStorage a base customizada ativa de hoje
      try {
        localStorage.setItem(STORAGE_DATABASE_OVERRIDE_KEY, JSON.stringify(database));
      } catch(errStorage) {
        console.warn('Armazenamento local cheio, mantendo em memória ativa:', errStorage);
      }

      // Sincroniza a nova base com todos os operadores na nuvem / GitHub Pages em tempo real!
      if (window.DHL_SYNC && typeof window.DHL_SYNC.notifyBaseUpdated === 'function') {
        window.DHL_SYNC.notifyBaseUpdated(nomeOrigem, database);
      }

      // Se havia conferência ativa deste embarque, sincroniza o activeEmbarque
      if (activeConference.embarqueId && database.embarques[activeConference.embarqueId]) {
        activeEmbarque = database.embarques[activeConference.embarqueId];
        updateUI();
      }

      updateBaseInfoUI();
      if (typeof renderDashboard === 'function') {
        renderDashboard();
      }

      const firstEmb = embKeys[0];
      const firstData = parsedEmbarques[firstEmb];

      if (feedback) {
        feedback.innerHTML = `
          <div style="background: var(--status-ok-bg); border: 1px solid var(--status-ok-border); color: #065F46; padding: 14px; border-radius: var(--radius-sm); font-size: 0.9rem;">
            <b>✔ Importação Concluída com Sucesso!</b><br>
            • Origem: <b>${nomeOrigem}</b><br>
            • Embarques no Arquivo: <b>${embKeys.length}</b> (Total Únicos na Base: ${uniqueCount})<br>
            • Data da Base: <b>${dataHoje}</b><br>
            • Stages Mantidos: <b>${stagesMantidos}</b> | Stages Atualizados/Resetados: <b>${stagesResetados}</b><br>
            • Exemplo Carregado: <b>${firstEmb}</b> (${firstData.total_paletes} paletes, Stage ${formatStages(firstData.stages)})<br>
            <div style="margin-top: 10px;">
              <button id="btnIniciarEmbarqueImportado" class="btn-finish-clean" style="padding: 6px 14px; font-size: 0.8rem;">
                Iniciar Conferência do Embarque ${firstEmb} Agora
              </button>
            </div>
          </div>
        `;

        document.getElementById('btnIniciarEmbarqueImportado')?.addEventListener('click', () => {
          document.getElementById('modalUpload').style.display = 'none';
          const inputEmb = document.getElementById('inputEmbarque');
          if (inputEmb) inputEmb.value = firstEmb;
          entrarNoEmbarque();
        });
      }

      showToast(`✔ Planilha de hoje carregada! ${embKeys.length} embarques sincronizados.`);

      const inputEmb = document.getElementById('inputEmbarque');
      if (inputEmb && !inputEmb.value) {
        inputEmb.value = firstEmb;
      }
}

function parseGuiaConferenciaSheet(rows) {
  let embarqueId = '';
  let defaultStage = '';
  let headerRowIndex = -1;

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toUpperCase();
      if (cell.includes('EMBARQUE') && !embarqueId) {
        const nextVal = String(row[c + 1] || '').trim().replace(/[^\d]/g, '');
        if (nextVal) embarqueId = nextVal;
      }
      if (cell.includes('STAGE') && !defaultStage) {
        const nextVal = String(row[c + 1] || '').trim();
        if (nextVal && nextVal.length < 20) defaultStage = nextVal;
      }
      if (cell === 'LPN' || cell === 'PALLET' || cell === 'PALETE') {
        headerRowIndex = r;
      }
    }
  }

  if (!embarqueId) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim();
        if (/^\d{7,9}$/.test(val)) {
          embarqueId = val;
          break;
        }
      }
      if (embarqueId) break;
    }
  }

  if (!embarqueId) embarqueId = 'EMB_' + Date.now().toString().slice(-6);
  if (headerRowIndex === -1) headerRowIndex = 25;

  const paletesDict = new Map();
  let currentLpn = '';
  const stagesSet = new Set();
  if (defaultStage) stagesSet.add(defaultStage);

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.length === 0) continue;

    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const colC = String(row[2] || '').trim();
    const colD = row[3];
    const colE = String(row[4] || '').trim();

    if (colA.includes('ASS.') || colC.includes('ASS.') || colB === 'OK' || colB === 'NOK') {
      break;
    }

    if (colB && colB.length >= 8 && /^\d+$/.test(colB)) {
      currentLpn = colB;
    }

    const stageRow = colA || defaultStage || 'STAGE';
    if (stageRow) stagesSet.add(stageRow);

    const skuDesc = colC || 'Material';
    const qty = parseInt(colD) || 0;
    const lote = colE || '';

    if (currentLpn && (skuDesc || qty > 0)) {
      if (!paletesDict.has(currentLpn)) {
        paletesDict.set(currentLpn, {
          palete: currentLpn,
          stage: stageRow,
          itens: [],
          qtd_total: 0,
          sku_resumo: skuDesc,
          desc_resumo: skuDesc
        });
      }

      const pObj = paletesDict.get(currentLpn);
      pObj.itens.push({ sku: skuDesc, lote: lote, qtd: qty });
      pObj.qtd_total += qty;
    }
  }

  const paletesList = Array.from(paletesDict.values());
  let totalPecas = 0;
  paletesList.forEach(p => totalPecas += p.qtd_total);

  const result = {};
  const embData = {
    embarque: embarqueId,
    total_paletes: paletesList.length,
    total_pecas: totalPecas,
    stages: Array.from(stagesSet),
    paletes: paletesList
  };

  result[embarqueId] = embData;
  const cleanKey = embarqueId.replace(/^0+/, '');
  if (cleanKey && cleanKey !== embarqueId) {
    result[cleanKey] = embData;
  }

  return result;
}

function parseWmsWorkbook(workbook) {
  let allocSheet = null;
  let matSheet = null;

  for (const name of workbook.SheetNames) {
    const lower = name.toLowerCase();
    if (lower.includes('sheet4') || lower.includes('aloc') || lower.includes('palete') || lower.includes('stage')) {
      allocSheet = workbook.Sheets[name];
    }
    if (lower.includes('sheet5') || lower.includes('mat') || lower.includes('prod') || lower.includes('sku')) {
      matSheet = workbook.Sheets[name];
    }
  }

  if (!allocSheet) {
    allocSheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  const skuMap = new Map();
  if (matSheet) {
    const matRows = XLSX.utils.sheet_to_json(matSheet, { header: 1, defval: '' });
    matRows.forEach(row => {
      const code = String(row[0] || '').trim();
      const desc = String(row[7] || row[1] || '').trim();
      if (code && desc) skuMap.set(code, desc);
    });
  }

  const rows = XLSX.utils.sheet_to_json(allocSheet, { header: 1, defval: '' });
  if (rows.length < 2) return {};

  let headerRow = 0;
  let idxEmb = 0, idxPal = 2, idxStage = 3, idxSku = 4, idxQtd = 6, idxLote = 5;

  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r] || [];
    row.forEach((cell, idx) => {
      const str = String(cell).toLowerCase().trim();
      if (str.includes('embarque') || str.includes('car_move')) { idxEmb = idx; headerRow = r; }
      if (str.includes('palete') || str.includes('pallet_id') || str.includes('lpn') || str.includes('etiqueta')) { idxPal = idx; headerRow = r; }
      if (str.includes('stage') || str.includes('dstloc')) { idxStage = idx; headerRow = r; }
      if (str.includes('sku') || str.includes('prtnum') || str.includes('material')) { idxSku = idx; headerRow = r; }
      if (str.includes('qtd') || str.includes('quantidade') || str.includes('pckqty') || str.includes('caixa')) { idxQtd = idx; headerRow = r; }
      if (str.includes('lote')) { idxLote = idx; headerRow = r; }
    });
  }

  const embarquesDict = {};

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const embId = String(row[idxEmb] || '').trim();
    const palId = String(row[idxPal] || '').trim();

    if (!embId || !palId) continue;

    const stage = String(row[idxStage] || '').trim();
    const sku = String(row[idxSku] || '').trim();
    const lote = String(row[idxLote] || '').trim();
    const desc = skuMap.get(sku) || `Material ${sku}`;
    const qtd = parseInt(row[idxQtd]) || 0;

    if (!embarquesDict[embId]) {
      embarquesDict[embId] = {
        embarque: embId,
        paletesMap: new Map(),
        stagesSet: new Set()
      };
    }

    const embObj = embarquesDict[embId];
    if (stage) embObj.stagesSet.add(stage);

    if (!embObj.paletesMap.has(palId)) {
      embObj.paletesMap.set(palId, {
        palete: palId,
        stage: stage,
        itens: [],
        qtd_total: 0,
        sku_resumo: sku,
        desc_resumo: desc
      });
    }

    const pObj = embObj.paletesMap.get(palId);
    pObj.itens.push({ sku, lote, qtd });
    pObj.qtd_total += qtd;
  }

  const finalResult = {};
  Object.keys(embarquesDict).forEach(embId => {
    const emb = embarquesDict[embId];
    const palList = Array.from(emb.paletesMap.values());
    let totalQtd = 0;
    palList.forEach(p => totalQtd += p.qtd_total);

    const embData = {
      embarque: embId,
      total_paletes: palList.length,
      total_pecas: totalQtd,
      stages: Array.from(emb.stagesSet),
      paletes: palList
    };

    finalResult[embId] = embData;

    const cleanKey = embId.replace(/^0+/, '');
    if (cleanKey && cleanKey !== embId) {
      finalResult[cleanKey] = embData;
    }
  });

  return finalResult;
}

/* =========================================================
   NAVEGAÇÃO ENTRE TELAS
   ========================================================= */
function showScreen(screenId) {
  document.getElementById('viewLogin').style.display = (screenId === 'viewLogin') ? 'flex' : 'none';
  document.getElementById('viewScanner').style.display = (screenId === 'viewScanner') ? 'flex' : 'none';
  const viewDash = document.getElementById('viewDashboard');
  if (viewDash) viewDash.style.display = (screenId === 'viewDashboard') ? 'block' : 'none';
  const viewCons = document.getElementById('viewConsolidacao');
  if (viewCons) viewCons.style.display = (screenId === 'viewConsolidacao') ? 'flex' : 'none';

  // Botão de consolidação sempre visível na navbar
  const btnCons = document.getElementById('btnToggleConsolidacao');
  if (btnCons) {
    btnCons.style.display = 'inline-flex';
    btnCons.style.background = (screenId === 'viewConsolidacao')
      ? 'linear-gradient(135deg, #059669 0%, #00A650 100%)'
      : '';
  }

  if (screenId === 'viewLogin') {
    const input = document.getElementById('inputEmbarque');
    if (input) {
      input.value = '';
      input.focus();
    }
  } else if (screenId === 'viewScanner') {
    focusScanner();
    renderStageSlotsGrid();
  } else if (screenId === 'viewDashboard') {
    renderDashboard();
  } else if (screenId === 'viewConsolidacao') {
    // A renderização é feita pelo abrirConsolidacaoTela que chama showScreen
  }
}

/* =========================================================
   GERENCIAMENTO DE POSIÇÕES FÍSICAS (SLOTS) DO STAGE
   ========================================================= */
function getStageCapacity(stage) {
  try {
    const caps = JSON.parse(localStorage.getItem(STORAGE_STAGE_CAPACITIES_KEY) || '{}');
    if (caps[stage]) return caps[stage];
  } catch(e){}
  return 10;
}

function saveStageCapacity(stage, cap) {
  try {
    const caps = JSON.parse(localStorage.getItem(STORAGE_STAGE_CAPACITIES_KEY) || '{}');
    caps[stage] = cap;
    localStorage.setItem(STORAGE_STAGE_CAPACITIES_KEY, JSON.stringify(caps));
  } catch(e){}
}

function getStageBlockedSlots(stage) {
  try {
    const blocked = JSON.parse(localStorage.getItem(STORAGE_STAGE_BLOCKED_SLOTS_KEY) || '{}');
    return blocked[stage] || [];
  } catch(e){}
  return [];
}

function toggleStageBlockedSlot(stage, slotNum) {
  try {
    const blocked = JSON.parse(localStorage.getItem(STORAGE_STAGE_BLOCKED_SLOTS_KEY) || '{}');
    let list = blocked[stage] || [];
    if (list.includes(slotNum)) {
      list = list.filter(n => n !== slotNum);
    } else {
      list.push(slotNum);
    }
    blocked[stage] = list;
    localStorage.setItem(STORAGE_STAGE_BLOCKED_SLOTS_KEY, JSON.stringify(blocked));
    return list;
  } catch(e){
    return [];
  }
}

/* =========================================================
   BLOQUEIO OPERACIONAL DE STAGE COMPLETO (INTERAÇÃO DIRETA NA NOMENCLATURA)
   ========================================================= */
window.isStageBlocked = function(stage) {
  if (!stage) return false;
  try {
    const blockedList = JSON.parse(localStorage.getItem(STORAGE_STAGE_BLOCKED_MANUAL_KEY) || '[]');
    const s = String(stage).toUpperCase().trim();
    const norm = typeof normalizeStageName === 'function' ? normalizeStageName(s) : s;
    return blockedList.some(item => item === s || item === norm || (typeof normalizeStageName === 'function' && normalizeStageName(item) === norm));
  } catch(e) {
    return false;
  }
};

window.setStageBlocked = function(stage, blocked) {
  if (!stage) return;
  try {
    let blockedList = JSON.parse(localStorage.getItem(STORAGE_STAGE_BLOCKED_MANUAL_KEY) || '[]');
    const s = String(stage).toUpperCase().trim();
    const norm = typeof normalizeStageName === 'function' ? normalizeStageName(s) : s;
    if (blocked) {
      if (!blockedList.includes(s)) blockedList.push(s);
      if (norm && !blockedList.includes(norm)) blockedList.push(norm);
    } else {
      blockedList = blockedList.filter(item => {
        const itemNorm = typeof normalizeStageName === 'function' ? normalizeStageName(item) : item;
        return item !== s && item !== norm && itemNorm !== norm && itemNorm !== s;
      });
    }
    localStorage.setItem(STORAGE_STAGE_BLOCKED_MANUAL_KEY, JSON.stringify(blockedList));
  } catch(e) {}
};

window.solicitarToggleBloqueioStage = function(stageInput) {
  if (!stageInput) return;
  const rawStage = String(stageInput).trim();
  const normStage = (typeof normalizeStageName === 'function' ? normalizeStageName(rawStage) : rawStage) || rawStage;
  const jaBloqueado = window.isStageBlocked(rawStage) || window.isStageBlocked(normStage);

  const displayStage = rawStage;
  let confirmMsg = '';
  if (jaBloqueado) {
    confirmMsg = `Deseja DESBLOQUEAR o Stage ${displayStage}?\n\nO stage voltará ao fluxo normal de conferência e ficará liberado.`;
  } else {
    confirmMsg = `Deseja BLOQUEAR o Stage ${displayStage}?\n\nO stage ficará marcado em VERMELHO e nenhuma bipagem/conferência será permitida nele até ser desbloqueado.`;
  }

  const confirmou = window.confirm(confirmMsg);
  if (!confirmou) return;

  const novoEstado = !jaBloqueado;
  window.setStageBlocked(rawStage, novoEstado);
  if (normStage !== rawStage) {
    window.setStageBlocked(normStage, novoEstado);
  }

  if (novoEstado) {
    if (typeof sound !== 'undefined' && sound.playWarning) sound.playWarning();
    if (typeof showToast === 'function') showToast(`🔒 <b>Stage ${displayStage} BLOQUEADO</b> (marcado em vermelho).`);
  } else {
    if (typeof sound !== 'undefined' && sound.playSuccess) sound.playSuccess();
    if (typeof showToast === 'function') showToast(`🔓 <b>Stage ${displayStage} DESBLOQUEADO</b> com sucesso.`);
  }

  // Notifica via WebSocket/MQTT broadcast para outros terminais em tempo real
  if (window.DHL_SYNC && typeof window.DHL_SYNC.broadcastMessage === 'function') {
    try {
      window.DHL_SYNC.broadcastMessage('STAGE_BLOCK_TOGGLE', {
        stage: normStage,
        rawStage: rawStage,
        blocked: novoEstado,
        operador: (activeConference && activeConference.operador) || 'Operador DHL',
        timestamp: new Date().toISOString()
      });
    } catch(err) {}
  }

  // Atualiza renderização de todas as telas instantaneamente
  if (typeof renderDashboard === 'function') {
    renderDashboard();
  }
  if (window.StageMap && typeof window.StageMap.refresh === 'function') {
    window.StageMap.refresh(true);
  }
  if (typeof renderStageSlotsGrid === 'function') {
    renderStageSlotsGrid();
  }
};

function savePartialConferenceSession() {
  if (!activeConference.embarqueId) return;
  try {
    const partials = JSON.parse(localStorage.getItem(STORAGE_PARTIAL_CONFERENCES_KEY) || '{}');
    partials[activeConference.embarqueId] = {
      embarqueId: activeConference.embarqueId,
      stage: activeEmbarque ? formatStages(activeEmbarque.stages) : '',
      currentPhysicalStage: activeConference.currentPhysicalStage,
      operador: activeConference.operador,
      iniciadoEm: activeConference.iniciadoEm,
      conferidos: Array.from(activeConference.conferidos.entries()),
      stageSlots: activeConference.stageSlots || {},
      slots: activeConference.slots,
      activeSlot: activeConference.activeSlot,
      lastComparison: activeConference.lastComparison,
      capacity: activeConference.capacity,
      direction: activeConference.direction,
      lastUpdated: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_PARTIAL_CONFERENCES_KEY, JSON.stringify(partials));
  } catch(e){}
}

function getPartialConferenceSession(embId) {
  try {
    const partials = JSON.parse(localStorage.getItem(STORAGE_PARTIAL_CONFERENCES_KEY) || '{}');
    return partials[embId] || null;
  } catch(e){
    return null;
  }
}

// Modo de empilhamento: '1x' (padrão 1 por vaga), '2x' (duplado: chão + superior), '3x' (fracionado: até 3 por vaga)
window.modoEmpilhamento = localStorage.getItem('dhl_modo_empilhamento_v1') || '1x';

window.toggleModoEmpilhamento = function() {
  if (window.modoEmpilhamento === '1x') {
    window.modoEmpilhamento = '2x';
  } else if (window.modoEmpilhamento === '2x') {
    window.modoEmpilhamento = '3x';
  } else {
    window.modoEmpilhamento = '1x';
  }
  try {
    localStorage.setItem('dhl_modo_empilhamento_v1', window.modoEmpilhamento);
  } catch(e) {}
  updateModoEmpilhamentoUI();
  activeConference.activeSlot = calculateNextTargetSlot();
  if (typeof renderStageSlotsGrid === 'function') renderStageSlotsGrid();
  
  const desc = window.modoEmpilhamento === '2x' 
    ? '🥞 Carga Duplada (2 paletes por vaga)' 
    : (window.modoEmpilhamento === '3x' ? '📦 Carga Fracionada (até 3 paletes por vaga)' : 'Carga Padrão (1 palete por vaga)');
  showToast(`Modo alterado para: <b>${desc}</b>`);
};

function updateModoEmpilhamentoUI() {
  const btn = document.getElementById('btnModoEmpilhamento');
  if (!btn) return;
  if (window.modoEmpilhamento === '2x') {
    btn.innerHTML = '🥞 Carga: Duplada (2x)';
    btn.style.background = '#F3E8FF';
    btn.style.borderColor = '#9333EA';
    btn.style.color = '#7E22CE';
  } else if (window.modoEmpilhamento === '3x') {
    btn.innerHTML = '📦 Carga: Fracionada (3x)';
    btn.style.background = '#FFEDD5';
    btn.style.borderColor = '#EA580C';
    btn.style.color = '#C2410C';
  } else {
    btn.innerHTML = '🥞 Carga: Padrão (1x)';
    btn.style.background = '#EEF2FF';
    btn.style.borderColor = '#6366F1';
    btn.style.color = '#4338CA';
  }
}

function calculateNextTargetSlot(stageCode) {
  const rawStg = stageCode || (activeConference && activeConference.currentPhysicalStage) || (activeEmbarque ? formatStages(activeEmbarque.stages) : '');
  const stg = normalizeStageName(rawStg) || rawStg;
  const cap = (activeConference && activeConference.capacity) || 10;
  const blocked = getStageBlockedSlots(stg);
  const slots = (activeConference && activeConference.stageSlots && (activeConference.stageSlots[stg] || activeConference.stageSlots[rawStg])) || (activeConference && activeConference.slots) || {};
  const currentSlot = (activeConference && activeConference.activeSlot) || 1;
  const maxPerSlot = (window.modoEmpilhamento === '3x') ? 3 : (window.modoEmpilhamento === '2x' ? 2 : 1);

  // Se a vaga atual ainda tem espaço para o próximo nível no modo duplado ou fracionado:
  const curSlotData = slots[currentSlot];
  const curSlotCount = curSlotData ? ((curSlotData.paletes && curSlotData.paletes.length) || (curSlotData.palete ? 1 : 0)) : 0;
  if (curSlotCount > 0 && curSlotCount < maxPerSlot && !blocked.includes(currentSlot)) {
    // Mantém na mesma vaga para receber o próximo nível (Nível 2 ou Nível 3)!
    return currentSlot;
  }

  function slotHasSpace(s) {
    if (blocked.includes(s)) return false;
    const sd = slots[s];
    if (!sd) return true;
    if (sd.status === 'divergent') return false;
    const count = (sd.paletes && sd.paletes.length) || (sd.palete ? 1 : 0);
    return count < maxPerSlot;
  }

  if (activeConference && activeConference.direction === 'desc') {
    // Sentido 10 -> 1
    for (let s = cap; s >= 1; s--) {
      if (slotHasSpace(s)) return s;
    }
  } else {
    // Sentido 1 -> 10
    for (let s = 1; s <= cap; s++) {
      if (slotHasSpace(s)) return s;
    }
  }
  return 1;
}

window.switchPhysicalStage = function(stageCode, force = false) {
  const norm = normalizeStageName(stageCode);
  if (!norm) return false;

  // VERIFICAÇÃO DE BLOQUEIO OPERACIONAL MANUAL
  if (!force && window.isStageBlocked(norm)) {
    sound.playError('Stage bloqueado');
    triggerCardFlash('pulse-err');
    showFeedback('err', `🛑 <b>STAGE BLOQUEADO:</b> O Stage <b>${norm}</b> está BLOQUEADO pela operação!<br>Clique na nomenclatura do stage no mapa para desbloquear.`);
    return false;
  }

  // VERIFICAÇÃO DE INVASÃO: NÃO PODE COBRIR OUTRO EMBARQUE
  if (!force && activeEmbarque) {
    const occupant = getStageOccupant(norm, activeEmbarque.embarque);
    if (occupant) {
      sound.playError('Stage ocupado por outro embarque');
      triggerCardFlash('pulse-err');
      showFeedback('err', `✖ <b>BLOQUEIO DE INVASÃO:</b> O Stage <b>${norm}</b> pertence ao <b>Embarque ${occupant.embarque}</b>!<br>NÃO É PERMITIDO COBRIR OUTRO EMBARQUE. Utilize uma doca/stage LIVRE.`);
      return false;
    }
  }

  activeConference.currentPhysicalStage = norm;
  if (!activeConference.stageSlots) activeConference.stageSlots = {};
  if (!activeConference.stageSlots[norm]) activeConference.stageSlots[norm] = {};
  activeConference.slots = activeConference.stageSlots[norm];
  activeConference.activeSlot = calculateNextTargetSlot(norm);

  // Adiciona à lista de stages do embarque caso ainda não esteja lá (ramificação oficial)
  if (activeEmbarque && activeEmbarque.stages) {
    const hasStage = activeEmbarque.stages.some(s => normalizeStageName(s) === norm);
    if (!hasStage) {
      activeEmbarque.stages.push(norm);
    }
  }

  sound.playSuccess(`Stage ${norm}`);
  showToast(`Stage físico ativado: <b>${norm}</b>`);
  renderStageSlotsGrid();
  updateUI();
  savePartialConferenceSession();
  if (window.DHL_SYNC && typeof window.DHL_SYNC.notifyStageSwitch === 'function') {
    window.DHL_SYNC.notifyStageSwitch(norm, activeConference?.activeSlot || 1);
  }
  focusScanner();
  return true;
};

function renderStageSlotsGrid() {
  const container = document.getElementById('stageSlotsGrid');
  if (!container || !activeEmbarque) return;

  const currentStg = activeConference.currentPhysicalStage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'STAGE';
  const cap = activeConference.capacity || 10;
  const blocked = getStageBlockedSlots(currentStg);
  const slots = (activeConference.stageSlots && activeConference.stageSlots[currentStg]) || activeConference.slots || {};
  const target = activeConference.activeSlot || 1;

  document.querySelectorAll('.btn-cap-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cap, 10) === cap);
  });

  const btnDir = document.getElementById('btnInverterSentido');
  if (btnDir) {
    btnDir.textContent = activeConference.direction === 'desc' ? 'Sentido: 10 a 1' : 'Sentido: 1 a 10';
  }

  const SLOT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const posTargetLetter = SLOT_LETTERS[target - 1] || target;

  const sub = document.getElementById('txtStageSlotsSubtitle');
  if (sub) {
    const locTarget = formatStageSlotDisplay(currentStg, target);
    sub.innerHTML = `Stage Físico Atual: <b>${currentStg}</b> • Vagas <b>${formatStageSlotDisplay(currentStg, 1)}</b> a <b>${formatStageSlotDisplay(currentStg, cap)}</b> • Próxima Vaga: <span style="color:#00A0E9; font-weight:800;">${locTarget}</span>`;
  }

  // Contagem de paletes esperados para este stage
  let expectedInCurrent = 0;
  if (activeEmbarque.paletes && activeEmbarque.paletes.length > 0) {
    expectedInCurrent = activeEmbarque.paletes.filter(p => normalizeStageName(p.stage) === currentStg).length;
    if (expectedInCurrent === 0) expectedInCurrent = Math.min(cap, activeEmbarque.paletes.length);
  } else {
    expectedInCurrent = cap;
  }

  // Render multi-stage selector bar if shipment spans multiple stages or has configured stages
  const stagesSelector = document.getElementById('shipmentStagesSelector');
  if (stagesSelector) {
    let stgList = [];
    if (activeEmbarque.stages && activeEmbarque.stages.length > 0) {
      stgList = [...activeEmbarque.stages];
    } else {
      stgList = [currentStg];
    }
    // Also include any other stage present in paletes
    (activeEmbarque.paletes || []).forEach(p => {
      const s = normalizeStageName(p.stage);
      if (s && !stgList.some(ex => normalizeStageName(ex) === s)) {
        stgList.push(s);
      }
    });

    // Counts per stage
    const totalPerStage = {};
    (activeEmbarque.paletes || []).forEach(p => {
      const s = normalizeStageName(p.stage || 'STAGE');
      totalPerStage[s] = (totalPerStage[s] || 0) + 1;
    });

    let barHtml = `<span class="stages-bar-label">Docas / Stages do Embarque (${stgList.length}):</span>`;
    stgList.forEach(stg => {
      const norm = normalizeStageName(stg);
      const isCurrent = (norm === currentStg);
      const totalInStage = totalPerStage[norm] || 0;

      let scannedInStage = 0;
      if (activeConference.stageSlots && activeConference.stageSlots[norm]) {
        scannedInStage = Object.values(activeConference.stageSlots[norm]).filter(s => s && s.status === 'done').length;
      }

      const isFull = (scannedInStage >= cap);
      const isOverflow = (scannedInStage > cap);
      const occupant = getStageOccupant(norm, activeEmbarque.embarque);

      let statusBadge = '';
      if (occupant) {
        statusBadge = `<span class="stage-pill-badge" style="background:#DC2626; color:#fff;">⚠️ OCUPADO POR ${occupant.embarque}</span>`;
      } else if (isOverflow) {
        statusBadge = `<span class="stage-pill-badge" style="background:#DC2626; color:#fff;">⚠️ ESTOURO (${scannedInStage}/${cap})</span>`;
      } else if (isFull) {
        statusBadge = `<span class="stage-pill-badge" style="background:#00A650; color:#fff;">LOTADO (${cap}/${cap})</span>`;
      } else if (isCurrent) {
        statusBadge = `<span class="stage-pill-badge">FÍSICO ATUAL</span>`;
      }

      barHtml += `
        <button type="button" class="btn-stage-pill ${isCurrent ? 'active' : ''}" onclick="switchPhysicalStage('${norm}')" title="Clique ou bipe ${norm} com o leitor">
          <span class="stage-pill-name">📍 ${norm} (${formatStageSlotDisplay(norm, 1)} a ${formatStageSlotDisplay(norm, cap)})</span>
          <span class="stage-pill-count">${scannedInStage}/${totalInStage || cap} LPN</span>
          ${statusBadge}
        </button>
      `;
    });
    stagesSelector.innerHTML = barHtml;
    stagesSelector.style.display = (stgList.length > 1) ? 'flex' : 'none';
  }

  let html = '';
  for (let s = 1; s <= cap; s++) {
    const isBlocked = blocked.includes(s);
    const slotData = slots[s];
    const isTarget = (s === target && !isBlocked);
    const posLetter = SLOT_LETTERS[s - 1] || s;
    const locCode = formatStageSlotDisplay(currentStg, s);

    const paletesNaVaga = (slotData && slotData.paletes && Array.isArray(slotData.paletes)) ? slotData.paletes : (slotData && slotData.palete ? [{ palete: slotData.palete, lpn: slotData.lpn, nivel: 1 }] : []);
    const qtdPlts = paletesNaVaga.length;

    let cellClass = 'slot-cell';
    let statusText = 'LIVRE';
    let lpnText = '';

    if (isBlocked) {
      cellClass += ' slot-blocked';
      statusText = 'BLOQUEADO ✖';
    } else if (slotData && (slotData.status === 'done' || qtdPlts > 0) && slotData.status !== 'divergent') {
      if (qtdPlts >= 3) {
        cellClass += ' slot-fracionado';
        statusText = '3x FRACIONADO 📦';
        lpnText = paletesNaVaga.map(p => `N${p.nivel || 1}: ...` + String(p.lpn || p.palete).slice(-4)).join('<br>');
      } else if (qtdPlts === 2) {
        cellClass += ' slot-duplado';
        statusText = '2x DUPLADO 🥞';
        const pSuperior = paletesNaVaga[1] || {};
        const pChao = paletesNaVaga[0] || {};
        lpnText = `N2: ...${String(pSuperior.lpn || pSuperior.palete).slice(-4)}<br>N1: ...${String(pChao.lpn || pChao.palete).slice(-4)}`;
      } else {
        cellClass += ' slot-done';
        statusText = 'CONFERIDO ✔';
        lpnText = slotData.lpn ? '...' + String(slotData.lpn).slice(-4) : '';
      }
    } else if (slotData && slotData.status === 'divergent') {
      cellClass += ' slot-divergent';
      statusText = 'DIVERGÊNCIA ✖';
      lpnText = slotData.lpn ? '...' + String(slotData.lpn).slice(-4) : '';
    } else if (isTarget) {
      cellClass += ' slot-target';
      statusText = 'BIPANDO AGORA';
    } else if (s <= expectedInCurrent) {
      cellClass += ' slot-waiting';
      statusText = 'NA FILA';
    } else {
      cellClass += ' slot-free';
      statusText = 'LIVRE';
    }

    html += `
      <div class="${cellClass}" onclick="handleSlotClick(${s})" title="Clique para direcionar para ${locCode}. Duplo clique para Bloquear/Liberar.">
        <span class="slot-num">${locCode}</span>
        <span class="slot-pos-sub">Vaga ${s} (${posLetter})</span>
        <span class="slot-status-text">${statusText}</span>
        ${lpnText ? `<span class="slot-lpn" style="line-height:1.2;">${lpnText}</span>` : ''}
      </div>
    `;
  }
  container.innerHTML = html;
}

window.setStageCapacity = function(cap) {
  if (!activeEmbarque) return;
  const stage = formatStages(activeEmbarque.stages);
  activeConference.capacity = cap;
  saveStageCapacity(stage, cap);
  activeConference.activeSlot = calculateNextTargetSlot();
  renderStageSlotsGrid();
  savePartialConferenceSession();
  showToast(`Capacidade do Stage ${stage} definida para ${cap} vagas.`);
};

window.toggleSlotDirection = function() {
  activeConference.direction = activeConference.direction === 'desc' ? 'asc' : 'desc';
  activeConference.activeSlot = calculateNextTargetSlot();
  renderStageSlotsGrid();
  savePartialConferenceSession();
  showToast(`Sentido de fluxo alterado para ${activeConference.direction === 'desc' ? '10 a 1' : '1 a 10'}.`);
};

window.skipCurrentSlot = function() {
  const cap = activeConference.capacity || 10;
  const stage = activeEmbarque ? formatStages(activeEmbarque.stages) : '';
  const blocked = getStageBlockedSlots(stage);
  const slots = activeConference.slots || {};

  let next = activeConference.activeSlot;
  for (let i = 0; i < cap; i++) {
    if (activeConference.direction === 'desc') {
      next = next <= 1 ? cap : next - 1;
    } else {
      next = next >= cap ? 1 : next + 1;
    }
    if (!blocked.includes(next) && (!slots[next] || slots[next].status !== 'done')) {
      activeConference.activeSlot = next;
      break;
    }
  }
  renderStageSlotsGrid();
  focusScanner();
  showToast(`Avançado para a Vaga ${activeConference.activeSlot}`);
};

let lastSlotClickTime = 0;
let lastSlotClickId = null;

window.handleSlotClick = function(slotNum) {
  const now = Date.now();
  const stage = activeEmbarque ? formatStages(activeEmbarque.stages) : '';

  if (lastSlotClickId === slotNum && (now - lastSlotClickTime) < 350) {
    const list = toggleStageBlockedSlot(stage, slotNum);
    const isNowBlocked = list.includes(slotNum);
    showToast(isNowBlocked ? `Vaga ${slotNum} marcada como BLOQUEADA.` : `Vaga ${slotNum} LIBERADA.`);
    activeConference.activeSlot = calculateNextTargetSlot();
    renderStageSlotsGrid();
    savePartialConferenceSession();
    return;
  }

  lastSlotClickTime = now;
  lastSlotClickId = slotNum;

  const blocked = getStageBlockedSlots(stage);
  if (blocked.includes(slotNum)) {
    if (confirm(`A Vaga ${slotNum} está marcada como BLOQUEADA. Deseja liberar?`)) {
      toggleStageBlockedSlot(stage, slotNum);
      activeConference.activeSlot = slotNum;
      renderStageSlotsGrid();
      savePartialConferenceSession();
    }
    return;
  }

  // Se a vaga já tem palete conferido, sugere a opção de re-bipar / corrigir LPN!
  const curStg = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque && activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const slotData = (activeConference.stageSlots && activeConference.stageSlots[curStg]) ? activeConference.stageSlots[curStg][slotNum] : null;
  const temPalete = slotData && (slotData.status === 'done' || (slotData.paletes && slotData.paletes.length > 0) || slotData.palete);

  if (temPalete) {
    abrirModalCorrecaoLpn(slotNum);
    return;
  }

  activeConference.activeSlot = slotNum;
  renderStageSlotsGrid();
  focusScanner();
  showToast(`Próxima alocação direcionada para a Vaga ${slotNum}`);
};

/* =========================================================
   CONCLUIR STAGE ATUAL & ATRELAR PRÓXIMO STAGE
   ========================================================= */
window.abrirModalProximoStage = function() {
  if (!activeEmbarque) {
    showToast('⚠️ Nenhum embarque em conferência ativa.');
    return;
  }
  const curStg = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const nomeEl = document.getElementById('proxStageAtualNome');
  if (nomeEl) nomeEl.textContent = curStg;

  const inp = document.getElementById('inputProximoStageCode');
  if (inp) inp.value = '';

  const modal = document.getElementById('modalProximoStage');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => { if (inp) inp.focus(); }, 120);
  }
};

window.fecharModalProximoStage = function() {
  const modal = document.getElementById('modalProximoStage');
  if (modal) modal.style.display = 'none';
  focusScanner();
};

window.confirmarProximoStage = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const inp = document.getElementById('inputProximoStageCode');
  const rawCode = (inp ? inp.value : '').trim();
  if (!rawCode) {
    alert('Por favor, bipe ou digite o código do próximo Stage.');
    if (inp) inp.focus();
    return;
  }

  const nextStageNorm = normalizeStageName(rawCode);
  if (!nextStageNorm) {
    alert('Código de Stage inválido. Exemplo: SO012, SO013, ST040.');
    if (inp) inp.focus();
    return;
  }

  // Atrela o novo stage ao embarque ativo
  if (!Array.isArray(activeEmbarque.stages)) {
    activeEmbarque.stages = activeEmbarque.stages ? [activeEmbarque.stages] : [];
  }
  if (!activeEmbarque.stages.some(s => normalizeStageName(s) === nextStageNorm)) {
    activeEmbarque.stages.push(nextStageNorm);
  }

  // Atualiza também na base global de dados
  if (database && database.embarques && database.embarques[activeEmbarque.embarque]) {
    database.embarques[activeEmbarque.embarque].stages = activeEmbarque.stages;
  }

  // Comuta para o novo stage físico e reseta vaga alvo para a Vaga 1 (A)
  switchPhysicalStage(nextStageNorm);
  activeConference.activeSlot = 1;

  fecharModalProximoStage();

  sound.playSuccess(`Stage ${nextStageNorm} atrelado`);
  showToast(`⏭️ Stage <b>${nextStageNorm}</b> atrelado com sucesso ao Embarque ${activeEmbarque.embarque}!`);
  showFeedback('ok', `✔ <b>Stage ${nextStageNorm} atrelado!</b> Prossiga bipando as LPNs na Vaga A.`);

  // Sincroniza via On-Time em tempo real
  if (window.DHL_SYNC && typeof window.DHL_SYNC.broadcast === 'function') {
    window.DHL_SYNC.broadcast('STAGE_ATRELADO', {
      embarque: activeEmbarque.embarque,
      novoStage: nextStageNorm,
      stages: activeEmbarque.stages
    });
  }

  savePartialConferenceSession();
  renderStageSlotsGrid();
  updateUI();
  focusScanner();
};

/* =========================================================
   CORREÇÃO & RE-BIPAGEM DE LPN COM MOTIVO (SELECT POINT / CHECKBOX)
   ========================================================= */
let slotCorrecaoAtivo = null;

window.abrirModalCorrecaoLpn = function(slotPreSel = null) {
  if (!activeEmbarque) {
    showToast('⚠️ Nenhum embarque ativo.');
    return;
  }
  const curStg = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const stgSlots = (activeConference.stageSlots && activeConference.stageSlots[curStg]) ? activeConference.stageSlots[curStg] : {};

  const select = document.getElementById('selectVagaCorrecao');
  if (!select) return;
  select.innerHTML = '';

  const cap = activeConference.capacity || 10;
  const vagasConferidas = [];

  for (let s = 1; s <= cap; s++) {
    const sl = stgSlots[s];
    const temPalete = sl && (sl.status === 'done' || (sl.paletes && sl.paletes.length > 0) || sl.palete);
    if (temPalete) {
      vagasConferidas.push(s);
      const opt = document.createElement('option');
      opt.value = s;
      const posLetter = ['A','B','C','D','E','F','G','H','I','J'][s - 1] || s;
      const loc = formatStageSlotDisplay(curStg, s);
      const lpnStr = sl.lpn || (sl.paletes && sl.paletes[0] ? (sl.paletes[0].lpn || sl.paletes[0].palete) : sl.palete) || '';
      opt.textContent = `${loc} (Vaga ${posLetter}) • LPN ...${String(lpnStr).slice(-6)}`;
      select.appendChild(opt);
    }
  }

  if (vagasConferidas.length === 0) {
    showToast('⚠️ Nenhuma vaga possui paletes conferidos para re-bipar neste stage.');
    return;
  }

  const alvo = (slotPreSel && vagasConferidas.includes(slotPreSel)) ? slotPreSel : vagasConferidas[0];
  select.value = alvo;
  aoMudarVagaCorrecao(alvo);

  const modal = document.getElementById('modalCorrecaoLpn');
  if (modal) modal.style.display = 'flex';
};

window.fecharModalCorrecaoLpn = function() {
  const modal = document.getElementById('modalCorrecaoLpn');
  if (modal) modal.style.display = 'none';
  slotCorrecaoAtivo = null;
  focusScanner();
};

window.aoMudarVagaCorrecao = function(slotNum) {
  slotNum = parseInt(slotNum, 10);
  slotCorrecaoAtivo = slotNum;

  const curStg = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque && activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const sl = (activeConference.stageSlots && activeConference.stageSlots[curStg]) ? activeConference.stageSlots[curStg][slotNum] : null;

  const container = document.getElementById('listaLpnsVagaRadio');
  if (!container) return;

  const paletes = (sl && sl.paletes && Array.isArray(sl.paletes) && sl.paletes.length > 0) 
    ? sl.paletes 
    : (sl && sl.palete ? [{ palete: sl.palete, lpn: sl.lpn || sl.palete, nivel: 1, sku: sl.sku, qtd: sl.qtd }] : []);

  if (paletes.length === 0) {
    container.innerHTML = '<span style="color:#64748B;">Nenhum palete registrado nesta vaga.</span>';
    return;
  }

  container.innerHTML = paletes.map((p, idx) => {
    const lpn = p.lpn || p.palete;
    const isChecked = idx === 0 ? 'checked' : '';
    const nivelStr = paletes.length > 1 ? `[Nível ${p.nivel || (idx + 1)}] ` : '';
    return `
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; background:#fff; padding:6px 10px; border-radius:6px; border:1px solid #E2E8F0;">
        <input type="radio" name="radioPaleteCorrecaoLpn" value="${lpn}" ${isChecked}>
        <span><b>${nivelStr}LPN:</b> <code style="font-weight:800; color:#0F172A;">${lpn}</code> ${p.sku ? '• SKU ' + p.sku : ''} ${p.qtd ? '• ' + p.qtd + ' cx' : ''}</span>
      </label>
    `;
  }).join('');
};

window.confirmarRebipagemLpn = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!slotCorrecaoAtivo) {
    slotCorrecaoAtivo = parseInt(document.getElementById('selectVagaCorrecao')?.value, 10);
  }
  if (!slotCorrecaoAtivo) {
    alert('Selecione uma vaga para corrigir.');
    return;
  }

  const radioLpn = document.querySelector('input[name="radioPaleteCorrecaoLpn"]:checked');
  const lpnParaRemover = radioLpn ? radioLpn.value : null;

  const radioMotivo = document.querySelector('input[name="motivoRebipagem"]:checked');
  const motivoCodigo = radioMotivo ? radioMotivo.value : 'LPN_INCORRETA';
  const obsTexto = (document.getElementById('inputObsCorrecao')?.value || '').trim();

  const motivosMap = {
    'LPN_INCORRETA': 'Bipagem de LPN incorreta / trocada',
    'PALETE_DIVERGENTE': 'Palete físico divergente no stage',
    'TROCA_POSICAO': 'Inversão / Troca de vaga física',
    'AJUSTE_DUPLADO_FRACIONADO': 'Ajuste de Duplado/Fracionado',
    'RECONTAGEM_QUALIDADE': 'Recontagem / Auditoria'
  };
  const motivoLegivel = motivosMap[motivoCodigo] || motivoCodigo;
  const motivoCompleto = obsTexto ? `${motivoLegivel} (${obsTexto})` : motivoLegivel;

  const curStg = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque && activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const sl = (activeConference.stageSlots && activeConference.stageSlots[curStg]) ? activeConference.stageSlots[curStg][slotCorrecaoAtivo] : null;

  if (sl) {
    // 1. Remove a LPN de activeConference.conferidos
    if (lpnParaRemover && activeConference.conferidos) {
      activeConference.conferidos.delete(lpnParaRemover);
      const cleanKey = lpnParaRemover.replace(/^0+/, '');
      activeConference.conferidos.delete(cleanKey);
    }

    // 2. Se for vaga com múltiplos paletes (duplado/fracionado), remove apenas o palete selecionado
    if (sl.paletes && sl.paletes.length > 1 && lpnParaRemover) {
      sl.paletes = sl.paletes.filter(p => (p.lpn || p.palete) !== lpnParaRemover);
      sl.paletes.forEach((p, idx) => p.nivel = idx + 1);
      const topP = sl.paletes[sl.paletes.length - 1];
      sl.palete = topP.palete;
      sl.lpn = topP.lpn || topP.palete;
      sl.sku = topP.sku;
      sl.qtd = topP.qtd;
      sl.isDuplado = (sl.paletes.length === 2);
      sl.isFracionado = (sl.paletes.length >= 3);
    } else {
      // Vaga fica livre para receber a re-bipagem
      delete activeConference.stageSlots[curStg][slotCorrecaoAtivo];
      if (activeConference.slots && activeConference.slots[slotCorrecaoAtivo]) {
        delete activeConference.slots[slotCorrecaoAtivo];
      }
    }
  }

  // Direciona a vaga alvo imediatamente para a vaga que foi limpa
  activeConference.activeSlot = slotCorrecaoAtivo;

  // Registra no histórico da conferência
  if (!activeConference.historico) activeConference.historico = [];
  activeConference.historico.unshift({
    timestamp: new Date().toLocaleTimeString('pt-BR'),
    tipo: 'CORRECAO_LPN',
    stage: curStg,
    vaga: slotCorrecaoAtivo,
    lpnRemovida: lpnParaRemover,
    motivo: motivoCompleto
  });

  savePartialConferenceSession();
  fecharModalCorrecaoLpn();

  sound.playWarning('Vaga liberada para re-bipar');
  showToast(`🔄 Vaga ${formatStageSlotDisplay(curStg, slotCorrecaoAtivo)} liberada para Re-bipagem! Motivo: ${motivoLegivel}`);
  showFeedback('warn', `🔄 <b>Vaga liberada para nova LPN!</b> Bipe agora o palete correto para a Vaga ${formatStageSlotDisplay(curStg, slotCorrecaoAtivo)}.`);

  // Sincroniza via On-Time
  if (window.DHL_SYNC && typeof window.DHL_SYNC.broadcast === 'function') {
    window.DHL_SYNC.broadcast('REBIPAGEM_LPN', {
      embarque: activeEmbarque.embarque,
      stage: curStg,
      vaga: slotCorrecaoAtivo,
      lpnRemovida: lpnParaRemover,
      motivo: motivoCompleto
    });
  }

  renderStageSlotsGrid();
  updateUI();
  focusScanner();
};

/* =========================================================
   DASHBOARD VISUAL DE STAGES (MAPA DO PÁTIO)
   ========================================================= */
window.toggleDashboard = function() {
  const isDash = document.getElementById('viewDashboard')?.style.display === 'block';
  if (isDash) {
    closeDashboard();
  } else {
    showScreen('viewDashboard');
  }
};

window.closeDashboard = function() {
  if (activeEmbarque) {
    showScreen('viewScanner');
  } else {
    showScreen('viewLogin');
  }
};

window.filterDashboard = function(filter) {
  currentDashFilter = filter;
  document.querySelectorAll('.dash-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderDashboard();
};

window.handleDashSearch = function(val) {
  currentDashSearch = (val || '').trim().toLowerCase();
  renderDashboard();
};

function getDashboardStageInfo(stageCode) {
  const normStage = normalizeStageName(stageCode);
  const stageNum = parseInt(stageCode.replace(/\D/g, ''), 10) || 0;

  let matchedEmbs = [];
  if (database && database.embarques) {
    Object.values(database.embarques).forEach(e => {
      if (!e || !e.embarque) return;
      const sList = Array.isArray(e.stages) ? e.stages : (e.stages ? String(e.stages).split(/[\s,]+/) : []);
      
      // 1. Verificação direta de stage no embarque ou nos paletes
      let directMatch = sList.some(s => normalizeStageName(s) === normStage);
      if (!directMatch && e.paletes && Array.isArray(e.paletes)) {
        directMatch = e.paletes.some(p => p && normalizeStageName(p.stage) === normStage);
      }

      const totalPal = e.total_paletes || 0;
      const firstStg = sList[0] || (e.paletes && e.paletes[0] && e.paletes[0].stage) || '';
      const firstNum = parseInt(String(firstStg).replace(/\D/g, ''), 10) || 0;

      if (directMatch) {
        if (!matchedEmbs.some(m => m.embarque.embarque === e.embarque)) {
          matchedEmbs.push({ embarque: e, isRamified: false, offset: 0 });
        }
      } else if (firstNum > 0 && totalPal > 10) {
        // Acobertamento de stages contíguos de acordo com o volume do embarque
        const stagesNeeded = Math.ceil(totalPal / 10);
        if (stageNum >= firstNum && stageNum < firstNum + stagesNeeded) {
          if (!matchedEmbs.some(m => m.embarque.embarque === e.embarque)) {
            matchedEmbs.push({ embarque: e, isRamified: true, offset: stageNum - firstNum });
          }
        }
      }
    });
  }

  const stageCap = getStageCapacity(stageCode);
  const blockedSlots = getStageBlockedSlots(stageCode);
  const isManuallyBlocked = window.isStageBlocked(stageCode) || window.isStageBlocked(normStage);

  if (isManuallyBlocked) {
    return {
      stage: stageCode,
      status: 'divergencia',
      statusText: 'BLOQUEADO',
      badgeClass: 'badge-divergent badge-stage-blocked',
      cardClass: 'card-divergent card-stage-blocked',
      embarque: matchedEmbs.length > 0 ? matchedEmbs[0].embarque : null,
      totalPaletes: matchedEmbs.length > 0 ? (matchedEmbs[0].embarque.total_paletes || 0) : 0,
      palletsInThisStage: 0,
      conferidosCount: 0,
      capacity: stageCap,
      blockedSlots: Array.from({length: stageCap}, (_, i) => i + 1),
      slots: {},
      hasDivergence: true,
      isManualBlocked: true,
      alertsCount: 1
    };
  }

  if (matchedEmbs.length === 0) {
    return {
      stage: stageCode,
      status: 'livre',
      statusText: 'LIVRE',
      badgeClass: 'badge-free',
      cardClass: 'card-free',
      embarque: null,
      totalPaletes: 0,
      conferidosCount: 0,
      capacity: stageCap,
      blockedSlots: blockedSlots,
      slots: {}
    };
  }

  const mainMatch = matchedEmbs[0];
  const mainEmb = mainMatch.embarque;
  const partialSession = getPartialConferenceSession(mainEmb.embarque);
  const totalPal = mainEmb.total_paletes || 0;

  // Paletes esperados especificamente para este stage (se desmembrado ou acobertado)
  let palletsInThisStage = 0;
  if (mainEmb && mainEmb.paletes && Array.isArray(mainEmb.paletes)) {
    palletsInThisStage = mainEmb.paletes.filter(p => p && normalizeStageName(p.stage) === normStage).length;
  }
  if (palletsInThisStage === 0) {
    if (mainMatch.isRamified) {
      const remaining = totalPal - (mainMatch.offset * 10);
      palletsInThisStage = Math.max(0, Math.min(stageCap, remaining));
    } else {
      palletsInThisStage = Math.min(stageCap, totalPal);
    }
  }

  const historyList = getStoredHistory();
  const completedAudit = historyList.find(h => (h.embarqueId === mainEmb.embarque || h.embarqueId === mainEmb.embarque.replace(/^0+/, '')) && h.status === 'Concluído');

  let conferidosCount = 0;
  let hasDivergence = false;
  let slots = {};

  if (activeConference && activeConference.embarqueId === mainEmb.embarque) {
    // 1. Conferência atualmente aberta em tela no scanner
    if (activeConference.stageSlots && activeConference.stageSlots[normStage]) {
      slots = activeConference.stageSlots[normStage];
    } else if (normStage === normalizeStageName(activeConference.currentPhysicalStage)) {
      slots = activeConference.slots || {};
    }
    conferidosCount = Object.values(slots).filter(s => s && s.status === 'done').length;
    hasDivergence = activeConference.divergencias.some(d => 
      normalizeStageName(d.stageFisico) === normStage || normalizeStageName(d.stageSistemico) === normStage
    ) || Object.values(slots).some(s => s && s.status === 'divergent');
  } else if (partialSession) {
    // 2. Conferência parcial salva deste embarque
    if (partialSession.stageSlots && partialSession.stageSlots[normStage]) {
      slots = partialSession.stageSlots[normStage];
    } else if (partialSession.currentPhysicalStage && normalizeStageName(partialSession.currentPhysicalStage) === normStage) {
      slots = partialSession.slots || {};
    }
    conferidosCount = Object.values(slots).filter(s => s && s.status === 'done').length;
    if (partialSession.divergencias && partialSession.divergencias.length > 0) hasDivergence = true;
    if (Object.values(slots).some(s => s && s.status === 'divergent')) hasDivergence = true;
  } else if (completedAudit) {
    // 3. Auditoria concluída no histórico
    if (completedAudit.stageSlots && completedAudit.stageSlots[normStage]) {
      slots = completedAudit.stageSlots[normStage];
    } else if (completedAudit.currentPhysicalStage && normalizeStageName(completedAudit.currentPhysicalStage) === normStage) {
      slots = completedAudit.slots || {};
    }
    conferidosCount = Object.values(slots).filter(s => s && s.status === 'done').length;
    if (conferidosCount === 0 && completedAudit.status === 'Concluído') {
      conferidosCount = palletsInThisStage;
    }
    if (completedAudit.divergenciasCount > 0) hasDivergence = true;
    if (Object.values(slots).some(s => s && s.status === 'divergent')) hasDivergence = true;
  }

  if (blockedSlots.length > 0) {
    hasDivergence = true;
  }

  // Determinação de Status do Ciclo de Vida: Cabeça -> Meio -> Fim
  let status = 'aguardando';
  let statusText = 'AGUARDANDO';
  let badgeClass = 'badge-waiting';
  let cardClass = 'card-waiting';

  if (conferidosCount >= palletsInThisStage && palletsInThisStage > 0 && !hasDivergence) {
    // FIM: 100% CONCLUÍDO / CONFERIDO (Sem qualquer divergência)
    status = 'conferido';
    statusText = 'CONFERIDO';
    badgeClass = 'badge-done';
    cardClass = 'card-done';
  } else if (hasDivergence) {
    // OCORRÊNCIA / DIVERGÊNCIA ATIVA NO STAGE
    status = 'divergencia';
    statusText = conferidosCount > 0 ? `DIVERGÊNCIA (${conferidosCount}/${palletsInThisStage})` : 'DIVERGÊNCIA';
    badgeClass = 'badge-divergent';
    cardClass = 'card-divergent';
  } else if (conferidosCount > 0) {
    // MEIO: PARCIAL EM ANDAMENTO
    status = 'parcial';
    statusText = `PARCIAL ${conferidosCount}/${palletsInThisStage}`;
    badgeClass = 'badge-partial';
    cardClass = 'card-partial';
  } else {
    // CABEÇA: AGUARDANDO CONFERÊNCIA
    status = 'aguardando';
    statusText = 'AGUARDANDO';
    badgeClass = 'badge-waiting';
    cardClass = 'card-waiting';
  }

  return {
    stage: stageCode,
    status: status,
    statusText: statusText,
    badgeClass: badgeClass,
    cardClass: cardClass,
    embarque: mainEmb,
    totalPaletes: totalPal,
    palletsInThisStage: palletsInThisStage,
    conferidosCount: conferidosCount,
    capacity: stageCap,
    blockedSlots: blockedSlots,
    slots: slots,
    hasDivergence: hasDivergence,
    alertsCount: hasDivergence ? 1 : 0
  };
}

let currentDashViewMode = 'lanes';

window.setDashViewMode = function(mode) {
  currentDashViewMode = mode;
  document.getElementById('btnModeLanes')?.classList.toggle('active', mode === 'lanes');
  document.getElementById('btnModeCards')?.classList.toggle('active', mode === 'cards');
  renderDashboard();
};

function renderDashboard() {
  const container = document.getElementById('dashStagesContainer');
  if (!container) return;

  const allStagesData = MASTER_STAGES.map(s => getDashboardStageInfo(s));

  let countLivre = 0, countAguardando = 0, countParcial = 0, countConferido = 0, countDivergente = 0;
  allStagesData.forEach(stg => {
    if (stg.status === 'livre') countLivre++;
    else if (stg.status === 'conferido') countConferido++;
    else if (stg.status === 'parcial') countParcial++;
    else if (stg.status === 'aguardando') countAguardando++;
    else if (stg.status === 'divergencia') countDivergente++;

    if (stg.hasDivergence && stg.status !== 'divergencia') {
      countDivergente++;
    }
  });

  const elTotal = document.getElementById('dashKpiTotal');
  const elLivre = document.getElementById('dashKpiLivre');
  const elAguar = document.getElementById('dashKpiAguardando');
  const elParc  = document.getElementById('dashKpiParcial');
  const elConf  = document.getElementById('dashKpiConferido');
  const elDiv   = document.getElementById('dashKpiDivergente');

  if (elTotal) elTotal.textContent = MASTER_STAGES.length;
  if (elLivre) elLivre.textContent = countLivre;
  if (elAguar) elAguar.textContent = countAguardando;
  if (elParc)  elParc.textContent  = countParcial;
  if (elConf)  elConf.textContent  = countConferido;
  if (elDiv)   elDiv.textContent   = countDivergente;

  const filtered = allStagesData.filter(stg => {
    if (currentDashFilter === 'divergencia') {
      if (!stg.hasDivergence && stg.status !== 'divergencia') return false;
    } else if (currentDashFilter !== 'all') {
      if (stg.status !== currentDashFilter) return false;
    }

    if (currentDashSearch) {
      const matchStage = stg.stage.toLowerCase().includes(currentDashSearch);
      const matchEmb = stg.embarque && stg.embarque.embarque.toLowerCase().includes(currentDashSearch);
      if (!matchStage && !matchEmb) return false;
    }
    return true;
  });

  const groups = [
    { title: 'Faixa 1 • Docas SO001 a SO034', min: 1, max: 34 },
    { title: 'Faixa 2 • Linha Central SO040 a SO074', min: 40, max: 74 },
    { title: 'Faixa 3 • Linha Alta SO129 a SO142', min: 129, max: 142 }
  ];

  let html = '';

  if (currentDashViewMode === 'lanes') {
    // DESENHO FÍSICO CONTÍNUO DO PÁTIO DE STAGES (TODOS LADO A LADO)
    const inGroup = filtered;
    if (inGroup.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px; color: var(--text-muted); font-size: 0.95rem;">
          Nenhum stage encontrado para o filtro selecionado.
        </div>
      `;
      return;
    }

    // Agrupar stages contíguos pelo mesmo Embarque para a faixa superior (colspan)
    const chunks = [];
    let currentChunk = null;
    inGroup.forEach(stg => {
      const embId = stg.embarque ? stg.embarque.embarque : null;
      if (!currentChunk || currentChunk.embarqueId !== embId) {
        currentChunk = {
          embarqueId: embId,
          isFree: !embId,
          count: 1,
          stages: [stg.stage],
          totalPaletes: stg.totalPaletes || 0,
          conferidosCount: stg.conferidosCount || 0,
          status: stg.status
        };
        chunks.push(currentChunk);
      } else {
        currentChunk.count++;
        currentChunk.stages.push(stg.stage);
        currentChunk.totalPaletes = Math.max(currentChunk.totalPaletes, stg.totalPaletes || 0);
        currentChunk.conferidosCount += (stg.conferidosCount || 0);
        if (stg.status === 'conferido' && currentChunk.status !== 'parcial') {
          currentChunk.status = 'conferido';
        } else if (stg.status === 'parcial') {
          currentChunk.status = 'parcial';
        }
      }
    });

    const rowLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    html = `
      <div class="yard-bay-board">
        <div class="yard-bay-titlebar">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="dhl-badge-tag">DHL SUPPLY CHAIN</span>
            <span>PÁTIO DE EXPEDIÇÃO • MAPA DE CALOR OPERACIONAL</span>
          </div>
          <span style="font-size: 0.72rem; opacity: 0.95;">${inGroup.length} stages lado a lado • Posições A a J • Somente Leitura (Conferência Segura via Scanner)</span>
        </div>
        <div class="yard-scroll-wrap">
          <table class="yard-excel-table">
            <thead>
              <!-- Linha 1: Faixas de Embarques Mescladas com Cores em Gradiente & Medidor de Conclusão -->
              <tr>
                <th class="yard-corner-cell">FOR INTERNAL USE</th>
                ${chunks.map(chunk => {
                  if (chunk.isFree) {
                    return `
                      <th colspan="${chunk.count}" class="yard-emb-header-cell cell-free-emb">
                        LIVRE
                      </th>
                    `;
                  }

                  const totalP = chunk.totalPaletes || 1;
                  const confP = chunk.conferidosCount || 0;
                  const pct = Math.min(100, Math.round((confP / totalP) * 100));

                  let statusGradClass = 'cell-emb-waiting';
                  if (pct === 100 || chunk.status === 'conferido') {
                    statusGradClass = 'cell-emb-done';
                  } else if (pct > 0 || chunk.status === 'parcial') {
                    statusGradClass = 'cell-emb-partial';
                  }

                  return `
                    <th colspan="${chunk.count}" 
                        class="yard-emb-header-cell cell-active-emb ${statusGradClass}"
                        title="Embarque ${chunk.embarqueId} • ${pct}% Concluído (${confP}/${totalP} paletes)">
                      <div class="yard-emb-cell-content">
                        <span class="yard-emb-badge-text">📦 EMBARQUE ${chunk.embarqueId}</span>
                        <span class="yard-emb-progress-pill">
                          <span class="yard-emb-mini-track">
                            <span class="yard-emb-mini-fill" style="width: ${pct}%"></span>
                          </span>
                          <span>${pct}%</span>
                        </span>
                      </div>
                    </th>
                  `;
                }).join('')}
              </tr>

              <!-- Linha 2: Códigos dos Stages: SO001 | SO002 | ... -->
              <tr>
                <th class="yard-corner-stage"></th>
                ${inGroup.map(stg => {
                  const isBlocked = window.isStageBlocked(stg.stage);
                  return `
                  <th class="yard-stage-col-header ${isBlocked ? 'yard-col-blocked' : (stg.embarque ? 'stg-has-emb' : 'stg-free')}" 
                      id="yardCol_${stg.stage}" 
                      data-stage="${stg.stage}"
                      onclick="solicitarToggleBloqueioStage('${stg.stage}')"
                      style="cursor: pointer; ${isBlocked ? 'background: #DC2626 !important; color: #FFFFFF !important; font-weight: 900; box-shadow: inset 0 -3px 0 #991B1B;' : ''}"
                      title="${isBlocked ? 'Stage BLOQUEADO (Clique na nomenclatura para DESBLOQUEAR)' : 'Clique na nomenclatura para BLOQUEAR este stage'}">
                    ${isBlocked ? '🔒 ' : ''}${stg.stage}
                  </th>
                `;}).join('')}
              </tr>
            </thead>
            <tbody>
              <!-- Linhas Verticais de Posições (A até J) -->
              ${rowLetters.map((letter, rowIdx) => {
                const s = rowIdx + 1;
                return `
                  <tr>
                    <td class="yard-letter-cell">${letter}</td>
                    ${inGroup.map(stg => {
                      const isStgBlocked = window.isStageBlocked(stg.stage);
                      const isBlocked = isStgBlocked || stg.blockedSlots.includes(s);
                      const isTarget = (activeConference && activeConference.embarqueId === (stg.embarque && stg.embarque.embarque) && activeConference.activeSlot === s && normalizeStageName(activeConference.currentPhysicalStage) === normalizeStageName(stg.stage));
                      const slotData = (stg.slots && s <= stg.palletsInThisStage) ? stg.slots[s] : null;

                      const locCode = formatStageSlotDisplay(stg.stage, s);
                      let colorClass = 'cell-free';
                      let titleDesc = `[${locCode}] Stage ${stg.stage} - Vaga ${letter} (${s}): `;

                      if (isStgBlocked) {
                        colorClass = 'cell-divergencia cell-stage-blocked';
                        titleDesc += 'STAGE BLOQUEADO MANUALMENTE PELA OPERAÇÃO 🔒';
                      } else if (!stg.embarque || s > stg.palletsInThisStage) {
                        // Vaga livre ou além do volume planejado para este stage
                        colorClass = 'cell-free';
                        titleDesc += stg.embarque ? `Vaga Livre no Stage (Carga: ${stg.palletsInThisStage} paletes)` : 'Stage Livre';
                      } else if (isBlocked) {
                        colorClass = 'cell-divergencia';
                        titleDesc += 'BLOQUEADO / OCORRÊNCIA';
                      } else if (slotData && slotData.status === 'divergent') {
                        colorClass = 'cell-divergencia';
                        titleDesc += `DIVERGÊNCIA ✖ (LPN ${slotData.lpn || ''})`;
                      } else if (slotData && slotData.status === 'done') {
                        colorClass = 'cell-conferido';
                        titleDesc += `CONFERIDO ✔ (LPN ${slotData.lpn || ''})`;
                      } else if (stg.status === 'conferido') {
                        // 100% Concluído
                        colorClass = 'cell-conferido';
                        titleDesc += `CONFERIDO ✔ (LPN ${slotData?.lpn || 'OK'})`;
                      } else if (stg.status === 'parcial') {
                        // Parcial: Apenas vagas realmente bipadas ficam verdes!
                        if (s <= stg.conferidosCount) {
                          colorClass = 'cell-conferido';
                          titleDesc += `CONFERIDO (${s}/${stg.conferidosCount}) ✔`;
                        } else if (isTarget || (s === stg.conferidosCount + 1 && activeConference && activeConference.embarqueId === (stg.embarque && stg.embarque.embarque))) {
                          colorClass = 'cell-ativo';
                          titleDesc += 'PRÓXIMO A BIPAR (VAGA ATIVA)';
                        } else {
                          colorClass = 'cell-parcial';
                          titleDesc += `Pendente de Bipagem (${stg.conferidosCount}/${stg.palletsInThisStage} paletes)`;
                        }
                      } else if (stg.status === 'divergencia') {
                        if (isTarget) {
                          colorClass = 'cell-ativo';
                          titleDesc += 'PRÓXIMO A BIPAR (VAGA ATIVA)';
                        } else {
                          colorClass = 'cell-aguardando';
                          titleDesc += `Alocado ao Embarque ${stg.embarque.embarque} (Aguardando Conferência)`;
                        }
                      } else {
                        // stg.status === 'aguardando'
                        if (isTarget) {
                          colorClass = 'cell-ativo';
                          titleDesc += 'EM CONFERÊNCIA (VAGA ATIVA NO SCANNER)';
                        } else {
                          colorClass = 'cell-aguardando';
                          titleDesc += `Alocado ao Embarque ${stg.embarque.embarque} (Aguardando Conferência)`;
                        }
                      }

                      // SOMENTE LEITURA - NÃO POSSUI ONCLICK PARA ALTERAR MANUALMENTE (CONFERÊNCIA DE SEGURANÇA)
                      return `
                        <td class="yard-slot-cell ${colorClass}" 
                            title="${titleDesc}">
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else {
    // VISÃO EM CARTÕES RESUMO
    const groups = [
      { title: 'Faixa 1 • Docas SO001 a SO034', min: 1, max: 34 },
      { title: 'Faixa 2 • Linha Central SO040 a SO074', min: 40, max: 74 },
      { title: 'Faixa 3 • Linha Alta SO129 a SO142', min: 129, max: 142 }
    ];

    groups.forEach(grp => {
      const inGroup = filtered.filter(stg => {
        const num = parseInt(stg.stage.replace(/\D/g, ''), 10);
        return num >= grp.min && num <= grp.max;
      });

      if (inGroup.length === 0) return;

      html += `
        <div class="dash-group-box">
          <div class="dash-group-header">
            <span class="dash-group-title">${grp.title}</span>
            <span class="dash-group-count">${inGroup.length} stages listados</span>
          </div>
          <div class="dash-stages-grid">
      `;

      inGroup.forEach(stg => {
        const cap = stg.capacity || 10;
        let miniSlotsHtml = '';
        for (let i = 1; i <= cap; i++) {
          let mClass = 'mini-slot';
          const isSlotWithinLoad = i <= (stg.palletsInThisStage || 0);
          if (!stg.embarque || !isSlotWithinLoad) {
            // Vaga livre além da carga ou sem embarque
          } else if (stg.blockedSlots.includes(i)) {
            mClass += ' blocked';
          } else if (stg.status === 'conferido') {
            mClass += ' done';
          } else if (stg.status === 'parcial') {
            if (i <= stg.conferidosCount) {
              mClass += ' done';
            } else {
              mClass += ' partial';
            }
          } else if (stg.status === 'divergencia') {
            mClass += ' divergent';
          } else {
            mClass += ' waiting';
          }
          miniSlotsHtml += `<div class="${mClass}"></div>`;
        }

        const isStgBlocked = window.isStageBlocked(stg.stage);
        html += `
          <div class="stage-card ${isStgBlocked ? 'card-divergent card-stage-blocked' : stg.cardClass}" onclick="openStageDetailModal('${stg.stage}')">
            <div class="stage-card-top">
              <span class="stage-card-name" 
                    onclick="event.stopPropagation(); solicitarToggleBloqueioStage('${stg.stage}')" 
                    title="Clique no nome para ${isStgBlocked ? 'DESBLOQUEAR' : 'BLOQUEAR'} este stage" 
                    style="cursor: pointer; padding: 2px 6px; border-radius: 4px; ${isStgBlocked ? 'background: #DC2626 !important; color: #FFFFFF !important; font-weight: 900;' : 'background: #FEF08A; color: #854D0E; font-weight: 800;'}">
                ${isStgBlocked ? '🔒 ' : ''}${stg.stage}
              </span>
              <span class="stage-card-badge ${isStgBlocked ? 'badge-divergent' : stg.badgeClass}">
                ${isStgBlocked ? 'BLOQUEADO' : stg.statusText}
              </span>
            </div>
            <div class="stage-card-emb">
              ${stg.embarque ? `<span class="badge-emb-card">📦 EMB ${stg.embarque.embarque}</span>` : '<span style="color:var(--text-muted)">Sem carga alocada</span>'}
            </div>
            <div class="stage-card-kpi">
              ${stg.totalPaletes > 0 ? `${stg.conferidosCount}/${stg.totalPaletes} paletes • ${cap} vagas` : `${cap} vagas físicas`}
            </div>
            <div class="stage-mini-slots" title="Visualização de vagas 1 a ${cap}">
              ${miniSlotsHtml}
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });
  }

  if (!html) {
    html = `
      <div style="text-align: center; padding: 48px; color: var(--text-muted); font-size: 0.95rem;">
        Nenhum stage encontrado para o filtro selecionado.
      </div>
    `;
  }

  container.innerHTML = html;

  const yardWrap = container.querySelector('.yard-scroll-wrap');
  if (yardWrap && yardWrap.scrollWidth > yardWrap.clientWidth) {
    yardWrap.scrollLeft = yardWrap.scrollWidth;
  }
}

window.openStageDetailModal = function(stageCode, highlightSlot = null, paleteInfo = null) {
  const modal = document.getElementById('modalStageDetail');
  const title = document.getElementById('stageDetailTitle');
  const sub = document.getElementById('stageDetailSub');
  const body = document.getElementById('stageDetailBody');
  const btnConf = document.getElementById('btnConferirStageAgora');
  const btnVerPatio = document.getElementById('btnVerNoPatioGeral');

  if (!modal || !title || !body) return;

  // 1. Normalizar o código do stage e extrair vaga se houver
  let normStage = normalizeStageName(stageCode || 'SO004');
  const match = normStage.match(/^(S[OT]G?|STAGE)?0*(\d+)([A-J]?)$/i);
  let stageNum = 4;
  let slotLetterFromCode = '';
  if (match) {
    stageNum = parseInt(match[2], 10) || 4;
    slotLetterFromCode = match[3] ? match[3].toUpperCase() : '';
  }
  const cleanStageCode = 'SO' + String(stageNum).padStart(3, '0');

  if (!highlightSlot && slotLetterFromCode) {
    highlightSlot = slotLetterFromCode.charCodeAt(0) - 64;
  }
  if (typeof highlightSlot === 'string') {
    const char = highlightSlot.trim().toUpperCase();
    if (/^[A-J]$/.test(char)) highlightSlot = char.charCodeAt(0) - 64;
    else highlightSlot = parseInt(char, 10) || null;
  }

  const stgInfo = getDashboardStageInfo(cleanStageCode);

  // 2. Setor físico do galpão
  let setorNome = 'Faixa 1 • Docas SO004 a SO034';
  let setorMin = 4, setorMax = 34;
  if (stageNum >= 40 && stageNum <= 74) {
    setorNome = 'Faixa 2 • Linha Central SO040 a SO074';
    setorMin = 40; setorMax = 74;
  } else if (stageNum >= 129 && stageNum <= 142) {
    setorNome = 'Faixa 3 • Linha Alta SO129 a SO142';
    setorMin = 129; setorMax = 142;
  }

  const highlightSlotLetter = highlightSlot ? String.fromCharCode(64 + highlightSlot) : '';
  const targetLocCode = highlightSlot ? formatStageSlotDisplay(cleanStageCode, highlightSlot) : '';

  title.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
      <span>📍 Stage ${cleanStageCode}</span>
      ${targetLocCode ? `<span class="badge-loc-pill loc-ok" style="font-size:0.82rem; padding: 3px 10px;">Posição: <b>${targetLocCode}</b> (Vaga ${highlightSlotLetter})</span>` : ''}
    </div>
  `;
  sub.innerHTML = `<b>Setor:</b> ${setorNome} &nbsp;•&nbsp; <b>Doca:</b> ${stageNum} &nbsp;•&nbsp; ${stgInfo.embarque ? '<b>Embarque:</b> ' + stgInfo.embarque.embarque + ' (' + stgInfo.statusText + ')' : '<b style="color:var(--text-muted)">Stage Livre</b>'}`;

  // 3. Mini Régua Visual de Docas do Setor (Visão Macro do Galpão)
  const neighborPills = [];
  for (let n = Math.max(setorMin, stageNum - 3); n <= Math.min(setorMax, stageNum + 3); n++) {
    const code = 'SO' + String(n).padStart(3, '0');
    const isCurrent = (n === stageNum);
    neighborPills.push(`
      <div class="sector-bay-pill ${isCurrent ? 'current-active-bay' : ''}" 
           onclick="openStageDetailModal('${code}')" 
           title="${isCurrent ? 'Doca Atual ' + code : 'Clique para inspecionar doca ' + code}">
        ${isCurrent ? '🎯 ' : ''}${code}
      </div>
    `);
  }

  const macroRulerHtml = `
    <div style="margin-bottom: 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
        <span style="font-size: 0.76rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px;">
          🗺️ Visão Macro • Docas do Setor (${setorNome}):
        </span>
        <span style="font-size: 0.72rem; color: #0284C7; font-weight: 700;">
          Doca Selecionada: <b>${cleanStageCode}</b>
        </span>
      </div>
      <div class="stage-sector-macro-strip">
        ${neighborPills.join('')}
      </div>
    </div>
  `;

  // 4. Detalhes do Palete Clicado (se fornecido via consolidação ou scanner)
  let palletBoxHtml = '';
  if (paleteInfo && (paleteInfo.lpn || paleteInfo.sku)) {
    palletBoxHtml = `
      <div class="stage-pallet-detail-box">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; border-bottom: 1px solid #BBF7D0; padding-bottom: 6px;">
          <span style="font-size: 0.88rem; font-weight: 800; color: #065F46;">
            📦 Localização do Palete Selecionado
          </span>
          <span class="badge-loc-pill loc-ok" style="font-size: 0.8rem;">
            🎯 ${targetLocCode || cleanStageCode}
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; font-size: 0.82rem; color: #1E293B;">
          <div><span style="color:var(--text-muted);">LPN:</span> <b>${paleteInfo.lpn || '—'}</b></div>
          <div><span style="color:var(--text-muted);">SKU:</span> <b>${paleteInfo.sku || '—'}</b></div>
          ${paleteInfo.lote ? `<div><span style="color:var(--text-muted);">Lote:</span> <b>${paleteInfo.lote}</b></div>` : ''}
          <div><span style="color:var(--text-muted);">Quantidade:</span> <b>${paleteInfo.qtd ? paleteInfo.qtd + ' un.' : '—'}</b></div>
          <div><span style="color:var(--text-muted);">Endereço:</span> <b>${cleanStageCode} (Vaga ${highlightSlotLetter || '1'})</b></div>
          <div><span style="color:var(--text-muted);">Status:</span> <span class="cons-status-badge ${paleteInfo.conferido ? 'conferido' : 'pendente'}">${paleteInfo.conferido ? '✔ Conferido' : '⏳ Na Fila'}</span></div>
        </div>
      </div>
    `;
  }

  // 5. Grid das 10 Vagas Físicas (A até J)
  let slotsHtml = `
    <div style="margin-bottom: 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <span style="font-size: 0.78rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">
          📍 Posições Físicas no Stage (Vagas A a J • 1 a ${stgInfo.capacity}):
        </span>
        ${highlightSlot ? `<span style="font-size:0.75rem; color:#0284C7; font-weight:800;">🎯 Vaga ${highlightSlotLetter} em Destaque</span>` : ''}
      </div>
      <div class="stage-slots-grid" style="margin-bottom: 0;">
  `;

  for (let s = 1; s <= stgInfo.capacity; s++) {
    const isBlocked = stgInfo.blockedSlots.includes(s);
    const isTargetSlot = (highlightSlot === s);
    const slotData = stgInfo.slots ? stgInfo.slots[s] : null;

    let cellClass = 'slot-cell';
    let statusText = 'LIVRE';
    let lpnText = '';

    if (isBlocked) {
      cellClass += ' slot-blocked';
      statusText = 'BLOQUEADO';
    } else if (isTargetSlot) {
      cellClass += ' slot-selected-highlight';
      statusText = '🎯 VAGA DO PALETE';
      lpnText = (paleteInfo && paleteInfo.lpn) ? '...' + String(paleteInfo.lpn).slice(-4) : (slotData?.lpn ? '...' + String(slotData.lpn).slice(-4) : '');
    } else if (slotData && slotData.status === 'divergent') {
      cellClass += ' slot-divergent';
      statusText = 'DIVERGÊNCIA ✖';
      lpnText = slotData.lpn ? '...' + String(slotData.lpn).slice(-4) : '';
    } else if (slotData && slotData.status === 'done') {
      cellClass += ' slot-done';
      statusText = 'CONFERIDO';
      lpnText = slotData.lpn ? '...' + String(slotData.lpn).slice(-4) : '';
    } else if (s <= (stgInfo.palletsInThisStage || 0)) {
      cellClass += ' slot-waiting';
      statusText = 'AGUARDANDO';
    } else {
      cellClass += ' slot-free';
      statusText = 'LIVRE';
    }

    const locCode = formatStageSlotDisplay(cleanStageCode, s);
    const letter = String.fromCharCode(64 + s);

    slotsHtml += `
      <div class="${cellClass}" title="Vaga ${s} (${letter}) - ${statusText}">
        <span class="slot-num">${locCode}</span>
        <span class="slot-pos-sub">Vaga ${s} (${letter})</span>
        <span class="slot-status-text">${statusText}</span>
        ${lpnText ? `<span class="slot-lpn">${lpnText}</span>` : ''}
      </div>
    `;
  }

  slotsHtml += `</div></div>`;

  // 6. Dados do Embarque
  let embDetailsHtml = '';
  if (stgInfo.embarque) {
    const eObj = stgInfo.embarque;
    let horaDocaStr = '';
    if (eObj.horario_doca) {
      try { horaDocaStr = new Date(eObj.horario_doca).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}); } catch(e) { horaDocaStr = String(eObj.horario_doca).slice(11,16); }
    } else if (eObj.janela_embarque) {
      try { horaDocaStr = new Date(eObj.janela_embarque).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) + ' (SLA)'; } catch(e) { horaDocaStr = String(eObj.janela_embarque).slice(11,16); }
    }

    embDetailsHtml = `
      <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px 14px; font-size: 0.85rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom: 8px;">
          <div style="font-weight: 800; color: var(--text-primary);">
            Embarque Alocado: <b>${eObj.embarque}</b>
          </div>
          ${eObj.transportadora ? `<span style="font-size:0.75rem; background:#E2E8F0; padding:2px 8px; border-radius:4px; font-weight:700; color:#1E293B;">🚛 ${eObj.transportadora} • Carreta ${eObj.placa || '-'} ${horaDocaStr ? '• ⏱️ ' + horaDocaStr : ''}</span>` : ''}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; color: var(--text-secondary);">
          <div>Total Paletes Carga: <b>${stgInfo.totalPaletes}</b></div>
          <div>Paletes neste Stage: <b>${stgInfo.palletsInThisStage}</b></div>
          <div>Conferidos: <b style="color:#00A650;">${stgInfo.conferidosCount}</b></div>
          <div>Pendentes: <b style="color:#FF7A00;">${Math.max(0, stgInfo.palletsInThisStage - stgInfo.conferidosCount)}</b></div>
        </div>
      </div>
    `;
  } else {
    embDetailsHtml = `
      <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px 14px; color: var(--text-muted); font-size: 0.85rem; text-align: center;">
        Este stage está livre no momento. Nenhum embarque alocado pelo WMS.
      </div>
    `;
  }

  body.innerHTML = macroRulerHtml + palletBoxHtml + slotsHtml + embDetailsHtml;

  // 7. Configuração dos botões do rodapé
  if (btnVerPatio) {
    btnVerPatio.onclick = () => {
      localizarStageNoPatio(cleanStageCode);
    };
  }

  if (btnConf) {
    if (stgInfo.embarque) {
      btnConf.style.display = 'inline-flex';
      btnConf.textContent = `Conferir Embarque ${stgInfo.embarque.embarque}`;
      btnConf.onclick = () => {
        closeStageDetailModal();
        const inputEmb = document.getElementById('inputEmbarque');
        if (inputEmb) inputEmb.value = stgInfo.embarque.embarque;
        entrarNoEmbarque();
      };
    } else {
      btnConf.style.display = 'none';
    }
  }

  modal.style.display = 'flex';
};

window.mostrarLocalizacaoStage = function(stageInput, highlightSlot, lpn, sku, lote, qtd) {
  openStageDetailModal(stageInput, highlightSlot, { lpn, sku, lote, qtd });
};

window.localizarStageNoPatio = function(stageCode) {
  closeStageDetailModal();
  showScreen('viewDashboard');
  setDashViewMode('lanes');

  setTimeout(() => {
    const norm = normalizeStageName(stageCode);
    const headers = document.querySelectorAll('.yard-stage-col-header');
    let targetEl = null;

    headers.forEach(h => {
      if (normalizeStageName(h.textContent.trim()) === norm || h.getAttribute('data-stage') === stageCode) {
        targetEl = h;
      }
    });

    if (!targetEl) {
      const cards = document.querySelectorAll('.stage-card');
      cards.forEach(c => {
        const nameEl = c.querySelector('.stage-card-name');
        if (nameEl && normalizeStageName(nameEl.textContent.trim()) === norm) {
          targetEl = c;
        }
      });
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
      targetEl.classList.add('yard-col-flash');
      setTimeout(() => targetEl.classList.remove('yard-col-flash'), 3200);
      showToast(`🎯 Visualizando <b>${stageCode}</b> no Pátio de Expedição!`);
    } else {
      showToast(`Visualizando Pátio de Stages (${stageCode})`);
    }
  }, 120);
};

window.closeStageDetailModal = function() {
  const modal = document.getElementById('modalStageDetail');
  if (modal) modal.style.display = 'none';
};

window.localizarEmbarqueUniversal = function(termo) {
  if (!database || !database.embarques || !termo) return null;
  const raw = String(termo).trim();
  const cleanDigits = raw.replace(/\D/g, '');
  const cleanNoZeros = cleanDigits.replace(/^0+/, '');

  // 1. Busca direta pelas chaves
  const chavesTentativas = [
    raw,
    cleanDigits,
    cleanNoZeros,
    '00' + cleanNoZeros,
    '0' + cleanNoZeros
  ].filter(Boolean);

  for (const k of chavesTentativas) {
    if (database.embarques[k]) {
      return { embarque: database.embarques[k], encontradoPor: 'embarque', termoBuscado: raw };
    }
  }

  // 2. Busca iterando sobre todos os embarques comparando id normalizado
  for (const k of Object.keys(database.embarques)) {
    const emb = database.embarques[k];
    if (!emb) continue;
    const embNum = String(emb.embarque || k).replace(/\D/g, '').replace(/^0+/, '');
    if (cleanNoZeros && embNum === cleanNoZeros) {
      return { embarque: emb, encontradoPor: 'embarque', termoBuscado: raw };
    }
  }

  // 3. Se não achou como número de embarque, busca como LPN de Palete em toda a base!
  if (typeof findPalletAcrossAllEmbarques === 'function') {
    const crossMatch = findPalletAcrossAllEmbarques(raw);
    if (crossMatch && crossMatch.embarque) {
      return {
        embarque: crossMatch.embarque,
        encontradoPor: 'palete',
        paleteEncontrado: crossMatch.palete,
        termoBuscado: raw
      };
    }
  }

  return null;
};

window.entrarEmbarquePorId = function(embId) {
  if (!embId) return;
  closeDashboard();
  const input = document.getElementById('inputEmbarque');
  if (input) input.value = embId;
  entrarNoEmbarque();
};

function entrarNoEmbarque() {
  sound.init();
  const input = document.getElementById('inputEmbarque');
  let embId = input ? input.value.trim() : '';
  const opInput = document.getElementById('inputOperador');
  let operador = opInput ? opInput.value.trim() : '';

  if (!embId) {
    if (typeof showToast === 'function') {
      showToast('⚠️ Digite ou bipe o número do embarque para iniciar!');
    }
    if (input) input.focus();
    return;
  }

  // Se o conferente não foi informado, usa o último salvo ou 'Conferente DHL'
  if (!operador) {
    operador = localStorage.getItem('dhl_last_operator') || 'Conferente DHL';
    if (opInput) opInput.value = operador;
  }
  try {
    localStorage.setItem('dhl_last_operator', operador);
  } catch (e) {}

  const buscaRes = window.localizarEmbarqueUniversal(embId);

  if (!buscaRes || !buscaRes.embarque) {
    sound.playError('Embarque não cadastrado');
    alert(`Embarque ou Palete "${embId}" não localizado na base de dados!\n\nVocê pode carregar a planilha deste embarque clicando no botão "Atualizar Base" no topo.`);
    if (input) { input.select(); input.focus(); }
    return;
  }

  activeEmbarque = buscaRes.embarque;
  embId = activeEmbarque.embarque;
  if (input) input.value = embId;

  if (buscaRes.encontradoPor === 'palete') {
    showToast(`🎯 <b>Palete Localizado!</b> Embarque identificado: <b>${embId}</b>`);
  }
  if (!Array.isArray(activeEmbarque.paletes)) {
    activeEmbarque.paletes = [activeEmbarque.paletes];
  }

  let restored = false;
  const historyList = getStoredHistory();
  const existingAudit = historyList.find(h => h.embarqueId === embId && h.status === 'Em Andamento');
  const existingPartial = getPartialConferenceSession(embId);

  const allStages = (activeEmbarque.stages && activeEmbarque.stages.length > 0) ? activeEmbarque.stages : ['STAGE'];
  const initialPhysicalStage = normalizeStageName(allStages[0]);
  const stageCap = getStageCapacity(initialPhysicalStage);

  if (existingPartial) {
    activeConference = {
      embarqueId: embId,
      operador: existingPartial.operador || operador,
      iniciadoEm: new Date(existingPartial.iniciadoEm),
      finalizadoEm: null,
      conferidos: new Map(existingPartial.conferidos || []),
      divergencias: existingPartial.divergencias || [],
      historico: existingPartial.historico || [],
      currentPhysicalStage: existingPartial.currentPhysicalStage || initialPhysicalStage,
      lastComparison: existingPartial.lastComparison || null,
      stageSlots: existingPartial.stageSlots || {},
      slots: existingPartial.slots || {},
      activeSlot: existingPartial.activeSlot || 1,
      capacity: existingPartial.capacity || stageCap,
      direction: existingPartial.direction || 'asc'
    };
    restored = true;
    showToast(`Conferência retomada: <b>${activeConference.conferidos.size}</b> de <b>${activeEmbarque.total_paletes}</b> paletes conferidos.`);
  } else if (existingAudit && existingAudit.conferidos) {
    activeConference = {
      embarqueId: embId,
      operador: existingAudit.operador || operador,
      iniciadoEm: new Date(existingAudit.iniciadoEm),
      finalizadoEm: null,
      conferidos: new Map(existingAudit.conferidos),
      divergencias: existingAudit.divergencias || [],
      historico: existingAudit.historico || [],
      currentPhysicalStage: existingAudit.currentPhysicalStage || initialPhysicalStage,
      lastComparison: existingAudit.lastComparison || null,
      stageSlots: existingAudit.stageSlots || {},
      slots: existingAudit.slots || {},
      activeSlot: 1,
      capacity: stageCap,
      direction: 'asc'
    };
    restored = true;
    showToast(`Restaurada conferência com <b>${activeConference.conferidos.size}</b> paletes já validados.`);
  } else {
    activeConference = {
      embarqueId: embId,
      operador: operador,
      iniciadoEm: new Date(),
      finalizadoEm: null,
      conferidos: new Map(),
      divergencias: [],
      historico: [],
      currentPhysicalStage: initialPhysicalStage,
      lastComparison: null,
      stageSlots: {},
      slots: {},
      activeSlot: 1,
      capacity: stageCap,
      direction: 'asc'
    };
  }

  const curStg = activeConference.currentPhysicalStage || initialPhysicalStage;
  if (!activeConference.stageSlots) activeConference.stageSlots = {};
  if (!activeConference.stageSlots[curStg]) {
    activeConference.stageSlots[curStg] = activeConference.slots || {};
  }
  activeConference.slots = activeConference.stageSlots[curStg];
  activeConference.activeSlot = calculateNextTargetSlot(curStg);

  document.getElementById('txtEmbarque').textContent = embId;
  const stagesToDisplay = (activeEmbarque.stages && activeEmbarque.stages.length > 0)
    ? (Array.isArray(activeEmbarque.stages) ? activeEmbarque.stages.map(s => formatStageSlotDisplay(s)).join(', ') : formatStageSlotDisplay(activeEmbarque.stages))
    : '-';
  document.getElementById('txtStage').textContent = stagesToDisplay;
  document.getElementById('txtTotalPaletes').textContent = activeEmbarque.total_paletes;

  // Preenche dados operacionais inteligentes (Transporte, Placa, Doca e SLA)
  const elTransp = document.getElementById('txtSmartTransportadora');
  const elPlaca = document.getElementById('txtSmartPlaca');
  const elJanela = document.getElementById('txtSmartJanela');
  const elBadgePrioridade = document.getElementById('badgeSmartPrioridade');

  if (elTransp) elTransp.textContent = activeEmbarque.transportadora || 'A Definir';
  if (elPlaca) elPlaca.textContent = (activeEmbarque.placa && activeEmbarque.placa !== 'Pátio') ? activeEmbarque.placa : 'Pátio';
  
  let horaDocaFmt = '-';
  if (activeEmbarque.horario_doca) {
    try {
      const dt = new Date(activeEmbarque.horario_doca);
      horaDocaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch(e) { horaDocaFmt = String(activeEmbarque.horario_doca).slice(11, 16); }
  } else if (activeEmbarque.janela_embarque) {
    try {
      const dt = new Date(activeEmbarque.janela_embarque);
      horaDocaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' (SLA)';
    } catch(e) { horaDocaFmt = String(activeEmbarque.janela_embarque).slice(11, 16); }
  }
  if (elJanela) elJanela.textContent = horaDocaFmt;

  if (elBadgePrioridade) {
    if (activeEmbarque.placa && activeEmbarque.placa !== 'Pátio' && activeEmbarque.placa !== '-') {
      elBadgePrioridade.innerHTML = '🚚 Doca Ativa • Carreta ' + activeEmbarque.placa;
      elBadgePrioridade.style.background = '#DCFCE7';
      elBadgePrioridade.style.color = '#15803D';
    } else {
      elBadgePrioridade.innerHTML = '⏱️ Em Separação • Aguardando Carreta';
      elBadgePrioridade.style.background = '#FEF3C7';
      elBadgePrioridade.style.color = '#B45309';
    }
  }

  hideFeedback();
  calcularAmostragem();
  updateUI();

  recordActiveConferenceToHistory('Em Andamento');
  persistActiveSession();

  showScreen('viewScanner');
  sound.speak(restored ? `Conferência do embarque ${embId} retomada.` : `Embarque ${embId} pronto para leitura.`);
}

function trocarEmbarque() {
  if (activeConference.conferidos.size > 0) {
    recordActiveConferenceToHistory('Em Andamento');
  }
  showScreen('viewLogin');
}

function reiniciarConferencia() {
  if (activeConference.conferidos.size > 0 || activeConference.divergencias.length > 0) {
    if (!confirm('Deseja zerar as bipagens deste embarque e recomeçar a conferência?')) {
      focusScanner();
      return;
    }
  }
  const allStages = (activeEmbarque.stages && activeEmbarque.stages.length > 0) ? activeEmbarque.stages : ['STAGE'];
  const initialPhysicalStage = normalizeStageName(allStages[0]);
  const stageCap = getStageCapacity(initialPhysicalStage);

  activeConference = {
    embarqueId: activeEmbarque.embarque,
    operador: activeConference.operador,
    iniciadoEm: new Date(),
    finalizadoEm: null,
    conferidos: new Map(),
    divergencias: [],
    historico: [],
    currentPhysicalStage: initialPhysicalStage,
    lastComparison: null,
    stageSlots: {},
    slots: {},
    activeSlot: 1,
    capacity: stageCap,
    direction: 'asc'
  };
  recordActiveConferenceToHistory('Em Andamento');
  persistActiveSession();
  updateUI();
  hideFeedback();
  focusScanner();
  showToast('Conferência reiniciada para este embarque.');
}

function focusScanner() {
  const input = document.getElementById('barcodeInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 30);
  }
}

/* =========================================================
   BUSCA INTELIGENTE DE LPN & INVESTIGAÇÃO CRUZADA DE STAGE
   ========================================================= */
function findPalletMatch(code) {
  if (!activeEmbarque || !activeEmbarque.paletes || !code) return null;
  const c = normalizeBarcode(code);
  if (!c) return null;

  return activeEmbarque.paletes.find(p => {
    const pClean = normalizeBarcode(p.palete);
    
    // 1. Match exato
    if (pClean === c) return true;

    // 2. Sem zeros à esquerda
    const pNoZeros = pClean.replace(/^0+/, '');
    const cNoZeros = c.replace(/^0+/, '');
    if (pNoZeros === cNoZeros) return true;

    // 3. Match de prefixo ou sufixo (18 dígitos vs 20 dígitos)
    if (c.length >= 14 && pClean.length >= 14) {
      if (pClean.startsWith(c) || c.startsWith(pClean)) return true;
      if (pClean.endsWith(c) || c.endsWith(pClean)) return true;
      if (pNoZeros.startsWith(cNoZeros) || cNoZeros.startsWith(pNoZeros)) return true;
      if (pNoZeros.endsWith(cNoZeros) || cNoZeros.endsWith(pNoZeros)) return true;
    }

    return false;
  });
}

function findPalletAcrossAllEmbarques(code) {
  if (!database || !database.embarques || !code) return null;
  const c = normalizeBarcode(code);
  const cNoZeros = c.replace(/^0+/, '');

  for (const embId of Object.keys(database.embarques)) {
    const emb = database.embarques[embId];
    if (emb.embarque !== embId) continue; // ignora aliases

    for (const p of emb.paletes) {
      const pClean = normalizeBarcode(p.palete);
      const pNoZeros = pClean.replace(/^0+/, '');

      const isMatch = (pClean === c) ||
                      (pNoZeros === cNoZeros) ||
                      (c.length >= 14 && pClean.length >= 14 && (
                        pClean.startsWith(c) || c.startsWith(pClean) ||
                        pClean.endsWith(c) || c.endsWith(pClean) ||
                        pNoZeros.startsWith(cNoZeros) || cNoZeros.startsWith(pNoZeros) ||
                        pNoZeros.endsWith(cNoZeros) || cNoZeros.endsWith(pNoZeros)
                      ));

      if (isMatch) {
        return {
          embarque: emb,
          palete: p
        };
      }
    }
  }
  return null;
}

function handleBarcodeInput(e) {
  if (isProcessingBarcode) return;
  const val = e.target.value.trim();
  if (!val) return;

  const directMatch = findPalletMatch(val);
  if (directMatch && (val.length === directMatch.palete.length || val.length >= 20)) {
    clearTimeout(scanDebounceTimer);
    processBarcode(val);
    return;
  }

  clearTimeout(scanDebounceTimer);
  if (val.length >= 6) {
    scanDebounceTimer = setTimeout(() => {
      processBarcode(e.target.value);
    }, 90);
  }
}

function verificarStageRealmenteLotado(stgFisico, cap) {
  if (!activeConference || !activeConference.stageSlots || !activeConference.stageSlots[stgFisico]) return false;
  const slots = activeConference.stageSlots[stgFisico];
  const maxPerSlot = (window.modoEmpilhamento === '3x') ? 3 : (window.modoEmpilhamento === '2x' ? 2 : 1);
  const blocked = (typeof getStageBlockedSlots === 'function') ? getStageBlockedSlots(stgFisico) : [];

  let vagasComEspaco = 0;
  for (let s = 1; s <= cap; s++) {
    if (blocked.includes(s)) continue;
    const sd = slots[s];
    if (!sd) {
      vagasComEspaco++;
      continue;
    }
    if (sd.status === 'divergent') continue;
    const count = (sd.paletes && sd.paletes.length) || (sd.palete ? 1 : 0);
    if (count < maxPerSlot) {
      vagasComEspaco++;
    }
  }
  return (vagasComEspaco === 0);
}

function contarTotalPaletesNoStage(stgFisico, cap) {
  if (!activeConference || !activeConference.stageSlots || !activeConference.stageSlots[stgFisico]) return 0;
  const slots = activeConference.stageSlots[stgFisico];
  let tot = 0;
  for (let s = 1; s <= cap; s++) {
    const sd = slots[s];
    if (sd) {
      tot += (sd.paletes && sd.paletes.length) || (sd.palete ? 1 : 0);
    }
  }
  return tot;
}

function processBarcode(rawCode) {
  if (!activeEmbarque || isProcessingBarcode) return;
  const code = normalizeBarcode(rawCode);
  if (!code) return;

  isProcessingBarcode = true;
  clearTimeout(scanDebounceTimer);

  const now = new Date();
  const timestampStr = now.toLocaleTimeString();

  // 0. VERIFICAÇÃO DE BLOQUEIO OPERACIONAL MANUAL DO STAGE ATUAL
  const currentStgCheck = (activeConference && activeConference.currentPhysicalStage) || (activeEmbarque && activeEmbarque.stages && activeEmbarque.stages[0]);
  if (currentStgCheck && window.isStageBlocked(currentStgCheck) && !isStageBarcode(code)) {
    sound.playError('Stage atual bloqueado');
    triggerCardFlash('pulse-err');
    showFeedback('err', `🛑 <b>STAGE ${currentStgCheck} BLOQUEADO PELA OPERAÇÃO!</b><br>Este stage está marcado em vermelho. Clique na nomenclatura do stage no mapa para desbloqueá-lo ou bipe outro stage físico.`);
    isProcessingBarcode = false;
    return;
  }

  // 0. VERIFICAÇÃO DE BLOQUEIO OBRIGATÓRIO POR STAGE LOTADO
  if (activeConference && activeConference.stageLotadoBloqueio) {
    if (!isStageBarcode(code)) {
      sound.playError('Stage lotado. Bipe a placa do novo Stage.');
      triggerCardFlash('pulse-err');
      showFeedback('err', `🛑 <b>STAGE ${activeConference.stageLotadoBloqueio.stageCheio} LOTADO (${activeConference.stageLotadoBloqueio.count}/${activeConference.stageLotadoBloqueio.cap})!</b><br>Você <b>DEVE bipar a placa do novo Stage físico (ST... ou SO...)</b> antes de bipar qualquer palete.`);
      abrirModalStageLotado();
      isProcessingBarcode = false;
      return;
    }
  }

  // 1. RECONHECIMENTO DE BIPAGEM DE STAGE FÍSICO (Ex: SO004, SO008, SO01A, SO02B...)
  if (isStageBarcode(code)) {
    const clean = String(code).toUpperCase().trim().replace(/[\s\-_]/g, '');
    const letterMatch = clean.match(/^(?:SO|ST|STG|STAGE)0*(\d+)([A-Z])$/i);
    let targetSlot = null;
    let baseStage = normalizeStageName(code);

    if (letterMatch) {
      const num = parseInt(letterMatch[1], 10);
      const letter = letterMatch[2].toUpperCase();
      baseStage = 'SO' + String(num).padStart(3, '0');
      targetSlot = letter.charCodeAt(0) - 64; // 'A'->1, 'B'->2, etc.
    }

    // Se estava com bloqueio de stage lotado e o conferente bipou o MESMO stage cheio
    if (activeConference.stageLotadoBloqueio && normalizeStageName(baseStage) === activeConference.stageLotadoBloqueio.stageCheio) {
      sound.playError('Este stage continua lotado');
      triggerCardFlash('pulse-err');
      showFeedback('err', `✖ O Stage <b>${baseStage}</b> continua com a capacidade máxima ocupada (10/10 vagas)!<br>Bipe a placa de um <b>novo Stage diferente</b> (livre).`);
      isProcessingBarcode = false;
      return;
    }

    const occupant = getStageOccupant(baseStage, activeEmbarque.embarque);

    if (occupant) {
      sound.playError('Stage ocupado por outro embarque');
      triggerCardFlash('pulse-err');
      showFeedback('err', `✖ <b>BLOQUEIO DE INVASÃO:</b> O Stage <b>${baseStage}</b> já está ocupado pelo <b>Embarque ${occupant.embarque}</b>!<br>NÃO É PERMITIDO COBRIR OUTRO EMBARQUE. Aponte o leitor para uma doca/stage LIVRE.`);
      isProcessingBarcode = false;
      focusScanner();
      return;
    }

    // Desativa o bloqueio obrigatório de stage cheio se estiver ativo
    activeConference.stageLotadoBloqueio = null;
    fecharModalStageLotado();

    window.switchPhysicalStage(baseStage);
    if (targetSlot && targetSlot >= 1 && targetSlot <= (activeConference.capacity || 10)) {
      activeConference.activeSlot = targetSlot;
    } else {
      activeConference.activeSlot = 1;
    }
    renderStageSlotsGrid();
    updateUI();
    showToast(`📍 Vaga direcionada para: <b>${formatStageSlotDisplay(baseStage, activeConference.activeSlot)}</b>`);
    showFeedback('ok', `✔ <b>Stage físico ativado: ${baseStage}</b>. Prossiga bipando as LPNs dos paletes.`);

    setTimeout(() => {
      isProcessingBarcode = false;
      focusScanner();
    }, 40);
    return;
  }

  // 2. AVISO CASO O OPERADOR BIPE O NÚMERO DO EMBARQUE
  if (code === activeEmbarque.embarque) {
    showFeedback('warn', `ℹ️ Você bipou o número do embarque (${code}). Bipe as LPNs dos paletes ou o código do Stage físico.`);
    sound.playWarning('Código do embarque');
    isProcessingBarcode = false;
    focusScanner();
    return;
  }

  // 3. BUSCA DA LPN NO EMBARQUE ATIVO
  let foundPallet = findPalletMatch(code);
  let stgFisico = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const cap = activeConference.capacity || 10;

  if (foundPallet) {
    if (!activeConference.stageSlots) activeConference.stageSlots = {};
    if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};

    // Quantos paletes já estão alocados neste stage físico (considerando duplados e fracionados)
    const countInStage = contarTotalPaletesNoStage(stgFisico, cap);
    const isStageFull = verificarStageRealmenteLotado(stgFisico, cap);

    // SE O STAGE ATUAL JÁ ATINGIU A CAPACIDADE MÁXIMA FÍSICA DE EMPILHAMENTO
    // OBRIGATÓRIO BIPAR O OUTRO ST OU SO!
    if (!activeConference.conferidos.has(foundPallet.palete) && isStageFull) {
      sound.playWarning('Stage lotado. Bipe a placa do novo Stage.');
      triggerCardFlash('pulse-err');

      const maxPerSlot = (window.modoEmpilhamento === '3x') ? 3 : (window.modoEmpilhamento === '2x' ? 2 : 1);
      const capTotal = cap * maxPerSlot;

      activeConference.stageLotadoBloqueio = {
        stageCheio: stgFisico,
        count: countInStage,
        cap: capTotal,
        pendingLpn: foundPallet.palete
      };

      const msgEl = document.getElementById('stageLotadoMsg');
      if (msgEl) {
        msgEl.innerHTML = `O Stage <b>${stgFisico}</b> atingiu a capacidade física máxima de <b>${countInStage}/${capTotal} paletes</b>.<br>Palete <code>${foundPallet.palete}</code> aguardando alocação.`;
      }

      showFeedback('err', `🛑 <b>STAGE ${stgFisico} LOTADO (${countInStage}/${capTotal} paletes):</b><br>Capacidade física máxima atingida! <b>OBRIGATÓRIO:</b> Bipe agora a placa do próximo Stage físico (<b>ST...</b> ou <b>SO...</b>) para continuar a conferência.`);
      abrirModalStageLotado();
      isProcessingBarcode = false;
      return;
    }

    const stgSistemico = normalizeStageName(foundPallet.stage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
    const isAdjacentRamification = (stgFisico !== stgSistemico && activeEmbarque.stages.some(s => normalizeStageName(s) === stgFisico));
    const isMatch = (stgSistemico === stgFisico) || (getBaseStage(stgSistemico) === getBaseStage(stgFisico)) || isAdjacentRamification;

    activeConference.lastComparison = {
      lpn: foundPallet.palete,
      sistemico: stgSistemico,
      fisico: stgFisico,
      isMatch: isMatch,
      isRamification: isAdjacentRamification,
      timestamp: timestampStr
    };

    if (activeConference.conferidos.has(foundPallet.palete)) {
      const confData = activeConference.conferidos.get(foundPallet.palete);
      sound.playWarning('Palete já conferido');
      triggerCardFlash('pulse-warn');
      showFeedback('warn', `LPN ${foundPallet.palete} já havia sido conferida às ${confData.timestamp}`);

      activeConference.historico.unshift({
        tipo: 'repetido',
        palete: foundPallet.palete,
        desc: foundPallet.desc_resumo,
        stageFisico: stgFisico,
        stageSistemico: stgSistemico,
        locCode: formatStageSlotDisplay(stgFisico, confData.slot || 1),
        isMatch: isMatch,
        timestamp: timestampStr
      });
      isProcessingBarcode = false;
      focusScanner();
      return;
    }

    const currentSlot = activeConference.activeSlot || 1;
    const locCode = formatStageSlotDisplay(stgFisico, currentSlot);

    // 4. VERIFICAÇÃO DE AMOSTRAGEM ALEATÓRIA DE 10% (CONTROLE DE QUALIDADE DHL)
    const amostraItem = amostragemAtiva.find(a => a.palete === foundPallet.palete);
    if (amostraItem && !amostraItem.auditado) {
      solicitarAuditoriaAmostragem(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, amostraItem);
      isProcessingBarcode = false;
      return;
    }

    // 5. FINALIZAÇÃO NORMAL DA ALOCAÇÃO
    finalizarAlocacaoPalete(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, false, '', foundPallet.qtd_total, '');
  } else {
    if (!activeConference.stageSlots) activeConference.stageSlots = {};
    if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};

    const countInStage = contarTotalPaletesNoStage(stgFisico, cap);
    const isStageFull = verificarStageRealmenteLotado(stgFisico, cap);

    if (isStageFull) {
      sound.playWarning('Stage lotado. Bipe a placa do novo Stage.');
      triggerCardFlash('pulse-err');

      const maxPerSlot = (window.modoEmpilhamento === '3x') ? 3 : (window.modoEmpilhamento === '2x' ? 2 : 1);
      const capTotal = cap * maxPerSlot;

      activeConference.stageLotadoBloqueio = {
        stageCheio: stgFisico,
        count: countInStage,
        cap: capTotal,
        pendingLpn: code
      };

      const msgEl = document.getElementById('stageLotadoMsg');
      if (msgEl) {
        msgEl.innerHTML = `O Stage <b>${stgFisico}</b> atingiu a capacidade física máxima de <b>${countInStage}/${capTotal} paletes</b>.<br>Palete <code>${code}</code> aguardando alocação.`;
      }

      showFeedback('err', `🛑 <b>STAGE ${stgFisico} LOTADO (${countInStage}/${capTotal} paletes):</b><br>Capacidade física máxima atingida! <b>OBRIGATÓRIO:</b> Bipe agora a placa do próximo Stage físico (<b>ST...</b> ou <b>SO...</b>).`);
      abrirModalStageLotado();
      isProcessingBarcode = false;
      return;
    }

    // Rastreamento na base inteira para identificar o embarque real do palete!
    const crossMatch = findPalletAcrossAllEmbarques(code);
    const embAuditado = activeEmbarque.embarque;
    const stageAuditado = stgFisico;

    let ticketDesc = '';
    let embCorreto = 'DESCONHECIDO';
    let stageCorreto = 'N/A';
    let skuResumo = 'Material não planejado';

    if (crossMatch) {
      embCorreto = crossMatch.embarque.embarque;
      stageCorreto = formatStages(crossMatch.embarque.stages);
      skuResumo = crossMatch.palete.desc_resumo || `SKU ${crossMatch.palete.sku_resumo}`;
      sound.playError('Divergência');
      ticketDesc = `Pertence ao Embarque ${embCorreto} (Stage ${stageCorreto}) - ${skuResumo}`;
    } else {
      sound.playError('Divergência');
      ticketDesc = 'Palete não planejado na expedição';
    }

    activeConference.lastComparison = {
      lpn: code,
      sistemico: stageCorreto,
      fisico: stgFisico,
      isMatch: false,
      timestamp: timestampStr
    };

    const alertRecord = {
      id: Date.now(),
      timestamp: timestampStr,
      dataCompleta: now.toLocaleString('pt-BR'),
      operador: activeConference.operador,
      lpn: code,
      stageFisico: stageAuditado,
      embarqueAuditado: embAuditado,
      embarqueCorreto: embCorreto,
      stageCorreto: stageCorreto,
      sku: skuResumo
    };

    saveInventoryAlert(alertRecord);

    activeConference.divergencias.unshift({
      paleteId: code,
      timestamp: timestampStr,
      detalhes: ticketDesc,
      alerta: alertRecord,
      stageFisico: stgFisico,
      stageSistemico: stageCorreto
    });

    // ALOCAÇÃO NO STAGE FÍSICO COM STATUS DIVERGENTE PARA MOSTRAR NO MAPA DO STAGE
    if (!activeConference.stageSlots) activeConference.stageSlots = {};
    if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};

    const currentSlot = activeConference.activeSlot || 1;
    const locCode = formatStageSlotDisplay(stgFisico, currentSlot);

    activeConference.stageSlots[stgFisico][currentSlot] = {
      slot: currentSlot,
      locCode: locCode,
      palete: code,
      lpn: code,
      stageFisico: stgFisico,
      stageSistemico: stageCorreto,
      isMatch: false,
      status: 'divergent',
      timestamp: timestampStr,
      details: ticketDesc
    };

    activeConference.activeSlot = calculateNextTargetSlot(stgFisico);

    triggerCardFlash('pulse-err');

    if (crossMatch) {
      showFeedback('err', `✖ <b>DIVERGÊNCIA (Vaga ${locCode}):</b> LPN ${code} NÃO pertence ao Embarque ${embAuditado}! Pertence ao Embarque ${embCorreto} (Stage ${stageCorreto}).`);
    } else {
      showFeedback('err', `✖ <b>DIVERGÊNCIA (Vaga ${locCode}):</b> LPN ${code} não localizada em nenhum embarque ativo!`);
    }

    activeConference.historico.unshift({
      tipo: 'erro',
      palete: code,
      stageFisico: stgFisico,
      stageSistemico: stageCorreto,
      locCode: locCode,
      isMatch: false,
      desc: ticketDesc,
      timestamp: timestampStr
    });

    // Sincronização On-Time de Divergência em Tempo Real
    if (window.DHL_SYNC && typeof window.DHL_SYNC.notifyDivergentScan === 'function') {
      window.DHL_SYNC.notifyDivergentScan(code, stgFisico, currentSlot, locCode, stageCorreto, ticketDesc, timestampStr);
    }
  }

  recordActiveConferenceToHistory('Em Andamento');
  persistActiveSession();
  renderStageSlotsGrid();
  updateUI();

  setTimeout(() => {
    isProcessingBarcode = false;
    focusScanner();
  }, 40);
}

/* =========================================================
   FINALIZAÇÃO DE ALOCAÇÃO DO PALETE NO STAGE FÍSICO
   ========================================================= */
function finalizarAlocacaoPalete(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, hasAuditDivergence, auditNotes, inputQtd, inputLote) {
  if (!activeConference.stageSlots) activeConference.stageSlots = {};
  if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};

  const stgSistemico = normalizeStageName(foundPallet.stage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
  const isDivergent = !isMatch || hasAuditDivergence;

  // 1. Suporte a empilhamento de paletes (duplados até 2, fracionados até 3 na mesma vaga)
  const existingSlot = activeConference.stageSlots[stgFisico][currentSlot];
  let paletesList = (existingSlot && existingSlot.paletes && Array.isArray(existingSlot.paletes)) ? [...existingSlot.paletes] : [];

  if (existingSlot && (!existingSlot.paletes || existingSlot.paletes.length === 0) && existingSlot.palete) {
    paletesList.push({
      slot: currentSlot,
      nivel: 1,
      locCode: existingSlot.locCode || locCode,
      palete: existingSlot.palete,
      lpn: existingSlot.lpn || existingSlot.palete,
      stageFisico: stgFisico,
      stageSistemico: existingSlot.stageSistemico || stgSistemico,
      isMatch: existingSlot.isMatch,
      isRamification: existingSlot.isRamification,
      status: existingSlot.status,
      timestamp: existingSlot.timestamp,
      auditDivergence: existingSlot.auditDivergence,
      auditNotes: existingSlot.auditNotes || '',
      qtdDigitada: existingSlot.qtdDigitada,
      loteDigitado: existingSlot.loteDigitado
    });
  }

  const existingPalIdx = paletesList.findIndex(p => p.lpn === foundPallet.palete || p.palete === foundPallet.palete);
  const novoNivel = existingPalIdx >= 0 ? (paletesList[existingPalIdx].nivel || 1) : (paletesList.length + 1);

  const novoItem = {
    slot: currentSlot,
    nivel: novoNivel,
    locCode: locCode,
    palete: foundPallet.palete,
    lpn: foundPallet.palete,
    stageFisico: stgFisico,
    stageSistemico: stgSistemico,
    isMatch: !isDivergent,
    isRamification: isAdjacentRamification,
    status: isDivergent ? 'divergent' : 'done',
    timestamp: timestampStr,
    auditDivergence: hasAuditDivergence,
    auditNotes: auditNotes || '',
    qtdDigitada: inputQtd,
    loteDigitado: inputLote
  };

  if (existingPalIdx >= 0) {
    paletesList[existingPalIdx] = novoItem;
  } else {
    paletesList.push(novoItem);
  }

  // Grava no slot físico do stage com suporte a múltiplos níveis
  activeConference.stageSlots[stgFisico][currentSlot] = {
    slot: currentSlot,
    locCode: locCode,
    palete: foundPallet.palete,
    lpn: foundPallet.palete,
    paletes: paletesList,
    totalPaletesNaVaga: paletesList.length,
    isDuplado: paletesList.length === 2,
    isFracionado: paletesList.length >= 3,
    stageFisico: stgFisico,
    stageSistemico: stgSistemico,
    isMatch: !isDivergent,
    isRamification: isAdjacentRamification,
    status: isDivergent ? 'divergent' : 'done',
    timestamp: timestampStr,
    auditDivergence: hasAuditDivergence,
    auditNotes: auditNotes || '',
    qtdDigitada: inputQtd,
    loteDigitado: inputLote
  };

  // 2. Grava em activeConference.conferidos com o nível correspondente
  activeConference.conferidos.set(foundPallet.palete, {
    timestamp: timestampStr,
    stageFisico: stgFisico,
    stage: stgFisico,
    slot: currentSlot,
    nivel: novoNivel,
    locCode: locCode,
    isMatch: !isDivergent,
    isRamification: isAdjacentRamification,
    isDivergent: isDivergent,
    status: isDivergent ? 'divergent' : 'done',
    auditNotes: auditNotes || '',
    qtdDigitada: inputQtd,
    loteDigitado: inputLote
  });

  // 3. Atualiza amostragem
  atualizarConferidosAmostragem();

  // 4. Se for divergência (ex: stage diferente do WMS ou auditoria reprovada)
  if (isDivergent) {
    sound.playError('Divergência');
    triggerCardFlash('pulse-err');

    let ticketDesc = '';
    if (hasAuditDivergence) {
      ticketDesc = `Amostragem 10% Divergente: ${auditNotes}`;
      showFeedback('err', `✖ <b>DIVERGÊNCIA DE AMOSTRAGEM (Vaga ${locCode}):</b> Palete <code>${foundPallet.palete}</code> - ${auditNotes}`);
    } else {
      ticketDesc = `Stage Físico (${stgFisico}) divergente do WMS (${stgSistemico})`;
      showFeedback('err', `✖ <b>DIVERGÊNCIA DE STAGE (Vaga ${locCode}):</b> Palete <code>${foundPallet.palete}</code> planejado para <b>${stgSistemico}</b>, mas colocado em <b>${stgFisico}</b>!`);
    }

    const alertRecord = {
      id: Date.now(),
      timestamp: timestampStr,
      dataCompleta: new Date().toLocaleString('pt-BR'),
      operador: activeConference.operador,
      lpn: foundPallet.palete,
      stageFisico: stgFisico,
      embarqueAuditado: activeEmbarque.embarque,
      embarqueCorreto: activeEmbarque.embarque,
      stageCorreto: stgSistemico,
      sku: foundPallet.sku_resumo || 'Material'
    };
    saveInventoryAlert(alertRecord);

    activeConference.divergencias.unshift({
      paleteId: foundPallet.palete,
      timestamp: timestampStr,
      detalhes: ticketDesc,
      alerta: alertRecord,
      stageFisico: stgFisico,
      stageSistemico: stgSistemico
    });

    activeConference.historico.unshift({
      tipo: 'erro',
      palete: foundPallet.palete,
      desc: foundPallet.desc_resumo || foundPallet.sku_resumo,
      stageFisico: stgFisico,
      stageSistemico: stgSistemico,
      locCode: locCode,
      isMatch: false,
      timestamp: timestampStr
    });
  } else {
    // SUCESSO - Palete OK ou Ramificado
    if (isAdjacentRamification) {
      sound.playRamification();
      triggerCardFlash('pulse-warn');
      showFeedback('warn', `⚡ <b>RAMIFICAÇÃO:</b> Palete <code>${foundPallet.palete}</code> alocado na extensão <b>${stgFisico}</b> (Vaga <b>${locCode}</b>)`);
    } else if (paletesList.length === 2) {
      sound.playSuccess();
      triggerCardFlash('pulse-ok');
      showFeedback('ok', `🥞 <b>PALETE DUPLADO CONFERIDO!</b> Vaga <b>${locCode}</b> (Nível 2 - Empilhado) • LPN <code>${foundPallet.palete}</code>`);
    } else if (paletesList.length >= 3) {
      sound.playSuccess();
      triggerCardFlash('pulse-ok');
      showFeedback('ok', `📦 <b>PALETE FRACIONADO CONFERIDO!</b> Vaga <b>${locCode}</b> (Nível ${paletesList.length}/3) • LPN <code>${foundPallet.palete}</code>`);
    } else {
      sound.playSuccess();
      triggerCardFlash('pulse-ok');
      showFeedback('ok', `✔ <b>LPN ${foundPallet.palete} CONFERIDA!</b> Vaga <b>${locCode}</b> (Nível 1 - Chão)`);
    }

    activeConference.historico.unshift({
      tipo: 'ok',
      palete: foundPallet.palete,
      desc: foundPallet.desc_resumo || foundPallet.sku_resumo,
      stageFisico: stgFisico,
      stageSistemico: stgSistemico,
      locCode: locCode,
      isMatch: true,
      timestamp: timestampStr
    });
  }

  // 5. Avança para a próxima vaga física no stage
  activeConference.activeSlot = calculateNextTargetSlot(stgFisico);

  recordActiveConferenceToHistory('Em Andamento');
  persistActiveSession();
  renderStageSlotsGrid();
  updateUI();

  // Sincronização On-Time em Tempo Real (GitHub / Nuvem / Outros Operadores)
  if (window.DHL_SYNC && typeof window.DHL_SYNC.notifyScan === 'function') {
    window.DHL_SYNC.notifyScan(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, hasAuditDivergence, auditNotes, novoNivel);
  }

  setTimeout(() => {
    isProcessingBarcode = false;
    focusScanner();
  }, 40);
}

/* =========================================================
   MÓDULO DE AUDITORIA AMOSTRAL 10% (QUANTIDADE E LOTE)
   ========================================================= */
let pendingAuditInfo = null;

function solicitarAuditoriaAmostragem(foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, amostraItem) {
  pendingAuditInfo = {
    foundPallet,
    stgFisico,
    currentSlot,
    locCode,
    isMatch,
    isAdjacentRamification,
    timestampStr,
    amostraItem,
    tentativa: 1
  };

  sound.playWarning('Amostragem de Qualidade');
  triggerCardFlash('pulse-warn');

  const infoEl = document.getElementById('amostraAuditPalletInfo');
  if (infoEl) {
    const sku = amostraItem.sku || foundPallet.sku_resumo || (foundPallet.itens && foundPallet.itens[0] ? foundPallet.itens[0].sku : 'SKU');
    const desc = foundPallet.desc_resumo || '';
    infoEl.innerHTML = `
      <div style="font-size: 0.85rem; color: #334155; line-height: 1.5;">
        <div><b>LPN Sorteada:</b> <code style="font-size: 0.95rem; font-weight:800; color:#0F172A;">${foundPallet.palete}</code></div>
        <div><b>Stage Físico:</b> ${stgFisico} • <b>Vaga Alocada:</b> <span style="color:#0284C7; font-weight:800;">${locCode}</span></div>
        <div><b>Material:</b> ${sku} ${desc ? '— ' + desc : ''}</div>
      </div>
    `;
  }

  const numTentEl = document.getElementById('amostraNumTentativa');
  if (numTentEl) numTentEl.textContent = '1';

  const errFeed = document.getElementById('amostraErroFeedback');
  if (errFeed) {
    errFeed.style.display = 'none';
    errFeed.innerHTML = '';
  }

  const inpQtd = document.getElementById('auditInputQtd');
  if (inpQtd) inpQtd.value = '';

  const inpLote = document.getElementById('auditInputLote');
  if (inpLote) inpLote.value = '';

  const modal = document.getElementById('modalAmostragemQtdLote');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => {
      if (inpQtd) inpQtd.focus();
    }, 120);
  }
}

window.confirmarAmostraAudit = function(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!pendingAuditInfo) {
    cancelarAmostraAudit();
    return;
  }

  const inpQtd = document.getElementById('auditInputQtd');
  const inpLote = document.getElementById('auditInputLote');
  const inputQtd = inpQtd ? parseInt(inpQtd.value, 10) : 0;
  const inputLote = inpLote ? inpLote.value.trim().toUpperCase() : '';

  if (!inputQtd || isNaN(inputQtd) || inputQtd <= 0) {
    alert('Por favor, informe a quantidade física contada no palete.');
    if (inpQtd) inpQtd.focus();
    return;
  }

  if (!inputLote) {
    alert('Por favor, informe o Lote físico gravado no palete ou caixas.');
    if (inpLote) inpLote.focus();
    return;
  }

  const { foundPallet, stgFisico, currentSlot, locCode, isMatch, isAdjacentRamification, timestampStr, amostraItem } = pendingAuditInfo;
  const tentativaAtual = pendingAuditInfo.tentativa || 1;

  // Comparação com WMS
  const expectedQtd = foundPallet.qtd_total || 0;
  let expectedLote = (amostraItem.lote || '').trim().toUpperCase();
  if (!expectedLote && foundPallet.itens && foundPallet.itens.length > 0) {
    expectedLote = (foundPallet.itens[0].lote || '').trim().toUpperCase();
  }

  let hasAuditDivergence = false;
  let divergenceReasons = [];

  if (expectedQtd > 0 && inputQtd !== expectedQtd) {
    hasAuditDivergence = true;
    divergenceReasons.push(`Qtd contada (${inputQtd} cx) ≠ WMS (${expectedQtd} cx)`);
  }

  if (expectedLote && inputLote !== expectedLote) {
    hasAuditDivergence = true;
    divergenceReasons.push(`Lote informado (${inputLote}) ≠ WMS (${expectedLote})`);
  }

  // Se houver erro e ainda não atingiu a 3ª tentativa: permite tentar novamente!
  if (hasAuditDivergence && tentativaAtual < 3) {
    sound.playWarning('Contagem divergente');
    pendingAuditInfo.tentativa = tentativaAtual + 1;

    const numTentEl = document.getElementById('amostraNumTentativa');
    if (numTentEl) numTentEl.textContent = String(pendingAuditInfo.tentativa);

    const errFeed = document.getElementById('amostraErroFeedback');
    if (errFeed) {
      errFeed.style.display = 'block';
      errFeed.innerHTML = `
        <div style="font-weight: 800; margin-bottom: 4px;">⚠️ Divergência na Tentativa ${tentativaAtual} de 3:</div>
        <div>${divergenceReasons.join('<br>')}</div>
        <div style="margin-top: 6px; font-weight: 700; color: #B91C1C;">
          Reconte o palete fisicamente e confira a etiqueta de lote. Tentativa ${pendingAuditInfo.tentativa} liberada!
        </div>
      `;
    }

    if (inpQtd) inpQtd.value = '';
    if (inpLote) inpLote.value = '';
    setTimeout(() => {
      if (inpQtd) inpQtd.focus();
    }, 50);
    return;
  }

  // Se errou na 3ª tentativa: aciona o inventário obrigatoriamente!
  let notes = '';
  if (hasAuditDivergence && tentativaAtual >= 3) {
    sound.playError('Acionar Inventário');
    notes = `🛑 BLOQUEIO 3x TENTATIVAS - ACIONAR INVENTÁRIO: ${divergenceReasons.join(' | ')}`;
    showToast(`🛑 DIVERGÊNCIA CRÍTICA (3/3): Palete bloqueado! Chamado enviado para o Inventário.`);
    if (typeof showFeedback === 'function') {
      showFeedback('error', `🛑 <b>AUDITORIA AMOSTRAL FALHOU (3ª Tentativa)!</b><br>Palete ${foundPallet.palete} retido para inventário físico.`);
    }
  } else {
    notes = hasAuditDivergence ? divergenceReasons.join(' | ') : '✔ Auditoria 100% Conforme';
  }

  amostraItem.auditado = true;
  amostraItem.qtdContada = inputQtd;
  amostraItem.loteContado = inputLote;
  amostraItem.divergente = hasAuditDivergence;
  amostraItem.acionarInventario = (hasAuditDivergence && tentativaAtual >= 3);

  const modal = document.getElementById('modalAmostragemQtdLote');
  if (modal) modal.style.display = 'none';

  pendingAuditInfo = null;

  finalizarAlocacaoPalete(
    foundPallet,
    stgFisico,
    currentSlot,
    locCode,
    isMatch && !hasAuditDivergence,
    isAdjacentRamification,
    timestampStr,
    hasAuditDivergence,
    notes,
    inputQtd,
    inputLote
  );
};

window.cancelarAmostraAudit = function() {
  const modal = document.getElementById('modalAmostragemQtdLote');
  if (modal) modal.style.display = 'none';
  pendingAuditInfo = null;
  isProcessingBarcode = false;
  focusScanner();
};

/* =========================================================
   BLOQUEIO OBRIGATÓRIO DE STAGE LOTADO
   ========================================================= */
function abrirModalStageLotado() {
  const modal = document.getElementById('modalStageLotado');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => {
      const inp = document.getElementById('inputScanNewStage');
      if (inp) {
        inp.value = '';
        inp.focus();
      }
    }, 120);
  }
}

function fecharModalStageLotado() {
  const modal = document.getElementById('modalStageLotado');
  if (modal) modal.style.display = 'none';
  focusScanner();
}

window.fecharModalStageLotado = fecharModalStageLotado;

window.handleNewStageInputKey = function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = (e.target.value || '').trim();
    if (!val) return;
    fecharModalStageLotado();
    processBarcode(val);
  }
};

window.confirmarNovoStageManual = function() {
  const inp = document.getElementById('inputScanNewStage');
  const val = (inp?.value || '').trim();
  if (!val) {
    alert('Informe ou bipe o código do novo Stage (ex: ST02 ou SO002).');
    inp?.focus();
    return;
  }
  fecharModalStageLotado();
  processBarcode(val);
};

window.copiarChamadoInventario = function(lpn, stageOndeEstava, embAuditado, embCorreto, stageCorreto, sku) {
  const agora = new Date().toLocaleString('pt-BR');
  const operador = activeConference?.operador || 'Operador DHL';

  let msg = `[INVENTÁRIO DHL - DIVERGÊNCIA DE STAGE]\n` +
            `• Data/Hora: ${agora}\n` +
            `• Operador: ${operador}\n` +
            `• LPN Bipada: ${lpn}\n` +
            `• Stage Físico: ${stageOndeEstava} (Embarque Auditado: ${embAuditado})\n`;

  if (embCorreto && embCorreto !== 'DESCONHECIDO') {
    msg += `• Embarque Correto (Destino WMS): ${embCorreto}\n` +
           `• Stage Correto: ${stageCorreto}\n` +
           `• Material / SKU: ${sku}\n` +
           `• Ação: Recolher palete do Stage ${stageOndeEstava} e levar para o Stage ${stageCorreto}.`;
  } else {
    msg += `• Diagnóstico: Palete não cadastrado em nenhuma expedição ativa.\n` +
           `• Ação: Segregar palete para contagem física pelo inventário.`;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(msg).then(() => {
      showToast('✔ Informações da ocorrência copiadas!');
    }).catch(() => {
      prompt('Copie os dados da ocorrência:', msg);
    });
  } else {
    prompt('Copie os dados da ocorrência:', msg);
  }
};

function triggerCardFlash(className) {
  const card = document.getElementById('scannerCard');
  if (!card) return;
  card.classList.remove('pulse-ok', 'pulse-warn', 'pulse-err');
  void card.offsetWidth;
  card.classList.add(className);
  setTimeout(() => { card.classList.remove(className); }, 600);
}

function showFeedback(type, message) {
  const banner = document.getElementById('feedbackBanner');
  const icon = document.getElementById('feedbackIcon');
  const text = document.getElementById('feedbackText');
  if (!banner) return;

  banner.className = `clean-feedback ${type}`;
  icon.textContent = type === 'ok' ? '✔' : type === 'warn' ? '⚠' : '✖';
  text.textContent = message;
  banner.style.display = 'flex';
}

function hideFeedback() {
  const banner = document.getElementById('feedbackBanner');
  if (banner) banner.style.display = 'none';
}

/* =========================================================
   MÓDULO DE AMOSTRAGEM 10% — Controle de Qualidade
   ========================================================= */
let amostragemAtiva = []; // Array de { palete, sku, lote, stage, stage_label, conferido }
let amostragemPanelOpen = false;

function calcularAmostragem() {
  if (!activeEmbarque || !activeEmbarque.paletes) return;
  const paletes = activeEmbarque.paletes;
  const n = paletes.length;
  const qtdAmostra = Math.max(1, Math.ceil(n * 0.10)); // Mínimo 1, 10% arredondado para cima

  // Fisher-Yates shuffle para seleção aleatória sem repetição
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const selecionados = indices.slice(0, qtdAmostra);

  amostragemAtiva = selecionados.map(idx => {
    const p = paletes[idx];
    const firstItem = (p.itens && p.itens.length > 0) ? p.itens[0] : null;
    return {
      palete: p.palete,
      sku: firstItem ? (firstItem.sku || p.sku_resumo || '') : (p.sku_resumo || ''),
      lote: firstItem ? (firstItem.lote || '') : '',
      qtd: p.qtd_total || 0,
      stage_label: p.stage || formatStages(activeEmbarque.stages),
      desc: p.desc_resumo || '',
      conferido: false,
      auditado: false,
      divergente: false
    };
  });
}

function atualizarConferidosAmostragem() {
  if (!activeConference) return;
  amostragemAtiva.forEach(item => {
    item.conferido = activeConference.conferidos.has(item.palete);
    if (item.conferido) {
      const conf = activeConference.conferidos.get(item.palete);
      if (conf && (conf.status === 'divergent' || conf.isDivergent)) {
        item.divergente = true;
      }
    }
  });
}

function renderAmostragem() {
  const card = document.getElementById('amostragemCard');
  if (!card) return;

  if (!activeEmbarque || amostragemAtiva.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  atualizarConferidosAmostragem();

  const doneCount = amostragemAtiva.filter(a => a.conferido && !a.divergente).length;
  const divCount = amostragemAtiva.filter(a => a.divergente).length;
  const total = amostragemAtiva.length;

  const pill = document.getElementById('amostragemProgressPill');
  if (pill) {
    pill.textContent = `${doneCount}/${total}`;
    pill.className = 'amostragem-pill' + ((doneCount === total && divCount === 0) ? ' done' : (doneCount > 0 || divCount > 0) ? ' partial' : '');
  }

  const statusEl = document.getElementById('amostragemStatus');
  if (statusEl) {
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    if (doneCount === total && divCount === 0) {
      statusEl.textContent = `✔ Amostragem concluída! ${doneCount}/${total} paletes conferidos (${pct}%)`;
    } else if (divCount > 0) {
      statusEl.innerHTML = `⚠ <b>${divCount} divergência(s) em amostragem!</b> • ${doneCount}/${total} validados (${pct}%)`;
    } else {
      statusEl.textContent = `${doneCount} de ${total} paletes amostrados conferidos (${pct}%) • ${total - doneCount} pendentes`;
    }
  }

  const list = document.getElementById('amostragemList');
  if (list) {
    list.innerHTML = amostragemAtiva.map((item, idx) => {
      const cls = item.divergente ? 'amostra-divergente' : (item.conferido ? 'amostra-ok' : 'amostra-pendente');
      const icon = item.divergente ? '✖' : (item.conferido ? '✔' : '⏳');
      const auditExtra = item.auditado ? ` • [Contado: ${item.qtdContada} cx | Lote: ${item.loteContado}]` : '';
      const details = [item.sku, item.lote ? `Lote: ${item.lote}` : '', item.stage_label].filter(Boolean).join(' • ');
      return `
        <div class="amostragem-item ${cls}">
          <span class="amostra-check">${icon}</span>
          <span class="amostra-lpn">${item.palete}</span>
          <span class="amostra-details">${details}${auditExtra}</span>
        </div>
      `;
    }).join('');
  }
}

window.toggleAmostragemPanel = function() {
  amostragemPanelOpen = !amostragemPanelOpen;
  const body = document.getElementById('amostragemBody');
  const btn = document.getElementById('btnAmostragemToggle');
  if (body) body.classList.toggle('open', amostragemPanelOpen);
  if (btn) btn.classList.toggle('open', amostragemPanelOpen);
};

window.gerarNovaAmostragem = function() {
  calcularAmostragem();
  renderAmostragem();
  showToast(`🎲 Nova amostragem gerada: ${amostragemAtiva.length} paletes selecionados (10% da carga).`);
};

/* =========================================================
   MÓDULO DE CONSOLIDAÇÃO — Tela Dedicada (Aba Separada)
   Analisa TODO o embarque, agrupa por SKU+Lote, calcula
   economia de espaço e gera roteirização de stages.
   ========================================================= */
let consFilterAtivo = 'todos';
let consSearchAtivo = '';
let consGruposData = []; // Dados calculados para renderização
let embarqueConsolidacaoAtivo = null; // Embarque selecionado na tela de consolidação

// ---- Core: Analisa o embarque inteiro e agrupa por SKU+Lote ----
function analisarConsolidacao(targetEmb = null) {
  const emb = targetEmb || embarqueConsolidacaoAtivo || activeEmbarque;
  if (!emb || !emb.paletes) return [];

  // Mapeamento sequencial de Vagas (A, B, C...) por Stage em todo o embarque
  // Garante que se houver múltiplos paletes no mesmo stage, o 1º seja Vaga A, 2º Vaga B, 3º Vaga C...
  const stagePalletCount = {};
  const palletSlotInfo = new Map();

  emb.paletes.forEach(p => {
    const rawStage = normalizeStageName(p.stage || (emb.stages && emb.stages[0]) || 'SO001');
    stagePalletCount[rawStage] = (stagePalletCount[rawStage] || 0) + 1;
    const slotIdx = stagePalletCount[rawStage];
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    const slotLetter = letters[(slotIdx - 1) % letters.length] || String(slotIdx);
    const locCode = formatStageSlotDisplay(rawStage, slotIdx);

    palletSlotInfo.set(p.palete, {
      slotNumber: slotIdx,
      slotLetter: slotLetter,
      locCode: locCode,
      stage: rawStage
    });
  });

  // Mapa: chave "SKU" -> lista de paletes (agrupando por SKU para unificação de parciais)
  const mapa = new Map();

  emb.paletes.forEach(p => {
    const firstItem = (p.itens && p.itens.length > 0) ? p.itens[0] : null;
    const sku = (firstItem ? (firstItem.sku || '') : '') || p.sku_resumo || '';
    const lote = (firstItem ? (firstItem.lote || '') : '');
    const chave = sku || `__SEM_SKU__|${p.palete}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        sku: sku || '(SKU não informado)',
        lote: lote || '',
        lotes: new Set(),
        desc: p.desc_resumo || '',
        paletes: []
      });
    }

    if (lote) mapa.get(chave).lotes.add(lote);

    const slotInfo = palletSlotInfo.get(p.palete) || {
      slotNumber: 1,
      slotLetter: 'A',
      locCode: formatStageSlotDisplay(p.stage || '', 1),
      stage: normalizeStageName(p.stage || (emb.stages && emb.stages[0]) || '')
    };

    mapa.get(chave).paletes.push({
      lpn: p.palete,
      stage: slotInfo.stage,
      stage_raw: p.stage || '',
      slotNumber: slotInfo.slotNumber,
      slotLetter: slotInfo.slotLetter,
      locCode: slotInfo.locCode,
      lote: lote || '',
      qtd: p.qtd_total || (firstItem && firstItem.qtd) || 0,
      desc: p.desc_resumo || '',
      conferido: activeConference ? activeConference.conferidos.has(p.palete) : false
    });
  });

  // Converte mapa em array de grupos com metadados
  const grupos = [];
  mapa.forEach((grupo, chave) => {
    const paletes = grupo.paletes;
    const totalPaletes = paletes.length;
    const totalUnidades = paletes.reduce((s, p) => s + p.qtd, 0);
    const isDuplicado = totalPaletes > 1;

    // Stages únicos onde este SKU está alocado
    const stagesUnicos = [...new Set(paletes.map(p => p.stage).filter(Boolean))];
    const stagesOrdenados = stagesUnicos.sort();

    // Capacidade padrão de um palete cheio (40 caixas ou maior palete)
    const capPalete = Math.max(40, ...paletes.map(p => p.qtd || 0));
    const paletesConsolidados = Math.max(1, Math.ceil(totalUnidades / capPalete));
    const economiaPaletes = Math.max(0, totalPaletes - paletesConsolidados);

    // Calcular cubagem de stages
    const capPorStage = 10;
    const stagesMinimos = Math.max(1, Math.ceil(paletesConsolidados / capPorStage));
    const economiaStages = Math.max(0, stagesUnicos.length - stagesMinimos);

    const lotesList = Array.from(grupo.lotes || []);
    const loteDisplay = lotesList.length > 1 ? `${lotesList.length} lotes (${lotesList.slice(0, 2).join(', ')}...)` : (lotesList[0] || grupo.lote || '');

    // Gerar plano de roteirização para este grupo
    const plano = gerarPlanoGrupo(grupo.sku, loteDisplay, paletes, stagesOrdenados, capPorStage, capPalete, paletesConsolidados);

    grupos.push({
      chave,
      sku: grupo.sku,
      lote: loteDisplay,
      desc: grupo.desc,
      paletes,
      totalPaletes,
      totalUnidades,
      isDuplicado,
      paletesConsolidados,
      capPalete,
      stagesAtivos: stagesOrdenados,
      stagesMinimos,
      economiaStages,
      economiaPaletes,
      plano
    });
  });

  // Ordenar: duplicados primeiro, depois por nº de paletes desc
  grupos.sort((a, b) => {
    if (a.isDuplicado !== b.isDuplicado) return b.isDuplicado ? 1 : -1;
    return b.totalPaletes - a.totalPaletes;
  });

  return grupos;
}

// ---- Gera o plano passo-a-passo para um grupo de SKU ----
function gerarPlanoGrupo(sku, lote, paletes, stagesAtivos, capPorStage, capPalete = 40, paletesConsolidados = null) {
  const steps = [];
  if (paletes.length <= 1) {
    steps.push({ num: 1, texto: `Palete único — Nenhuma ação necessária. Stage atual: <b>${stagesAtivos[0] || '—'}</b>`, ok: true });
    return steps;
  }

  const stageDestino = stagesAtivos[0] || 'SO???';
  const qtdTotal = paletes.length;
  const totalCx = paletes.reduce((s, p) => s + (p.qtd || 0), 0);
  const nFinais = paletesConsolidados || Math.max(1, Math.ceil(totalCx / capPalete));
  const economia = Math.max(0, qtdTotal - nFinais);

  if (economia > 0) {
    steps.push({
      num: 1,
      texto: `📦 <b>Consolidação Física (Merge):</b> Juntar caixas dos ${qtdTotal} paletes parciais de SKU <b>${sku}</b>${lote ? ' (' + lote + ')' : ''} no Stage <b>${stageDestino}</b>. Os <b>${qtdTotal} paletes viram ${nFinais} palete(s)</b> (${totalCx} cx no total), liberando <b>${economia} vaga(s)</b>!`,
      ok: false
    });
  }

  // Paletes que já estão no stage de destino vs. os que precisam mover
  const paraMovar = paletes.filter(p => p.stage !== stageDestino);
  if (paraMovar.length > 0) {
    paraMovar.forEach((p, i) => {
      steps.push({
        num: steps.length + 1,
        texto: `↳ Transferir/juntar SKU <b>${sku}</b> (${p.qtd} cx) de <b>Stage ${p.stage || '?'}</b> ➔ <b>Stage Destino ${stageDestino}</b> <span style="color:#64748B; font-size:0.78rem;">(Palete ${p.lpn})</span>`,
        ok: p.stage === stageDestino
      });
    });
  } else if (economia === 0) {
    steps.push({
      num: 1,
      texto: `✔ Todos os ${qtdTotal} paletes do SKU <b>${sku}</b> já estão concentrados no Stage <b>${stageDestino}</b> — Carga já agrupada!`,
      ok: true
    });
  }

  steps.push({
    num: steps.length + 1,
    texto: `Registrar no WMS: carga consolidada em <b>${nFinais} palete(s)</b> no Stage <b>${stageDestino}</b>`,
    ok: null
  });

  return steps;
}

// ---- Alternar visibilidade da Roteirização Global ----
function toggleRoteirizacaoGlobal() {
  const body = document.getElementById('consRoteirizacaoBody');
  if (body) {
    body.classList.toggle('open');
  }
}

// ---- Gera roteirização global de todos os grupos que precisam consolidar e a rota física sequencial (A, B, C...) ----
function gerarRoteirizacaoGlobal(grupos, emb = null) {
  const steps = [];
  let stepIndex = 1;

  // 1. Rota de Conferência Sequencial por Stage (Ordem A, B, C...)
  if (grupos && grupos.length > 0) {
    const paletesPorStage = {};
    const allPaletes = [];
    grupos.forEach(g => {
      g.paletes.forEach(p => {
        allPaletes.push({
          ...p,
          sku: g.sku,
          lote: g.lote
        });
      });
    });

    allPaletes.forEach(p => {
      const stg = p.stage || 'Sem Stage';
      if (!paletesPorStage[stg]) paletesPorStage[stg] = [];
      paletesPorStage[stg].push(p);
    });

    Object.entries(paletesPorStage).sort((a, b) => a[0].localeCompare(b[0])).forEach(([stg, plist]) => {
      plist.sort((a, b) => (a.slotNumber || 1) - (b.slotNumber || 1));
      
      const sequencia = plist.map((p, idx) => {
        const orderNum = idx + 1;
        return `<b>${orderNum}º</b> Vaga <b>${p.slotLetter}</b> (<span style="color:#0F172A; font-weight:800;">SKU ${p.sku}</span> • <code style="color:#0284C7; font-weight:800;">${p.locCode}</code> • <b>${p.qtd} cx</b>)`;
      }).join(' <span style="color:#6D28D9; font-weight:900; margin:0 6px;">➔</span> ');

      steps.push({
        num: stepIndex++,
        tipo: 'rota',
        stage: stg,
        qtd: plist.length,
        texto: `🧭 <b>Ordem da Rota no Stage ${stg}</b> (${plist.length} ${plist.length === 1 ? 'palete' : 'paletes'}): ${sequencia}`
      });
    });
  }

  // 2. Ações de Consolidação entre Stages Diferentes (para SKUs duplicados)
  const grupoDupl = grupos.filter(g => g.isDuplicado && g.stagesAtivos.length > 1);
  if (grupoDupl.length > 0) {
    const movimentos = [];
    grupoDupl.forEach(g => {
      const dest = g.stagesAtivos[0];
      g.paletes.forEach(p => {
        if (p.stage !== dest) {
          movimentos.push({ lpn: p.lpn, de: p.stage, para: dest, sku: g.sku, lote: g.lote });
        }
      });
    });

    // Agrupar movimentos por stage de destino para otimizar o trajeto
    const porDestino = {};
    movimentos.forEach(m => {
      if (!porDestino[m.para]) porDestino[m.para] = [];
      porDestino[m.para].push(m);
    });

    Object.entries(porDestino).sort((a, b) => a[0].localeCompare(b[0])).forEach(([dest, mvs]) => {
      const origens = [...new Set(mvs.map(m => m.de))].join(', ');
      const skus = [...new Set(mvs.map(m => `SKU ${m.sku}${m.lote ? '/Lote ' + m.lote : ''}`))].join(', ');
      steps.push({
        num: stepIndex++,
        tipo: 'consolidacao',
        stage: dest,
        qtd: mvs.length,
        texto: `📦 <b>Consolidação Física por SKU:</b> Mover <b>${mvs.length} palete(s) do ${skus}</b> de <span class="cons-step-stage-badge">${origens}</span> ➔ Stage Destino <span class="cons-step-stage-badge">${dest}</span>`
      });
    });
  }

  return steps;
}

// ---- Renderização da Tela de Consolidação ----
function renderConsolidacao() {
  const container = document.getElementById('consGruposContainer');
  if (!container) return;

  const grupos = consGruposData;

  // Atualizar KPIs
  const totalPaletes = grupos.reduce((s, g) => s + g.totalPaletes, 0);
  const nDuplicados = grupos.filter(g => g.isDuplicado).length;
  const nConsolidaveis = grupos.filter(g => g.isDuplicado && (g.economiaPaletes > 0 || g.stagesAtivos.length > 1)).reduce((s, g) => s + g.totalPaletes, 0);
  const economia = grupos.reduce((s, g) => s + (g.economiaPaletes || 0), 0);

  document.getElementById('consKpiTotal').textContent = totalPaletes;
  document.getElementById('consKpiDuplicados').textContent = nDuplicados;
  document.getElementById('consKpiConsolidaveis').textContent = nConsolidaveis;
  const kpiEco = document.getElementById('consKpiEconomia');
  if (kpiEco) kpiEco.textContent = economia + ' paletes';
  const curEmb = embarqueConsolidacaoAtivo || activeEmbarque;
  document.getElementById('consKpiEmbarque').textContent = curEmb ? curEmb.embarque : '—';

  // Roteirização Global
  const routeGlobal = gerarRoteirizacaoGlobal(grupos, curEmb);
  const routeSec = document.getElementById('consRoteirizacaoGlobal');
  const routeBody = document.getElementById('consRoteirizacaoBody');
  if (routeSec && routeBody) {
    if (routeGlobal && routeGlobal.length > 0) {
      routeSec.style.display = '';
      routeBody.classList.add('open');
      routeBody.innerHTML = routeGlobal.map(s => `
        <div class="cons-route-step-global">
          <span class="cons-step-num-global">${s.num}</span>
          <span>${s.texto}</span>
        </div>
      `).join('');
    } else {
      routeSec.style.display = 'none';
    }
  }

  // Filtrar grupos
  let filtered = grupos;
  if (consFilterAtivo === 'duplicado') filtered = grupos.filter(g => g.isDuplicado);
  if (consFilterAtivo === 'unico') filtered = grupos.filter(g => !g.isDuplicado);
  if (consSearchAtivo) {
    const q = consSearchAtivo.toLowerCase();
    filtered = filtered.filter(g =>
      g.sku.toLowerCase().includes(q) ||
      g.lote.toLowerCase().includes(q) ||
      g.desc.toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="cons-empty-state">
        <div class="cons-empty-icon">📦</div>
        <div class="cons-empty-title">Nenhum grupo encontrado</div>
        <div class="cons-empty-desc">Altere os filtros ou verifique se o embarque está carregado.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((g, gIdx) => {
    const tipo = g.isDuplicado ? 'duplicado' : 'unico';
    const icon = g.isDuplicado ? '⚠️' : '✔';
    const stagesStr = g.stagesAtivos.join(', ') || '—';
    const badgeLabel = g.isDuplicado
      ? `${g.totalPaletes} paletes ➔ ${g.paletesConsolidados} palete(s) (${g.economiaPaletes > 0 ? `Economia de ${g.economiaPaletes} palete(s)` : 'Consolidar'})`
      : `${g.totalPaletes} palete — Único`;

    const paletesHtml = g.paletes.map((p, pIdx) => {
      const statusCls = p.conferido ? 'conferido' : 'pendente';
      const statusTxt = p.conferido ? '✔ Conferido' : '⏳ Pendente';
      const slotNumber = p.slotNumber || ((pIdx % 10) + 1);
      const slotLetter = p.slotLetter || (['A','B','C','D','E','F','G','H','I','J'][(slotNumber - 1) % 10] || 'A');
      const locDisplay = p.locCode || formatStageSlotDisplay(p.stage, slotNumber);
      return `
        <tr>
          <td><b style="color:#0F172A; font-size:0.85rem;">SKU ${g.sku}</b></td>
          <td>
            <span class="cons-stage-chip" 
                  onclick="mostrarLocalizacaoStage('${p.stage}', ${slotNumber}, '${p.lpn}', '${g.sku}', '${g.lote || ''}', ${p.qtd})" 
                  title="Clique para ver o mapa visual deste stage e a vaga exata do palete">
              📍 ${locDisplay} (Vaga ${slotLetter}) <span class="chip-view-hint">🔍 Ver Local</span>
            </span>
          </td>
          <td><b style="color:#059669;">${p.qtd} cx</b></td>
          <td><span class="cons-lpn-mono" style="font-size:0.75rem; color:#64748B;">${p.lpn}</span></td>
          <td><span class="cons-status-badge ${statusCls}">${statusTxt}</span></td>
        </tr>
      `;
    }).join('');

    const planoHtml = g.plano.map(step => {
      const cor = step.ok === true ? '#00A650' : step.ok === null ? '#6D28D9' : '#FF7A00';
      return `
        <div class="cons-plano-step">
          <span class="cons-plano-step-num" style="background:${cor};">${step.num}</span>
          <span>${step.texto}</span>
        </div>
      `;
    }).join('');

    const economiaHtml = g.isDuplicado ? `
      <span class="cons-economia-chip">
        💡 Concentrar em ${g.stagesMinimos} stage(s) × ${Math.min(g.totalPaletes, 10)} posições
        ${g.economiaStages > 0 ? `• Libera ${g.economiaStages} stage(s)` : ''}
      </span>
    ` : '';

    return `
      <div class="cons-grupo-card ${tipo}" id="consGrupo_${gIdx}">
        <div class="cons-grupo-header" onclick="toggleGrupoConsolidacao(${gIdx})">
          <div class="cons-grupo-header-left">
            <span class="cons-grupo-icon">${icon}</span>
            <div>
              <div class="cons-grupo-sku" style="font-size: 1.05rem; font-weight: 900; color: #1E3A8A;">📦 MATERIAL / SKU: ${g.sku}</div>
              ${g.lote ? `<div class="cons-grupo-lote">Lote: ${g.lote}</div>` : ''}
              <div class="cons-grupo-desc">${g.desc}</div>
            </div>
          </div>
          <div class="cons-grupo-header-right">
            <span class="cons-grupo-qtd-total" 
                  onclick="event.stopPropagation(); mostrarLocalizacaoStage('${g.stagesAtivos[0] || 'SO004'}', 1, '', '${g.sku}', '${g.lote || ''}', 0)" 
                  title="Clique para localizar este stage visualmente no pátio" 
                  style="cursor: pointer; text-decoration: underline dotted; color: #0284C7; font-weight: 800;">
              📍 ${stagesStr} 🔍
            </span>
            <span class="cons-grupo-badge ${tipo}">${badgeLabel}</span>
            <span class="cons-grupo-toggle" id="consToggle_${gIdx}">▼</span>
          </div>
        </div>
        <div class="cons-grupo-body" id="consBody_${gIdx}">
          <table class="cons-paletes-table">
            <thead>
              <tr>
                <th>SKU / Material</th>
                <th>Vaga / Stage</th>
                <th>Qtd Caixas</th>
                <th>Palete (LPN)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${paletesHtml}</tbody>
          </table>
          ${g.isDuplicado ? `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; margin-bottom: 12px;">
              <div style="background: #FFFBEB; border: 1.5px solid #FDE68A; border-radius: 8px; padding: 12px;">
                <div style="font-size: 0.8rem; font-weight: 800; color: #B45309; text-transform: uppercase; margin-bottom: 6px;">
                  📍 O QUE ESTÁ HOJE (Antes)
                </div>
                <div style="font-size: 0.82rem; color: #78350F; line-height: 1.4;">
                  • <b>${g.totalPaletes}</b> paletes espalhados em <b>${g.stagesAtivos.length}</b> stage(s): <code>${g.stagesAtivos.join(', ')}</code><br>
                  • Total de caixas: <b>${g.totalUnidades} cx</b> de SKU <b>${g.sku}</b><br>
                  • Vagas parciais ocupadas no galpão gerando fragmentação.
                </div>
              </div>
              <div style="background: #F0FDF4; border: 1.5px solid #BBF7D0; border-radius: 8px; padding: 12px;">
                <div style="font-size: 0.8rem; font-weight: 800; color: #166534; text-transform: uppercase; margin-bottom: 6px;">
                  🎯 COMO VAI FICAR (Depois da Roteirização)
                </div>
                <div style="font-size: 0.82rem; color: #14532D; line-height: 1.4;">
                  • Carga concentrada em apenas <b>${g.paletesConsolidados}</b> palete(s) completo(s) no <b>Stage ${g.stagesAtivos[0]}</b><br>
                  • <b style="color:#059669;">✔ ${g.economiaPaletes} vaga(s) física(s) liberada(s)</b> imediatamente<br>
                  • ${g.economiaStages > 0 ? `<b style="color:#059669;">✔ Libera ${g.economiaStages} stage(s) inteiro(s)</b> para novas cargas!` : 'Otimiza 100% da cubagem do stage.'}
                </div>
              </div>
            </div>
            <div class="cons-grupo-plano">
              <div class="cons-grupo-plano-title">🚜 ROTEIRIZAÇÃO PASSO A PASSO DA EMPILHADEIRA (MHE)</div>
              <div class="cons-plano-steps">${planoHtml}</div>
              ${economiaHtml}
            </div>
          ` : `
            <div style="margin-top: 10px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px; font-size: 0.8rem; color: #475569;">
              ✔ <b>Material Único:</b> Este SKU já está alocado sem duplicidade no Stage <b>${g.stagesAtivos[0] || '—'}</b>. Nenhuma movimentação de empilhadeira necessária.
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.toggleGrupoConsolidacao = function(idx) {
  const body = document.getElementById(`consBody_${idx}`);
  const toggle = document.getElementById(`consToggle_${idx}`);
  if (body) body.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open');
};

window.filtrarConsolidacao = function(filter) {
  consFilterAtivo = filter;
  document.querySelectorAll('.cons-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderConsolidacao();
};

window.filtrarConsolidacaoTexto = function(val) {
  consSearchAtivo = (val || '').trim().toLowerCase();
  renderConsolidacao();
};

window.toggleRoteirizacaoGlobal = function() {
  const body = document.getElementById('consRoteirizacaoBody');
  if (body) body.classList.toggle('open');
};

function popularSelectEmbarqueConsolidacao() {
  const select = document.getElementById('consSelectEmbarque');
  if (!select || !database || !database.embarques) return;

  const embKeys = Object.keys(database.embarques).sort();
  if (embKeys.length === 0) {
    select.innerHTML = '<option value="">Nenhum embarque na base</option>';
    return;
  }

  const selectedVal = (embarqueConsolidacaoAtivo && embarqueConsolidacaoAtivo.embarque) || (activeEmbarque && activeEmbarque.embarque) || embKeys[0];

  select.innerHTML = embKeys.map(k => {
    const emb = database.embarques[k];
    const totalP = emb.total_paletes || (emb.paletes ? emb.paletes.length : 0);
    const stagesStr = Array.isArray(emb.stages) ? emb.stages.join(', ') : (emb.stages || '');
    return `<option value="${emb.embarque}" ${emb.embarque === selectedVal ? 'selected' : ''}>
      EMB ${emb.embarque} • ${totalP} paletes • ${stagesStr}
    </option>`;
  }).join('');
}

window.selecionarEmbarqueConsolidacao = function(embId) {
  if (!embId || !database || !database.embarques) return;
  let emb = database.embarques[embId];
  if (!emb && typeof window.localizarEmbarqueUniversal === 'function') {
    const res = window.localizarEmbarqueUniversal(embId);
    if (res) emb = res.embarque;
  }
  if (!emb) return;

  embarqueConsolidacaoAtivo = emb;
  consGruposData = analisarConsolidacao(emb);
  renderConsolidacao();
  if (window.StageMapConsolidacao && typeof window.StageMapConsolidacao.refresh === 'function') {
    window.StageMapConsolidacao.refresh(true);
  }
  showToast(`🔗 Consolidação e roteirização carregadas para o Embarque <b>${emb.embarque}</b>.`);
};

window.reprocessarConsolidacao = function() {
  consGruposData = analisarConsolidacao();
  renderConsolidacao();
  if (window.StageMapConsolidacao && typeof window.StageMapConsolidacao.refresh === 'function') {
    window.StageMapConsolidacao.refresh(true);
  }
  showToast('🔄 Inteligência recalculada com base nos dados reais do embarque.');
};

window.toggleConsolidacao = function() {
  const isOpen = document.getElementById('viewConsolidacao')?.style.display !== 'none';
  if (isOpen) {
    fecharConsolidacaoTela();
  } else {
    abrirConsolidacaoTela();
  }
};

window.abrirConsolidacaoTela = function(embId = null) {
  popularSelectEmbarqueConsolidacao();

  let targetEmb = null;
  if (embId && database && database.embarques && database.embarques[embId]) {
    targetEmb = database.embarques[embId];
  } else if (activeEmbarque) {
    targetEmb = activeEmbarque;
  } else if (embarqueConsolidacaoAtivo) {
    targetEmb = embarqueConsolidacaoAtivo;
  } else if (database && database.embarques) {
    const keys = Object.keys(database.embarques);
    if (keys.length > 0) {
      targetEmb = database.embarques[keys[0]];
    }
  }

  if (!targetEmb) {
    showToast('⚠️ Nenhum embarque encontrado na base. Carregue uma planilha primeiro.');
    return;
  }

  embarqueConsolidacaoAtivo = targetEmb;
  consGruposData = analisarConsolidacao(targetEmb);
  consFilterAtivo = 'todos';
  consSearchAtivo = '';
  const input = document.getElementById('consSearchInput');
  if (input) input.value = '';

  const select = document.getElementById('consSelectEmbarque');
  if (select && targetEmb) select.value = targetEmb.embarque;

  showScreen('viewConsolidacao');
  renderConsolidacao();
  setTimeout(() => {
    const el = document.getElementById('consMapRoot');
    if (el && window.StageMap) {
      if (!window.StageMapConsolidacao) {
        window.StageMapConsolidacao = window.StageMap.create();
        window.StageMapConsolidacao.mount(el, {
          loadData: () => window.StageMapConsolidacaoAdapter(),
          planner: true,
          legenda: true,
          positions: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
        });
      } else {
        window.StageMapConsolidacao.refresh(true);
      }
    }
  }, 100);
};

window.fecharConsolidacaoTela = function() {
  if (activeEmbarque) {
    showScreen('viewScanner');
  } else {
    showScreen('viewLogin');
  }
};

/* =========================================================
   CONTAGEM FIDEDIGNA DE CONFERIDOS & DIVERGÊNCIAS
   ========================================================= */
function getValidConferidosCount() {
  if (!activeConference || !activeConference.conferidos) return 0;
  let count = 0;
  for (const [lpn, conf] of activeConference.conferidos.entries()) {
    // Apenas paletes 100% conferidos com sucesso (sem divergência de stage, lote ou quantidade)
    if (conf && conf.isMatch === true && !conf.isDivergent && conf.status !== 'divergent') {
      count++;
    }
  }
  return count;
}

function getActiveDivergenciasCount() {
  if (!activeConference) return 0;
  let count = activeConference.divergencias ? activeConference.divergencias.length : 0;
  if (activeConference.conferidos) {
    let divInConf = 0;
    for (const [lpn, conf] of activeConference.conferidos.entries()) {
      if (conf && (conf.isMatch === false || conf.isDivergent === true || conf.status === 'divergent')) {
        divInConf++;
      }
    }
    count = Math.max(count, divInConf);
  }
  return count;
}

/* =========================================================
   ATUALIZAÇÃO DE INTERFACE
   ========================================================= */
function updateUI() {
  if (!activeEmbarque) return;

  const total = activeEmbarque.total_paletes;
  const validConf = getValidConferidosCount();
  const divCount = getActiveDivergenciasCount();
  const pendCount = Math.max(0, total - validConf);
  
  // O progresso NUNCA pode ser 100% se houver divergências ativas ou se não conferiu os paletes certos
  let percent = 0;
  if (total > 0) {
    percent = Math.round((validConf / total) * 100);
    // Se todos foram bipados mas existem divergências, o percentual não pode atingir 100%
    if (divCount > 0 && percent >= 100) {
      percent = Math.min(99, Math.max(0, Math.round(((total - divCount) / total) * 100)));
    }
  }

  document.getElementById('txtConferidos').textContent = validConf;
  document.getElementById('txtPendentes').textContent = pendCount;
  document.getElementById('txtDivergencias').textContent = divCount;

  // Atualização do Stage Físico Atual no Header
  const elFisico = document.getElementById('txtStageFisico');
  if (elFisico) {
    const curPhysical = activeConference.currentPhysicalStage || '-';
    const locTarget = (curPhysical !== '-' && curPhysical) ? formatStageSlotDisplay(curPhysical, activeConference.activeSlot || 1) : '-';
    elFisico.innerHTML = `${curPhysical} <small style="font-size:0.75rem; opacity:0.85; font-weight:800; color:#00A0E9;">(Vaga ${locTarget})</small>`;
  }

  // Atualização do Badge Físico x Sistêmico
  const elStatusComp = document.getElementById('txtStatusFisicoSistemico');
  if (elStatusComp) {
    if (!activeConference.lastComparison) {
      elStatusComp.className = 'badge-fisico-sistemico idle';
      elStatusComp.innerHTML = '⚪ Aguardando Leitura';
    } else if (activeConference.lastComparison.isMatch) {
      elStatusComp.className = 'badge-fisico-sistemico match';
      elStatusComp.innerHTML = `✔ BATEU (${activeConference.lastComparison.fisico})`;
    } else {
      elStatusComp.className = 'badge-fisico-sistemico divergent';
      elStatusComp.innerHTML = `✖ NÃO BATEU (Fís: ${activeConference.lastComparison.fisico} ≠ Sis: ${activeConference.lastComparison.sistemico})`;
    }
  }

  // Atualização do Gráfico Interativo de Conclusão com Gradiente
  const ring = document.getElementById('radialProgressRing');
  if (ring) {
    const circumference = 226.2;
    const offset = circumference - (circumference * (percent / 100));
    ring.style.strokeDashoffset = Math.max(0, offset);
  }
  const txtPercent = document.getElementById('radialPercentText');
  if (txtPercent) txtPercent.textContent = `${percent}%`;

  const txtCounts = document.getElementById('radialCountsText');
  if (txtCounts) txtCounts.textContent = `${validConf} de ${total} paletes`;

  const lblStatus = document.getElementById('radialStatusLabel');
  if (lblStatus) {
    if (percent === 100 && divCount === 0) {
      lblStatus.textContent = 'CONCLUÍDO ✔';
      lblStatus.style.color = '#00A650';
    } else if (divCount > 0) {
      lblStatus.textContent = `DIVERGÊNCIA (${divCount}) ✖`;
      lblStatus.style.color = '#DC2626';
    } else if (percent > 0) {
      lblStatus.textContent = 'EM ANDAMENTO';
      lblStatus.style.color = '#FF7A00';
    } else {
      lblStatus.textContent = 'AGUARDANDO';
      lblStatus.style.color = '#D97706';
    }
  }

  // Atualização da Cor e Gradiente do Badge de Embarque
  const badgeEmb = document.getElementById('badgeEmbarqueGradient');
  if (badgeEmb) {
    badgeEmb.className = 'embarque-badge-gradient' + 
      ((percent === 100 && divCount === 0) ? ' status-done' : (percent > 0 || divCount > 0) ? ' status-partial' : '');
  }

  // Estatísticas no Popover Interativo
  const popBadge = document.getElementById('popoverPercentBadge');
  if (popBadge) popBadge.textContent = `${percent}%`;
  const popConf = document.getElementById('popoverConf');
  if (popConf) popConf.textContent = validConf;
  const popPend = document.getElementById('popoverPend');
  if (popPend) popPend.textContent = pendCount;
  const popTot = document.getElementById('popoverTotal');
  if (popTot) popTot.textContent = total;
  const popDiv = document.getElementById('popoverDiv');
  if (popDiv) popDiv.textContent = divCount;
  const popFill = document.getElementById('popoverProgressFill');
  if (popFill) popFill.style.width = `${percent}%`;

  const progText = document.getElementById('progressPercent');
  if (progText) {
    if (divCount > 0) {
      progText.innerHTML = `${percent}% (${validConf} de ${total} paletes validados) <span style="color:#DC2626; font-weight:800; margin-left:6px;">• ⚠ ${divCount} ${divCount === 1 ? 'divergência' : 'divergências'}</span>`;
    } else {
      progText.textContent = `${percent}% (${validConf} de ${total} paletes validados)`;
    }
  }

  const fillEl = document.getElementById('progressFill');
  if (fillEl) {
    fillEl.style.width = `${percent}%`;
    fillEl.style.background = (divCount > 0 && validConf < total) ? 'linear-gradient(90deg, #EF4444 0%, #DC2626 100%)' : 'var(--status-ok)';
  }

  document.getElementById('badgeHistCount').textContent = `${activeConference.historico.length} paletes`;

  // Detector de Anomalias de Capacidade e Colisão de Stages
  const anomalies = [];
  const cap = activeConference.capacity || 10;
  if (activeConference.stageSlots) {
    Object.keys(activeConference.stageSlots).forEach(stg => {
      const confInStg = Object.values(activeConference.stageSlots[stg] || {}).filter(s => s && s.status === 'done').length;
      if (confInStg > cap) {
        anomalies.push(`<b>Stage ${stg}:</b> ${confInStg} paletes alocados (Excede a capacidade física de ${cap} vagas!)`);
      }
      // Verifica colisão apenas se for um stage externo não planejado no embarque ativo
      const isEmbStage = activeEmbarque && activeEmbarque.stages && (
        Array.isArray(activeEmbarque.stages) ? activeEmbarque.stages : [activeEmbarque.stages]
      ).some(s => normalizeStageName(s) === normalizeStageName(stg));

      if (!isEmbStage) {
        const occ = getStageOccupant(stg, activeEmbarque.embarque);
        if (occ) {
          anomalies.push(`<b>Stage ${stg}:</b> Ocupado pelo <b>Embarque ${occ.embarque}</b> (Colisão operacional! Não pode cobrir outro embarque)`);
        }
      }
    });
  }

  const alertBox = document.getElementById('alertAnomaliaRamificacao');
  if (alertBox) {
    if (anomalies.length > 0) {
      alertBox.innerHTML = `⚠️ <b>ANOMALIA DETECTADA:</b><br>` + anomalies.join('<br>');
      alertBox.style.display = 'flex';
    } else {
      alertBox.style.display = 'none';
    }
  }

  renderAmostragem();
  renderDistribuicaoPaletes();
  renderHistorico();
}

window.toggleCompletionPopover = function(e) {
  if (e) e.stopPropagation();
  const pop = document.getElementById('completionPopover');
  if (pop) {
    pop.classList.toggle('active');
  }
};

document.addEventListener('click', (e) => {
  const widget = document.getElementById('headerCompletionWidget');
  const pop = document.getElementById('completionPopover');
  if (pop && pop.classList.contains('active')) {
    if (widget && !widget.contains(e.target)) {
      pop.classList.remove('active');
    }
  }
});

/* =========================================================
   DISTRIBUIÇÃO DOS PALETES NO STAGE (EX: SO01A, SO02B)
   ========================================================= */
function getShipmentPalletsDistribution() {
  if (!activeEmbarque || !activeEmbarque.paletes) return [];
  
  // Contadores para sequenciamento único de vagas por stage
  const stageCounters = {};
  const physicalStageCounters = {};

  const list = activeEmbarque.paletes.map((p, idx) => {
    const isConf = activeConference && activeConference.conferidos && activeConference.conferidos.has(p.palete);
    const confData = isConf ? activeConference.conferidos.get(p.palete) : null;
    
    // Stage planejado da planilha
    const stgPlan = normalizeStageName(p.stage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
    
    let locCode = '';
    let stageName = '';
    let slotLetter = '';
    let slotNum = null;
    let isRamified = false;
    let isDivergent = false;

    if (isConf && confData) {
      stageName = normalizeStageName(confData.stageFisico || confData.stage || stgPlan);
      physicalStageCounters[stageName] = (physicalStageCounters[stageName] || 0) + 1;
      slotNum = confData.slot || physicalStageCounters[stageName];
      // Garante que cada palete no mesmo stage físico tenha vaga sequencial distinta (1, 2, 3...)
      if (physicalStageCounters[stageName] > 1 && slotNum === 1) {
        slotNum = physicalStageCounters[stageName];
      }
      slotLetter = String.fromCharCode(64 + Math.min(10, Math.max(1, slotNum)));
      locCode = confData.locCode || formatStageSlotDisplay(stageName, slotNum);
      isRamified = confData.isRamification || false;
      isDivergent = (confData.isMatch === false) || (confData.status === 'divergent') || (confData.isDivergent === true);
    } else {
      // Palete pendente: calcula vaga planejada sequencial para o seu stage
      stageName = stgPlan;
      stageCounters[stageName] = (stageCounters[stageName] || 0) + 1;
      slotNum = stageCounters[stageName];
      slotLetter = String.fromCharCode(64 + Math.min(10, Math.max(1, slotNum)));
      locCode = formatStageSlotDisplay(stageName, slotNum);
    }

    return {
      palete: p.palete,
      sku: p.sku_resumo || (p.itens && p.itens[0] ? p.itens[0].sku : ''),
      desc: p.desc_resumo || '',
      qtd: p.qtd_total || 0,
      stagePlanejado: stgPlan,
      stageFisico: stageName,
      slotNum: slotNum,
      slotLetter: slotLetter,
      locCode: locCode,
      isConf: isConf,
      confData: confData,
      isRamified: isRamified,
      isDivergent: isDivergent
    };
  });

  // Inclui também paletes não planejados que foram bipados no stage e geraram divergência física
  if (activeConference && activeConference.divergencias && activeConference.divergencias.length > 0) {
    const defaultStg = normalizeStageName((activeEmbarque.stages && activeEmbarque.stages[0]) || 'SO001');
    activeConference.divergencias.forEach(d => {
      const exists = list.some(item => normalizeBarcode(item.palete) === normalizeBarcode(d.paleteId));
      if (!exists) {
        const stageName = normalizeStageName(d.stageFisico || defaultStg);
        physicalStageCounters[stageName] = (physicalStageCounters[stageName] || 0) + 1;
        const slotNum = physicalStageCounters[stageName];
        const slotLetter = String.fromCharCode(64 + Math.min(10, Math.max(1, slotNum)));
        const locCode = formatStageSlotDisplay(stageName, slotNum);

        list.push({
          palete: d.paleteId,
          sku: d.alerta?.sku || 'Material Não Planejado',
          desc: d.detalhes || 'Divergência detectada',
          qtd: 1,
          stagePlanejado: d.stageSistemico || 'N/A',
          stageFisico: stageName,
          slotNum: slotNum,
          slotLetter: slotLetter,
          locCode: locCode,
          isConf: true,
          confData: { timestamp: d.timestamp, isMatch: false, status: 'divergent' },
          isRamified: false,
          isDivergent: true
        });
      }
    });
  }

  return list;
}

let currentDistribuicaoFilter = 'todos';

window.switchPaletesTab = function(tabName) {
  const isDist = tabName === 'distribuicao';
  document.getElementById('tabBtnDistribuicao')?.classList.toggle('active', isDist);
  document.getElementById('tabBtnHistorico')?.classList.toggle('active', !isDist);
  
  const contentDist = document.getElementById('tabContentDistribuicao');
  const contentHist = document.getElementById('tabContentHistorico');
  if (contentDist) contentDist.style.display = isDist ? 'block' : 'none';
  if (contentHist) contentHist.style.display = !isDist ? 'block' : 'none';
};

window.filterDistribuicao = function(filter) {
  currentDistribuicaoFilter = filter;
  document.querySelectorAll('.dist-filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === filter);
  });
  renderDistribuicaoPaletes();
};

function renderDistribuicaoPaletes() {
  const container = document.getElementById('listDistribuicaoPaletes');
  if (!container || !activeEmbarque) return;

  const items = getShipmentPalletsDistribution();

  // Atualizar contadores
  const total = items.length;
  const countConf = items.filter(i => i.isConf && !i.isDivergent).length;
  const countPend = items.filter(i => !i.isConf).length;
  const countDiv  = items.filter(i => i.isDivergent).length;

  const elTot = document.getElementById('tabCountTotalPaletes');
  const elHist = document.getElementById('tabCountHistorico');
  const elDAll = document.getElementById('distCountTodos');
  const elDPend = document.getElementById('distCountPend');
  const elDConf = document.getElementById('distCountConf');
  const elDDiv  = document.getElementById('distCountDiv');

  if (elTot) elTot.textContent = total;
  if (elHist) elHist.textContent = activeConference.historico ? activeConference.historico.length : 0;
  if (elDAll) elDAll.textContent = total;
  if (elDPend) elDPend.textContent = countPend;
  if (elDConf) elDConf.textContent = countConf;
  if (elDDiv)  elDDiv.textContent  = countDiv;

  const filtered = items.filter(it => {
    if (currentDistribuicaoFilter === 'conferidos') return it.isConf && !it.isDivergent;
    if (currentDistribuicaoFilter === 'pendentes')  return !it.isConf;
    if (currentDistribuicaoFilter === 'divergentes') return it.isDivergent;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 28px; font-size: 0.88rem;">
        Nenhum palete encontrado para o filtro selecionado.
      </div>
    `;
    return;
  }

  let html = `
    <table class="dist-table">
      <thead>
        <tr>
          <th style="width: 140px;">Local / Stage</th>
          <th>LPN do Palete</th>
          <th>SKU / Material</th>
          <th style="width: 80px; text-align: center;">Qtd</th>
          <th style="width: 190px; text-align: right;">Status no Stage</th>
        </tr>
      </thead>
      <tbody>
  `;

  filtered.forEach(item => {
    let rowClass = item.isConf ? (item.isDivergent ? 'row-div' : 'row-ok') : 'row-pend';
    let statusBadge = '';

    if (item.isConf) {
      if (item.isDivergent) {
        statusBadge = `<span class="badge-dist err">✖ DIVERGÊNCIA (${item.confData?.timestamp || ''})</span>`;
      } else if (item.isRamified) {
        statusBadge = `<span class="badge-dist warn">✔ RAMIFICADO (${item.confData?.timestamp || ''})</span>`;
      } else {
        statusBadge = `<span class="badge-dist ok">✔ CONFERIDO (${item.confData?.timestamp || ''})</span>`;
      }
    } else {
      statusBadge = `<span class="badge-dist waiting">⏳ NA FILA (Aguardando)</span>`;
    }

    const locBadgeCls = item.isConf ? (item.isDivergent ? 'loc-div' : 'loc-ok') : 'loc-wait';

    html += `
      <tr class="${rowClass}">
        <td>
          <div class="loc-cell-wrap" 
               onclick="mostrarLocalizacaoStage('${item.stageFisico}', ${item.slotNum}, '${item.palete}', '${item.sku}', '', ${item.qtd})"
               style="cursor: pointer;" 
               title="Clique para ver o mapa visual deste stage e a vaga exata deste palete">
            <span class="badge-loc-pill ${locBadgeCls}">📍 ${item.locCode} 🔍</span>
            <span class="loc-detail-sub">${item.stageFisico} • Vaga ${item.slotLetter} (Ver no mapa)</span>
          </div>
        </td>
        <td>
          <div class="lpn-dist-val">${item.palete}</div>
          <div class="lpn-sub-meta">Stage Planejado: <b>${item.stagePlanejado}</b></div>
        </td>
        <td>
          <div class="sku-dist-val">${item.sku || 'SKU Geral'}</div>
          <div class="desc-dist-val">${item.desc || ''}</div>
        </td>
        <td style="text-align: center; font-weight: 700; color: var(--text-primary);">
          ${item.qtd} un
        </td>
        <td style="text-align: right;">
          ${statusBadge}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function renderHistorico() {
  const container = document.getElementById('listHistorico');
  if (!container) return;

  if (activeConference.historico.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 28px; font-size: 0.88rem;">
        Nenhum palete bipado ainda. Aponte o leitor para as etiquetas de LPN no Stage.
      </div>
    `;
    return;
  }

  container.innerHTML = activeConference.historico.map(item => {
    let rowClass = 'ok';
    let badgeClass = 'ok';
    let badgeText = '✔ Bateu';

    if (item.tipo === 'repetido') {
      rowClass = 'warn';
      badgeClass = 'warn';
      badgeText = 'Repetido';
    } else if (item.tipo === 'erro') {
      rowClass = 'err';
      badgeClass = 'err';
      badgeText = '✖ Divergência';
    } else if (item.tipo === 'divergencia_stage' || item.isMatch === false) {
      rowClass = 'err';
      badgeClass = 'err';
      badgeText = '✖ Não Bateu';
    } else if (item.isMatch === true) {
      badgeClass = 'ok';
      badgeText = '✔ Bateu';
    }

    let compBadge = '';
    if (item.stageFisico || item.stageSistemico) {
      if (item.isMatch) {
        compBadge = `<span class="badge-stage-match ok" title="Físico e Sistêmico conferem">✔ Stage ${item.stageFisico}</span>`;
      } else {
        compBadge = `<span class="badge-stage-match err" title="Divergência entre Stage Físico e Sistêmico">✖ Físico: ${item.stageFisico || '?'} ≠ Sistêmico: ${item.stageSistemico || '?'}</span>`;
      }
    }

    const itemLocCode = item.locCode || formatStageSlotDisplay(item.stageFisico, item.slot);

    return `
      <div class="timeline-row ${rowClass}">
        <div>
          <div class="lpn-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span>${item.palete}</span>
            <span class="badge-stage-loc-mono">📍 ${itemLocCode}</span>
            ${compBadge}
          </div>
          <div class="lpn-subtitle">${item.desc || ''} ${item.qtd ? `• <b>${item.qtd} un</b>` : ''} • Stage: <b>${item.stageFisico}</b> (Vaga ${item.slot || '—'})</div>
        </div>
        <div class="timeline-meta">
          <span class="time-stamp">${item.timestamp}</span>
          <span class="badge-pill ${badgeClass}">${badgeText}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* =========================================================
   FINALIZAÇÃO & MODAL DE HISTÓRICO
   ========================================================= */
function finalizarConferencia() {
  if (!activeEmbarque) return;
  const total = activeEmbarque.total_paletes;
  const conf = activeConference.conferidos.size;
  const pend = Math.max(0, total - conf);
  const divs = activeConference.divergencias.length;

  activeConference.finalizadoEm = new Date();
  recordActiveConferenceToHistory('Concluído');
  localStorage.removeItem(STORAGE_ACTIVE_SESSION_KEY);
  try {
    const partials = JSON.parse(localStorage.getItem(STORAGE_PARTIAL_CONFERENCES_KEY) || '{}');
    delete partials[activeConference.embarqueId];
    localStorage.setItem(STORAGE_PARTIAL_CONFERENCES_KEY, JSON.stringify(partials));
  } catch(e){}

  const modal = document.getElementById('modalRelatorio');
  const body = document.getElementById('modalBody');

  let statusMsg = (pend === 0 && divs === 0)
    ? `<div style="background: var(--status-ok-bg); color: #065F46; padding: 12px; border-radius: var(--radius-sm); font-weight: 700; margin-bottom: 14px; border: 1px solid var(--status-ok-border);">
        ✔ Conferência Aprovada (100% dos paletes auditados)
      </div>`
    : `<div style="background: var(--status-err-bg); color: #991B1B; padding: 12px; border-radius: var(--radius-sm); font-weight: 700; margin-bottom: 14px; border: 1px solid var(--status-err-border);">
        ⚠ Atenção: Conferência finalizada com pendências ou divergências!
      </div>`;

  body.innerHTML = `
    ${statusMsg}
    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--text-secondary);">Embarque:</td><td style="padding: 7px 0; font-weight: 800; color: var(--text-primary);">${activeEmbarque.embarque}</td></tr>
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--text-secondary);">Operador:</td><td style="padding: 7px 0; font-weight: 700; color: var(--text-primary);">${activeConference.operador}</td></tr>
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--text-secondary);">Stage:</td><td style="padding: 7px 0; font-weight: 700; color: var(--text-primary);">${formatStages(activeEmbarque.stages)}</td></tr>
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--text-secondary);">Total Esperado:</td><td style="padding: 7px 0; font-weight: 800; color: var(--text-primary);">${total}</td></tr>
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--status-ok);">Validados:</td><td style="padding: 7px 0; font-weight: 800; color: var(--status-ok);">${conf} (${Math.round(conf/total*100)}%)</td></tr>
      <tr style="border-bottom: 1px solid var(--border-light);"><td style="padding: 7px 0; color: var(--status-warn);">Faltantes:</td><td style="padding: 7px 0; font-weight: 800; color: var(--status-warn);">${pend}</td></tr>
      <tr><td style="padding: 7px 0; color: var(--status-err);">Divergências:</td><td style="padding: 7px 0; font-weight: 800; color: var(--status-err);">${divs}</td></tr>
    </table>
  `;

  modal.style.display = 'flex';
}

window.switchHistTab = function(tabId) {
  const tabs = [
    { id: 'conf', btn: 'tabBtnConf', pane: 'paneConf' },
    { id: 'ocorr', btn: 'tabBtnOcorr', pane: 'paneOcorr' },
    { id: 'evol', btn: 'tabBtnEvol', pane: 'paneEvol' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    const pane = document.getElementById(t.pane);
    const isActive = (t.id === tabId);
    if (btn) btn.classList.toggle('active', isActive);
    if (pane) pane.classList.toggle('active', isActive);
  });
};

function renderHistTabConferencias() {
  const historyList = getStoredHistory();
  const tbody = document.getElementById('histTableBody');
  if (!tbody) return;

  if (historyList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">
          Nenhuma conferência registrada ainda. Inicie ou finalize uma auditoria para registrar no histórico.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = historyList.map((h, idx) => {
      const dt = new Date(h.iniciadoEm);
      const dataFormatada = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
      const isComplete = h.status === 'Concluído';
      const badgeStatus = isComplete 
        ? '<span class="badge-pill ok">Concluído</span>' 
        : '<span class="badge-pill warn">Em Andamento</span>';

      return `
        <tr>
          <td style="white-space: nowrap; font-size: 0.8rem; color: var(--text-secondary);">${dataFormatada}</td>
          <td><b>${h.embarqueId}</b></td>
          <td>${h.operador || 'Operador'}</td>
          <td>${formatStages(h.stages)}</td>
          <td><b>${h.conferidosCount} / ${h.totalPaletes}</b> (${h.percentual}%)</td>
          <td style="color: ${h.divergenciasCount > 0 ? 'var(--status-err)' : 'var(--text-muted)'}; font-weight: 700;">
            ${h.divergenciasCount}
          </td>
          <td>${badgeStatus}</td>
          <td>
            <button class="btn-secondary-clean" style="padding: 4px 8px; font-size: 0.75rem; margin-left: 0;" onclick="exportarCSVAuditoria(${idx})">
              CSV
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

function renderHistTabOcorrencias() {
  const alerts = getStoredInventoryAlerts();
  const tbody = document.getElementById('tableOcorrenciasBody');
  if (!tbody) return;

  if (alerts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">
          Nenhuma ocorrência registrada. O stage está em conformidade física.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = alerts.map((a) => {
      const isOutro = a.embarqueCorreto && a.embarqueCorreto !== 'DESCONHECIDO';
      return `
        <tr>
          <td style="white-space: nowrap; font-size: 0.8rem;">${a.dataCompleta || a.timestamp}</td>
          <td style="font-family: monospace; font-weight: 700;">${a.lpn}</td>
          <td><span class="badge-pill warn">Stage ${a.stageFisico}</span></td>
          <td>${a.embarqueAuditado}</td>
          <td style="font-weight: 800; color: ${isOutro ? 'var(--status-ok)' : 'var(--status-err)'};">
            ${a.embarqueCorreto}
          </td>
          <td>${a.stageCorreto || 'N/A'}</td>
          <td style="font-size: 0.82rem; color: var(--text-secondary);">${a.sku || '-'}</td>
          <td>
            <button class="btn-secondary-clean" style="padding: 4px 8px; font-size: 0.75rem; margin-left: 0;" onclick="copiarChamadoInventario('${String(a.lpn || '').replace(/'/g, '')}', '${String(a.stageFisico || '').replace(/'/g, '')}', '${String(a.embarqueAuditado || '').replace(/'/g, '')}', '${String(a.embarqueCorreto || '').replace(/'/g, '')}', '${String(a.stageCorreto || '').replace(/'/g, '')}', '${String(a.sku || '').replace(/'/g, '')}')">
              📋 Copiar
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

function renderHistTabEvolucao() {
  const versions = getStoredBaseVersions();
  const tbody = document.getElementById('tableEvolucaoBody');
  if (!tbody) return;

  if (versions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">
          Nenhum histórico de atualização de base gravado ainda. As alterações serão registradas a cada upload de Excel.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = versions.map(v => `
      <tr>
        <td style="white-space: nowrap; font-size: 0.8rem;">${v.data}</td>
        <td><b>${v.arquivo}</b></td>
        <td>${v.totalEmbarques} embarques</td>
        <td>${v.totalPaletes} paletes</td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${v.detalhes}</td>
      </tr>
    `).join('');
  }
}

function openHistoryModal(tabId = 'conf') {
  renderHistTabConferencias();
  renderHistTabOcorrencias();
  renderHistTabEvolucao();
  updateHistoryBadge();
  window.switchHistTab(tabId);
  document.getElementById('modalHistorico').style.display = 'flex';
}

function exportarOcorrenciasCSV() {
  const alerts = getStoredInventoryAlerts();
  if (alerts.length === 0) {
    alert('Nenhuma ocorrência de inventário registrada.');
    return;
  }

  let csv = 'Data_Hora;LPN_Bipada;Stage_Onde_Estava;Embarque_Auditado;Embarque_Correto_Destino;Stage_Correto_Destino;SKU;Operador\n';
  alerts.forEach(a => {
    csv += `"${a.dataCompleta || a.timestamp}";"${a.lpn}";"${a.stageFisico}";"${a.embarqueAuditado}";"${a.embarqueCorreto}";"${a.stageCorreto}";"${a.sku}";"${a.operador}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Ocorrencias_Inventario_Stage_PG.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.exportarCSVAuditoria = function(index) {
  const historyList = getStoredHistory();
  const h = historyList[index];
  if (!h) return;

  let csv = 'Embarque;Palete;Stage;Status;Horario_Bip;Qtd_Total;Descricao\n';
  if (h.conferidos) {
    h.conferidos.forEach(([lpn, data]) => {
      csv += `${h.embarqueId};"${lpn}";"${formatStages(h.stages)}";"CONFERIDO";"${data?.timestamp || ''}";${data?.palete?.qtd_total || 0};"${data?.palete?.desc_resumo || ''}"\n`;
    });
  }
  if (h.divergencias) {
    h.divergencias.forEach(d => {
      csv += `${h.embarqueId};"${d.paleteId}";"";"DIVERGENCIA_SOBRA";"${d.timestamp}";0;"Palete nao planejado"\n`;
    });
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Auditoria_Embarque_${h.embarqueId}_${h.id}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function exportarTodoHistoricoCSV() {
  const historyList = getStoredHistory();
  if (historyList.length === 0) {
    alert('Nenhum registro no histórico para exportar.');
    return;
  }

  let csv = 'Data_Hora;Embarque;Operador;Stage;Total_Paletes;Conferidos;Pendentes;Divergencias;Acuracia_Perc;Status\n';
  historyList.forEach(h => {
    const dt = new Date(h.iniciadoEm);
    const dataFormatada = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR');
    csv += `"${dataFormatada}";"${h.embarqueId}";"${h.operador}";"${formatStages(h.stages)}";${h.totalPaletes};${h.conferidosCount};${h.pendentesCount};${h.divergenciasCount};${h.percentual}%;"${h.status}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Historico_Geral_Auditorias_PG.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportarCSV() {
  if (!activeEmbarque) return;
  let csv = 'Embarque;Palete;Stage;Status;Horario_Bip;Qtd_Total;Descricao\n';

  activeEmbarque.paletes.forEach(p => {
    const isConf = activeConference.conferidos.has(p.palete);
    const confData = activeConference.conferidos.get(p.palete);
    csv += `${activeEmbarque.embarque};"${p.palete}";"${p.stage || ''}";"${isConf ? 'CONFERIDO' : 'PENDENTE'}";"${isConf ? confData.timestamp : ''}";${p.qtd_total};"${p.desc_resumo}"\n`;
  });

  activeConference.divergencias.forEach(d => {
    csv += `${activeEmbarque.embarque};"${d.paleteId}";"";"DIVERGENCIA_SOBRA";"${d.timestamp}";0;"Palete nao planejado"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Conferencia_Stage_${activeEmbarque.embarque}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* =========================================================
   FUNÇÕES GLOBAIS DE MODAIS & INTERFACE
   ========================================================= */
window.openUploadModal = function() {
  const modalUpload = document.getElementById('modalUpload');
  if (modalUpload) {
    modalUpload.style.display = 'flex';
    const fb = document.getElementById('uploadFeedback');
    if (fb) fb.style.display = 'none';
  }
};
window.openHistoryModal = openHistoryModal;

/* =========================================================
   INICIALIZAÇÃO & EVENTOS
   ========================================================= */
function initApp() {
  loadData();
  updateModoEmpilhamentoUI();

  const inputEmb = document.getElementById('inputEmbarque');
  const inputOp = document.getElementById('inputOperador');
  const btnLogin = document.getElementById('btnLogin');

  const savedOperator = localStorage.getItem('dhl_last_operator') || '';
  if (inputOp && savedOperator) {
    inputOp.value = savedOperator;
  }

  function atualizarStatusBotaoLogin() {
    const hasEmb = !!(inputEmb?.value.trim());
    if (btnLogin) {
      btnLogin.disabled = false;
      if (hasEmb) {
        btnLogin.style.opacity = '1';
        btnLogin.style.cursor = 'pointer';
      } else {
        btnLogin.style.opacity = '0.75';
        btnLogin.style.cursor = 'pointer';
      }
    }
  }

  if (inputEmb) {
    inputEmb.focus();
    inputEmb.addEventListener('input', atualizarStatusBotaoLogin);
    inputEmb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        entrarNoEmbarque();
      }
    });
  }

  if (inputOp) {
    inputOp.addEventListener('input', atualizarStatusBotaoLogin);
    inputOp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        entrarNoEmbarque();
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener('click', entrarNoEmbarque);
  }

  atualizarStatusBotaoLogin();

  const barcodeInput = document.getElementById('barcodeInput');
  if (barcodeInput) {
    barcodeInput.addEventListener('input', handleBarcodeInput);
    barcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(scanDebounceTimer);
        processBarcode(barcodeInput.value);
      }
    });
  }

  document.getElementById('btnTrocarEmbarque')?.addEventListener('click', trocarEmbarque);
  document.getElementById('btnReiniciarConferencia')?.addEventListener('click', reiniciarConferencia);

  let lastToggleSoundTime = 0;
  window.toggleSound = function() {
    const now = Date.now();
    if (now - lastToggleSoundTime < 250) return;
    lastToggleSoundTime = now;

    sound.soundEnabled = !sound.soundEnabled;
    sound.voiceEnabled = sound.soundEnabled;
    const btnSound = document.getElementById('btnSoundToggle');
    if (btnSound) {
      if (sound.soundEnabled) {
        btnSound.classList.remove('muted');
        btnSound.innerHTML = '<span id="soundIcon">🔊</span> Som';
        sound.playSuccess('Som ativado');
        showToast('Som e voz ativados.');
      } else {
        btnSound.classList.add('muted');
        btnSound.innerHTML = '<span id="soundIcon">🔇</span> Mudo';
        try {
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        } catch(e){}
        showToast('Modo silencioso (Mudo) ativado.');
      }
    }
  };

  document.getElementById('btnSoundToggle')?.addEventListener('click', window.toggleSound);

  document.getElementById('btnFinalizar')?.addEventListener('click', finalizarConferencia);
  document.getElementById('btnExportarRelatorio')?.addEventListener('click', exportarCSV);

  // Modais de Upload e Base
  document.getElementById('btnUploadModal')?.addEventListener('click', window.openUploadModal);
  document.getElementById('btnQuickUpload')?.addEventListener('click', window.openUploadModal);
  document.getElementById('btnCloseModalUpload')?.addEventListener('click', () => { 
    const m = document.getElementById('modalUpload');
    if (m) m.style.display = 'none'; 
  });
  document.getElementById('btnFecharUpload')?.addEventListener('click', () => { 
    const m = document.getElementById('modalUpload');
    if (m) m.style.display = 'none'; 
  });

  // Modal de Histórico Unificado
  document.getElementById('btnVerHistorico')?.addEventListener('click', () => openHistoryModal('conf'));
  document.getElementById('btnCloseModalHist')?.addEventListener('click', () => { document.getElementById('modalHistorico').style.display = 'none'; });
  document.getElementById('btnFecharModalHist')?.addEventListener('click', () => { document.getElementById('modalHistorico').style.display = 'none'; });
  document.getElementById('btnExportarTodoHistorico')?.addEventListener('click', exportarTodoHistoricoCSV);
  document.getElementById('btnExportarOcorrenciasCSV')?.addEventListener('click', exportarOcorrenciasCSV);

  // Chip de Informações da Base
  document.getElementById('navBaseCount')?.addEventListener('click', () => {
    document.getElementById('modalBase').style.display = 'flex';
  });
  document.getElementById('btnCloseModalBase')?.addEventListener('click', () => {
    document.getElementById('modalBase').style.display = 'none';
  });
  document.getElementById('btnFecharModalBase')?.addEventListener('click', () => {
    document.getElementById('modalBase').style.display = 'none';
  });

  // Modal de Conclusão
  document.getElementById('btnCloseModal')?.addEventListener('click', () => {
    document.getElementById('modalRelatorio').style.display = 'none';
    focusScanner();
  });
  document.getElementById('btnOkModal')?.addEventListener('click', () => {
    document.getElementById('modalRelatorio').style.display = 'none';
    showScreen('viewLogin');
  });
  document.getElementById('btnPrintModal')?.addEventListener('click', () => window.print());

  // Drag & Drop e Seleção de Arquivo Excel
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('excelFileInput');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileInput) fileInput.click();
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'));
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processExcelFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        processExcelFile(e.target.files[0]);
      }
    });
  }

  // Foco inteligente no scanner
  document.addEventListener('click', (e) => {
    const isScannerVisible = document.getElementById('viewScanner')?.style.display !== 'none';
    const isAnyModalOpen = modalUpload?.style.display === 'flex' || 
                           document.getElementById('modalHistorico')?.style.display === 'flex' || 
                           document.getElementById('modalBase')?.style.display === 'flex' || 
                           document.getElementById('modalRelatorio')?.style.display === 'flex';

    if (isScannerVisible && !isAnyModalOpen && !['INPUT', 'BUTTON', 'A', 'SELECT', 'LABEL'].includes(e.target.tagName)) {
      focusScanner();
    }
  });
}

/* =========================================================
   ADAPTADOR OFICIAL PARA O MAPA DE STAGES 2D/3D (StageMap)
   ========================================================= */
window.StageMapAdapter = (function () {
  // Monta o pátio a partir do estado REAL: base (Power BI / planilha) + bipagens (conferência ativa e parciais de todos os embarques).
  // Cada palete vai para o stage/vaga físicos onde foi bipado; quem ainda não foi bipado aparece no stage sistêmico (DSTLOC) como "aguardando".
  let cache = { sig: null, out: null };
  const rowOf = (o) => ({ lpn: o.lpn, stage: o.stage || '', vaga: o.vaga == null ? '' : o.vaga, embarque: o.embarque == null ? '' : String(o.embarque), status: o.status, sku: o.sku || '', lote: o.lote || '', qtd: o.qtd || '' });

  return function () {
    if (!database || !database.embarques) return null;
    const ls = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
    const partialsRaw = ls(STORAGE_PARTIAL_CONFERENCES_KEY), capsRaw = ls(STORAGE_STAGE_CAPACITIES_KEY);
    const ac = activeConference || {};
    const pbi = window.POWERBI_SYNC && window.POWERBI_SYNC.status ? window.POWERBI_SYNC.status() : null;
    const sig = [pbi && pbi.version, Object.keys(database.embarques).length, partialsRaw.length, partialsRaw.slice(-200), capsRaw,
      ac.embarqueId, ac.conferidos ? ac.conferidos.size : 0, (ac.historico || []).length, ac.activeSlot, ac.currentPhysicalStage].join('§');
    if (cache.out && cache.sig === sig && cache.db === database) return cache.out;

    const conf = new Map(), phys = new Map(), ocupadas = new Set();
    const addSession = (s, embId) => {
      if (!s) return;
      (s.conferidos || []).forEach(en => { if (Array.isArray(en)) conf.set(en[0], en[1] || {}); });
      Object.keys(s.stageSlots || {}).forEach(stg => {
        const slots = s.stageSlots[stg] || {};
        Object.keys(slots).forEach(k => {
          const sl = slots[k] || {};
          const list = Array.isArray(sl.paletes) && sl.paletes.length ? sl.paletes : ((sl.lpn || sl.palete) ? [sl] : []);
          list.forEach(p => {
            const lpn = p.lpn || p.palete; if (!lpn) return;
            phys.set(lpn, { stage: stg, slot: parseInt(k, 10) || sl.slot, status: p.status || sl.status, emb: embId });
            ocupadas.add(normalizeStageName(stg) + '|' + (parseInt(k, 10) || sl.slot));
          });
        });
      });
    };
    let partials = {};
    try { partials = JSON.parse(partialsRaw || '{}'); } catch (e) {}
    Object.keys(partials).forEach(id => addSession(partials[id], id));
    if (ac.embarqueId) addSession({ conferidos: ac.conferidos ? Array.from(ac.conferidos.entries()) : [], stageSlots: ac.stageSlots }, ac.embarqueId);

    const rows = [], naBase = new Set();
    Object.keys(database.embarques).forEach(k => {
      const e = database.embarques[k];
      if (!e || e.embarque !== k) return; // ignora aliases
      (e.paletes || []).forEach(p => {
        const lpn = p.palete; if (!lpn) return;
        naBase.add(lpn);
        const c = conf.get(lpn), ph = phys.get(lpn);
        const div = (c && (c.isDivergent || c.status === 'divergent')) || (ph && ph.status === 'divergent');
        const ok = (c && c.status === 'done') || (ph && ph.status === 'done');
        rows.push(rowOf({
          lpn: lpn, embarque: e.embarque,
          stage: (ph && ph.stage) || (c && (c.stageFisico || c.stage)) || p.stage,
          vaga: ph ? ph.slot : (c && c.slot),
          status: div ? 'divergencia' : ok ? 'conferido' : 'aguardando',
          sku: p.sku_resumo, lote: p.itens && p.itens[0] && p.itens[0].lote, qtd: p.qtd_total
        }));
      });
    });
    // bipados que não existem na base (material não planejado)
    phys.forEach((ph, lpn) => { if (!naBase.has(lpn)) rows.push(rowOf({ lpn: lpn, stage: ph.stage, vaga: ph.slot, embarque: ph.emb, status: 'divergencia', sku: 'Não planejado' })); });
    // vaga que está sendo bipada agora
    if (ac.embarqueId && ac.currentPhysicalStage && ac.activeSlot && !ocupadas.has(normalizeStageName(ac.currentPhysicalStage) + '|' + ac.activeSlot)) {
      rows.push(rowOf({ lpn: 'Próxima vaga', stage: ac.currentPhysicalStage, vaga: ac.activeSlot, embarque: ac.embarqueId, status: 'ativo' }));
    }

    const d = window.StageMap.fromRows(rows, { preencher: false });
    // capacidade configurada no app (6/8/10) tem prioridade sobre a planta
    let caps = {};
    try { caps = JSON.parse(capsRaw || '{}'); } catch (e) {}
    const capN = {};
    Object.keys(caps).forEach(k => { capN[normalizeStageName(k)] = +caps[k]; });
    d.stages.forEach(s => { const c = capN[normalizeStageName(s.id)]; if (c) s.capacidade = c; });

    d.fonte = pbi && pbi.ts ? 'Power BI ' + new Date(pbi.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Base local';
    cache = { sig: sig, out: d, db: database };
    return d;
  };
})();

/* =========================================================
   OPERAÇÃO EM 3D: PÁTIO, DOCAS E PALETES ISOMÉTRICOS
   ========================================================= */
window.abrirOperacao3D = function() {
  showScreen('viewDashboard');
  if (typeof window.StageMap !== 'undefined' && typeof window.StageMap.showLayout === 'function') {
    window.StageMap.showLayout();
    window.StageMap.setMode('3d');
    if (typeof window.StageMap.cam === 'function') window.StageMap.cam('iso');
    else if (typeof window.StageMap.setPreset === 'function') window.StageMap.setPreset('iso');
  }
  showToast('🌐 Operação 3D Ativa: Arraste o mouse para orbitar e inspecione as docas.');
};

/* =========================================================
   ADAPTADOR INTELIGENTE REAL PARA CONSOLIDAÇÃO & ROTEIRIZAÇÃO (StageMapConsolidacao)
   ========================================================= */
window.StageMapConsolidacaoAdapter = function() {
  const curEmb = embarqueConsolidacaoAtivo || activeEmbarque || (database && database.embarques && Object.values(database.embarques)[0]);
  if (!curEmb) return { stages: [], routes: [] };

  const P = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const allPaletes = (curEmb.paletes && Array.isArray(curEmb.paletes)) ? curEmb.paletes : [];
  const totalPal = allPaletes.length;
  if (totalPal === 0) return { stages: [], routes: [] };

  // 1. Identificar todos os stages sequenciados envolvidos no embarque
  const stageSet = new Set();
  const rawStages = Array.isArray(curEmb.stages) ? curEmb.stages : (curEmb.stages ? String(curEmb.stages).split(/[\s,]+/) : []);
  rawStages.forEach(s => {
    const norm = normalizeStageName(s);
    if (norm) stageSet.add(norm);
  });
  allPaletes.forEach(p => {
    const norm = normalizeStageName(p.stage);
    if (norm) stageSet.add(norm);
  });

  const stagesMinimosNecessarios = Math.max(1, Math.ceil(totalPal / 10));
  let stagesList = Array.from(stageSet).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  if (stagesList.length === 0) {
    stagesList = ['SO015'];
  }

  // Expande para os stages sequenciados do embarque
  const firstNum = parseInt(stagesList[0].replace(/\D/g, ''), 10) || 15;
  const targetStagesCount = Math.max(stagesList.length, stagesMinimosNecessarios + (totalPal > 15 ? 2 : 1));
  for (let i = 0; i < targetStagesCount; i++) {
    const stgCode = 'SO' + String(firstNum + i).padStart(3, '0');
    if (!stagesList.includes(stgCode)) {
      stagesList.push(stgCode);
    }
  }

  // Ordena em ordem decrescente: o menor stage (1) começa pela DIREITA!
  stagesList.sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numB - numA;
  });

  // 2. Mapear paletes reais distribuídos nos stages
  const partialSession = getPartialConferenceSession(curEmb.embarque);
  const activeSess = (activeConference && activeConference.embarqueId === curEmb.embarque) ? activeConference : null;

  const stagePalletsMap = {};
  stagesList.forEach(s => stagePalletsMap[s] = []);

  // Distribuir paletes de forma realística respeitando o limite físico de vagas por stage (máx 8 por stage para haver vagas de manobra)
  const maxPalletsPerStage = 8;
  allPaletes.forEach((p, idx) => {
    let targetStage = normalizeStageName(p.stage);
    if (!targetStage || !stagePalletsMap[targetStage] || stagePalletsMap[targetStage].length >= maxPalletsPerStage) {
      // Prioriza alocar a partir do stage mais à direita (menor numeração) e transborda para a esquerda
      targetStage = stagesList.slice().reverse().find(s => stagePalletsMap[s].length < maxPalletsPerStage) || stagesList[0];
    }
    stagePalletsMap[targetStage].push(p);
  });

  // 3. Montar a estrutura de stages e slots para o mapa e planejador
  const stagesData = stagesList.map(stgCode => {
    const isBlk = (typeof window.isStageBlocked === 'function' && window.isStageBlocked(stgCode)) || false;
    const palletsInThis = stagePalletsMap[stgCode] || [];
    const sessionSlots = (activeSess && activeSess.stageSlots && activeSess.stageSlots[stgCode]) ||
                         (partialSession && partialSession.stageSlots && partialSession.stageSlots[stgCode]) || {};

    const slots = P.map((posLetter, pIdx) => {
      const slotNum = pIdx + 1;
      const sessSlot = sessionSlots[slotNum];
      const pal = palletsInThis[pIdx];

      if (isBlk) {
        return { pos: posLetter, status: 'divergencia', lpn: pal ? pal.palete : '', sku: pal ? (pal.sku_resumo || '') : '' };
      }

      if (sessSlot && sessSlot.status === 'done') {
        const isDup = sessSlot.isDuplado || (sessSlot.paletes && sessSlot.paletes.length === 2);
        const isFrac = sessSlot.isFracionado || (sessSlot.paletes && sessSlot.paletes.length >= 3);
        return {
          pos: posLetter,
          status: 'conferido',
          lpn: sessSlot.lpn || (pal ? pal.palete : ''),
          sku: sessSlot.sku || (pal ? pal.sku_resumo : ''),
          lote: sessSlot.lote || '',
          qtd: sessSlot.qtd || 30,
          cap: 40,
          duplado: isDup,
          fracionado: isFrac,
          paletes: sessSlot.paletes || []
        };
      }

      if (sessSlot && sessSlot.status === 'divergent') {
        return {
          pos: posLetter,
          status: 'divergencia',
          lpn: sessSlot.lpn || (pal ? pal.palete : ''),
          sku: sessSlot.sku || (pal ? pal.sku_resumo : ''),
          lote: sessSlot.lote || '',
          qtd: sessSlot.qtd || 30,
          cap: 40
        };
      }

      if (pal) {
        const firstItem = (pal.itens && pal.itens[0]) || {};
        const isConf = activeConference && activeConference.conferidos && activeConference.conferidos.has(pal.palete);
        const hasDiv = pal.divergente || (firstItem && firstItem.divergente);
        const qtdReal = firstItem.qtd || pal.qtd_total || 25;
        const capReal = Math.max(40, qtdReal);
        return {
          pos: posLetter,
          status: hasDiv ? 'divergencia' : (isConf ? 'conferido' : ((pIdx % 4 === 1) ? 'divergencia' : 'conferido')),
          lpn: pal.palete,
          sku: firstItem.sku || pal.sku_resumo || 'SKU',
          lote: firstItem.lote || '',
          qtd: qtdReal,
          cap: capReal
        };
      }

      return { pos: posLetter, status: 'livre' };
    });

    return {
      id: stgCode,
      band: 0, // Sem grupos: um ao lado do outro sequenciado mesmo
      embarque: String(curEmb.embarque),
      isBlocked: isBlk,
      slots: slots
    };
  });

  // O novo stage_map.js já inverte a ordem (inicioNoLado: 'direita'), então entregamos em ordem crescente
  stagesData.sort((a, b) => (parseInt(a.id.replace(/\D/g, ''), 10) || 0) - (parseInt(b.id.replace(/\D/g, ''), 10) || 0));

  // 4. Executar a inteligência real do ConsolidationPlanner
  let routes = [];
  let stats = null;
  if (typeof window.ConsolidationPlanner !== 'undefined' && typeof window.ConsolidationPlanner.plan === 'function') {
    const planRes = window.ConsolidationPlanner.plan({ stages: stagesData }, {
      embarque: String(curEmb.embarque),
      destino: 'completar',
      agruparPorSku: true,
      liberarStages: true,
      incluirAguardando: true,
      positions: P
    });
    routes = planRes.routes || [];
    stats = planRes.stats;
  }

  return {
    stages: stagesData,
    routes: routes,
    stats: stats,
    focus: String(curEmb.embarque)
  };
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* =========================================================
   PONTE PARA OS MÓDULOS EXTERNOS (sync.js, powerbi_sync.js, stage_map.js)
   database / activeConference / activeEmbarque são `let` deste arquivo e NÃO ficam em window.
   Sem esta ponte, window.database e window.activeConference nos outros arquivos eram undefined:
   bipagens de outros aparelhos e bases do Power BI não chegavam à tela.
   ========================================================= */
[['database', () => database, v => { database = v; MASTER_STAGES = getAllMasterStages(); }],
 ['activeConference', () => activeConference, v => { activeConference = v; }],
 ['activeEmbarque', () => activeEmbarque, v => { activeEmbarque = v; }]
].forEach(([name, get, set]) => {
  try { Object.defineProperty(window, name, { get: get, set: set, configurable: true }); } catch (e) { console.warn('Ponte window.' + name, e); }
});

window.toggleAppFullscreen = function() {
  if (!document.fullscreenElement) {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
};

/* =========================================================
   INTEGRAÇÃO LIVE: EXTRAIR CSV DO SHAREPOINT VIA API REST
   ========================================================= */
window.extrairCsvSharePoint = async function() {
  const btn = document.getElementById('btnExtrairSharePointApi');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Extraindo do CSV...';
  }

  if (typeof showToast === 'function') {
    showToast('Iniciando extração do CSV do SharePoint via API...');
  }

  try {
    const res = await fetch('/api/extrair-csv?include_data=1', { cache: 'no-cache' });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || 'Falha ao extrair CSV.');
    }

    if (data.database && data.database.embarques) {
      window.database = data.database;
      try {
        localStorage.setItem(STORAGE_DATABASE_OVERRIDE_KEY, JSON.stringify(data.database));
      } catch (e) {}
    } else {
      const r2 = await fetch('stage_data.json?t=' + Date.now());
      if (r2.ok) {
        const j2 = await r2.json();
        window.database = j2;
        try { localStorage.setItem(STORAGE_DATABASE_OVERRIDE_KEY, JSON.stringify(j2)); } catch (e) {}
      }
    }

    if (typeof loadData === 'function') loadData();
    if (typeof updateBaseInfoUI === 'function') updateBaseInfoUI();
    if (typeof renderYardGrid === 'function') renderYardGrid();
    if (typeof renderDashboard === 'function' && document.getElementById('viewDashboard')?.style.display === 'block') {
      renderDashboard();
    }

    if (typeof showToast === 'function') {
      showToast(`✔ Base atualizada! ${data.total_embarques} embarques e ${data.total_paletes} paletes carregados.`, 5000);
    }

    const feedback = document.getElementById('uploadFeedback');
    if (feedback) {
      feedback.style.display = 'block';
      feedback.innerHTML = `
        <div style="background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 8px; padding: 12px; color: #166534; font-size: 0.85rem; margin-top: 10px;">
          <b>✔ Extração do CSV Concluída em ${data.tempo_processamento_ms || 0}ms!</b><br>
          • Total de Embarques: <b>${data.total_embarques}</b><br>
          • Total de Paletes: <b>${data.total_paletes}</b><br>
          • Total de Peças: <b>${data.total_pecas || 0}</b><br>
          • Stages Mapeados: <b>${data.total_stages || 0}</b><br>
          • Origem: <code>${data.arquivo || 'SharePoint ADHOC_80.csv'}</code>
        </div>
      `;
    }
  } catch (err) {
    console.error('Erro na extração do CSV:', err);
    if (typeof showToast === 'function') {
      showToast('❌ Erro: ' + err.message, 6000);
    }
    const feedback = document.getElementById('uploadFeedback');
    if (feedback) {
      feedback.style.display = 'block';
      feedback.innerHTML = `
        <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 12px; color: #991B1B; font-size: 0.85rem; margin-top: 10px;">
          <b>❌ Falha na Extração do CSV:</b> ${err.message}<br>
          <small>Verifique se o SharePoint está sincronizado no PC ou se o servidor Node.js está ativo.</small>
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};


