const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');

function toBase64(filename) {
  const filePath = path.join(assetsDir, filename);
  if (!fs.existsSync(filePath)) return '';
  return 'data:image/png;base64,' + fs.readFileSync(filePath).toString('base64');
}

const orgulhoB64 = toBase64('orgulho_dhl.png');
const caixasB64 = toBase64('caixas_dhl.png');
const aviaoB64 = toBase64('crescendo_voando_alto.png');
const estrelaB64 = toBase64('estrela_amarela_dhl.png');
const fogueteB64 = toBase64('foguete_dhl.png');
const juntosB64 = toBase64('juntos_imparaveis_2030.png');

const cssContent = `/* =========================================================
   DHL DESIGN SYSTEM & LAYOUT BRANDING (Elementos Gráficos Integrados)
   ========================================================= */

/* 1. Vinheta Integrada na Topbar */
.dhl-brand-accent {
  display: inline-flex;
  align-items: center;
  margin-left: 14px;
  height: 32px;
}
.dhl-brand-accent img {
  height: 28px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.08));
  transition: transform 0.2s ease;
}
.dhl-brand-accent img:hover {
  transform: scale(1.04);
}

/* 2. Banner Suave no Card de Início / Boas-vindas */
.login-header-banner {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 12px;
  position: relative;
}
.login-header-banner img {
  max-height: 48px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.08));
}

/* 3. Watermarks Sutis de Fundo nos Cards de KPI (Design Sem Poluição) */
.kpi-unit-embarque {
  position: relative;
  overflow: hidden;
}
.kpi-unit-embarque::after {
  content: "";
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 52px;
  height: 52px;
  background-image: url('${caixasB64}');
  background-size: contain;
  background-repeat: no-repeat;
  opacity: 0.12;
  pointer-events: none;
}

.dash-kpi-item {
  position: relative;
  overflow: hidden;
}
.dash-kpi-item.border-done::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 2px;
  width: 44px;
  height: 44px;
  background-image: url('${estrelaB64}');
  background-size: contain;
  background-repeat: no-repeat;
  opacity: 0.14;
  pointer-events: none;
}
.dash-kpi-item.border-waiting::after {
  content: "";
  position: absolute;
  right: 6px;
  bottom: 4px;
  width: 40px;
  height: 40px;
  background-image: url('${fogueteB64}');
  background-size: contain;
  background-repeat: no-repeat;
  opacity: 0.12;
  pointer-events: none;
}

/* 4. Rodapé Integrado com Branding 2030 */
.footer-brand-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.footer-brand-pill img {
  height: 22px;
  width: auto;
  vertical-align: middle;
  opacity: 0.95;
}
`;

const outPath = path.join(__dirname, '..', 'dhl_branding.css');
fs.writeFileSync(outPath, cssContent, 'utf8');
console.log('✔ dhl_branding.css gerado com sucesso em:', outPath);
