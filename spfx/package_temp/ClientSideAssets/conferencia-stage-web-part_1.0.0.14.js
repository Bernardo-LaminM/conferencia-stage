/*! DHL Supply Chain - Conferencia de Stage SPFx WebPart Autocontido v1.0.0.14 */
define("c5d7e9a1-2b4f-4d8e-9f1a-7b3c5e8d0a12_1.0.0.14", ["@microsoft/sp-core-library", "@microsoft/sp-webpart-base"], function(spCore, spWebPart) {
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
      var selectors = [
        '[data-automation-id="CanvasZone"]',
        '[data-automation-id="CanvasComponent"]',
        '[data-automation-id="CanvasControl"]',
        '[data-automation-id="CanvasSection"]',
        '.CanvasZoneContainer',
        '.CanvasZone',
        '.CanvasSection',
        '.CanvasSection-col',
        '.CanvasComponent',
        '.SPCanvas',
        '.controlZone',
        '.CanvasColumn',
        '[class*="CanvasZone"]',
        '[class*="CanvasSection"]',
        '[class*="CanvasColumn"]',
        '[class*="controlZone"]',
        '[class*="CanvasComponent"]'
      ];

      this.domElement.style.setProperty('width', '100%', 'important');
      this.domElement.style.setProperty('max-width', '100%', 'important');
      this.domElement.style.setProperty('margin', '0', 'important');
      this.domElement.style.setProperty('padding', '0', 'important');
      this.domElement.style.setProperty('overflow', 'visible', 'important');

      var self = this;
      selectors.forEach(function (sel) {
        var el = self.domElement.closest(sel);
        if (el) {
          el.style.setProperty('padding-left', '0', 'important');
          el.style.setProperty('padding-right', '0', 'important');
          el.style.setProperty('padding-top', '0', 'important');
          el.style.setProperty('padding-bottom', '0', 'important');
          el.style.setProperty('max-width', '100%', 'important');
          el.style.setProperty('width', '100%', 'important');
          el.style.setProperty('margin', '0', 'important');
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('overflow-x', 'visible', 'important');
        }
      });

      if (this.domElement.parentElement) {
        this.domElement.parentElement.style.setProperty('margin', '0', 'important');
        this.domElement.parentElement.style.setProperty('padding', '0', 'important');
        this.domElement.parentElement.style.setProperty('max-width', '100%', 'important');
        this.domElement.parentElement.style.setProperty('width', '100%', 'important');
        this.domElement.parentElement.style.setProperty('overflow', 'visible', 'important');
      }
    };

    ConferenciaStageWebPart.prototype._injectGlobalBreakoutStyles = function () {
      var styleId = 'elb-global-css';
      if (!document.getElementById(styleId)) {
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent = [
          '#spLeftNav, [data-automation-id="spLeftNav"], #sideNavBox, nav[role="navigation"] {',
          '  display: none !important;',
          '}',
          '[data-automation-id="CanvasZone"],',
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
          '.spPageCanvasContent {',
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
          '}'
        ].join('\n');
        document.head.appendChild(style);
      }
    };

    ConferenciaStageWebPart.prototype.render = function () {
      this._removeSharePointPadding();
      this._injectGlobalBreakoutStyles();

      var prodUrl = "https://bernardo-laminm.github.io/conferencia-stage/index.html?v=" + Date.now();

      this.domElement.innerHTML = [
        '<div class="elb-container" style="width: 100%; min-height: 92vh; margin: 0; padding: 0; overflow: visible;">',
        '  <iframe id="dhlStageFrame" src="' + prodUrl + '" style="width: 100%; height: 92vh; min-height: 92vh; border: none; display: block; background: #f8fafc;" allow="camera; microphone; geolocation" loading="eager"></iframe>',
        '</div>'
      ].join('');
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
