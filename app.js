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

// 67 Stages mapeados da base operacional (Faixas 004-034, 040-074, 129-142)
const MASTER_STAGES = [
  "SO004", "SO008", "SO09", "SO010", "SO10", "SO11", "SO012", "SO12", "SO13", "SO14", "SO15", "SO16", "SO17", "SO017", "SO18", "SO19", "SO20", "SO021", "SO21", "SO022", "SO22", "SO23", "SO023", "SO24", "SO024", "SO25", "SO26", "SO027", "SO27", "SO28", "SO29", "SO030", "SO031", "SO033", "SO034",
  "SO040", "SO043", "SO48", "SO048", "SO049", "SO051", "SO052", "SO053", "SO53", "SO54", "SO55", "SO56", "SO057", "SO059", "SO061", "SO62", "SO063", "SO064", "SO068", "SO070", "SO074",
  "SO129", "SO130", "SO132", "SO133", "SO134", "SO135", "SO136", "SO137", "SO138", "SO139", "SO142"
];

/* =========================================================
   ESTADO DA APLICAÇÃO
   ========================================================= */
let database = null;
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
    if (window.EMBEDDED_STAGE_DATA) {
      database = JSON.parse(JSON.stringify(window.EMBEDDED_STAGE_DATA));
    } else {
      database = { embarques: {} };
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
   PARSER DE PLANILHAS EXCEL (TABULAR + GUIA + WMS)
   ========================================================= */
function processExcelFile(file) {
  const feedback = document.getElementById('uploadFeedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.innerHTML = `<div style="color: var(--text-secondary); padding: 10px;">⏳ Lendo e processando planilha <b>${file.name}</b>...</div>`;
  }

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

      const embKeys = Object.keys(parsedEmbarques);
      if (embKeys.length === 0) {
        throw new Error('Não foi possível identificar dados de embarque/paletes nesta planilha. Verifique o formato.');
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
          arquivo_origem: file.name,
          embarques: parsedEmbarques
        };
      } else {
        // Guia avulsa de embarque específico: atualiza/adiciona na base existente
        if (!database) database = { embarques: {} };
        database.data_base = dataHoje;
        database.gerado_em = dataHoraHoje;
        database.arquivo_origem = file.name;
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
        arquivo: file.name,
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
            • Arquivo: <b>${file.name}</b><br>
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

    } catch(err) {
      console.error(err);
      if (feedback) {
        feedback.innerHTML = `
          <div style="background: var(--status-err-bg); border: 1px solid var(--status-err-border); color: #991B1B; padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem;">
            <b>✖ Erro ao processar planilha:</b> ${err.message}
          </div>
        `;
      }
    }
  };
  reader.readAsArrayBuffer(file);
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

function calculateNextTargetSlot(stageCode) {
  const stg = stageCode || activeConference.currentPhysicalStage || (activeEmbarque ? formatStages(activeEmbarque.stages) : '');
  const cap = activeConference.capacity || 10;
  const blocked = getStageBlockedSlots(stg);
  const slots = (activeConference.stageSlots && activeConference.stageSlots[stg]) || activeConference.slots || {};

  if (activeConference.direction === 'desc') {
    // Sentido 10 -> 1
    for (let s = cap; s >= 1; s--) {
      if (!blocked.includes(s) && (!slots[s] || (slots[s].status !== 'done' && slots[s].status !== 'divergent'))) {
        return s;
      }
    }
  } else {
    // Sentido 1 -> 10
    for (let s = 1; s <= cap; s++) {
      if (!blocked.includes(s) && (!slots[s] || (slots[s].status !== 'done' && slots[s].status !== 'divergent'))) {
        return s;
      }
    }
  }
  return 1;
}

window.switchPhysicalStage = function(stageCode, force = false) {
  const norm = normalizeStageName(stageCode);
  if (!norm) return false;

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

    let cellClass = 'slot-cell';
    let statusText = 'LIVRE';
    let lpnText = '';

    if (isBlocked) {
      cellClass += ' slot-blocked';
      statusText = 'BLOQUEADO ✖';
    } else if (slotData && slotData.status === 'done') {
      cellClass += ' slot-done';
      statusText = 'CONFERIDO ✔';
      lpnText = slotData.lpn ? '...' + slotData.lpn.slice(-4) : '';
    } else if (slotData && slotData.status === 'divergent') {
      cellClass += ' slot-divergent';
      statusText = 'DIVERGÊNCIA ✖';
      lpnText = slotData.lpn ? '...' + slotData.lpn.slice(-4) : '';
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
        ${lpnText ? `<span class="slot-lpn">${lpnText}</span>` : ''}
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

  activeConference.activeSlot = slotNum;
  renderStageSlotsGrid();
  focusScanner();
  showToast(`Próxima alocação direcionada para a Vaga ${slotNum}`);
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
  let matchedEmbs = [];
  if (database && database.embarques) {
    Object.values(database.embarques).forEach(e => {
      if (e && e.stages && e.embarque) {
        const sList = Array.isArray(e.stages) ? e.stages : String(e.stages).split(/[\s,]+/);
        const match = sList.some(s => normalizeStageName(s) === normStage);
        if (match && !matchedEmbs.some(m => m.embarque === e.embarque)) {
          matchedEmbs.push(e);
        }
      }
    });
  }

  const stageCap = getStageCapacity(stageCode);
  const blockedSlots = getStageBlockedSlots(stageCode);

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

  const mainEmb = matchedEmbs[0];
  const partialSession = getPartialConferenceSession(mainEmb.embarque);
  const totalPal = mainEmb.total_paletes || 0;

  // Paletes esperados especificamente para este stage (se desmembrado)
  let palletsInThisStage = 0;
  if (mainEmb && mainEmb.paletes) {
    palletsInThisStage = mainEmb.paletes.filter(p => normalizeStageName(p.stage) === normStage).length;
  }
  if (palletsInThisStage === 0) palletsInThisStage = Math.min(stageCap, totalPal);

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
    );
  } else if (partialSession) {
    // 2. Conferência parcial salva deste embarque
    if (partialSession.stageSlots && partialSession.stageSlots[normStage]) {
      slots = partialSession.stageSlots[normStage];
    } else if (partialSession.currentPhysicalStage && normalizeStageName(partialSession.currentPhysicalStage) === normStage) {
      slots = partialSession.slots || {};
    }
    conferidosCount = Object.values(slots).filter(s => s && s.status === 'done').length;
    if (partialSession.divergencias && partialSession.divergencias.length > 0) hasDivergence = true;
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
  }

  if (blockedSlots.length > 0) {
    hasDivergence = true;
  }

  // Determinação de Status do Ciclo de Vida: Cabeça -> Meio -> Fim
  let status = 'aguardando';
  let statusText = 'AGUARDANDO';
  let badgeClass = 'badge-waiting';
  let cardClass = 'card-waiting';

  if (conferidosCount >= palletsInThisStage && palletsInThisStage > 0) {
    // FIM: 100% CONCLUÍDO / CONFERIDO
    status = 'conferido';
    statusText = hasDivergence ? 'CONFERIDO (C/ ALERTA)' : 'CONFERIDO';
    badgeClass = 'badge-done';
    cardClass = 'card-done';
  } else if (conferidosCount > 0) {
    // MEIO: PARCIAL EM ANDAMENTO
    status = 'parcial';
    statusText = `PARCIAL ${conferidosCount}/${palletsInThisStage}`;
    badgeClass = 'badge-partial';
    cardClass = 'card-partial';
  } else if (hasDivergence) {
    // OCORRÊNCIA COM ZERO CONFERÊNCIAS
    status = 'divergencia';
    statusText = 'DIVERGÊNCIA';
    badgeClass = 'badge-divergent';
    cardClass = 'card-divergent';
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
    { title: 'Faixa 1 • Docas SO004 a SO034', min: 4, max: 34 },
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
                ${inGroup.map(stg => `
                  <th class="yard-stage-col-header ${stg.embarque ? 'stg-has-emb' : 'stg-free'}">
                    ${stg.stage}
                  </th>
                `).join('')}
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
                      const isBlocked = stg.blockedSlots.includes(s);
                      const isTarget = (activeConference && activeConference.embarqueId === (stg.embarque && stg.embarque.embarque) && activeConference.activeSlot === s && normalizeStageName(activeConference.currentPhysicalStage) === normalizeStageName(stg.stage));
                      const slotData = (stg.slots && s <= stg.palletsInThisStage) ? stg.slots[s] : null;

                      const locCode = formatStageSlotDisplay(stg.stage, s);
                      let colorClass = 'cell-free';
                      let titleDesc = `[${locCode}] Stage ${stg.stage} - Vaga ${letter} (${s}): `;

                      if (!stg.embarque || s > stg.palletsInThisStage) {
                        // Vaga livre ou além do volume planejado para este stage
                        colorClass = 'cell-free';
                        titleDesc += stg.embarque ? `Vaga Livre no Stage (Carga: ${stg.palletsInThisStage} paletes)` : 'Stage Livre';
                      } else if (isBlocked) {
                        colorClass = 'cell-divergencia';
                        titleDesc += 'BLOQUEADO / OCORRÊNCIA';
                      } else if (stg.status === 'conferido') {
                        // 100% Concluído
                        colorClass = 'cell-conferido';
                        titleDesc += `CONFERIDO ✔ (LPN ${slotData?.lpn || 'OK'})`;
                      } else if (stg.status === 'parcial') {
                        // Parcial: Apenas vagas realmente bipadas ficam verdes!
                        if (slotData && slotData.status === 'done' && s <= stg.conferidosCount) {
                          colorClass = 'cell-conferido';
                          titleDesc += `CONFERIDO (LPN ${slotData.lpn || ''}) ✔`;
                        } else if (s <= stg.conferidosCount) {
                          colorClass = 'cell-conferido';
                          titleDesc += `CONFERIDO (${s}/${stg.conferidosCount}) ✔`;
                        } else if (slotData && slotData.status === 'divergent') {
                          colorClass = 'cell-divergencia';
                          titleDesc += 'DIVERGÊNCIA / INVENTÁRIO';
                        } else if (isTarget || (s === stg.conferidosCount + 1 && activeConference && activeConference.embarqueId === (stg.embarque && stg.embarque.embarque))) {
                          colorClass = 'cell-ativo';
                          titleDesc += 'PRÓXIMO A BIPAR (VAGA ATIVA)';
                        } else {
                          colorClass = 'cell-parcial';
                          titleDesc += `Pendente de Bipagem (${stg.conferidosCount}/${stg.palletsInThisStage} paletes)`;
                        }
                      } else if (stg.status === 'divergencia') {
                        colorClass = 'cell-divergencia';
                        titleDesc += 'DIVERGÊNCIA NO STAGE';
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
      { title: 'Faixa 1 • Docas SO004 a SO034', min: 4, max: 34 },
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

        html += `
          <div class="stage-card ${stg.cardClass}" onclick="openStageDetailModal('${stg.stage}')">
            <div class="stage-card-top">
              <span class="stage-card-name">${stg.stage}</span>
              <span class="stage-card-badge ${stg.badgeClass}">${stg.statusText}</span>
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
}

window.openStageDetailModal = function(stageCode) {
  const modal = document.getElementById('modalStageDetail');
  const title = document.getElementById('stageDetailTitle');
  const sub = document.getElementById('stageDetailSub');
  const body = document.getElementById('stageDetailBody');
  const btnConf = document.getElementById('btnConferirStageAgora');

  if (!modal || !title || !body) return;

  const stgInfo = getDashboardStageInfo(stageCode);
  title.textContent = `Stage ${stageCode}`;
  sub.textContent = stgInfo.embarque 
    ? `Embarque ${stgInfo.embarque.embarque} • ${stgInfo.statusText} • Capacidade: ${stgInfo.capacity} vagas`
    : `Stage Disponível • Capacidade: ${stgInfo.capacity} vagas`;

  let slotsHtml = `
    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">
        Vagas Físicas no Stage (1 a ${stgInfo.capacity}):
      </div>
      <div class="stage-slots-grid" style="margin-bottom: 0;">
  `;

  for (let s = 1; s <= stgInfo.capacity; s++) {
    const isBlocked = stgInfo.blockedSlots.includes(s);
    const slotData = stgInfo.slots ? stgInfo.slots[s] : null;

    let cellClass = 'slot-cell';
    let statusText = 'LIVRE';
    let lpnText = '';

    if (isBlocked) {
      cellClass += ' slot-blocked';
      statusText = 'BLOQUEADO';
    } else if (slotData && slotData.status === 'done') {
      cellClass += ' slot-done';
      statusText = 'CONFERIDO';
      lpnText = slotData.lpn ? '...' + slotData.lpn.slice(-4) : '';
    } else {
      cellClass += ' slot-free';
      statusText = 'LIVRE';
    }

    const locCode = formatStageSlotDisplay(stageCode, s);
    const letter = String.fromCharCode(64 + s);

    slotsHtml += `
      <div class="${cellClass}">
        <span class="slot-num">${locCode}</span>
        <span class="slot-pos-sub">Vaga ${s} (${letter})</span>
        <span class="slot-status-text">${statusText}</span>
        ${lpnText ? `<span class="slot-lpn">${lpnText}</span>` : ''}
      </div>
    `;
  }

  slotsHtml += `</div></div>`;

  let embDetailsHtml = '';
  if (stgInfo.embarque) {
    embDetailsHtml = `
      <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 8px; padding: 14px; font-size: 0.85rem;">
        <div style="font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">
          Dados do Embarque: ${stgInfo.embarque.embarque}
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; color: var(--text-secondary);">
          <div>Total Paletes: <b>${stgInfo.totalPaletes}</b></div>
          <div>Conferidos: <b>${stgInfo.conferidosCount}</b></div>
          <div>Pendentes: <b>${Math.max(0, stgInfo.totalPaletes - stgInfo.conferidosCount)}</b></div>
        </div>
      </div>
    `;
  } else {
    embDetailsHtml = `
      <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: 8px; padding: 14px; color: var(--text-muted); font-size: 0.85rem; text-align: center;">
        Este stage está livre no momento. Nenhum embarque alocado pelo WMS.
      </div>
    `;
  }

  body.innerHTML = slotsHtml + embDetailsHtml;

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

window.closeStageDetailModal = function() {
  const modal = document.getElementById('modalStageDetail');
  if (modal) modal.style.display = 'none';
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
  const operador = (document.getElementById('inputOperador')?.value.trim()) || 'Operador DHL 01';

  if (!embId) {
    if (input) input.focus();
    return;
  }

  if (!database || !database.embarques || !database.embarques[embId]) {
    sound.playError('Embarque não cadastrado');
    alert(`Embarque "${embId}" não localizado na base de dados!\n\nVocê pode carregar a planilha deste embarque clicando no botão "Atualizar Excel" no topo.`);
    if (input) { input.select(); input.focus(); }
    return;
  }

  activeEmbarque = database.embarques[embId];
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

function processBarcode(rawCode) {
  if (!activeEmbarque || isProcessingBarcode) return;
  const code = normalizeBarcode(rawCode);
  if (!code) return;

  isProcessingBarcode = true;
  clearTimeout(scanDebounceTimer);

  const now = new Date();
  const timestampStr = now.toLocaleTimeString();

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

    const occupant = getStageOccupant(baseStage, activeEmbarque.embarque);

    if (occupant) {
      sound.playError('Stage ocupado por outro embarque');
      triggerCardFlash('pulse-err');
      showFeedback('err', `✖ <b>BLOQUEIO DE INVASÃO:</b> O Stage <b>${baseStage}</b> já está ocupado pelo <b>Embarque ${occupant.embarque}</b>!<br>NÃO É PERMITIDO COBRIR OUTRO EMBARQUE. Aponte o leitor para uma doca/stage LIVRE.`);
      isProcessingBarcode = false;
      focusScanner();
      return;
    }

    window.switchPhysicalStage(baseStage);
    if (targetSlot && targetSlot >= 1 && targetSlot <= (activeConference.capacity || 10)) {
      activeConference.activeSlot = targetSlot;
      renderStageSlotsGrid();
      showToast(`📍 Vaga direcionada para: <b>${formatStageSlotDisplay(baseStage, targetSlot)}</b> (Vaga ${targetSlot})`);
    }
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
  let stgFisico = normalizeStageName(activeConference.currentPhysicalStage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'STAGE');
  const cap = activeConference.capacity || 10;

  if (foundPallet) {
    if (!activeConference.stageSlots) activeConference.stageSlots = {};
    if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};

    // Quantos paletes já estão alocados neste stage físico
    const countInStage = Object.values(activeConference.stageSlots[stgFisico]).filter(s => s && s.status === 'done').length;

    // SE O STAGE ATUAL JÁ ATINGIU A CAPACIDADE MÁXIMA FÍSICA (EX: 10/10)
    if (!activeConference.conferidos.has(foundPallet.palete) && countInStage >= cap) {
      // 1. Tentar primeiro o adjacente imediato
      const adjacentStg = getAdjacentStage(stgFisico, 1);
      const occupantAdj = adjacentStg ? getStageOccupant(adjacentStg, activeEmbarque.embarque) : null;

      if (adjacentStg && !occupantAdj) {
        showToast(`Stage ${stgFisico} lotado (${cap}/${cap}). Ramificando automaticamente para o Stage ${adjacentStg}...`);
        window.switchPhysicalStage(adjacentStg, true);
        stgFisico = adjacentStg;
      } else {
        // 2. Se o adjacente imediato estiver ocupado por outro embarque, buscar a próxima doca livre
        const nextFree = findNextFreeAdjacentStage(stgFisico, activeEmbarque.embarque);
        if (nextFree) {
          showToast(`Stage ${stgFisico} lotado. O ${adjacentStg || 'vizinho'} está ocupado. Ramificando para a doca livre ${nextFree.stage}...`);
          window.switchPhysicalStage(nextFree.stage, true);
          stgFisico = nextFree.stage;
        } else {
          // 3. Solicitar ao operador bipar a placa de onde está alocando
          sound.playWarning('Stage cheio. Bipe a placa do novo stage.');
          showFeedback('warn', `⚠️ <b>STAGE ${stgFisico} LOTADO (${cap}/${cap}):</b><br>Bipe a placa do próximo Stage físico onde os paletes estão sendo colocados (ex: ST005, SO009...).`);
          isProcessingBarcode = false;
          focusScanner();
          return;
        }
      }
    }

    const stgSistemico = normalizeStageName(foundPallet.stage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'STAGE');
    
    // Ramificação válida: o stage físico é uma extensão autorizada do embarque (livre e sem invadir outros)
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
    } else {
      const currentSlot = activeConference.activeSlot || 1;
      const locCode = formatStageSlotDisplay(stgFisico, currentSlot);

      const slotData = {
        slot: currentSlot,
        locCode: locCode,
        lpn: foundPallet.palete,
        status: isMatch ? 'done' : 'divergent',
        stageFisico: stgFisico,
        stageSistemico: stgSistemico,
        isMatch: isMatch,
        isRamification: isAdjacentRamification,
        sku: foundPallet.sku_resumo,
        qtd: foundPallet.qtd_total,
        timestamp: timestampStr
      };

      if (!activeConference.stageSlots) activeConference.stageSlots = {};
      if (!activeConference.stageSlots[stgFisico]) activeConference.stageSlots[stgFisico] = {};
      activeConference.stageSlots[stgFisico][currentSlot] = slotData;
      activeConference.slots = activeConference.stageSlots[stgFisico];

      activeConference.conferidos.set(foundPallet.palete, {
        palete: foundPallet,
        slot: currentSlot,
        locCode: locCode,
        stageFisico: stgFisico,
        stageSistemico: stgSistemico,
        isMatch: isMatch,
        isRamification: isAdjacentRamification,
        timestamp: timestampStr
      });

      const progressoAtual = activeConference.conferidos.size;
      const total = activeEmbarque.total_paletes;

      if (!isMatch) {
        // NÃO BATEU (VERMELHO) - Divergência de Stage Físico x Sistêmico
        sound.playError('Stage divergente');
        triggerCardFlash('pulse-err');
        showFeedback('err', `✖ <b>FÍSICO X SISTÊMICO: NÃO BATEU!</b><br>LPN <b>${foundPallet.palete}</b> pertence sistemicamente ao <b>${stgSistemico}</b>, mas foi alocada no Local <b>${locCode}</b> (${stgFisico}, Vaga ${currentSlot}).`);

        activeConference.divergencias.unshift({
          paleteId: foundPallet.palete,
          timestamp: timestampStr,
          tipo: 'divergencia_stage',
          detalhes: `Stage Sistêmico ${stgSistemico} ≠ Stage Físico ${stgFisico} (${locCode})`,
          stageFisico: stgFisico,
          stageSistemico: stgSistemico,
          locCode: locCode
        });
      } else {
        // BATEU (VERDE)
        const matchLabel = isAdjacentRamification 
          ? `✔ <b>FÍSICO X SISTÊMICO: BATEU! (Ramificação no Stage ${stgFisico})</b>`
          : `✔ <b>FÍSICO X SISTÊMICO: BATEU!</b>`;

        if (progressoAtual === total) {
          sound.playSuccess('Carga concluída com sucesso');
          triggerCardFlash('pulse-ok');
          showFeedback('ok', `${matchLabel} [Local: <b>${locCode}</b>] • Carga 100% Conferida! Todos os ${total} paletes validados.`);
        } else {
          sound.playSuccess(`Bateu! Local ${locCode}`);
          triggerCardFlash('pulse-ok');
          showFeedback('ok', `${matchLabel} • Local: <b>${locCode}</b> (${stgFisico}, Vaga ${currentSlot}) • LPN ${foundPallet.palete} [${progressoAtual}/${total}] • ${foundPallet.desc_resumo} (${foundPallet.qtd_total} un)`);
        }
      }

      activeConference.historico.unshift({
        tipo: isMatch ? 'ok' : 'divergencia_stage',
        palete: foundPallet.palete,
        slot: currentSlot,
        locCode: locCode,
        stageFisico: stgFisico,
        stageSistemico: stgSistemico,
        isMatch: isMatch,
        desc: foundPallet.desc_resumo,
        qtd: foundPallet.qtd_total,
        timestamp: timestampStr
      });

      activeConference.activeSlot = calculateNextTargetSlot(stgFisico);
      renderStageSlotsGrid();
      savePartialConferenceSession();
    }
  } else {
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

    triggerCardFlash('pulse-err');

    if (crossMatch) {
      showFeedback('err', `✖ <b>DIVERGÊNCIA:</b> LPN ${code} NÃO pertence ao Embarque ${embAuditado}! Pertence ao Embarque ${embCorreto} (Stage ${stageCorreto}).`);
    } else {
      showFeedback('err', `✖ <b>DIVERGÊNCIA:</b> LPN ${code} não localizada em nenhum embarque ativo!`);
    }

    activeConference.historico.unshift({
      tipo: 'erro',
      palete: code,
      stageFisico: stgFisico,
      stageSistemico: stageCorreto,
      isMatch: false,
      desc: ticketDesc,
      timestamp: timestampStr
    });
  }

  recordActiveConferenceToHistory('Em Andamento');
  persistActiveSession();

  updateUI();

  setTimeout(() => {
    isProcessingBarcode = false;
    focusScanner();
  }, 40);
}

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
      stage_label: p.stage || formatStages(activeEmbarque.stages),
      desc: p.desc_resumo || '',
      conferido: false
    };
  });
}

function atualizarConferidosAmostragem() {
  if (!activeConference) return;
  amostragemAtiva.forEach(item => {
    item.conferido = activeConference.conferidos.has(item.palete);
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

  const doneCount = amostragemAtiva.filter(a => a.conferido).length;
  const total = amostragemAtiva.length;

  const pill = document.getElementById('amostragemProgressPill');
  if (pill) {
    pill.textContent = `${doneCount}/${total}`;
    pill.className = 'amostragem-pill' + (doneCount === total ? ' done' : doneCount > 0 ? ' partial' : '');
  }

  const statusEl = document.getElementById('amostragemStatus');
  if (statusEl) {
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    if (doneCount === total) {
      statusEl.textContent = `✔ Amostragem concluída! ${doneCount}/${total} paletes conferidos (${pct}%)`;
    } else {
      statusEl.textContent = `${doneCount} de ${total} paletes amostrados conferidos (${pct}%) • ${total - doneCount} pendentes`;
    }
  }

  const list = document.getElementById('amostragemList');
  if (list) {
    list.innerHTML = amostragemAtiva.map((item, idx) => {
      const cls = item.conferido ? 'amostra-ok' : 'amostra-pendente';
      const icon = item.conferido ? '✔' : '⏳';
      const details = [item.sku, item.lote, item.stage_label].filter(Boolean).join(' • ');
      return `
        <div class="amostragem-item ${cls}">
          <span class="amostra-check">${icon}</span>
          <span class="amostra-lpn">${item.palete}</span>
          ${details ? `<span class="amostra-details">${details}</span>` : ''}
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

  // Mapa: chave "SKU|Lote" -> lista de paletes
  const mapa = new Map();

  emb.paletes.forEach(p => {
    const firstItem = (p.itens && p.itens.length > 0) ? p.itens[0] : null;
    const sku = (firstItem ? (firstItem.sku || '') : '') || p.sku_resumo || '';
    const lote = (firstItem ? (firstItem.lote || '') : '');
    const chave = sku ? `${sku}|${lote}` : `__SEM_SKU__|${p.palete}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        sku: sku || '(SKU não informado)',
        lote: lote || '',
        desc: p.desc_resumo || '',
        paletes: []
      });
    }
    mapa.get(chave).paletes.push({
      lpn: p.palete,
      stage: normalizeStageName(p.stage || (emb.stages && emb.stages[0]) || ''),
      stage_raw: p.stage || '',
      qtd: p.qtd_total || 0,
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

    // Stages únicos onde este SKU+Lote está alocado
    const stagesUnicos = [...new Set(paletes.map(p => p.stage).filter(Boolean))];
    const stagesOrdenados = stagesUnicos.sort();

    // Calcular cubagem: quantos stages mínimos são necessários se consolidarmos
    const capPorStage = 10;
    const stagesMinimos = Math.ceil(totalPaletes / capPorStage);
    const economiaStages = Math.max(0, stagesUnicos.length - stagesMinimos);
    const economiaPaletes = isDuplicado ? totalPaletes - 1 : 0; // Não reduz paletes, mas reduz posições

    // Gerar plano de roteirização para este grupo
    const plano = gerarPlanoGrupo(grupo.sku, grupo.lote, paletes, stagesOrdenados, capPorStage);

    grupos.push({
      chave,
      sku: grupo.sku,
      lote: grupo.lote,
      desc: grupo.desc,
      paletes,
      totalPaletes,
      totalUnidades,
      isDuplicado,
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

// ---- Gera o plano passo-a-passo para um grupo de SKU+Lote ----
function gerarPlanoGrupo(sku, lote, paletes, stagesAtivos, capPorStage) {
  const steps = [];
  if (paletes.length <= 1) {
    steps.push({ num: 1, texto: `Palete único — Nenhuma ação necessária. Stage atual: <b>${stagesAtivos[0] || '—'}</b>`, ok: true });
    return steps;
  }

  // Stage de destino: o menor numericamente (primeiro que aparece)
  const stageDestino = stagesAtivos[0] || 'SO???';
  const qtdTotal = paletes.length;
  const stagesNecessarios = Math.ceil(qtdTotal / capPorStage);

  // Paletes que já estão no stage de destino vs. os que precisam mover
  const noDestino = paletes.filter(p => p.stage === stageDestino);
  const paraMovar = paletes.filter(p => p.stage !== stageDestino);

  if (paraMovar.length > 0) {
    steps.push({
      num: 1,
      texto: `Concentrar todos os ${qtdTotal} paletes de SKU <b>${sku}</b>${lote ? ' / Lote <b>' + lote + '</b>' : ''} no Stage <b>${stageDestino}</b>`,
      ok: false
    });
    paraMovar.forEach((p, i) => {
      steps.push({
        num: steps.length + 1,
        texto: `↳ Mover LPN <code>${p.lpn}</code> do Stage <b>${p.stage || '?'}</b> → <b>${stageDestino}</b>`,
        ok: p.stage === stageDestino
      });
    });
  } else {
    steps.push({
      num: 1,
      texto: `✔ Todos os ${qtdTotal} paletes já estão no Stage <b>${stageDestino}</b> — Consolidação física já realizada!`,
      ok: true
    });
  }

  // Se precisar de mais de 1 stage por capacidade
  if (stagesNecessarios > 1) {
    for (let i = 1; i < stagesNecessarios; i++) {
      // Pegar o próximo stage na lista de stages ativos ou sugerir um adjacente
      const stageExtra = stagesAtivos[i] || ('SO' + String(parseInt(stageDestino.replace(/\D/g,''), 10) + i).padStart(3, '0'));
      const paletesDeste = paletes.slice(i * capPorStage, (i + 1) * capPorStage);
      steps.push({
        num: steps.length + 1,
        texto: `Excedente de capacidade: ${paletesDeste.length} palete(s) para o Stage <b>${stageExtra}</b> (overflow do ${stageDestino})`,
        ok: false
      });
    }
  }

  // Passo final: atualizar WMS
  steps.push({
    num: steps.length + 1,
    texto: `Registrar no WMS: <b>${qtdTotal} paletes</b> de SKU <b>${sku}</b> no(s) Stage(s) <b>${stagesAtivos.join(', ')}</b>`,
    ok: null
  });

  return steps;
}

// ---- Gera roteirização global de todos os grupos que precisam consolidar ----
function gerarRoteirizacaoGlobal(grupos) {
  const grupoDupl = grupos.filter(g => g.isDuplicado && g.stagesAtivos.length > 1);
  if (grupoDupl.length === 0) return null;

  // Agrupar por stage de origem -> destino
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

  const steps = [];
  Object.entries(porDestino).sort((a, b) => a[0].localeCompare(b[0])).forEach(([dest, mvs], idx) => {
    const origens = [...new Set(mvs.map(m => m.de))].join(', ');
    steps.push({
      num: idx + 1,
      destino: dest,
      origens,
      qtd: mvs.length,
      skus: [...new Set(mvs.map(m => `SKU ${m.sku}${m.lote ? '/Lote ' + m.lote : ''}`))]
    });
  });

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
  const nConsolidaveis = grupos.filter(g => g.isDuplicado && g.stagesAtivos.length > 1).reduce((s, g) => s + g.totalPaletes, 0);
  const economia = grupos.reduce((s, g) => s + (g.isDuplicado ? g.totalPaletes - 1 : 0), 0);

  document.getElementById('consKpiTotal').textContent = totalPaletes;
  document.getElementById('consKpiDuplicados').textContent = nDuplicados;
  document.getElementById('consKpiConsolidaveis').textContent = nConsolidaveis;
  const curEmb = embarqueConsolidacaoAtivo || activeEmbarque;
  document.getElementById('consKpiEmbarque').textContent = curEmb ? curEmb.embarque : '—';

  // Roteirização Global
  const routeGlobal = gerarRoteirizacaoGlobal(grupos);
  const routeSec = document.getElementById('consRoteirizacaoGlobal');
  const routeBody = document.getElementById('consRoteirizacaoBody');
  if (routeSec && routeBody) {
    if (routeGlobal && routeGlobal.length > 0) {
      routeSec.style.display = '';
      routeBody.innerHTML = routeGlobal.map(s => `
        <div class="cons-route-step-global">
          <span class="cons-step-num-global">${s.num}</span>
          <span>
            Consolidar <b>${s.qtd} palete(s)</b> vindos de
            <span class="cons-step-stage-badge">${s.origens}</span>
            → Stage destino
            <span class="cons-step-stage-badge">${s.destino}</span>
            • ${s.skus.join(', ')}
          </span>
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
      ? `${g.totalPaletes} paletes — Consolidar!`
      : `${g.totalPaletes} palete — Único`;

    const paletesHtml = g.paletes.map((p, pIdx) => {
      const statusCls = p.conferido ? 'conferido' : 'pendente';
      const statusTxt = p.conferido ? '✔ Conferido' : '⏳ Pendente';
      const locDisplay = formatStageSlotDisplay(p.stage, (pIdx % 10) + 1);
      return `
        <tr>
          <td><span class="cons-lpn-mono">${p.lpn}</span></td>
          <td><span class="cons-stage-chip" title="Localização no Stage">📍 ${locDisplay}</span></td>
          <td>${p.qtd} un.</td>
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
              <div class="cons-grupo-sku">SKU: ${g.sku}</div>
              ${g.lote ? `<div class="cons-grupo-lote">Lote: ${g.lote}</div>` : ''}
              <div class="cons-grupo-desc">${g.desc}</div>
            </div>
          </div>
          <div class="cons-grupo-header-right">
            <span class="cons-grupo-qtd-total">${stagesStr}</span>
            <span class="cons-grupo-badge ${tipo}">${badgeLabel}</span>
            <span class="cons-grupo-toggle" id="consToggle_${gIdx}">▼</span>
          </div>
        </div>
        <div class="cons-grupo-body" id="consBody_${gIdx}">
          <table class="cons-paletes-table">
            <thead>
              <tr>
                <th>LPN</th>
                <th>Stage</th>
                <th>Qtd</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${paletesHtml}</tbody>
          </table>
          ${g.isDuplicado ? `
            <div class="cons-grupo-plano">
              <div class="cons-grupo-plano-title">📐 Plano de Consolidação e Roteirização</div>
              <div class="cons-plano-steps">${planoHtml}</div>
              ${economiaHtml}
            </div>
          ` : ''}
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
  const emb = database.embarques[embId];
  if (!emb) return;

  embarqueConsolidacaoAtivo = emb;
  consGruposData = analisarConsolidacao(emb);
  renderConsolidacao();
  showToast(`🔗 Consolidação carregada para o Embarque <b>${emb.embarque}</b>.`);
};

window.reprocessarConsolidacao = function() {
  consGruposData = analisarConsolidacao();
  renderConsolidacao();
  showToast('🔄 Consolidação recalculada com base nos dados atuais.');
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
};

window.fecharConsolidacaoTela = function() {
  if (activeEmbarque) {
    showScreen('viewScanner');
  } else {
    showScreen('viewLogin');
  }
};

/* =========================================================
   ATUALIZAÇÃO DE INTERFACE
   ========================================================= */
function updateUI() {
  if (!activeEmbarque) return;

  const total = activeEmbarque.total_paletes;
  const confCount = activeConference.conferidos.size;
  const pendCount = Math.max(0, total - confCount);
  const divCount = activeConference.divergencias.length;
  const percent = total > 0 ? Math.round((confCount / total) * 100) : 0;

  document.getElementById('txtConferidos').textContent = confCount;
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
  if (txtCounts) txtCounts.textContent = `${confCount} de ${total} paletes`;

  const lblStatus = document.getElementById('radialStatusLabel');
  if (lblStatus) {
    if (percent === 100) {
      lblStatus.textContent = 'CONCLUÍDO ✔';
      lblStatus.style.color = '#00A650';
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
      (percent === 100 ? ' status-done' : percent > 0 ? ' status-partial' : '');
  }

  // Estatísticas no Popover Interativo
  const popBadge = document.getElementById('popoverPercentBadge');
  if (popBadge) popBadge.textContent = `${percent}%`;
  const popConf = document.getElementById('popoverConf');
  if (popConf) popConf.textContent = confCount;
  const popPend = document.getElementById('popoverPend');
  if (popPend) popPend.textContent = pendCount;
  const popTot = document.getElementById('popoverTotal');
  if (popTot) popTot.textContent = total;
  const popDiv = document.getElementById('popoverDiv');
  if (popDiv) popDiv.textContent = divCount;
  const popFill = document.getElementById('popoverProgressFill');
  if (popFill) popFill.style.width = `${percent}%`;

  document.getElementById('progressPercent').textContent = `${percent}% (${confCount} de ${total} paletes)`;
  document.getElementById('progressFill').style.width = `${percent}%`;

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
  
  // Agrupar paletes por stage planejado para sequenciamento das vagas estimadas (A, B, C...)
  const stageCounters = {};

  return activeEmbarque.paletes.map((p, idx) => {
    const isConf = activeConference && activeConference.conferidos && activeConference.conferidos.has(p.palete);
    const confData = isConf ? activeConference.conferidos.get(p.palete) : null;
    
    // Stage planejado da planilha
    const stgPlan = normalizeStageName(p.stage || (activeEmbarque.stages && activeEmbarque.stages[0]) || 'STAGE');
    
    let locCode = '';
    let stageName = '';
    let slotLetter = '';
    let slotNum = null;
    let isRamified = false;
    let isDivergent = false;

    if (isConf && confData) {
      stageName = confData.stageFisico;
      slotNum = confData.slot;
      slotLetter = String.fromCharCode(64 + Math.min(10, Math.max(1, slotNum || 1)));
      locCode = confData.locCode || formatStageSlotDisplay(stageName, slotNum);
      isRamified = confData.isRamification || false;
      isDivergent = !confData.isMatch;
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
          <div class="loc-cell-wrap">
            <span class="badge-loc-pill ${locBadgeCls}">📍 ${item.locCode}</span>
            <span class="loc-detail-sub">${item.stageFisico} • Vaga ${item.slotLetter}</span>
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
  link.setAttribute('download', `Ocorrencias_Inventario_Stage_DHL.csv`);
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
  link.setAttribute('download', `Historico_Geral_Auditorias_DHL.csv`);
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

  const inputEmb = document.getElementById('inputEmbarque');
  const btnLogin = document.getElementById('btnLogin');

  if (inputEmb) {
    inputEmb.value = '';
    inputEmb.focus();

    inputEmb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        entrarNoEmbarque();
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener('click', entrarNoEmbarque);
  }

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
