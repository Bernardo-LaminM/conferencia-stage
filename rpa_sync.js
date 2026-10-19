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

function processarCsvEEnviar(targetFile) {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const spMod = require('./atualizar_sharepoint.js');
    const fileToProcess = targetFile || spMod.localizarArquivoMaisRecente();
    if (!fileToProcess || !fs.existsSync(fileToProcess)) {
      log('❌ Arquivo .xlsx / .csv não localizado no caminho do SharePoint.');
      isSyncing = false;
      return;
    }

    log(`⚡ RPA Detectou atualização em ${path.basename(fileToProcess)}! Iniciando processamento...`);
    const resSync = spMod.atualizar(fileToProcess);
    if (!resSync || !resSync.ok) {
      log('⚠️ Arquivo vazio ou ainda em processo de gravação pelo OneDrive.');
      isSyncing = false;
      return;
    }

    const uniqueEmbs = resSync.embarques;
    const totalPal = resSync.paletes;
    log(`✔ Base compilada: ${uniqueEmbs} embarques, ${totalPal} paletes.`);

    // 2. Git Commit & Push Automático para o GitHub Pages
    if (fs.existsSync(GIT_EXE)) {
      log('🚀 Publicando automaticamente no GitHub Pages...');
      execSync(`"${GIT_EXE}" add stage_data.js`, { cwd: ROOT_DIR, stdio: 'pipe' });

      try {
        execSync(`"${GIT_EXE}" commit -m "Auto-RPA: Base atualizada (${uniqueEmbs} embarques, ${totalPal} paletes) [skip ci]"`, { cwd: ROOT_DIR, stdio: 'pipe' });
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
    const spMod = require('./atualizar_sharepoint.js');
    const latestFile = spMod.localizarArquivoMaisRecente();
    if (!latestFile || !fs.existsSync(latestFile)) return;
    const stat = fs.statSync(latestFile);
    const mtime = stat.mtimeMs;

    if (lastFileMtime === 0) {
      lastFileMtime = mtime;
      log(`🤖 RPA DHL Ativo! Monitorando ${path.basename(latestFile)} (.xlsx / .csv)...`);
      processarCsvEEnviar(latestFile);
      return;
    }

    if (mtime > lastFileMtime) {
      lastFileMtime = mtime;
      setTimeout(() => processarCsvEEnviar(latestFile), 3000);
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
