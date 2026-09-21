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
  historico: []
};

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
    historico: activeConference.historico
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
    historico: activeConference.historico
  };
  try {
    localStorage.setItem(STORAGE_ACTIVE_SESSION_KEY, JSON.stringify(session));
  } catch(e) {}
}

/* =========================================================
   CARREGAMENTO E MESCLAGEM DA BASE DE DADOS
   ========================================================= */
function loadData() {
  // 1. Base embutida (stage_data.js)
  if (window.EMBEDDED_STAGE_DATA) {
    database = JSON.parse(JSON.stringify(window.EMBEDDED_STAGE_DATA));
  } else {
    database = { embarques: {} };
  }

  // 2. Base customizada / salva via Upload de Excel no navegador
  try {
    const savedCustom = localStorage.getItem(STORAGE_DATABASE_OVERRIDE_KEY);
    if (savedCustom) {
      const customDb = JSON.parse(savedCustom);
      if (customDb && customDb.embarques) {
        Object.keys(customDb.embarques).forEach(embId => {
          database.embarques[embId] = customDb.embarques[embId];
        });
      }
    }
  } catch(e) {
    console.warn('Erro ao carregar base salva no storage:', e);
  }

  updateBaseInfoUI();
  updateHistoryBadge();
}

function updateBaseInfoUI() {
  const total = database && database.embarques ? Object.keys(database.embarques).length : 0;
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

      // Estatísticas para Evolução da Base
      let novosAdicionados = 0;
      if (!database) database = { embarques: {} };

      embKeys.forEach(embId => {
        if (!database.embarques[embId]) novosAdicionados++;
        database.embarques[embId] = parsedEmbarques[embId];
      });

      let totalPaletesDepois = 0;
      Object.values(database.embarques).forEach(e => {
        if (e && e.embarque) totalPaletesDepois += (e.total_paletes || 0);
      });
      const totalEmbarquesDepois = Object.keys(database.embarques).length;

      // Grava snapshot na Evolução da Base
      const evolSnapshot = {
        data: new Date().toLocaleString('pt-BR'),
        arquivo: file.name,
        totalEmbarques: totalEmbarquesDepois,
        totalPaletes: totalPaletesDepois,
        detalhes: `+${embKeys.length} embarques atualizados (${novosAdicionados} novos). Base consolidada com ${totalPaletesDepois} paletes.`
      };
      saveBaseVersion(evolSnapshot);

      // Salva no localStorage a base mesclada
      try {
        localStorage.setItem(STORAGE_DATABASE_OVERRIDE_KEY, JSON.stringify(database));
      } catch(errStorage) {
        console.warn('Armazenamento local cheio, mantendo em memória ativa:', errStorage);
      }

      // Se havia conferência ativa deste embarque, sincroniza o activeEmbarque sem perder os conferidos!
      if (activeConference.embarqueId && database.embarques[activeConference.embarqueId]) {
        activeEmbarque = database.embarques[activeConference.embarqueId];
        updateUI();
      }

      updateBaseInfoUI();

      const firstEmb = embKeys[0];
      const firstData = parsedEmbarques[firstEmb];

      if (feedback) {
        feedback.innerHTML = `
          <div style="background: var(--status-ok-bg); border: 1px solid var(--status-ok-border); color: #065F46; padding: 14px; border-radius: var(--radius-sm); font-size: 0.9rem;">
            <b>✔ Importação Concluída com Sucesso!</b><br>
            • Arquivo: <b>${file.name}</b><br>
            • Embarques no Arquivo: <b>${embKeys.length}</b><br>
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

      showToast(`✔ Planilha carregada! ${embKeys.length} embarques sincronizados.`);

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

  if (screenId === 'viewLogin') {
    const input = document.getElementById('inputEmbarque');
    if (input) {
      input.value = '';
      input.focus();
    }
  } else if (screenId === 'viewScanner') {
    focusScanner();
  }
}

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

  if (existingAudit && existingAudit.conferidos) {
    activeConference = {
      embarqueId: embId,
      operador: existingAudit.operador || operador,
      iniciadoEm: new Date(existingAudit.iniciadoEm),
      finalizadoEm: null,
      conferidos: new Map(existingAudit.conferidos),
      divergencias: existingAudit.divergencias || [],
      historico: existingAudit.historico || []
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
      historico: []
    };
  }

  document.getElementById('txtEmbarque').textContent = embId;
  document.getElementById('txtStage').textContent = formatStages(activeEmbarque.stages);
  document.getElementById('txtTotalPaletes').textContent = activeEmbarque.total_paletes;

  hideFeedback();
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
  activeConference = {
    embarqueId: activeEmbarque.embarque,
    operador: activeConference.operador,
    iniciadoEm: new Date(),
    finalizadoEm: null,
    conferidos: new Map(),
    divergencias: [],
    historico: []
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

  if (code === activeEmbarque.embarque) {
    showFeedback('warn', `ℹ️ Você bipou o número do embarque (${code}). Bipe as LPNs dos paletes.`);
    sound.playWarning('Código do embarque');
    isProcessingBarcode = false;
    focusScanner();
    return;
  }

  let foundPallet = findPalletMatch(code);

  if (foundPallet) {
    if (activeConference.conferidos.has(foundPallet.palete)) {
      const confData = activeConference.conferidos.get(foundPallet.palete);
      sound.playWarning('Palete já conferido');
      triggerCardFlash('pulse-warn');
      showFeedback('warn', `LPN ${foundPallet.palete} já havia sido conferida às ${confData.timestamp}`);

      activeConference.historico.unshift({
        tipo: 'repetido',
        palete: foundPallet.palete,
        desc: foundPallet.desc_resumo,
        timestamp: timestampStr
      });
    } else {
      activeConference.conferidos.set(foundPallet.palete, {
        palete: foundPallet,
        timestamp: timestampStr
      });

      const progressoAtual = activeConference.conferidos.size;
      const total = activeEmbarque.total_paletes;

      if (progressoAtual === total) {
        sound.playSuccess('Carga concluída com sucesso');
        triggerCardFlash('pulse-ok');
        showFeedback('ok', `Carga 100% Conferida! Todos os ${total} paletes validados.`);
      } else {
        sound.playSuccess(`Palete ${progressoAtual} de ${total}`);
        triggerCardFlash('pulse-ok');
        showFeedback('ok', `LPN ${foundPallet.palete} [${progressoAtual}/${total}] • ${foundPallet.desc_resumo} (${foundPallet.qtd_total} un)`);
      }

      activeConference.historico.unshift({
        tipo: 'ok',
        palete: foundPallet.palete,
        desc: foundPallet.desc_resumo,
        qtd: foundPallet.qtd_total,
        timestamp: timestampStr
      });
    }
  } else {
    // Rastreamento na base inteira para identificar o embarque real do palete!
    const crossMatch = findPalletAcrossAllEmbarques(code);
    const embAuditado = activeEmbarque.embarque;
    const stageAuditado = formatStages(activeEmbarque.stages);

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
      alerta: alertRecord
    });

    triggerCardFlash('pulse-err');

    if (crossMatch) {
      showFeedback('err', `✖ LPN ${code} NÃO pertence ao Embarque ${embAuditado}! Pertence ao Embarque ${embCorreto} (Stage ${stageCorreto}). Registrado no Histórico.`);
    } else {
      showFeedback('err', `✖ LPN ${code} não localizada em nenhum embarque ativo! Registrada no Histórico.`);
    }

    activeConference.historico.unshift({
      tipo: 'erro',
      palete: code,
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

  document.getElementById('progressPercent').textContent = `${percent}% (${confCount} de ${total} paletes)`;
  document.getElementById('progressFill').style.width = `${percent}%`;

  document.getElementById('badgeHistCount').textContent = `${activeConference.historico.length} paletes`;

  renderHistorico();
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
    let badgeText = 'OK';

    if (item.tipo === 'repetido') {
      rowClass = 'warn';
      badgeClass = 'warn';
      badgeText = 'Repetido';
    } else if (item.tipo === 'erro') {
      rowClass = 'err';
      badgeClass = 'err';
      badgeText = 'Divergência';
    }

    return `
      <div class="timeline-row ${rowClass}">
        <div>
          <div class="lpn-title">${item.palete}</div>
          <div class="lpn-subtitle">${item.desc} ${item.qtd ? `• <b>${item.qtd} un</b>` : ''}</div>
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
   INICIALIZAÇÃO & EVENTOS
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
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

  window.toggleSound = function() {
    sound.soundEnabled = !sound.soundEnabled;
    sound.voiceEnabled = sound.soundEnabled;
    const btnSound = document.getElementById('btnSoundToggle');
    if (btnSound) {
      if (sound.soundEnabled) {
        btnSound.classList.remove('muted');
        btnSound.innerHTML = '<span id="soundIcon">🔊</span> Som';
        sound.playSuccess('Som ativado');
      } else {
        btnSound.classList.add('muted');
        btnSound.innerHTML = '<span id="soundIcon">🔇</span> Mudo';
      }
    }
  };

  document.getElementById('btnSoundToggle')?.addEventListener('click', window.toggleSound);

  document.getElementById('btnFinalizar')?.addEventListener('click', finalizarConferencia);
  document.getElementById('btnExportarRelatorio')?.addEventListener('click', exportarCSV);

  // Modais de Upload e Base
  window.openUploadModal = function() {
    const modalUpload = document.getElementById('modalUpload');
    if (modalUpload) {
      modalUpload.style.display = 'flex';
      const fb = document.getElementById('uploadFeedback');
      if (fb) fb.style.display = 'none';
    }
  };
  window.openHistoryModal = openHistoryModal;

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
});
