import { Version } from '@microsoft/sp-core-library';
import {
  BaseClientSideWebPart,
  IPropertyPaneConfiguration,
  PropertyPaneTextField,
  PropertyPaneToggle
} from '@microsoft/sp-webpart-base';

export interface IConferenciaStageWebPartProps {
  description: string;
  fullBleedMode: boolean;
  sharepointCsvUrl: string;
}

export default class ConferenciaStageWebPart extends BaseClientSideWebPart<IConferenciaStageWebPartProps> {

  public render(): void {
    // Quebra margens nativas do SharePoint para ocupar 100% da viewport (Full Bleed / Tela Cheia)
    this.injectFullBleedStyles();

    this.domElement.innerHTML = `
      <div id="spfxDhlAppRoot" class="w-screen min-h-screen max-w-none m-0 p-0 bg-slate-50 text-slate-800 flex flex-col font-sans">
        
        <!-- Topbar Tailwind DHL -->
        <header class="w-full bg-white border-b-2 border-yellow-400 shadow-sm px-4 sm:px-6 py-2.5 flex items-center justify-between sticky top-0 z-50">
          <div class="flex items-center gap-3">
            <span class="bg-red-600 text-yellow-400 font-black px-2.5 py-1 rounded text-base tracking-wider shadow">DHL</span>
            <div class="h-6 w-0.5 bg-slate-200"></div>
            <div>
              <h1 class="text-sm sm:text-base font-extrabold text-slate-900 leading-tight">Conferência de Stage & Alocação</h1>
              <p class="text-xs text-slate-500 hidden sm:block">P&amp;G Itatiaia • Expedição Inteligente (Tablets &amp; Coletores)</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <div id="spfxLiveBadge" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Live SharePoint</span>
            </div>
            <button id="btnRecarregarBaseSpfx" class="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-900 text-white hover:bg-blue-800 transition shadow-sm">
              🔄 Atualizar Base
            </button>
          </div>
        </header>

        <!-- Container Principal da Aplicação em Tela Cheia -->
        <main class="flex-1 w-full flex flex-col p-3 sm:p-5 max-w-full">
          <div id="spfxAppContainer" class="w-full flex-1 flex flex-col">
            <!-- Iframe Seamless ou Renderização Direta Fullscreen -->
            <iframe id="frameConferenciaApp" 
                    src="${this.getAppUrl()}" 
                    class="w-full flex-1 border-0 rounded-xl shadow-sm bg-white" 
                    style="min-height: calc(100vh - 75px); width: 100vw; margin-left: calc(-50vw + 50%); margin-right: calc(-50vw + 50%);"
                    allow="camera; microphone; geolocation"
                    loading="eager">
            </iframe>
          </div>
        </main>

      </div>
    `;

    this.bindEvents();
  }

  private getAppUrl(): string {
    // Se estiver em produção no SharePoint, pode carregar o index.html da mesma biblioteca
    return 'index.html?v=' + Date.now();
  }

  private injectFullBleedStyles(): void {
    const styleId = 'dhl-spfx-fullbleed-tailwind';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        /* Remove paddings e larguras limitadoras das seções do SharePoint Moderno */
        .CanvasZone, [data-automation-id="CanvasZone"], .CanvasSection, .ControlZone {
          padding-left: 0 !important;
          padding-right: 0 !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        /* Quebra contêiner para 100% de largura da tela do tablet */
        #spfxDhlAppRoot {
          width: 100vw !important;
          position: relative !important;
          left: 50% !important;
          right: 50% !important;
          margin-left: -50vw !important;
          margin-right: -50vw !important;
          box-sizing: border-box !important;
        }
      `;
      document.head.appendChild(style);

      // Injeta Tailwind CSS via CDN se não presente
      if (!(window as any).tailwind) {
        const twScript = document.createElement('script');
        twScript.src = 'https://cdn.tailwindcss.com';
        document.head.appendChild(twScript);
      }
    }
  }

  private bindEvents(): void {
    const btn = this.domElement.querySelector('#btnRecarregarBaseSpfx');
    if (btn) {
      btn.addEventListener('click', () => {
        const frame = this.domElement.querySelector('#frameConferenciaApp') as HTMLIFrameElement;
        if (frame) {
          frame.src = this.getAppUrl();
        }
      });
    }
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: "Configurações da Conferência de Stage DHL"
          },
          groups: [
            {
              groupName: "Exibição & Dados",
              groupFields: [
                PropertyPaneTextField('description', {
                  label: "Título da Web Part"
                }),
                PropertyPaneToggle('fullBleedMode', {
                  label: "Modo Tela Cheia (Ocupar Tela Toda)",
                  checked: true
                }),
                PropertyPaneTextField('sharepointCsvUrl', {
                  label: "URL do ADHOC_80.csv (SharePoint Nuvem)"
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
