const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const spfxDir = __dirname;
const targetDir = path.join(spfxDir, 'package_temp');
const solutionDir = path.join(spfxDir, 'solution');

// Limpa e recria diretórios de trabalho
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(path.join(targetDir, '_rels'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'ClientSideAssets'), { recursive: true });
if (!fs.existsSync(solutionDir)) fs.mkdirSync(solutionDir, { recursive: true });

// Identificadores consistentes (GUIDs e IDs)
const FEATURE_ID = 'c5d7e9a1-2b4f-4d8e-9f1a-7b3c5e8d0a12';
const PRODUCT_ID = '9e7c3b21-4f8a-4932-a567-8b1c2d3e4f50';
const ASSETS_FEATURE_ID = 'f16e9e70-88b2-47c6-bb39-977f5e2337c7';
const COMPONENT_VERSION = '1.0.0.29';
const JS_BUNDLE_NAME = `conferencia-stage-web-part_${COMPONENT_VERSION}.js`;

// Subpasta da Feature para o elemento WebPart
fs.mkdirSync(path.join(targetDir, FEATURE_ID), { recursive: true });

// 1. [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="webpart" ContentType="text/xml" />
  <Default Extension="htm" ContentType="text/html" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="aspx" ContentType="text/xml" />
  <Default Extension="resx" ContentType="text/xml" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="jpg" ContentType="image/jpeg" />
  <Default Extension="bmp" ContentType="image/bmp" />
  <Default Extension="gif" ContentType="image/gif" />
  <Default Extension="txt" ContentType="application/octet-stream" />
</Types>`;
fs.writeFileSync(path.join(targetDir, '[Content_Types].xml'), contentTypesXml, 'utf8');

// 2. _rels/.rels (Obrigatório: package-manifest apontando para AppManifest.xml)
const relsXml = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/package-manifest" Target="/AppManifest.xml" Id="r0" />
</Relationships>`;
fs.writeFileSync(path.join(targetDir, '_rels', '.rels'), relsXml, 'utf8');

// 3. AppManifest.xml
const appManifestXml = `<?xml version="1.0" encoding="utf-8"?>
<App xmlns="http://schemas.microsoft.com/sharepoint/2012/app/manifest" Name="dhl-conferencia-stage-client-side-solution" ProductID="${PRODUCT_ID}" SharePointMinVersion="16.0.0.0" IsClientSideSolution="true" Version="${COMPONENT_VERSION}">
  <Properties>
    <Title>DHL Conferência de Stage</Title>
  </Properties>
</App>`;
fs.writeFileSync(path.join(targetDir, 'AppManifest.xml'), appManifestXml, 'utf8');

// 4. _rels/AppManifest.xml.rels
const appManifestRelsXml = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/manifest-feature" Target="/feature_${FEATURE_ID}.xml" Id="r6" />
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/manifest-clientsideasset" Target="/ClientSideAssets.xml" Id="r7" />
</Relationships>`;
fs.writeFileSync(path.join(targetDir, '_rels', 'AppManifest.xml.rels'), appManifestRelsXml, 'utf8');

// 5. feature_${FEATURE_ID}.xml
const featureXml = `<?xml version="1.0" encoding="utf-8"?>
<Feature xmlns="http://schemas.microsoft.com/sharepoint/" Title="DHL Conferencia Feature" Description="Ativa a WebPart de Conferencia de Stage" Id="${FEATURE_ID}" Version="${COMPONENT_VERSION}" Scope="Web" Hidden="FALSE" />`;
fs.writeFileSync(path.join(targetDir, `feature_${FEATURE_ID}.xml`), featureXml, 'utf8');

// 6. _rels/feature_${FEATURE_ID}.xml.rels
const featureRelsXml = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/partconfiguration" Target="/feature_${FEATURE_ID}.xml.config.xml" Id="r1" />
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/feature-elementmanifest" Target="/${FEATURE_ID}/WebPart_${FEATURE_ID}.xml" Id="r2" />
</Relationships>`;
fs.writeFileSync(path.join(targetDir, '_rels', `feature_${FEATURE_ID}.xml.rels`), featureRelsXml, 'utf8');

// 7. feature_${FEATURE_ID}.xml.config.xml
const featureConfigXml = `<?xml version="1.0" encoding="utf-8"?>
<AppPartConfig xmlns="http://schemas.microsoft.com/sharepoint/2012/app/partconfiguration">
  <Id>ae08919f-4f1f-4647-92e1-6f15607e811f</Id>
</AppPartConfig>`;
fs.writeFileSync(path.join(targetDir, `feature_${FEATURE_ID}.xml.config.xml`), featureConfigXml, 'utf8');

// 8. ElementManifest: ${FEATURE_ID}/WebPart_${FEATURE_ID}.xml
const manifestJson = {
  id: FEATURE_ID,
  alias: "ConferenciaStageWebPart",
  componentType: "WebPart",
  version: COMPONENT_VERSION,
  manifestVersion: 2,
  supportsFullBleed: true,
  supportedHosts: ["SharePointWebPart", "SharePointFullPage", "TeamsPersonalApp", "TeamsTab"],
  preconfiguredEntries: [{
    groupId: "5c03119e-3074-46fd-976b-c60198311f70",
    group: { default: "Other" },
    title: { default: "DHL Conferência de Stage" },
    description: { default: "Conferência de Stage e Alocação P&amp;G Itatiaia (Full Bleed / Tailwind)" },
    officeFabricIconFontName: "Page",
    properties: {}
  }],
  loaderConfig: {
    internalModuleBaseUrls: ["HTTPS://SPCLIENTSIDEASSETLIBRARY/"],
    entryModuleId: "conferencia-stage-web-part",
    scriptResources: {
      "conferencia-stage-web-part": {
        type: "path",
        path: JS_BUNDLE_NAME
      },
      "@microsoft/sp-core-library": {
        type: "component",
        id: "7263c7d0-1d6a-45ec-8d85-d4d1d234171b",
        version: "1.18.0"
      },
      "@microsoft/sp-webpart-base": {
        type: "component",
        id: "974a7777-0990-4136-8fa6-95d80114c2e0",
        version: "1.18.0"
      }
    }
  }
};

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const elementManifestXml = `<?xml version="1.0" encoding="utf-8"?>
<Elements xmlns="http://schemas.microsoft.com/sharepoint/">
  <ClientSideComponent Name="ConferenciaStage" Id="${FEATURE_ID}" ComponentManifest="${escapeXml(JSON.stringify(manifestJson))}" Type="WebPart" />
  <Module Name="ConferenciaStage" Url="_catalogs/wp" List="113" />
</Elements>`;
fs.writeFileSync(path.join(targetDir, FEATURE_ID, `WebPart_${FEATURE_ID}.xml`), elementManifestXml, 'utf8');

// 9. ClientSideAssets.xml
const clientSideAssetsXml = `<?xml version="1.0" encoding="utf-8"?>
<Feature xmlns="http://schemas.microsoft.com/sharepoint/" Title="Client Side Assets" Description="A feature that help deploy client side component assets to SharePoint Online." Id="${ASSETS_FEATURE_ID}" Version="${COMPONENT_VERSION}" Scope="Web" Hidden="FALSE" />`;
fs.writeFileSync(path.join(targetDir, 'ClientSideAssets.xml'), clientSideAssetsXml, 'utf8');

// 10. _rels/ClientSideAssets.xml.rels
const clientSideAssetsRelsXml = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/partconfiguration" Target="/ClientSideAssets.xml.config.xml" Id="r3" />
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/clientsideasset" Target="/ClientSideAssets/${JS_BUNDLE_NAME}" Id="r4" />
  <Relationship Type="http://schemas.microsoft.com/sharepoint/2012/app/relationships/clientsideasset" Target="/ClientSideAssets/${JS_BUNDLE_NAME}.LICENSE.txt" Id="r5" />
</Relationships>`;
fs.writeFileSync(path.join(targetDir, '_rels', 'ClientSideAssets.xml.rels'), clientSideAssetsRelsXml, 'utf8');

// 11. ClientSideAssets.xml.config.xml
const clientSideAssetsConfigXml = `<?xml version="1.0" encoding="utf-8"?>
<AppPartConfig xmlns="http://schemas.microsoft.com/sharepoint/2012/app/partconfiguration">
  <Id>1b90a6af-3405-49e0-a4d3-12cf4c43ecda</Id>
</AppPartConfig>`;
fs.writeFileSync(path.join(targetDir, 'ClientSideAssets.xml.config.xml'), clientSideAssetsConfigXml, 'utf8');

// Lê o CSS compilado scoped do Tailwind
const scopedCssFile = path.join(spfxDir, 'src', 'styles', 'tailwind-scoped.css');
const scopedCssContent = fs.existsSync(scopedCssFile) ? fs.readFileSync(scopedCssFile, 'utf8') : '';

// Lê o HTML autocontido da aplicação com o SVG oficial da DHL
const bundleHtmlFile = path.join(spfxDir, 'conferencia_bundle.html');
const bundleHtmlContent = fs.existsSync(bundleHtmlFile) ? fs.readFileSync(bundleHtmlFile, 'utf8') : '';

// Extrai styles da aplicação
const styleMatches = bundleHtmlContent.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
const combinedStylesContent = styleMatches.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n');

// Extrai o HTML do body sem as tags de script
const bodyStart = bundleHtmlContent.indexOf('<body');
const bodyContentStart = bundleHtmlContent.indexOf('>', bodyStart) + 1;
const bodyEnd = bundleHtmlContent.lastIndexOf('</body>');
const fullBody = bundleHtmlContent.slice(bodyContentStart, bodyEnd);
function sanitizeInlineEventAttrs(str) {
  return String(str || '').replace(/(\s)(on(?:click|change|input|submit|keydown))\s*=\s*(["'])/gi, '$1data-csp-$2=$3');
}

const bodyHtmlWithoutScripts = sanitizeInlineEventAttrs(fullBody.replace(/<script[\s\S]*?<\/script>/gi, ''));

// Lê os módulos de script originais
const baseDir = path.join(spfxDir, '..');
const stageDataJs = fs.existsSync(path.join(baseDir, 'stage_data.js')) ? fs.readFileSync(path.join(baseDir, 'stage_data.js'), 'utf8') : '';
const databaseStorageJs = fs.existsSync(path.join(baseDir, 'database_storage.js')) ? fs.readFileSync(path.join(baseDir, 'database_storage.js'), 'utf8') : '';
const dashboardAnalyticsJs = fs.existsSync(path.join(baseDir, 'dashboard_analytics.js')) ? sanitizeInlineEventAttrs(fs.readFileSync(path.join(baseDir, 'dashboard_analytics.js'), 'utf8')) : '';
const consolidationJs = fs.existsSync(path.join(baseDir, 'consolidation_planner.js')) ? sanitizeInlineEventAttrs(fs.readFileSync(path.join(baseDir, 'consolidation_planner.js'), 'utf8')) : '';
const appJs = fs.existsSync(path.join(baseDir, 'app.js')) ? sanitizeInlineEventAttrs(fs.readFileSync(path.join(baseDir, 'app.js'), 'utf8')) : '';
const stageMapJs = fs.existsSync(path.join(baseDir, 'stage_map.js')) ? fs.readFileSync(path.join(baseDir, 'stage_map.js'), 'utf8') : '';
const powerBiSyncJs = fs.existsSync(path.join(baseDir, 'powerbi_sync.js')) ? sanitizeInlineEventAttrs(fs.readFileSync(path.join(baseDir, 'powerbi_sync.js'), 'utf8')) : '';
const syncJs = fs.existsSync(path.join(baseDir, 'sync.js')) ? fs.readFileSync(path.join(baseDir, 'sync.js'), 'utf8') : '';
const xlsxJs = fs.existsSync(path.join(baseDir, 'xlsx.full.min.js')) ? fs.readFileSync(path.join(baseDir, 'xlsx.full.min.js'), 'utf8') : '';
const mqttJs = fs.existsSync(path.join(baseDir, 'mqtt.min.js')) ? fs.readFileSync(path.join(baseDir, 'mqtt.min.js'), 'utf8') : '';

// 12. ClientSideAssets/conferencia-stage-web-part_1.0.0.17.js (Módulo AMD SPFx Nativo 100% no DOM)
const bundleJs = `/*! DHL Supply Chain - Conferencia de Stage SPFx WebPart Nativo v${COMPONENT_VERSION} */
define("${FEATURE_ID}_${COMPONENT_VERSION}", ["@microsoft/sp-core-library", "@microsoft/sp-webpart-base"], function(spCore, spWebPart) {
  var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
      extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
      return extendStatics(d, b);
    };
    return function (d, b) {
      if (typeof b !== "function" && b !== null)
        throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
      extendStatics(d, b);
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
  })();

  var ConferenciaStageWebPart = (function (_super) {
    __extends(ConferenciaStageWebPart, _super);

    function ConferenciaStageWebPart() {
      return _super !== null && _super.apply(this, arguments) || this;
    }

    ConferenciaStageWebPart.prototype.onInit = function () {
      this._removeSharePointPadding();
      this._injectGlobalBreakoutStyles();
      return _super.prototype.onInit.call(this);
    };

    ConferenciaStageWebPart.prototype._removeSharePointPadding = function () {
      var self = this;
      var applyFullBleed = function () {
        if (!self.domElement) return;
        self.domElement.style.setProperty('width', '100%', 'important');
        self.domElement.style.setProperty('max-width', '100%', 'important');
        self.domElement.style.setProperty('margin', '0', 'important');
        self.domElement.style.setProperty('padding', '0', 'important');
        self.domElement.style.setProperty('overflow', 'visible', 'important');

        for (var n = self.domElement; n && n !== document.body; n = n.parentElement) {
          var cls = (typeof n.className === 'string' ? n.className : '') || '';
          var id = n.id || '';
          var tag = n.tagName || '';
          if (id !== 'SuiteNavWrapper' && cls.indexOf('suiteBar') === -1) {
            if (
              cls.indexOf('Canvas') !== -1 ||
              cls.indexOf('controlZone') !== -1 ||
              cls.indexOf('column') !== -1 ||
              cls.indexOf('section') !== -1 ||
              cls.indexOf('component') !== -1 ||
              cls.indexOf('Zone') !== -1 ||
              cls.indexOf('WebPart') !== -1 ||
              cls.indexOf('webpart') !== -1 ||
              cls.indexOf('Page') !== -1 ||
              cls.indexOf('page') !== -1 ||
              cls.indexOf('Content') !== -1 ||
              cls.indexOf('content') !== -1 ||
              n.getAttribute('data-automation-id') ||
              tag === 'SECTION' ||
              tag === 'MAIN' ||
              tag === 'DIV'
            ) {
              n.style.setProperty('width', '100%', 'important');
              n.style.setProperty('max-width', '100%', 'important');
              n.style.setProperty('padding-left', '0', 'important');
              n.style.setProperty('padding-right', '0', 'important');
              n.style.setProperty('padding-top', '0', 'important');
              n.style.setProperty('padding-bottom', '0', 'important');
              n.style.setProperty('margin-left', '0', 'important');
              n.style.setProperty('margin-right', '0', 'important');
              n.style.setProperty('overflow', 'visible', 'important');
              n.style.setProperty('overflow-x', 'visible', 'important');
              n.style.setProperty('transform', 'none', 'important');
              n.style.setProperty('contain', 'none', 'important');
            }
          }
        }
      };

      applyFullBleed();
      if (!window.__DHL_SPFX_RESIZE_BOUND__) {
        window.__DHL_SPFX_RESIZE_BOUND__ = true;
        window.addEventListener('resize', applyFullBleed);
      }
    };

    ConferenciaStageWebPart.prototype._injectGlobalBreakoutStyles = function () {
      var styleId = 'elb-global-css';
      var isEditMode = window.location.search.indexOf('Mode=Edit') !== -1 || window.location.href.indexOf('Mode=Edit') !== -1;
      var existing = document.getElementById(styleId);
      if (existing) existing.remove();

      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = [
        '/* Oculta barras laterais, AppBar e cabeçalhos do SharePoint para Tela Cheia Real (Padrão ELBSystemV4) */',
        '#spLeftNav, [data-automation-id="spLeftNav"], #sideNavBox,',
        '#sp-appBar, .sp-appBar, [data-automation-id="sp-appBar"],',
        '#spSiteHeader, [data-automationid="SiteHeader"], [class*="siteHeader_"],',
        '[data-automation-id="pageHeader"], [class*="pageHeader_"],',
        '#CommentsWrapper, [id*="CommentsWrapper"] {',
        '  display: none !important;',
        '}',
        isEditMode ? '' : [
          '#spCommandBar, [class*="commandBarWrapper_"], #SuiteNavWrapper, #O365_NavHeader {',
          '  display: none !important;',
          '}',
          'html, body {',
          '  overflow: hidden !important;',
          '}',
          '.elb-container.dhl-spfx-fullscreen {',
          '  position: fixed !important;',
          '  top: 0 !important;',
          '  left: 0 !important;',
          '  right: 0 !important;',
          '  bottom: 0 !important;',
          '  width: 100vw !important;',
          '  height: 100vh !important;',
          '  z-index: 99999 !important;',
          '  overflow-y: auto !important;',
          '  overflow-x: hidden !important;',
          '  background-color: #F8FAFC !important;',
          '  display: flex !important;',
          '  flex-direction: column !important;',
          '}'
        ].join('\\n'),
        '[data-automation-id="CanvasZone"],',
        '[data-automation-id="CanvasZone-SectionContainer"],',
        '[data-automation-id="CanvasComponent"],',
        '[data-automation-id="CanvasControl"],',
        '[data-automation-id="CanvasSection"],',
        '.CanvasZoneContainer,',
        '.CanvasZone,',
        '.CanvasSection,',
        '.CanvasSection-col,',
        '.CanvasComponent,',
        '.SPCanvas,',
        '.controlZone,',
        '.CanvasColumn,',
        '[class*="CanvasZone"],',
        '[class*="CanvasSection"],',
        '[class*="CanvasColumn"],',
        '[class*="controlZone"],',
        '[class*="CanvasComponent"],',
        '[class*="mainContent_"],',
        '[class*="pageContainer_"],',
        '[class*="contentArea_"],',
        '[class*="canvasPerTabWrapper_"],',
        '#spPageCanvasContent,',
        '.spPageCanvasContent,',
        '#workbenchPageContent {',
        '  width: 100% !important;',
        '  max-width: 100% !important;',
        '  padding-left: 0 !important;',
        '  padding-right: 0 !important;',
        '  padding-top: 0 !important;',
        '  padding-bottom: 0 !important;',
        '  margin-left: 0 !important;',
        '  margin-right: 0 !important;',
        '  overflow: visible !important;',
        '  overflow-x: visible !important;',
        '}',
        '[data-webpart-id] {',
        '  width: 100% !important;',
        '  max-width: 100% !important;',
        '}',
        '.elb-container .modal-backdrop {',
        '  z-index: 100005 !important;',
        '}',
        '.elb-container .modal-clean-box.modal-lg {',
        '  max-height: 90vh !important;',
        '  overflow-y: auto !important;',
        '}'
      ].join('\\n');
      document.head.appendChild(style);
    };

    ConferenciaStageWebPart.prototype.render = function () {
      window.spContext = this.context;
      this._removeSharePointPadding();
      this._injectGlobalBreakoutStyles();

      // 1. Injeta os estilos CSS da aplicação no head da página (apenas uma vez)
      var styleId = 'dhl-stage-native-styles';
      if (!document.getElementById(styleId)) {
        var styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = ${JSON.stringify(combinedStylesContent)};
        document.head.appendChild(styleEl);
      }

      // 2. Injeta a interface visual HTML da aplicação diretamente no DOM do SharePoint (SEM IFRAME)
      this.domElement.innerHTML = [
        '<div class="elb-container dhl-spfx-fullscreen" style="width: 100%; min-height: 100vh; margin: 0; padding: 0;">',
        ${JSON.stringify(bodyHtmlWithoutScripts)},
        '</div>'
      ].join('');

      // 3. Executa o ecossistema JavaScript nativamente no escopo do SharePoint
      if (!window.__DHL_STAGE_APP_INITIALIZED__) {
        window.__DHL_STAGE_APP_INITIALIZED__ = true;
        try {
          (function (define, exports, module) {
            ${xlsxJs}
            if (typeof XLSX !== 'undefined' && (!window.XLSX || typeof window.XLSX.read !== 'function')) window.XLSX = XLSX;
          }).call(window, undefined, undefined, undefined);
        } catch(e) { console.warn('[SPFx Native] XLSX:', e); }
        try {
          (function (define, exports, module) {
            ${mqttJs}
          }).call(window, undefined, undefined, undefined);
        } catch(e) { console.warn('[SPFx Native] MQTT:', e); }
        try {
          ${stageDataJs}
        } catch(e) { console.warn('[SPFx Native] StageData:', e); }
        try {
          ${databaseStorageJs}
        } catch(e) { console.warn('[SPFx Native] DatabaseStorage:', e); }
        try {
          ${dashboardAnalyticsJs}
        } catch(e) { console.warn('[SPFx Native] DashboardAnalytics:', e); }
        try {
          ${consolidationJs}
        } catch(e) { console.warn('[SPFx Native] Consolidation:', e); }
        try {
          ${appJs}
        } catch(e) { console.warn('[SPFx Native] App:', e); }
        try {
          ${stageMapJs}
        } catch(e) { console.warn('[SPFx Native] StageMap:', e); }
        try {
          ${powerBiSyncJs}
        } catch(e) { console.warn('[SPFx Native] PowerBiSync:', e); }
        try {
          ${syncJs}
        } catch(e) { console.warn('[SPFx Native] Sync:', e); }
      }

      // 4. Inicializa os dados e vincula todos os botões e formulários do DOM
      if (typeof window.initApp === 'function') {
        try { window.initApp(); } catch(e) { console.warn('[SPFx Native] initApp:', e); }
      }
    };



    Object.defineProperty(ConferenciaStageWebPart.prototype, "dataVersion", {
      get: function () {
        return spCore.Version.parse("1.0");
      },
      enumerable: false,
      configurable: true
    });

    return ConferenciaStageWebPart;
  })(spWebPart.BaseClientSideWebPart);

  return {
    default: ConferenciaStageWebPart,
    __esModule: true
  };
});
`;

fs.writeFileSync(path.join(targetDir, 'ClientSideAssets', JS_BUNDLE_NAME), bundleJs, 'utf8');
fs.writeFileSync(path.join(targetDir, 'ClientSideAssets', `${JS_BUNDLE_NAME}.LICENSE.txt`), '/*! DHL Supply Chain Proprietary */', 'utf8');

// 13. Empacotamento via System.IO.Compression.ZipFile (.sppkg)
const sppkgOut = path.join(solutionDir, 'dhl-conferencia-stage.sppkg');
console.log('Compactando pacote oficial SPFx (.sppkg) com Tailwind Scoped e Canvas Breakout...');
const ps1File = path.join(spfxDir, 'compactar_sppkg.ps1');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1File}" -Src "${targetDir}" -Dst "${sppkgOut}"`, { stdio: 'inherit' });

console.log('✔ Pacote SPFx (.sppkg) gerado com sucesso em: ' + sppkgOut);
