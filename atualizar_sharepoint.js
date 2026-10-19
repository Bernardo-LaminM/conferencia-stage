/**
 * Conversor Automático Live do SharePoint / Power BI (.xlsx e .csv)
 * Lê: ADHOC_80.xlsx, data*.xlsx ou ADHOC_80.csv
 * Gera: stage_data.json e stage_data.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('./xlsx.full.min.js');

const SP_DIR = 'C:/Users/blaminma/Procter and Gamble/Servidor DHL - Confêrencia Digital';
const DOWNLOADS_DIR = 'C:/Users/blaminma/Downloads';
const outputDir = __dirname;

function localizarArquivoMaisRecente(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;

  const candidatos = [];
  const seen = new Set();
  const addCandidate = (p) => {
    try {
      const norm = path.resolve(p);
      if (seen.has(norm)) return;
      if (p && fs.existsSync(p)) {
        const st = fs.statSync(p);
        // Ignora arquivos esqueleto de "Conexão Dinâmica" do Power BI (< 10 KB quando .xlsx)
        const isTinyXlsx = /\.xlsx$/i.test(p) && st.size < 10240;
        if (st.isFile() && st.size > 100 && !isTinyXlsx) {
          seen.add(norm);
          candidatos.push({ file: p, mtime: st.mtimeMs });
        }
      }
    } catch (e) {}
  };

  // 1. Pasta do SharePoint sincronizado
  addCandidate(path.join(SP_DIR, 'ADHOC_80.xlsx'));
  addCandidate(path.join(SP_DIR, 'data.xlsx'));
  addCandidate(path.join(SP_DIR, 'ADHOC_80.csv'));
  try {
    if (fs.existsSync(SP_DIR)) {
      fs.readdirSync(SP_DIR).forEach(f => {
        if (/^(adhoc_80|data).*\.(xlsx|csv)$/i.test(f)) addCandidate(path.join(SP_DIR, f));
      });
    }
  } catch (e) {}

  // 2. Pasta do projeto
  addCandidate(path.join(outputDir, 'ADHOC_80.xlsx'));
  addCandidate(path.join(outputDir, 'data.xlsx'));
  addCandidate(path.join(outputDir, 'ADHOC_80.csv'));
  try {
    fs.readdirSync(outputDir).forEach(f => {
      if (/^(adhoc_80|data).*\.(xlsx|csv)$/i.test(f)) addCandidate(path.join(outputDir, f));
    });
  } catch (e) {}

  // 3. Pasta Downloads (exportações recentes data*.xlsx ou ADHOC_80*.xlsx)
  try {
    if (fs.existsSync(DOWNLOADS_DIR)) {
      fs.readdirSync(DOWNLOADS_DIR).forEach(f => {
        if (/^(adhoc_80|data\b).*\.(xlsx|csv)$/i.test(f)) addCandidate(path.join(DOWNLOADS_DIR, f));
      });
    }
  } catch (e) {}

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => b.mtime - a.mtime);
  return candidatos[0].file;
}

function extrairLinhasArquivo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const buf = fs.readFileSync(filePath);
    const wb = XLSX.read(buf, { type: 'buffer' });
    let sheet = null;
    for (const name of wb.SheetNames) {
      const lower = name.toLowerCase();
      if (lower.includes('detail')) continue;
      if (lower.includes('export') || lower.includes('sheet4') || lower.includes('aloc') || lower.includes('palete') || lower.includes('stage') || lower.includes('adhoc') || lower.includes('data')) {
        if (wb.Sheets[name] && wb.Sheets[name]['!ref']) {
          sheet = wb.Sheets[name];
          break;
        }
      }
    }
    if (!sheet) {
      for (const name of wb.SheetNames) {
        if (!name.toLowerCase().includes('detail') && wb.Sheets[name] && wb.Sheets[name]['!ref']) {
          sheet = wb.Sheets[name];
          break;
        }
      }
    }
    if (!sheet) sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return { rows, hasMerges: Array.isArray(sheet['!merges']) && sheet['!merges'].length > 0 };
  } else {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const sep = (lines[0] && lines[0].includes(';')) ? ';' : ',';
    return { rows: lines.map(l => l.split(sep)), hasMerges: false };
  }
}

function normalizeStageName(stg) {
  if (!stg) return '';
  const s = String(stg).toUpperCase().trim().replace(/[\s\-_]/g, '');
  const m = s.match(/^(?:SO|ST|STG|STAGE)0*(\d+)([A-Z]*)$/i);
  if (m) {
    const num = parseInt(m[1], 10);
    const suffix = m[2] ? m[2].toUpperCase() : '';
    const padLen = num < 100 ? 2 : 3;
    return 'SO' + String(num).padStart(padLen, '0') + suffix;
  }
  return s;
}

function atualizar(customPath) {
  const targetFile = localizarArquivoMaisRecente(customPath || process.argv[2]);
  if (!targetFile) {
    console.error('Nenhum arquivo ADHOC_80 (.xlsx / .csv) ou data.xlsx encontrado.');
    return null;
  }

  const { rows, hasMerges } = extrairLinhasArquivo(targetFile);
  if (!rows || rows.length < 2) {
    console.error('Arquivo vazio ou sem registros:', targetFile);
    return null;
  }

  let headerRow = 0;
  let idxEmb = 0, idxOrd = 1, idxPal = 2, idxStage = 3, idxSku = 4, idxLote = -1, idxQtd = 5;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
    if (!/car_move|embarque|pallet_id|palete|lpn|etiqueta/.test(rowStr)) continue;
    headerRow = r;
    row.forEach((cell, idx) => {
      const str = String(cell).replace(/[\[\]'"]/g, '').toLowerCase().trim();
      if (str.includes('embarque') || str.includes('car_move')) idxEmb = idx;
      if (str.includes('ordnum') || str === 'order' || str.includes('ordem')) idxOrd = idx;
      if (str.includes('palete') || str.includes('pallet_id') || str.includes('lpn') || str.includes('etiqueta')) idxPal = idx;
      if (str.includes('stage') || str.includes('dstloc')) idxStage = idx;
      if (str.includes('sku') || str.includes('prtnum') || str.includes('material')) idxSku = idx;
      if (str === 'lot' || str.includes('lote') || str.includes('lotnum')) idxLote = idx;
      if (str.includes('qtd') || str.includes('quantidade') || str.includes('pckqty') || str.includes('caixa')) idxQtd = idx;
    });
    break;
  }

  const dict = {};
  const allStages = new Set();
  let totalPecas = 0;
  let lastEmbId = '', lastPalId = '', lastStage = '', lastOrdNum = '';

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    let rawEmb = String(row[idxEmb] || '').trim();
    let rawPal = String(row[idxPal] || '').trim();
    let rawStage = idxStage !== -1 ? String(row[idxStage] || '').trim() : '';
    let rawOrd = idxOrd !== -1 ? String(row[idxOrd] || '').trim() : '';
    const sku = idxSku !== -1 ? String(row[idxSku] || '').trim() : '';

    const lowerEmb = rawEmb.toLowerCase();
    if (lowerEmb === 'total' || lowerEmb.startsWith('total ') || lowerEmb.includes('filtro aplicado') || lowerEmb.includes('filtros aplicados') || lowerEmb.includes('applied filters')) {
      continue;
    }

    if (hasMerges && !rawEmb && lastEmbId && (rawPal || sku)) rawEmb = lastEmbId;
    if (hasMerges && !rawPal && lastPalId && sku) rawPal = lastPalId;
    if (hasMerges && !rawStage && lastStage && rawPal) rawStage = lastStage;
    if (hasMerges && !rawOrd && lastOrdNum && rawEmb) rawOrd = lastOrdNum;

    const embId = rawEmb;
    const palId = rawPal;
    if (!embId || !palId || palId.toLowerCase() === 'total') continue;

    lastEmbId = embId;
    lastPalId = palId;
    if (rawStage) lastStage = rawStage;
    if (rawOrd) lastOrdNum = rawOrd;

    const ordNum = rawOrd;
    const stage = normalizeStageName(rawStage);
    const lote = idxLote !== -1 ? String(row[idxLote] || '').trim() : '';
    const qtdRaw = row[idxQtd];
    const qtd = typeof qtdRaw === 'number' ? Math.round(qtdRaw) : (Math.round(parseFloat(String(qtdRaw || '0').replace(/\./g, '').replace(',', '.'))) || 0);

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
        lote: lote,
        itens: [],
        _itemMap: new Map(),
        qtd_total: 0,
        sku_resumo: sku || 'Material',
        desc_resumo: sku ? 'SKU ' + sku : 'Material'
      });
    }

    const p = e.pal.get(palId);
    const itemKey = `${sku}|${lote}`;
    if (p._itemMap.has(itemKey)) {
      p._itemMap.get(itemKey).qtd += qtd;
    } else {
      const itemObj = { sku: sku, lote: lote, qtd: qtd };
      if (ordNum) itemObj.order_num = ordNum;
      p._itemMap.set(itemKey, itemObj);
      p.itens.push(itemObj);
    }
    p.qtd_total += qtd;
    e.total_pecas += qtd;
    totalPecas += qtd;
  }

  const out = {};
  let totalPalUnicos = 0;
  Object.values(dict).forEach(e => {
    const paletes = Array.from(e.pal.values());
    paletes.forEach(p => { delete p._itemMap; });
    totalPalUnicos += paletes.length;
    out[e.embarque] = {
      embarque: e.embarque,
      total_paletes: paletes.length,
      total_pecas: e.total_pecas,
      stages: Array.from(e.stages),
      paletes: paletes
    };
  });

  const embsCount = Object.values(dict).length;
  const finalDb = {
    origem: path.basename(targetFile),
    arquivo_origem: path.basename(targetFile),
    atualizado_em: new Date().toISOString(),
    total_embarques: embsCount,
    total_paletes: totalPalUnicos,
    total_pecas: totalPecas,
    total_stages: allStages.size,
    embarques: out
  };

  const jsonFile = path.join(outputDir, 'stage_data.json');
  const jsFile = path.join(outputDir, 'stage_data.js');

  const compactJson = JSON.stringify(finalDb);
  fs.writeFileSync(jsonFile, compactJson, 'utf8');
  fs.writeFileSync(
    jsFile,
    'window.EMBEDDED_STAGE_DATA = ' + compactJson + ';\n' +
    '(function(d){if(d&&d.embarques){Object.keys(d.embarques).forEach(function(k){var c=k.replace(/^0+/,"");if(c&&c!==k)d.embarques[c]=d.embarques[k];});}})(window.EMBEDDED_STAGE_DATA);\n',
    'utf8'
  );

  // Hidrata aliases também no objeto retornado em memória
  Object.keys(out).forEach(k => {
    const alias = k.replace(/^0+/, '');
    if (alias && alias !== k) out[alias] = out[k];
  });

  console.log(`✔ Base atualizada de [${path.basename(targetFile)}]: ${embsCount} embarques, ${totalPalUnicos} paletes, ${totalPecas} caixas.`);
  return {
    ok: true,
    arquivo: targetFile,
    embarques: embsCount,
    paletes: totalPalUnicos,
    pecas: totalPecas,
    stages: Array.from(allStages).sort(),
    database: finalDb
  };
}

if (require.main === module) {
  atualizar();
}

module.exports = { atualizar, localizarArquivoMaisRecente };

