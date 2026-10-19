/**
 * Servidor Web & API REST - DHL Conferência de Stage
 * Rápido, assíncrono (Node.js nativo - sem travamentos)
 * Serve arquivos estáticos por streaming e expõe APIs de sincronização em tempo real
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = __dirname;
const SHAREPOINT_CSV = 'C:/Users/blaminma/Procter and Gamble/Servidor DHL - Confêrencia Digital/ADHOC_80.csv';

// Identifica o IP local na rede Wi-Fi para os tablets
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// Carrega o conversor de SharePoint se disponível
let atualizarSharepointFn = null;
try {
  const spModule = require('./atualizar_sharepoint.js');
  atualizarSharepointFn = spModule.atualizar;
} catch (e) {}

const server = http.createServer((req, res) => {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // ==========================================
  // ROTAS DE API
  // ==========================================

  // 1. Status da Base de Dados
  if (pathname === '/api/status') {
    const jsonPath = path.join(ROOT_DIR, 'stage_data.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const stat = fs.statSync(jsonPath);
        let raw = fs.readFileSync(jsonPath, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        const data = JSON.parse(raw);
        const embs = data.embarques ? Object.keys(data.embarques).length : 0;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          total_embarques: embs,
          total_paletes: data.total_paletes || 0,
          atualizado_em: data.atualizado_em || stat.mtime.toISOString(),
          origem: data.origem || 'Desconhecida',
          sharepoint_csv_presente: fs.existsSync(SHAREPOINT_CSV)
        }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, message: 'Base stage_data.json ainda não gerada.' }));
    return;
  }

  // 2. Extrair XLSX / CSV do SharePoint & Injetar na Ferramenta
  if (pathname === '/api/extrair-csv' || pathname === '/api/sync' || pathname === '/api/sync-sharepoint') {
    const tStart = Date.now();
    const customPath = parsedUrl.searchParams.get('caminho') || undefined;

    try {
      const spMod = require('./atualizar_sharepoint.js');
      const resSync = spMod.atualizar(customPath);
      if (!resSync || !resSync.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: false,
          message: 'Arquivo .xlsx ou .csv não encontrado no SharePoint/Downloads.'
        }));
        return;
      }

      const elapsedMs = Date.now() - tStart;
      const finalDb = resSync.database;

      const responsePayload = {
        ok: true,
        origem: `SharePoint / Power BI (${path.basename(resSync.arquivo)})`,
        arquivo: resSync.arquivo,
        tempo_processamento_ms: elapsedMs,
        total_embarques: resSync.embarques,
        total_paletes: resSync.paletes,
        total_pecas: resSync.pecas,
        total_stages: resSync.stages.length,
        stages: resSync.stages,
        atualizado_em: finalDb.atualizado_em,
        message: `Sucesso! ${resSync.embarques} embarques e ${resSync.paletes} paletes extraídos de ${path.basename(resSync.arquivo)} e injetados na ferramenta.`
      };

      if (parsedUrl.searchParams.get('include_data') === '1') {
        responsePayload.database = finalDb;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(responsePayload));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return;
    }
  }

  // 2.1. API para Retornar a Base Completa (JSON direto para consumo em tempo real)
  if (pathname === '/api/database' || pathname === '/api/dados') {
    const jsonPath = path.join(ROOT_DIR, 'stage_data.json');
    if (fs.existsSync(jsonPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(jsonPath).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, message: 'Base não encontrada.' }));
    return;
  }

  // 3. Compartilhamento de Sessão / Bipagens (State Sync)
  if (pathname === '/api/shared-state') {
    const sharedFile = path.join(ROOT_DIR, 'shared_state.json');
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        fs.writeFile(sharedFile, body, 'utf8', () => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, updated: true }));
        });
      });
      return;
    } else {
      if (fs.existsSync(sharedFile)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        fs.createReadStream(sharedFile).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{}');
      }
      return;
    }
  }

  // ==========================================
  // ARQUIVOS ESTÁTICOS (com Streaming rápido)
  // ==========================================
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Acesso negado');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - Arquivo não encontrado');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
});

const localIP = getLocalIP();
server.listen(PORT, '0.0.0.0', () => {
  console.log('=========================================================');
  console.log('   P&G ITATIAIA - SERVIDOR API & WEB (ALTA PERFORMANCE)  ');
  console.log('=========================================================');
  console.log(` [1] Acesso no seu Computador:`);
  console.log(`     -> http://localhost:${PORT}`);
  console.log(`     -> http://127.0.0.1:${PORT}`);
  console.log(``);
  console.log(` [2] Acesso nos Tablets / Coletores (Wi-Fi):`);
  console.log(`     -> http://${localIP}:${PORT}`);
  console.log('=========================================================');
});
