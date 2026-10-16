/**
 * Conversor Automático Live do SharePoint
 * Lê: C:\Users\blaminma\Procter and Gamble\Servidor DHL - Confêrencia Digital\ADHOC_80.csv
 * Gera: stage_data.json e stage_data.js
 */
const fs = require('fs');
const path = require('path');

const csvPath = 'C:/Users/blaminma/Procter and Gamble/Servidor DHL - Confêrencia Digital/ADHOC_80.csv';
const outputDir = __dirname;

function atualizar() {
  if (!fs.existsSync(csvPath)) {
    console.error('Arquivo ADHOC_80.csv não encontrado no SharePoint sincronizado.');
    return null;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    console.error('CSV vazio ou sem registros.');
    return null;
  }

  const headers = lines[0].split(',').map(h => h.replace(/[\[\]']/g, '').trim().toLowerCase());
  const dict = {};
  let totalPecas = 0;
  let totalPal = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => { row[h] = parts[idx] ? parts[idx].trim() : ''; });

    const embId = row.car_move_id;
    const palId = row.pallet_id;
    if (!embId || !palId) continue;

    const ordNum = row.ordnum;
    const stage = row.dstloc;
    const sku = row.prtnum;
    const qtd = parseInt(row.qtd_caixas, 10) || 0;

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

  const embsCount = Object.values(dict).length;
  const finalDb = {
    origem: 'PowerAutomate_SharePoint_Live',
    atualizado_em: new Date().toISOString(),
    total_embarques: embsCount,
    total_paletes: totalPal,
    embarques: out
  };

  const jsonFile = path.join(outputDir, 'stage_data.json');
  const jsFile = path.join(outputDir, 'stage_data.js');

  fs.writeFileSync(jsonFile, JSON.stringify(finalDb, null, 2), 'utf8');
  fs.writeFileSync(jsFile, 'window.EMBEDDED_STAGE_DATA = ' + JSON.stringify(finalDb, null, 2) + ';\n', 'utf8');

  console.log(`✔ Base atualizada: ${embsCount} embarques, ${totalPal} paletes.`);
  return { ok: true, embarques: embsCount, paletes: totalPal, pecas: totalPecas };
}

if (require.main === module) {
  atualizar();
}

module.exports = { atualizar };
