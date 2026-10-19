const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..');
const indexHtmlPath = path.join(baseDir, 'index.html');
const styleCssPath = path.join(baseDir, 'style.css');
const stageMapCssPath = path.join(baseDir, 'stage_map.css');
const dhlBrandingCssPath = path.join(baseDir, 'dhl_branding.css');

const databaseStorageJsPath = path.join(baseDir, 'database_storage.js');
const consolidationJsPath = path.join(baseDir, 'consolidation_planner.js');
const stageMapJsPath = path.join(baseDir, 'stage_map.js');
const appJsPath = path.join(baseDir, 'app.js');
const powerBiSyncJsPath = path.join(baseDir, 'powerbi_sync.js');
const syncJsPath = path.join(baseDir, 'sync.js');

let html = fs.readFileSync(indexHtmlPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');
const stageMapCss = fs.readFileSync(stageMapCssPath, 'utf8');
const dhlBrandingCss = fs.existsSync(dhlBrandingCssPath) ? fs.readFileSync(dhlBrandingCssPath, 'utf8') : '';

const databaseStorageJs = fs.existsSync(databaseStorageJsPath) ? fs.readFileSync(databaseStorageJsPath, 'utf8') : '';
const consolidationJs = fs.existsSync(consolidationJsPath) ? fs.readFileSync(consolidationJsPath, 'utf8') : '';
const stageMapJs = fs.existsSync(stageMapJsPath) ? fs.readFileSync(stageMapJsPath, 'utf8') : '';
const appJs = fs.existsSync(appJsPath) ? fs.readFileSync(appJsPath, 'utf8') : '';
const powerBiSyncJs = fs.existsSync(powerBiSyncJsPath) ? fs.readFileSync(powerBiSyncJsPath, 'utf8') : '';
const syncJs = fs.existsSync(syncJsPath) ? fs.readFileSync(syncJsPath, 'utf8') : '';

// SVG oficial da DHL fornecido pelo usuário
const dhlSvg = `<svg height="32" viewBox="0 0 196 43.2533" width="145" xmlns="http://www.w3.org/2000/svg" style="display:block; border-radius:4px;"><path d="m0 0h196v43.2533h-196z" fill="#fc0"/><g fill="#d40511"><path d="m0 29.901h26.506l-1.448 1.97h-25.058z"/><path d="m0 26.245h29.199l-1.451 1.968h-27.748z"/><path d="m0 33.56h23.815l-1.442 1.956h-22.373z"/><path d="m196 31.871h-26.402l1.447-1.969h24.955z"/><path d="m196 35.516-29.087.003 1.441-1.959h27.646z"/><path d="m173.735 26.245h22.265v1.969l-23.713.002z"/><path d="m25.6726 35.5163 12.5779-17.0888h15.6082c1.7252 0 1.7026.655.86 1.7975-.8562 1.16-2.3133 3.1547-3.1854 4.3323-.4426.5982-1.2431 1.6881 1.4089 1.6881h20.91c-1.739 2.3822-7.38 9.2709-17.5082 9.2709z"/><path d="m97.7056 26.244-6.82 9.2723h-17.9926s6.8172-9.2709 6.8233-9.2709z"/><path d="m123.7239 26.2454-6.8239 9.2709h-17.9857s6.8178-9.2709 6.8239-9.2709z"/><path d="m129.5749 26.2454c.0006 0-1.3141 1.7975-1.9529 2.66-2.2593 3.0534-.2626 6.6105 7.111 6.6105h28.8853l6.8226-9.2709z"/><path d="m34.4685 7.8007-6.2621 8.508h34.1289c1.7249 0 1.7023.655.8592 1.7974-.8562 1.1587-2.2894 3.1763-3.1614 4.3539-.4427.597-1.2432 1.6867 1.4089 1.6867h13.9564s2.25-3.0615 4.1352-5.6206c2.5655-3.4815.2225-10.7254-8.9486-10.7254z"/><path d="m125.269 24.147h-44.007l12.034-16.346h17.986l-6.896 9.372h8.028l6.901-9.372h17.984z"/><path d="m162.2084 7.8007-12.0314 16.346h-19.0593s12.0355-16.346 12.0415-16.346z"/></g></svg>`;

// Imagens em Base64 para branding elegante
function toBase64(filename) {
  const filePath = path.join(baseDir, 'assets', filename);
  if (!fs.existsSync(filePath)) return '';
  return 'data:image/png;base64,' + fs.readFileSync(filePath).toString('base64');
}

const orgulhoB64 = toBase64('orgulho_dhl.png');
const juntosB64 = toBase64('juntos_imparaveis_2030.png');
const aviaoB64 = toBase64('crescendo_voando_alto.png');

const tailwindScopedCssPath = path.join(__dirname, 'src', 'styles', 'tailwind-scoped.css');
const tailwindScopedCss = fs.existsSync(tailwindScopedCssPath) ? fs.readFileSync(tailwindScopedCssPath, 'utf8') : '';

// Remove a tag do CDN externo do Tailwind (bloqueada pela CSP da DHL) e substitui pelo Tailwind Scoped 100% offline
html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, `<style id="tailwind-offline-scoped">\n${tailwindScopedCss}\n</style>`);
html = html.replace(/<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*<\/script>/i, `<script>window.tailwind = { config: {} };</script>`);

// Garante que o <body> possua a classe elb-container para ativar os seletores scoped do Tailwind
html = html.replace(/<body([^>]*)>/i, function(match, attrs) {
  if (/class="/i.test(attrs)) {
    return `<body${attrs.replace(/class="([^"]*)"/i, 'class="elb-container $1"')}>`;
  }
  return `<body class="elb-container"${attrs}>`;
});

// Substitui referências de css externas por inline
html = html.replace(/<link rel="stylesheet" href="style.css">/i, `<style>\n${styleCss}\n${dhlBrandingCss}\n</style>`);
html = html.replace(/<link rel="stylesheet" href="stage_map.css[^"]*">/i, `<style>\n${stageMapCss}\n</style>`);

// Substitui a imagem do logo pelo SVG oficial da DHL (limpo, sem adesivos extras na topbar)
html = html.replace(/<img src="dhl_logo\.svg"[^>]*>/i, dhlSvg);

// Banner no login de boas-vindas
if (aviaoB64) {
  const loginBanner = `
    <div class="login-header-banner" title="Crescendo e voando alto - DHL">
      <img src="${aviaoB64}" alt="DHL Aviation">
    </div>
  `;
  html = html.replace(/<div class="login-logo-circle">/i, `${loginBanner}\n      <div class="login-logo-circle">`);
}

if (juntosB64) {
  html = html.replace(
    /DHL Supply Chain • Operational Excellence/i,
    `<span class="footer-brand-pill"><span>DHL Supply Chain • Operational Excellence</span><img src="${juntosB64}" alt="Juntos Imparáveis 2030" title="Juntos Imparáveis 2030"></span>`
  );
}

// Substitui todas as imagens dhl_logo.svg pelo SVG oficial inline para nunca dar imagem quebrada
html = html.replace(/<img src="dhl_logo\.svg"[^>]*>/gi, dhlSvg);

const stageDataJsPath = path.join(baseDir, 'stage_data.js');
const stageDataJs = fs.existsSync(stageDataJsPath) ? fs.readFileSync(stageDataJsPath, 'utf8') : '';
const mqttJsPath = path.join(baseDir, 'mqtt.min.js');
const mqttJs = fs.existsSync(mqttJsPath) ? fs.readFileSync(mqttJsPath, 'utf8') : '';
const xlsxJsPath = path.join(baseDir, 'xlsx.full.min.js');
const xlsxJs = fs.existsSync(xlsxJsPath) ? fs.readFileSync(xlsxJsPath, 'utf8') : '';

// Garante que o localStorage funcione mesmo em contextos restritos do SharePoint
const storageGuard = `
<script id="dhl-storage-guard">
(function() {
  try {
    var k = '__dhl_spfx_test__';
    window.localStorage.setItem(k, k);
    window.localStorage.removeItem(k);
  } catch(e) {
    console.warn('[SPFx Storage Guard] localStorage restrito, ativando fallback seguro em memória.');
    var _mem = {};
    try {
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: function(k) { return _mem.hasOwnProperty(k) ? _mem[k] : null; },
          setItem: function(k, v) { _mem[k] = String(v); },
          removeItem: function(k) { delete _mem[k]; },
          clear: function() { _mem = {}; },
          key: function(i) { return Object.keys(_mem)[i] || null; },
          get length() { return Object.keys(_mem).length; }
        },
        writable: true,
        configurable: true
      });
    } catch(err2) {}
  }
})();
</script>
`;
html = html.replace(/<head>/i, () => `<head>\n${storageGuard}`);

// Injeta MQTT inline e remove fallbacks com document.write de CDN externo
if (mqttJs) {
  html = html.replace(/<script src="mqtt\.min\.js"><\/script>/i, () => `<script>\n${mqttJs}\n</script>`);
}
html = html.replace(/<script>if \(typeof mqtt === 'undefined'\)[\s\S]*?<\/script>/i, '');

// Injeta XLSX 100% inline (sem depender de conexões com CDNs externas)
if (xlsxJs) {
  html = html.replace(/<script src="xlsx\.full\.min\.js"><\/script>/i, () => `<script>\n${xlsxJs}\n</script>`);
} else {
  html = html.replace(/<script src="xlsx\.full\.min\.js"><\/script>/i, () => `<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>`);
}

// Injeta stage_data.js (base embutida) diretamente para carregamento instantâneo
if (stageDataJs) {
  html = html.replace(/<script src="stage_data\.js[^"]*"><\/script>/i, () => `<script>\n${stageDataJs}\n</script>`);
}

// Substitui TODOS os scripts da aplicação por scripts inline (usando função callback para evitar corrupção por tokens $)
html = html.replace(/<script src="database_storage\.js[^"]*"><\/script>/i, () => `<script>\n${databaseStorageJs}\n</script>`);
html = html.replace(/<script src="consolidation_planner\.js[^"]*"><\/script>/i, () => `<script>\n${consolidationJs}\n</script>`);
html = html.replace(/<script src="app\.js[^"]*"><\/script>/i, () => `<script>\n${appJs}\n</script>`);
html = html.replace(/<script src="stage_map\.js[^"]*"><\/script>/i, () => `<script>\n${stageMapJs}\n</script>`);
html = html.replace(/<script src="powerbi_sync\.js[^"]*"><\/script>/i, () => `<script>\n${powerBiSyncJs}\n</script>`);
html = html.replace(/<script src="sync\.js[^"]*"><\/script>/i, () => `<script>\n${syncJs}\n</script>`);

const outPath = path.join(__dirname, 'conferencia_bundle.html');
fs.writeFileSync(outPath, html, 'utf8');

console.log('✔ Bundle HTML atualizado com scripts 100% inline em: ' + outPath);
console.log('Tamanho total do HTML autocontido: ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
