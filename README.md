# DHL Supply Chain - Conferência de Stage (Auditoria & Validação de Expedição)

Aplicação web moderna, responsiva e de alta performance desenvolvida para auditoria física de paletes e validação de expedição (Stage Inventory & Dispatch Verification) em centros de distribuição DHL Supply Chain.

---

## ⚡ Principais Funcionalidades

- **Bipagem Contínua Sem Enter ("Bipou = Validou"):**
  - Validação instantânea de etiquetas SSCC / LPN com leitor de código de barras USB ou Bluetooth.
  - Reconhecimento automático de LPNs de 18 e 20 dígitos (GS1-128) com suporte a prefixos, sufixos e tolerância a zeros à esquerda.
  - Alertas sonoros (bip de confirmação, alerta de palete duplicado e buzzer de divergência) e sintetizador de voz pt-BR.

- **Atualização da Base via Upload de Excel (.xlsx):**
  - Importação direta no navegador (com Drag & Drop) usando biblioteca **SheetJS** offline.
  - Suporte automático a múltiplos formatos:
    - Formato de Guia de Conferência (`GUIA DE CONFERÊNCIA.xlsx`).
    - Formato tabular de consulta WMS / SQL (`car_move`, `order_num`, `etiqueta`, `stage`, `sku`, `lote`, `caixas`).
    - Relatórios analíticos de alocações (`adhc8-*.xlsx`).

- **Preservação Permanente de Histórico:**
  - Todas as conferências anteriores e auditorias salvas são armazenadas no `localStorage` do navegador e **nunca são perdidas** ao atualizar a base de embarques.
  - Painel de Histórico com exportação individual e geral em formato **CSV**.

---

## 🚀 Como Publicar no GitHub Pages (Web Hosting Gratuito)

1. Crie um novo repositório no seu GitHub (ex.: `conferencia-stage`).
2. Faça o upload dos seguintes arquivos principais:
   - `index.html`
   - `style.css`
   - `app.js`
   - `stage_data.js`
   - `stage_data.json`
   - `xlsx.full.min.js`
   - Pasta `assets/`
3. No repositório no GitHub, acesse **Settings** > **Pages**.
4. Em **Build and deployment**, selecione a branch `main` (ou `master`) e a pasta `/ (root)`, e clique em **Save**.
5. Em menos de 1 minuto, sua aplicação estará online com link HTTPS (ex.: `https://<seu-usuario>.github.io/conferencia-stage/`).

---

## 💻 Execução Local / Rede Wi-Fi

Para rodar localmente no computador e liberar o acesso para coletores de dados (Zebra, Honeywell, smartphones) no mesmo Wi-Fi:
- Dê dois cliques em **`INICIAR_SERVIDOR_WEB.bat`**.
- Acesse via navegador:
  - No computador: `http://localhost:8080`
  - No coletor de dados / celular: `http://<IP_DA_MAQUINA>:8080`

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 & CSS3** (Design System Clean DHL Supply Chain corporativo).
- **JavaScript Moderno (ES6+)** com Web Audio API e Web Speech API.
- **SheetJS (xlsx.full.min.js)** para manipulação de planilhas Excel no cliente.
- **PowerShell** para scripts de automação e servidor HTTP leve.
