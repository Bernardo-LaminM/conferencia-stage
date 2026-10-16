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

  // 2. Extrair CSV do SharePoint & Injetar na Ferramenta
  if (pathname === '/api/extrair-csv' || pathname === '/api/sync' || pathname === '/api/sync-sharepoint') {
    const tStart = Date.now();
    let csvFile = parsedUrl.searchParams.get('caminho') || SHAREPOINT_CSV;

    // Fallback: se não estiver no caminho absoluto, tenta na pasta atual
    if (!fs.existsSync(csvFile)) {
      const localCsv = path.join(ROOT_DIR, 'ADHOC_80.csv');
      if (fs.existsSync(localCsv)) csvFile = localCsv;
    }

    if (!fs.existsSync(csvFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: false,
        message: `Arquivo CSV não encontrado em: ${csvFile}. Verifique se o SharePoint está sincronizado.`
      }));
      return;
    }

    try {
      let rawContent = fs.readFileSync(csvFile, 'utf8');
      if (rawContent.charCodeAt(0) === 0xFEFF) rawContent = rawContent.slice(1);

      const lines = rawContent.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: 'O arquivo CSV está vazio ou sem linhas de dados.' }));
        return;
      }

      // Identifica os cabeçalhos normalizados
      const headers = lines[0].split(',').map(h => h.replace(/[\[\]'"]/g, '').trim().toLowerCase());
      const dict = {};
      const allStages = new Set();
      let totalPecas = 0;
      let totalPal = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const row = {};
        for (let j = 0; j < headers.length; j++) {
          row[headers[j]] = parts[j] ? parts[j].trim() : '';
        }

        const embId = row.car_move_id;
        const palId = row.pallet_id;
        if (!embId || !palId) continue;

        const ordNum = row.ordnum;
        const stage = row.dstloc;
        const sku = row.prtnum;
        const qtd = parseInt(row.qtd_caixas, 10) || 0;

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
        origem: 'API_SharePoint_CSV',
        atualizado_em: new Date().toISOString(),
        total_embarques: uniqueEmbs,
        total_paletes: totalPal,
        total_pecas: totalPecas,
        total_stages: allStages.size,
        embarques: outEmbarques
      };

      // Grava em stage_data.json e stage_data.js sem BOM
      const jsonFile = path.join(ROOT_DIR, 'stage_data.json');
      const jsFile = path.join(ROOT_DIR, 'stage_data.js');

      fs.writeFileSync(jsonFile, JSON.stringify(finalDb, null, 2), 'utf8');
      fs.writeFileSync(jsFile, 'window.EMBEDDED_STAGE_DATA = ' + JSON.stringify(finalDb, null, 2) + ';\n', 'utf8');

      const elapsedMs = Date.now() - tStart;

      const responsePayload = {
        ok: true,
        origem: 'SharePoint CSV (Central de Dados OMS)',
        arquivo: csvFile,
        tempo_processamento_ms: elapsedMs,
        total_linhas_csv: lines.length - 1,
        total_embarques: uniqueEmbs,
        total_paletes: totalPal,
        total_pecas: totalPecas,
        total_stages: allStages.size,
        stages: Array.from(allStages).sort(),
        atualizado_em: finalDb.atualizado_em,
        message: `Sucesso! ${uniqueEmbs} embarques e ${totalPal} paletes extraídos do CSV e injetados na ferramenta.`
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
