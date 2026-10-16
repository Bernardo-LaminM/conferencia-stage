# DHL Supply Chain - Robô RPA UiPath (Conferência de Stage)

Projeto RPA corporativo oficial desenvolvido para automação unattended/attended de sincronização de dados de expedição (Stage Inventory & Dispatch Verification) via Gateway `MI-ITATIAIA-PROD-FULL-PaaS-ADHOC`.

---

## 🎯 Arquitetura do Processo

1. **Trigger / Disparo:**
   - Agendamento automático no **UiPath Orchestrator** (ex: a cada 15 ou 30 minutos).
   - Ou disparo manual via **UiPath Assistant** pelo conferente ou analista líder.
2. **Extração Segura via Gateway:**
   - O robô consulta o dataset corporativo alimentado pelo Gateway `MI-ITATIAIA-PROD-FULL-PaaS-ADHOC` (banco `itatiaia` no servidor `sqlwrhitatiaiaprod.b05aaf70da1f.database.windows.net`).
3. **Compilação e Validação:**
   - Monta os dados de todos os embarques, paletes, caixas e stages físicos em `stage_data.js`.
4. **Publicação Contínua:**
   - Envia a base atualizada para o GitHub Pages.
   - Os tablets dos operadores acessam instantaneamente em:
     `https://bernardo-laminm.github.io/conferencia-stage/index.html`

---

## 📂 Onde o Projeto Está Localizado

O projeto está pronto nos dois locais padrão:
1. `C:\Users\blaminma\Documents\UiPath\DHL_Conferencia_Stage_Sync`
2. `C:\Users\blaminma\Downloads\Conferencia_Stage_Oficial\uipath_robot`

---

## 🚀 Como Abrir e Publicar no UiPath Studio

1. Abra o **UiPath Studio**.
2. Na tela inicial, clique em **Open Local Project** (ou navegue até `Documents\UiPath\DHL_Conferencia_Stage_Sync`).
3. Abra o arquivo **`project.json`**.
4. No menu superior do Studio:
   - Clique em **Run** para fazer um teste imediato.
   - Clique em **Publish** para publicar o pacote `.nupkg` no **UiPath Orchestrator** corporativo da DHL.

---

## 🔐 Conta de Serviço DHL
- **Conta:** `consumersector1.ProcessAssistant@dhl.com`
- O robô opera com isolamento de credenciais via Windows Credential Manager e variáveis de ambiente, sem expor senhas em texto puro.
