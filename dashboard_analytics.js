/**
 * =======================================================================
 * DHL SUPPLY CHAIN — DASHBOARD ANALÍTICO DE OPERAÇÕES & OPORTUNIDADES
 * =======================================================================
 * Painel completo de inteligência operacional com validação por:
 *  - Dias / Datas (Histórico temporal)
 *  - Horários e Turnos (1º, 2º e 3º Turno • Curva de Pico)
 *  - Usuários / Conferentes (Produtividade, Ritmo e Assertividade)
 *  - Embarques (Volume de paletes, peças e status)
 *  - Docas (Alocação de carretas, janelas e transportadoras)
 *  - Stages (Lotação física, capacidade e giro)
 *  - OPORTUNIDADES (Consolidação de vagas, balanceamento e inventário)
 * =======================================================================
 */

(function (window) {
  'use strict';

  const TURNOS = {
    'T1': { nome: '1º Turno (06:00 - 14:20)', inicio: 6, fim: 14.33, cor: '#0284C7' },
    'T2': { nome: '2º Turno (14:20 - 22:40)', inicio: 14.33, fim: 22.67, cor: '#D97706' },
    'T3': { nome: '3º Turno (22:40 - 06:00)', inicio: 22.67, fim: 6, cor: '#7C3AED' }
  };

  const estadoFiltros = {
    data: 'todas',
    turno: 'todos',
    usuario: 'todos',
    embarque: 'todos',
    doca: 'todas',
    stage: 'todos',
    tipoOportunidade: 'todas'
  };

  function obterTurnoDeHora(h, m = 0) {
    const val = h + (m / 60);
    if (val >= 6 && val < 14.33) return 'T1';
    if (val >= 14.33 && val < 22.67) return 'T2';
    return 'T3';
  }

  // Coleta dados consolidados da base e do histórico
  async function coletarDadosAnaliticos() {
    const db = window.database || { embarques: {} };
    let confs = [], bips = [], ocorrs = [];

    if (window.DHL_DB) {
      try {
        [confs, bips, ocorrs] = await Promise.all([
          window.DHL_DB.obterConferencias(),
          window.DHL_DB.obterBipagens(),
          window.DHL_DB.obterOcorrencias()
        ]);
      } catch (e) {
        console.warn('[Analytics] Erro ao ler IndexedDB:', e);
      }
    }

    // Fallback de conferências salvas no localStorage caso o IndexedDB esteja em transição
    if (!confs.length) {
      try {
        confs = JSON.parse(localStorage.getItem('dhl_stage_audit_history_v1') || '[]');
      } catch (e) {}
    }

    const ac = window.activeConference || {};
    const embKeys = Object.keys(db.embarques || {});

    return {
      embarquesDb: db.embarques || {},
      totalEmbarquesCadastrados: embKeys.length,
      conferencias: confs,
      bipagens: bips,
      ocorrencias: ocorrs,
      activeConference: ac,
      atualizadoEm: db.atualizado_em || new Date().toISOString()
    };
  }

  // Processa as métricas e oportunidades com base nos filtros
  function processarMetricas(dados, filtros) {
    const { embarquesDb, conferencias, bipagens, ocorrencias } = dados;

    // 1. Dicionários e Agrupadores
    const diasDisponiveis = new Set();
    const usuariosDisponiveis = new Set();
    const embarquesDisponiveis = new Set();
    const docasDisponiveis = new Set();
    const stagesDisponiveis = new Set();

    // Distribuição horária (0h a 23h)
    const porHora = Array.from({ length: 24 }, (_, i) => ({ hora: i, bipagens: 0, conferidos: 0, divergencias: 0 }));
    // Produtividade por Usuário
    const porUsuario = {};
    // Ocupação por Stage
    const porStage = {};
    // Alocação por Doca
    const porDoca = {};
    // Status por Embarque
    const porEmbarque = {};
    // Lista de Oportunidades
    const oportunidades = [];

    // Popula listas a partir dos embarques da base WMS
    Object.values(embarquesDb).forEach(e => {
      if (!e || !e.embarque) return;
      embarquesDisponiveis.add(e.embarque);
      const stgList = e.stages || (e.stage ? [e.stage] : []);
      stgList.forEach(s => {
        const norm = window.normalizeStageName ? window.normalizeStageName(s) : s;
        if (norm) {
          stagesDisponiveis.add(norm);
          if (!porStage[norm]) {
            porStage[norm] = { id: norm, totalPaletes: 0, conferidos: 0, embarques: new Set(), excedente: 0 };
          }
          porStage[norm].totalPaletes += (e.total_paletes || 0);
          porStage[norm].embarques.add(e.embarque);
        }
      });
    });

    // Processa bipagens registradas
    let totalBipagensFiltradas = 0;
    let totalDivergenciasFiltradas = 0;
    let totalPaletesConferidos = 0;

    bipagens.forEach(b => {
      const dt = new Date(b.timestamp || Date.now());
      const diaStr = dt.toLocaleDateString('pt-BR');
      diasDisponiveis.add(diaStr);
      if (b.operador) usuariosDisponiveis.add(b.operador);
      if (b.embarque) embarquesDisponiveis.add(b.embarque);
      if (b.stageFisico) stagesDisponiveis.add(b.stageFisico);

      const hora = dt.getHours();
      const min = dt.getMinutes();
      const turno = obterTurnoDeHora(hora, min);

      // Aplica filtros cruzados
      if (filtros.data !== 'todas' && diaStr !== filtros.data) return;
      if (filtros.turno !== 'todos' && turno !== filtros.turno) return;
      if (filtros.usuario !== 'todos' && b.operador !== filtros.usuario) return;
      if (filtros.embarque !== 'todos' && b.embarque !== filtros.embarque) return;
      if (filtros.stage !== 'todos' && b.stageFisico !== filtros.stage) return;

      totalBipagensFiltradas++;
      if (b.isDivergente || b.status === 'divergent') totalDivergenciasFiltradas++;
      else totalPaletesConferidos++;

      porHora[hora].bipagens++;
      if (b.isDivergente) porHora[hora].divergencias++;
      else porHora[hora].conferidos++;

      // Agrupa usuário
      const op = b.operador || 'Operador Padrão';
      if (!porUsuario[op]) {
        porUsuario[op] = { operador: op, totalBips: 0, ok: 0, divs: 0, primeiroBip: b.timestamp, ultimoBip: b.timestamp };
      }
      porUsuario[op].totalBips++;
      if (b.isDivergente) porUsuario[op].divs++;
      else porUsuario[op].ok++;
      porUsuario[op].primeiroBip = Math.min(porUsuario[op].primeiroBip, b.timestamp);
      porUsuario[op].ultimoBip = Math.max(porUsuario[op].ultimoBip, b.timestamp);
    });

    // Se não houver bipagens históricas suficientes, mapeia a base atual para análise preditiva
    if (totalBipagensFiltradas === 0 && Object.keys(embarquesDb).length > 0) {
      let count = 0;
      Object.values(embarquesDb).forEach(e => {
        count += (e.total_paletes || 0);
      });
      totalBipagensFiltradas = count;
      totalPaletesConferidos = 0;
    }

    // 2. Mapeamento de Oportunidades Reais (Analytics de Eficiência)
    // Oportunidade A: Stages com saturação física (> 10 paletes alocados precisando de liberação)
    Object.values(porStage).forEach(stg => {
      if (stg.totalPaletes > 10) {
        oportunidades.push({
          tipo: 'Gargalo de Stage',
          icone: '🚨',
          nivel: 'alta',
          titulo: `Stage ${stg.id} com sobrecarga (${stg.totalPaletes} paletes)`,
          descricao: `Stage ultrapassa a capacidade de 10 vagas físicas. ${stg.totalPaletes - 10} paletes aguardam giro contínuo.`,
          acao: `Priorizar carregamento ou duplar vagas físicas no ${stg.id}`
        });
      }
    });

    // Oportunidade B: Consolidação de Paletes Parciais (Liberação de Vagas)
    if (window.ConsolidationPlanner && window.StageMap) {
      try {
        const smAdapter = window.StageMapAdapter ? window.StageMapAdapter() : null;
        if (smAdapter && smAdapter.stages) {
          const plan = window.ConsolidationPlanner.plan(smAdapter, { liberarStages: true, incluirAguardando: true });
          if (plan && plan.stats && plan.stats.liberados > 0) {
            oportunidades.push({
              tipo: 'Consolidação de Espaço',
              icone: '✨',
              nivel: 'oportunidade',
              titulo: `${plan.stats.liberados} Vagas podem ser Liberadas Imediatamente`,
              descricao: `${plan.stats.movimentos} movimentações sugeridas para agrupar o mesmo SKU+Lote. Economia direta de ${plan.stats.pct}% de área.`,
              acao: 'Abrir módulo de Consolidação e executar junção de paletes'
            });
          }
        }
      } catch (e) {}
    }

    // Oportunidade C: Divergências Detectadas por Horário ou Usuário
    if (totalDivergenciasFiltradas > 0) {
      const taxaAssertividade = totalBipagensFiltradas ? ((totalPaletesConferidos / totalBipagensFiltradas) * 100).toFixed(1) : 100;
      oportunidades.push({
        tipo: 'Qualidade / Inventário',
        icone: '⚠️',
        nivel: 'media',
        titulo: `${totalDivergenciasFiltradas} Divergências Registradas (Assertividade: ${taxaAssertividade}%)`,
        descricao: 'Paletes alocados em stages divergentes do planejamento do WMS ou erros de lote.',
        acao: 'Verificar chamado com time de Inventário e confirmar transferências'
      });
    }

    // Oportunidade D: Docas livres vs carregando
    for (let d = 1; d <= 30; d++) {
      const docaId = 'DOCA' + (d < 10 ? '0' + d : d);
      docasDisponiveis.add(docaId);
    }

    return {
      totalBipagens: totalBipagensFiltradas,
      totalConferidos: totalPaletesConferidos,
      totalDivergencias: totalDivergenciasFiltradas,
      assertividadePct: totalBipagensFiltradas ? ((totalPaletesConferidos / totalBipagensFiltradas) * 100).toFixed(1) : 100,
      porHora,
      porUsuario: Object.values(porUsuario),
      porStage: Object.values(porStage),
      oportunidades,
      listasFiltro: {
        dias: Array.from(diasDisponiveis).sort(),
        usuarios: Array.from(usuariosDisponiveis).sort(),
        embarques: Array.from(embarquesDisponiveis).sort(),
        docas: Array.from(docasDisponiveis),
        stages: Array.from(stagesDisponiveis).sort((a,b) => (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0))
      }
    };
  }

  // Gera o gráfico SVG de barras por horário (0h às 23h)
  function renderSvgGraficoHorarios(porHora) {
    const maxVal = Math.max(...porHora.map(h => h.bipagens), 10);
    const svgW = 760;
    const svgH = 160;
    const padL = 35;
    const padB = 25;
    const barW = (svgW - padL - 10) / 24;

    let bars = '';
    porHora.forEach((item, idx) => {
      const hPx = (item.bipagens / maxVal) * (svgH - padB - 20);
      const x = padL + idx * barW + 2;
      const y = svgH - padB - hPx;
      const turno = obterTurnoDeHora(item.hora);
      const cor = TURNOS[turno].cor;

      bars += `
        <g class="dash-bar-group" data-h="${item.hora}">
          <title>${item.hora}:00 - ${item.bipagens} paletes (${TURNOS[turno].nome})</title>
          <rect x="${x}" y="${y}" width="${barW - 4}" height="${hPx}" rx="3" fill="${cor}" opacity="${item.bipagens ? '0.9' : '0.15'}" />
          ${item.bipagens > 0 ? `<text x="${x + (barW - 4)/2}" y="${y - 4}" font-size="9" font-weight="700" fill="#1E293B" text-anchor="middle">${item.bipagens}</text>` : ''}
          <text x="${x + (barW - 4)/2}" y="${svgH - 8}" font-size="9" fill="#64748B" text-anchor="middle">${item.hora}h</text>
        </g>
      `;
    });

    return `
      <svg viewBox="0 0 ${svgW} ${svgH}" class="dash-svg-chart" style="width: 100%; height: auto; max-height: 200px; display: block;">
        <line x1="${padL}" y1="${svgH - padB}" x2="${svgW}" y2="${svgH - padB}" stroke="#E2E8F0" stroke-width="1.5" />
        ${bars}
      </svg>
    `;
  }

  /* =========================================================
     RENDERIZAÇÃO COMPLETA DO PAINEL DO DASHBOARD
     ========================================================= */
  async function renderDashboard() {
    const root = document.getElementById('analyticsDashboardRoot');
    if (!root) return;

    root.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748B;">Carregando dados analíticos da operação...</div>`;

    const dados = await coletarDadosAnaliticos();
    const metricas = processarMetricas(dados, estadoFiltros);

    // Monta o cabeçalho de filtros interativos
    let optionsDias = `<option value="todas">📅 Todos os Dias</option>` + metricas.listasFiltro.dias.map(d => `<option value="${d}" ${estadoFiltros.data === d ? 'selected' : ''}>${d}</option>`).join('');
    let optionsTurnos = `<option value="todos">⏰ Todos os Turnos</option>` + Object.keys(TURNOS).map(t => `<option value="${t}" ${estadoFiltros.turno === t ? 'selected' : ''}>${TURNOS[t].nome}</option>`).join('');
    let optionsUsuarios = `<option value="todos">👤 Todos os Conferentes</option>` + metricas.listasFiltro.usuarios.map(u => `<option value="${u}" ${estadoFiltros.usuario === u ? 'selected' : ''}>${u}</option>`).join('');
    let optionsEmbarques = `<option value="todos">📦 Todos os Embarques (${metricas.listasFiltro.embarques.length})</option>` + metricas.listasFiltro.embarques.slice(0, 100).map(e => `<option value="${e}" ${estadoFiltros.embarque === e ? 'selected' : ''}>Embarque ${e}</option>`).join('');
    let optionsStages = `<option value="todos">📍 Todos os Stages (${metricas.listasFiltro.stages.length})</option>` + metricas.listasFiltro.stages.map(s => `<option value="${s}" ${estadoFiltros.stage === s ? 'selected' : ''}>${s}</option>`).join('');

    const html = `
      <div class="dash-analytics-wrap">
        <!-- Barra Superior de Controle e Filtros -->
        <header class="dash-ana-header">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
            <div>
              <h1 style="font-size: 1.35rem; font-weight: 900; color: #0F172A; display: flex; align-items: center; gap: 8px; margin: 0;">
                📊 Dashboard Operacional &amp; Oportunidades
              </h1>
              <span style="font-size: 0.8rem; color: #64748B;">
                Auditoria de Produtividade, Turnos, Pátio, Docas e Oportunidades de Otimização • CD P&amp;G Itatiaia
              </span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn-clean-primary" style="margin-top:0;width:auto;padding:8px 16px;background:#059669;font-weight:700;" onclick="window.AnalyticsDashboard.exportarRelatorioExcel()">
                📊 Exportar Relatório (.xlsx)
              </button>
              <button class="btn-secondary-clean" onclick="window.AnalyticsDashboard.resetarFiltros()">
                🔄 Limpar Filtros
              </button>
              <button class="btn-secondary-clean" onclick="window.irParaConferencia()">
                ← Voltar à Conferência
              </button>
            </div>
          </div>

          <!-- Grade de Filtros Dinâmicos -->
          <div class="dash-filter-grid">
            <div class="dash-f-item">
              <label>Data / Dia</label>
              <select onchange="window.AnalyticsDashboard.filtrar('data', this.value)">${optionsDias}</select>
            </div>
            <div class="dash-f-item">
              <label>Turno / Horário</label>
              <select onchange="window.AnalyticsDashboard.filtrar('turno', this.value)">${optionsTurnos}</select>
            </div>
            <div class="dash-f-item">
              <label>Conferente / Usuário</label>
              <select onchange="window.AnalyticsDashboard.filtrar('usuario', this.value)">${optionsUsuarios}</select>
            </div>
            <div class="dash-f-item">
              <label>Embarque</label>
              <select onchange="window.AnalyticsDashboard.filtrar('embarque', this.value)">${optionsEmbarques}</select>
            </div>
            <div class="dash-f-item">
              <label>Stage Físico</label>
              <select onchange="window.AnalyticsDashboard.filtrar('stage', this.value)">${optionsStages}</select>
            </div>
          </div>
        </header>

        <!-- Cards de KPIs Principais -->
        <div class="dash-kpi-grid">
          <div class="dash-kpi-card">
            <span class="d-label">Volume Total Auditado</span>
            <span class="d-val blue">${metricas.totalBipagens.toLocaleString('pt-BR')}</span>
            <span class="d-sub">Paletes registrados</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Paletes 100% Conferidos</span>
            <span class="d-val green">${metricas.totalConferidos.toLocaleString('pt-BR')}</span>
            <span class="d-sub">${metricas.assertividadePct}% de assertividade</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Divergências de Pátio</span>
            <span class="d-val red">${metricas.totalDivergencias}</span>
            <span class="d-sub">Stages trocados ou erros</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Stages Ativos no CD</span>
            <span class="d-val purple">${metricas.listasFiltro.stages.length}</span>
            <span class="d-sub">De SO01 a SO76 + SO128 a SO148</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Oportunidades Mapeadas</span>
            <span class="d-val orange">${metricas.oportunidades.length}</span>
            <span class="d-sub">Ações de melhoria ativas</span>
          </div>
        </div>

        <!-- Painel Central Duplo: Curva de Horários & Oportunidades de Otimização -->
        <div class="dash-main-split">
          
          <!-- Coluna 1: Curva de Horários & Turnos -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">⏱️ Distribuição de Carga por Horário &amp; Turno</h2>
                <span style="font-size:0.75rem;color:#64748B;">Identificação de horários de pico e ritmo operacional (0h às 23h)</span>
              </div>
              <div style="display:flex;gap:10px;font-size:0.72rem;font-weight:700;">
                <span style="color:#0284C7;">■ 1º Turno</span>
                <span style="color:#D97706;">■ 2º Turno</span>
                <span style="color:#7C3AED;">■ 3º Turno</span>
              </div>
            </div>
            <div style="padding:14px;">
              ${renderSvgGraficoHorarios(metricas.porHora)}
            </div>
          </div>

          <!-- Coluna 2: Painel Estratégico de OPORTUNIDADES -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">💡 Oportunidades de Otimização &amp; Ação</h2>
                <span style="font-size:0.75rem;color:#64748B;">Gargalos de pátio, liberação de vagas e auditoria de qualidade</span>
              </div>
              <span class="badge-op-count">${metricas.oportunidades.length} Ações</span>
            </div>
            <div class="dash-op-list">
              ${metricas.oportunidades.length ? metricas.oportunidades.map(op => `
                <div class="dash-op-item op-${op.nivel}">
                  <div class="op-icon">${op.icone}</div>
                  <div style="flex:1;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <b style="font-size:0.88rem;color:#0F172A;">${op.titulo}</b>
                      <span class="op-tag">${op.tipo}</span>
                    </div>
                    <div style="font-size:0.78rem;color:#475569;margin-top:2px;">${op.descricao}</div>
                    <div style="font-size:0.75rem;font-weight:800;color:#0369A1;margin-top:4px;">🎯 Ação Recomendada: ${op.acao}</div>
                  </div>
                </div>
              `).join('') : '<div style="padding:30px;text-align:center;color:#64748B;">Nenhum gargalo ou oportunidade crítica no momento. Operação em fluxo nominal.</div>'}
            </div>
          </div>

        </div>

        <!-- Grade Inferior: Produtividade por Conferente & Ocupação de Stages -->
        <div class="dash-main-split" style="margin-top:16px;">
          
          <!-- Usuários / Conferentes -->
          <div class="dash-card">
            <div class="dash-card-header">
              <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">👤 Produtividade por Conferente</h2>
              <span style="font-size:0.75rem;color:#64748B;">Volume e qualidade de bipagem por usuário</span>
            </div>
            <div class="dash-table-wrap">
              <table class="dash-table">
                <thead>
                  <tr>
                    <th>Conferente</th>
                    <th>Paletes Bipados</th>
                    <th>Conferidos (OK)</th>
                    <th>Divergências</th>
                    <th>Assertividade</th>
                  </tr>
                </thead>
                <tbody>
                  ${metricas.porUsuario.length ? metricas.porUsuario.map(u => {
                    const pct = u.totalBips ? ((u.ok / u.totalBips) * 100).toFixed(1) : 100;
                    return `
                      <tr>
                        <td><b>${u.operador}</b></td>
                        <td>${u.totalBips}</td>
                        <td style="color:#059669;font-weight:700;">${u.ok}</td>
                        <td style="color:#DC2626;font-weight:700;">${u.divs}</td>
                        <td><span class="badge-assert">${pct}%</span></td>
                      </tr>
                    `;
                  }).join('') : `<tr><td colspan="5" style="text-align:center;color:#64748B;">Bipagens aguardando início no coletor.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Stages & Pátio -->
          <div class="dash-card">
            <div class="dash-card-header">
              <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">📍 Ocupação dos Stages &amp; Docas</h2>
              <span style="font-size:0.75rem;color:#64748B;">Stages com maior concentração de paletes</span>
            </div>
            <div class="dash-table-wrap">
              <table class="dash-table">
                <thead>
                  <tr>
                    <th>Stage Físico</th>
                    <th>Paletes Planejados</th>
                    <th>Status Lotação</th>
                    <th>Embarques Atrelados</th>
                  </tr>
                </thead>
                <tbody>
                  ${metricas.porStage.slice(0, 15).map(s => {
                    const isLotado = s.totalPaletes >= 10;
                    return `
                      <tr>
                        <td><b>${s.id}</b></td>
                        <td><b>${s.totalPaletes}</b> paletes</td>
                        <td>
                          <span class="badge-status ${isLotado ? 'st-full' : 'st-ok'}">
                            ${isLotado ? `Sobrecarga (${s.totalPaletes}/10)` : `${s.totalPaletes}/10 vagas`}
                          </span>
                        </td>
                        <td style="font-size:0.75rem;color:#64748B;">${Array.from(s.embarques).slice(0, 2).join(', ')}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    `;

    root.innerHTML = html;
  }

  /* =========================================================
     API PÚBLICA DO DASHBOARD
     ========================================================= */
  const AnalyticsDashboard = {
    abrir: function () {
      if (typeof window.showScreen === 'function') {
        window.showScreen('viewAnalyticsDashboard');
      } else {
        const el = document.getElementById('viewAnalyticsDashboard');
        if (el) el.style.display = 'block';
      }
      renderDashboard();
    },

    filtrar: function (tipo, valor) {
      estadoFiltros[tipo] = valor;
      renderDashboard();
    },

    resetarFiltros: function () {
      Object.keys(estadoFiltros).forEach(k => {
        estadoFiltros[k] = (k === 'data' || k === 'doca') ? 'todas' : 'todos';
      });
      renderDashboard();
    },

    exportarRelatorioExcel: async function () {
      if (!window.XLSX) {
        alert('SheetJS não disponível para exportar.');
        return;
      }
      const dados = await coletarDadosAnaliticos();
      const metricas = processarMetricas(dados, estadoFiltros);
      const wb = window.XLSX.utils.book_new();

      // 1. Resumo Executivo
      const resumo = [
        { 'Indicador': 'Total Paletes Auditados', 'Valor': metricas.totalBipagens },
        { 'Indicador': 'Paletes Conferidos (OK)', 'Valor': metricas.totalConferidos },
        { 'Indicador': 'Divergências Registradas', 'Valor': metricas.totalDivergencias },
        { 'Indicador': 'Assertividade Global', 'Valor': metricas.assertividadePct + '%' },
        { 'Indicador': 'Oportunidades Mapeadas', 'Valor': metricas.oportunidades.length }
      ];
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(resumo), 'Resumo Executivo');

      // 2. Horários e Turnos
      const wsHoras = window.XLSX.utils.json_to_sheet(metricas.porHora.map(h => ({
        'Hora': h.hora + ':00',
        'Turno': TURNOS[obterTurnoDeHora(h.hora)].nome,
        'Bipagens': h.bipagens,
        'Conferidos (OK)': h.conferidos,
        'Divergências': h.divergencias
      })));
      window.XLSX.utils.book_append_sheet(wb, wsHoras, 'Produtividade por Horário');

      // 3. Produtividade por Conferente
      if (metricas.porUsuario.length) {
        const wsUser = window.XLSX.utils.json_to_sheet(metricas.porUsuario.map(u => ({
          'Operador': u.operador,
          'Total Bipagens': u.totalBips,
          'Conferidos': u.ok,
          'Divergências': u.divs,
          'Assertividade': ((u.ok / u.totalBips) * 100).toFixed(1) + '%'
        })));
        window.XLSX.utils.book_append_sheet(wb, wsUser, 'Conferentes');
      }

      // 4. Oportunidades Operacionais
      if (metricas.oportunidades.length) {
        const wsOp = window.XLSX.utils.json_to_sheet(metricas.oportunidades.map(o => ({
          'Tipo': o.tipo,
          'Nível': o.nivel,
          'Título': o.titulo,
          'Diagnóstico': o.descricao,
          'Ação Recomendada': o.acao
        })));
        window.XLSX.utils.book_append_sheet(wb, wsOp, 'Oportunidades');
      }

      const hoje = new Date().toISOString().slice(0, 10);
      window.XLSX.writeFile(wb, `DHL_Dashboard_Operacional_${hoje}.xlsx`);
    }
  };

  const dashStyles = `
    .dash-analytics-wrap { padding: 18px 24px; max-width: 1400px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .dash-ana-header { background: #FFFFFF; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #E2E8F0; margin-bottom: 20px; }
    .dash-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
    .dash-f-item { display: flex; flex-direction: column; gap: 4px; }
    .dash-f-item label { font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
    .dash-f-item select { padding: 8px 10px; border-radius: 6px; border: 1px solid #CBD5E1; font-size: 0.82rem; background: #F8FAFC; color: #1E293B; font-weight: 600; outline: none; }
    .dash-f-item select:focus { border-color: #0284C7; background: #FFF; }
    .dash-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .dash-kpi-card { background: #FFFFFF; border-radius: 10px; padding: 14px 18px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 4px; }
    .dash-kpi-card .d-label { font-size: 0.74rem; font-weight: 700; color: #64748B; text-transform: uppercase; }
    .dash-kpi-card .d-val { font-size: 1.6rem; font-weight: 900; line-height: 1.2; }
    .dash-kpi-card .d-val.blue { color: #0284C7; }
    .dash-kpi-card .d-val.green { color: #059669; }
    .dash-kpi-card .d-val.red { color: #DC2626; }
    .dash-kpi-card .d-val.purple { color: #7C3AED; }
    .dash-kpi-card .d-val.orange { color: #D97706; }
    .dash-kpi-card .d-sub { font-size: 0.72rem; color: #94A3B8; }
    .dash-main-split { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; }
    @media (max-width: 960px) { .dash-main-split { grid-template-columns: 1fr; } }
    .dash-card { background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; display: flex; flex-direction: column; }
    .dash-card-header { padding: 14px 18px; border-bottom: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center; background: #FAFBFD; }
    .badge-op-count { font-size: 0.74rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: #FEF3C7; color: #B45309; }
    .dash-op-list { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; }
    .dash-op-item { display: flex; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF; transition: all 0.15s; }
    .dash-op-item:hover { border-color: #CBD5E1; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
    .dash-op-item.op-alta { border-left: 4px solid #DC2626; background: #FEF2F2; }
    .dash-op-item.op-media { border-left: 4px solid #D97706; background: #FFFBEB; }
    .dash-op-item.op-oportunidade { border-left: 4px solid #059669; background: #F0FDF4; }
    .op-icon { font-size: 1.4rem; line-height: 1; }
    .op-tag { font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: #E2E8F0; color: #334155; }
    .dash-table-wrap { padding: 10px 16px; overflow-x: auto; max-height: 340px; }
    .dash-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left; }
    .dash-table th { padding: 8px 10px; border-bottom: 2px solid #E2E8F0; color: #475569; font-weight: 800; font-size: 0.74rem; text-transform: uppercase; }
    .dash-table td { padding: 8px 10px; border-bottom: 1px solid #F1F5F9; }
    .dash-table tr:hover td { background: #F8FAFC; }
  `;
  if (typeof document !== 'undefined') {
    const sEl = document.createElement('style');
    sEl.textContent = dashStyles;
    document.head.appendChild(sEl);
  }

  window.AnalyticsDashboard = AnalyticsDashboard;
  window.abrirAnalyticsDashboard = AnalyticsDashboard.abrir;

})(window);
