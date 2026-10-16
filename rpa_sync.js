/**
 * =======================================================================
 * RPA DHL SUPPLY CHAIN - SINCRONIZADOR CONTÍNUO SHAREPOINT -> GITHUB PAGES
 * =======================================================================
 * 1. Monitora o arquivo ADHOC_80.csv na pasta sincronizada do SharePoint (OneDrive).
 * 2. Converte os dados brutos para stage_data.js e stage_data.json.
 * 3. Faz o Git Commit e Push automático para o GitHub Pages.
 * 4. Mantém todos os tablets da operação sempre atualizados sem intervenção humana.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const SHAREPOINT_CSV = 'C:/Users/blaminma/Procter and Gamble/Servidor DHL - Confêrencia Digital/ADHOC_80.csv';
const GIT_EXE = 'C:/Users/blaminma/AppData/Local/Programs/Git/cmd/git.exe';
const LOG_FILE = path.join(ROOT_DIR, 'rpa_sync.log');
const CHECK_INTERVAL_MS = 60 * 1000; // Checa a cada 1 minuto se o arquivo mudou

let lastFileMtime = 0;
let isSyncing = false;

function log(msg) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {}
}

function processarCsvEEnviar() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    log('⚡ RPA Detectou alteração no ADHOC_80.csv do SharePoint! Iniciando processamento...');

    if (!fs.existsSync(SHAREPOINT_CSV)) {
      log('❌ Arquivo ADHOC_80.csv não localizado no caminho do SharePoint.');
      isSyncing = false;
      return;
    }

    let rawContent = fs.readFileSync(SHAREPOINT_CSV, 'utf8');
    if (rawContent.charCodeAt(0) === 0xFEFF) rawContent = rawContent.slice(1);

    const lines = rawContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      log('⚠️ CSV vazio ou ainda em processo de gravação pelo OneDrive.');
      isSyncing = false;
      return;
    }

    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.replace(/[\[\]'"]/g, '').trim().toLowerCase());

    let idxEmb = -1, idxPal = -1, idxStage = -1, idxSku = -1, idxQtd = -1, idxOrd = -1;
    headers.forEach((h, idx) => {
      if (h.includes('car_move') || h.includes('embarque')) idxEmb = idx;
      if (h.includes('pallet') || h.includes('palete') || h.includes('lpn') || h.includes('etiqueta')) idxPal = idx;
      if (h.includes('stage') || h.includes('dstloc')) idxStage = idx;
      if (h.includes('sku') || h.includes('prtnum')) idxSku = idx;
      if (h.includes('qtd') || h.includes('caixa')) idxQtd = idx;
      if (h.includes('ordnum') || h.includes('order')) idxOrd = idx;
    });

    if (idxEmb === -1 || idxPal === -1) {
      idxEmb = 0; idxOrd = 1; idxPal = 2; idxStage = 3; idxSku = 4; idxQtd = 5;
    }

    const dict = {};
    const allStages = new Set();
    let totalPecas = 0;
    let totalPal = 0;

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(sep);
      const embId = (parts[idxEmb] || '').trim();
      const palId = (parts[idxPal] || '').trim();
      if (!embId || !palId) continue;

      const ordNum = idxOrd !== -1 ? (parts[idxOrd] || '').trim() : '';
      const stage = idxStage !== -1 ? (parts[idxStage] || '').trim() : '';
      const sku = idxSku !== -1 ? (parts[idxSku] || '').trim() : '';
      const qtd = idxQtd !== -1 ? (parseInt(parts[idxQtd], 10) || 0) : 0;

      if (stage) allStages.add(stage);

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
        qtd: qtd,
        order_num: ordNum
      });
      p.qtd_total += qtd;
      e.total_pecas += qtd;
      totalPecas += qtd;
      totalPal++;
    }

    const outEmbarques = {};
    Object.values(dict).forEach(e => {
      const paletes = Array.from(e.pal.values());
      outEmbarques[e.embarque] = {
        embarque: e.embarque,
        total_paletes: paletes.length,
        total_pecas: e.total_pecas,
        stages: Array.from(e.stages),
        paletes: paletes
      };
      const alias = e.embarque.replace(/^0+/, '');
      if (alias && alias !== e.embarque) {
        outEmbarques[alias] = outEmbarques[e.embarque];
      }
    });

    const uniqueEmbs = Object.keys(dict).length;
    const finalDb = {
      origem: 'RPA_SharePoint_AutoSync',
      atualizado_em: new Date().toISOString(),
      total_embarques: uniqueEmbs,
      total_paletes: totalPal,
      total_pecas: totalPecas,
      total_stages: allStages.size,
      embarques: outEmbarques
    };

    const jsonFile = path.join(ROOT_DIR, 'stage_data.json');
    const jsFile = path.join(ROOT_DIR, 'stage_data.js');

    fs.writeFileSync(jsonFile, JSON.stringify(finalDb, null, 2), 'utf8');
    fs.writeFileSync(jsFile, 'window.EMBEDDED_STAGE_DATA = ' + JSON.stringify(finalDb, null, 2) + ';\n', 'utf8');

    log(`✔ Base compilada: ${uniqueEmbs} embarques, ${totalPal} paletes.`);

    // 2. Git Commit & Push Automático para o GitHub Pages
    if (fs.existsSync(GIT_EXE)) {
      log('🚀 Publicando automaticamente no GitHub Pages...');
      execSync(`"${GIT_EXE}" add stage_data.js`, { cwd: ROOT_DIR, stdio: 'pipe' });

      try {
        execSync(`"${GIT_EXE}" commit -m "Auto-RPA: Base atualizada do SharePoint (${uniqueEmbs} embarques, ${totalPal} paletes) [skip ci]"`, { cwd: ROOT_DIR, stdio: 'pipe' });
      } catch (errCommit) {
        log('ℹ️ Nenhuma alteração de conteúdo na base (já estava sincronizada).');
      }

      execSync(`"${GIT_EXE}" push origin main`, { cwd: ROOT_DIR, stdio: 'pipe' });
      log('🎉 Publicado no GitHub Pages com sucesso! Tablets já podem acessar.');
    } else {
      log('⚠️ Executável do Git não encontrado para push.');
    }

  } catch (err) {
    log('❌ Erro no RPA: ' + err.message);
  } finally {
    isSyncing = false;
  }
}

function verificarAlteracao() {
  try {
    if (!fs.existsSync(SHAREPOINT_CSV)) return;
    const stat = fs.statSync(SHAREPOINT_CSV);
    const mtime = stat.mtimeMs;

    if (lastFileMtime === 0) {
      lastFileMtime = mtime;
      log('🤖 RPA DHL Ativo! Monitorando ADHOC_80.csv...');
      // Executa a primeira sincronização na inicialização
      processarCsvEEnviar();
      return;
    }

    if (mtime > lastFileMtime) {
      lastFileMtime = mtime;
      // Aguarda 3 segundos de debounce para garantir que o arquivo terminou de ser gravado
      setTimeout(processarCsvEEnviar, 3000);
    }
  } catch (e) {
    // Arquivo pode estar momentaneamente bloqueado pelo OneDrive durante o download
  }
}

// Inicia o monitoramento
log('=====================================================');
log('  DHL RPA - SINCRONIZADOR SHAREPOINT -> GITHUB PAGES ');
log('=====================================================');

verificarAlteracao();
setInterval(verificarAlteracao, CHECK_INTERVAL_MS);
