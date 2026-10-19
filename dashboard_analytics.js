/**
 * =======================================================================
 * DHL SUPPLY CHAIN — DASHBOARD ANALÍTICO OPERACIONAL OFICIAL
 * CD P&G ITATIAIA • GESTÃO DE EXPEDIÇÃO & CONSOLIDAÇÃO DE STAGES
 * =======================================================================
 * 100% DADOS REAIS — ZERO SIMULAÇÃO OU INVENÇÃO:
 *  - Embarques e Paletes planejados diretamente da view oficial do WMS
 *  - Auditorias e Bipagens reais registradas no IndexedDB / Histórico
 *  - Filtros 100% Hierárquicos e Ramificados (Cascading & Cross-Filtering)
 *  - Oportunidades Reais de Consolidação de Vagas (SKU + Lote)
 * =======================================================================
 */

(function (window) {
  'use strict';

  const TURNOS = {
    'T1': { nome: '1º Turno (06:00 - 14:20)', inicio: 6, fim: 14.333, cor: '#0284C7' },
    'T2': { nome: '2º Turno (14:20 - 22:40)', inicio: 14.333, fim: 22.667, cor: '#D97706' },
    'T3': { nome: '3º Turno (22:40 - 06:00)', inicio: 22.667, fim: 6, cor: '#7C3AED' }
  };

  const estadoFiltros = {
    data: 'todas',
    turno: 'todos',
    usuario: 'todos',
    embarque: 'todos',
    stage: 'todos'
  };

  function obterTurnoDeHora(h, m = 0) {
    const val = h + (m / 60);
    if (val >= 6 && val < 14.333) return 'T1';
    if (val >= 14.333 && val < 22.667) return 'T2';
    return 'T3';
  }

  function normStage(s) {
    if (!s) return '';
    if (typeof window.normalizeStageName === 'function') {
      return window.normalizeStageName(s);
    }
    const str = String(s).trim().toUpperCase();
    const m = str.match(/^(?:SO|ST|STAGE|STG)?0*(\d+)/i);
    if (!m) return str;
    const num = parseInt(m[1], 10);
    return 'SO' + (num < 100 ? String(num).padStart(2, '0') : String(num));
  }

  /* =========================================================
     1. COLETA DE DADOS 100% REAIS (BASE OFICIAL + HISTÓRICO)
     ========================================================= */
  async function coletarDadosOficiais() {
    const db = window.database || window.EMBEDDED_STAGE_DATA || { embarques: {} };
    const embarquesDb = db.embarques || {};

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

    if (!confs.length) {
      try {
        confs = JSON.parse(localStorage.getItem('dhl_stage_audit_history_v1') || '[]');
      } catch (e) {}
    }

    // 1. Extração plana de todos os paletes planejados da base oficial
    const paletesBase = [];
    const embarquesMap = {};

    Object.values(embarquesDb).forEach(emb => {
      if (!emb || !emb.embarque) return;
      const embId = String(emb.embarque).trim();
      const stgPadrao = (emb.stages && emb.stages[0]) ? normStage(emb.stages[0]) : '';
      
      embarquesMap[embId] = {
        embarque: embId,
        total_paletes: emb.total_paletes || (emb.paletes ? emb.paletes.length : 0),
        total_pecas: emb.total_pecas || 0,
        stages: (emb.stages || []).map(normStage).filter(Boolean)
      };

      if (Array.isArray(emb.paletes)) {
        emb.paletes.forEach(p => {
          if (!p) return;
          const stg = normStage(p.stage || stgPadrao || 'SEM_STAGE');
          paletesBase.push({
            embarque: embId,
            palete: String(p.palete || p.pallet_id || p.lpn || '').trim(),
            stage: stg,
            order_num: p.order_num || '',
            lote: String(p.lote || '').trim(),
            sku: String(p.sku_resumo || (p.itens && p.itens[0] && p.itens[0].sku) || '').trim(),
            qtd: Number(p.qtd_total || 0),
            itens: p.itens || []
          });
        });
      }
    });

    // 2. Extração plana de todas as bipagens reais registradas
    const bipagensRegistradas = [];
    bips.forEach(b => {
      if (!b || !b.lpn) return;
      const dt = new Date(b.timestamp || Date.now());
      const hora = dt.getHours();
      const min = dt.getMinutes();
      const diaStr = dt.toLocaleDateString('pt-BR');
      const turno = obterTurnoDeHora(hora, min);
      const stg = normStage(b.stageFisico || b.stage || '');

      bipagensRegistradas.push({
        id: b.id,
        embarque: String(b.embarque || '').trim(),
        lpn: String(b.lpn).trim(),
        stage: stg,
        vaga: b.vaga || '',
        operador: String(b.operador || 'Operador').trim(),
        timestamp: b.timestamp || dt.getTime(),
        diaStr: diaStr,
        hora: hora,
        turno: turno,
        isDivergente: !!(b.isDivergente || b.status === 'divergent')
      });
    });

    return {
      embarquesDb,
      embarquesMap,
      paletesBase,
      bipagensRegistradas,
      conferencias: confs,
      ocorrencias: ocorrs
    };
  }

  /* =========================================================
     2. MOTOR DE FILTROS HIERÁRQUICOS & RAMIFICADOS
     ========================================================= */
  function calcularOpcoesFiltrosHierarquicos(dados, filtrosAtuais) {
    const { paletesBase, bipagensRegistradas } = dados;

    // Função de checagem condicional com exclusão de uma dimensão
    function itemAtende(item, excetoDim) {
      if (excetoDim !== 'data' && filtrosAtuais.data !== 'todas' && item.diaStr && item.diaStr !== filtrosAtuais.data) return false;
      if (excetoDim !== 'turno' && filtrosAtuais.turno !== 'todos' && item.turno && item.turno !== filtrosAtuais.turno) return false;
      if (excetoDim !== 'usuario' && filtrosAtuais.usuario !== 'todos' && item.operador && item.operador !== filtrosAtuais.usuario) return false;
      if (excetoDim !== 'embarque' && filtrosAtuais.embarque !== 'todos' && item.embarque && item.embarque !== filtrosAtuais.embarque) return false;
      if (excetoDim !== 'stage' && filtrosAtuais.stage !== 'todos' && item.stage && item.stage !== filtrosAtuais.stage) return false;
      return true;
    }

    // 1. Dias disponíveis (derivados de bipagens reais que atendem aos outros filtros)
    const diasSet = new Map();
    bipagensRegistradas.forEach(b => {
      if (itemAtende(b, 'data')) {
        diasSet.set(b.diaStr, (diasSet.get(b.diaStr) || 0) + 1);
      }
    });

    // 2. Turnos disponíveis
    const turnosSet = new Map();
    bipagensRegistradas.forEach(b => {
      if (itemAtende(b, 'turno')) {
        turnosSet.set(b.turno, (turnosSet.get(b.turno) || 0) + 1);
      }
    });

    // 3. Usuários / Conferentes disponíveis
    const usuariosSet = new Map();
    bipagensRegistradas.forEach(b => {
      if (itemAtende(b, 'usuario')) {
        usuariosSet.set(b.operador, (usuariosSet.get(b.operador) || 0) + 1);
      }
    });

    // 4. Embarques disponíveis (cruzamento entre base e bipagens)
    const embarquesSet = new Map();
    // Bipagens que atendem
    bipagensRegistradas.forEach(b => {
      if (itemAtende(b, 'embarque')) {
        embarquesSet.set(b.embarque, (embarquesSet.get(b.embarque) || 0));
      }
    });
    // Paletes da base que atendem ao filtro de stage
    paletesBase.forEach(p => {
      if (filtrosAtuais.stage === 'todos' || p.stage === filtrosAtuais.stage) {
        embarquesSet.set(p.embarque, (embarquesSet.get(p.embarque) || 0) + 1);
      }
    });

    // 5. Stages disponíveis (cruzamento entre base e bipagens)
    const stagesSet = new Map();
    bipagensRegistradas.forEach(b => {
      if (b.stage && itemAtende(b, 'stage')) {
        stagesSet.set(b.stage, (stagesSet.get(b.stage) || 0));
      }
    });
    paletesBase.forEach(p => {
      if (filtrosAtuais.embarque === 'todos' || p.embarque === filtrosAtuais.embarque) {
        stagesSet.set(p.stage, (stagesSet.get(p.stage) || 0) + 1);
      }
    });

    // Valida e corrige seleções órfãs (se o valor filtrado não existe mais no subconjunto ramificado)
    if (filtrosAtuais.data !== 'todas' && !diasSet.has(filtrosAtuais.data)) filtrosAtuais.data = 'todas';
    if (filtrosAtuais.turno !== 'todos' && !turnosSet.has(filtrosAtuais.turno)) filtrosAtuais.turno = 'todos';
    if (filtrosAtuais.usuario !== 'todos' && !usuariosSet.has(filtrosAtuais.usuario)) filtrosAtuais.usuario = 'todos';
    if (filtrosAtuais.embarque !== 'todos' && !embarquesSet.has(filtrosAtuais.embarque)) filtrosAtuais.embarque = 'todos';
    if (filtrosAtuais.stage !== 'todos' && !stagesSet.has(filtrosAtuais.stage)) filtrosAtuais.stage = 'todos';

    // Ordenação numérica e alfanumérica
    const sortStages = (a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb || a.localeCompare(b);
    };

    return {
      dias: Array.from(diasSet.entries()).map(([k, v]) => ({ valor: k, count: v })).sort((a,b) => b.valor.localeCompare(a.valor)),
      turnos: Array.from(turnosSet.entries()).map(([k, v]) => ({ valor: k, count: v, nome: TURNOS[k] ? TURNOS[k].nome : k })),
      usuarios: Array.from(usuariosSet.entries()).map(([k, v]) => ({ valor: k, count: v })).sort((a,b) => a.valor.localeCompare(b.valor)),
      embarques: Array.from(embarquesSet.entries()).map(([k, v]) => ({ valor: k, count: v })).sort((a,b) => a.valor.localeCompare(b.valor)),
      stages: Array.from(stagesSet.entries()).map(([k, v]) => ({ valor: k, count: v })).sort((a, b) => sortStages(a.valor, b.valor))
    };
  }

  /* =========================================================
     3. PROCESSAMENTO DE MÉTRICAS & OPORTUNIDADES OFICIAIS
     ========================================================= */
  function processarMetricasOficiais(dados, filtros) {
    const { paletesBase, bipagensRegistradas } = dados;

    // 1. Filtragem estrita dos paletes planejados da base
    const paletesFiltrados = paletesBase.filter(p => {
      if (filtros.embarque !== 'todos' && p.embarque !== filtros.embarque) return false;
      if (filtros.stage !== 'todos' && p.stage !== filtros.stage) return false;
      return true;
    });

    // 2. Filtragem estrita das bipagens reais realizadas
    const bipagensFiltradas = bipagensRegistradas.filter(b => {
      if (filtros.data !== 'todas' && b.diaStr !== filtros.data) return false;
      if (filtros.turno !== 'todos' && b.turno !== filtros.turno) return false;
      if (filtros.usuario !== 'todos' && b.operador !== filtros.usuario) return false;
      if (filtros.embarque !== 'todos' && b.embarque !== filtros.embarque) return false;
      if (filtros.stage !== 'todos' && b.stage !== filtros.stage) return false;
      return true;
    });

    // 3. Métricas de Volume
    const embarquesUnicos = new Set(paletesFiltrados.map(p => p.embarque));
    const stagesUnicos = new Set(paletesFiltrados.map(p => p.stage));

    const totalPaletesPlanejados = paletesFiltrados.length;
    const totalPaletesAuditados = bipagensFiltradas.length; // 100% REAL: contagem real de leituras!
    const totalConferidosOK = bipagensFiltradas.filter(b => !b.isDivergente).length;
    const totalDivergencias = bipagensFiltradas.filter(b => b.isDivergente).length;

    const assertividadePct = totalPaletesAuditados > 0
      ? ((totalConferidosOK / totalPaletesAuditados) * 100).toFixed(1)
      : null;

    // 4. Distribuição Horária Real (0h a 23h)
    const porHora = Array.from({ length: 24 }, (_, i) => ({ hora: i, bipagens: 0, conferidos: 0, divergencias: 0 }));
    bipagensFiltradas.forEach(b => {
      porHora[b.hora].bipagens++;
      if (b.isDivergente) porHora[b.hora].divergencias++;
      else porHora[b.hora].conferidos++;
    });

    // 5. Produtividade por Usuário Real
    const porUsuarioMap = {};
    bipagensFiltradas.forEach(b => {
      const op = b.operador;
      if (!porUsuarioMap[op]) {
        porUsuarioMap[op] = { operador: op, totalBips: 0, ok: 0, divs: 0 };
      }
      porUsuarioMap[op].totalBips++;
      if (b.isDivergente) porUsuarioMap[op].divs++;
      else porUsuarioMap[op].ok++;
    });

    // 6. Ocupação dos Stages Real
    const porStageMap = {};
    paletesFiltrados.forEach(p => {
      if (!porStageMap[p.stage]) {
        porStageMap[p.stage] = { stage: p.stage, planejados: 0, auditados: 0, embarques: new Set() };
      }
      porStageMap[p.stage].planejados++;
      porStageMap[p.stage].embarques.add(p.embarque);
    });
    bipagensFiltradas.forEach(b => {
      if (b.stage && porStageMap[b.stage]) {
        porStageMap[b.stage].auditados++;
      }
    });

    // 7. Oportunidades 100% REAIS de Consolidação (SKU + Lote)
    // Agrupa paletes com exatamente o mesmo SKU e Lote no mesmo Stage para junção física
    const oportunidades = [];
    const gruposSkuLote = {};

    paletesFiltrados.forEach(p => {
      if (!p.sku || !p.lote) return;
      const chave = `${p.stage}|${p.sku}|${p.lote}`;
      if (!gruposSkuLote[chave]) {
        gruposSkuLote[chave] = {
          stage: p.stage,
          sku: p.sku,
          lote: p.lote,
          embarque: p.embarque,
          paletes: [],
          totalCaixas: 0
        };
      }
      gruposSkuLote[chave].paletes.push(p.palete);
      gruposSkuLote[chave].totalCaixas += (p.qtd || 0);
    });

    Object.values(gruposSkuLote).forEach(g => {
      if (g.paletes.length >= 2) {
        // Encontrou 2 ou mais paletes no mesmo stage com mesmo SKU e lote
        const vagasQuePodemLiberar = g.paletes.length - 1;
        oportunidades.push({
          tipo: 'Consolidação de Vagas',
          icone: '📦',
          nivel: 'oportunidade',
          embarque: g.embarque,
          stage: g.stage,
          titulo: `Consolidar SKU ${g.sku} • Lote ${g.lote} (${g.stage})`,
          descricao: `Existem ${g.paletes.length} paletes deste produto/lote no mesmo stage somando ${g.totalCaixas} caixas.`,
          acao: `Juntar os paletes parciais para liberar até ${vagasQuePodemLiberar} vaga(s) física(s) no ${g.stage}.`,
          acaoClick: `window.abrirConsolidacaoTela('${g.embarque}')`
        });
      }
    });

    // Oportunidades de Divergências Reais registradas
    if (totalDivergencias > 0) {
      oportunidades.push({
        tipo: 'Qualidade / Inventário',
        icone: '⚠️',
        nivel: 'alta',
        stage: filtros.stage !== 'todos' ? filtros.stage : 'CD',
        titulo: `${totalDivergencias} Divergência(s) de Palete Registrada(s)`,
        descricao: `Paletes foram bipados em stages incorretos ou com discordância de lote frente ao WMS.`,
        acao: `Abrir o modal de Histórico / Ocorrências e conferir fisicamente com o time de Inventário.`,
        acaoClick: `if(typeof openHistoryModal === 'function') openHistoryModal('ocorr')`
      });
    }

    return {
      totalEmbarques: embarquesUnicos.size,
      totalPaletesPlanejados,
      totalPaletesAuditados,
      totalConferidosOK,
      totalDivergencias,
      assertividadePct,
      totalStages: stagesUnicos.size,
      porHora,
      porUsuario: Object.values(porUsuarioMap).sort((a,b) => b.totalBips - a.totalBips),
      porStage: Object.values(porStageMap).sort((a,b) => b.planejados - a.planejados),
      oportunidades
    };
  }

  /* =========================================================
     4. RENDERIZAÇÃO DO GRÁFICO SVG DE HORÁRIOS & TURNOS
     ========================================================= */
  function renderSvgGraficoHorarios(porHora, totalAuditados) {
    if (totalAuditados === 0) {
      return `
        <div style="padding: 32px 16px; text-align: center; color: #64748B; background: #F8FAFC; border-radius: 8px; border: 1px dashed #CBD5E1;">
          <span style="font-size: 2rem; display: block; margin-bottom: 6px;">⏱️</span>
          <b style="font-size: 0.92rem; color: #1E293B;">Nenhuma leitura realizada no filtro selecionado</b>
          <div style="font-size: 0.76rem; color: #64748B; margin-top: 4px;">
            Inicie a leitura de paletes no coletor para visualizar a curva horária e o ritmo da operação em tempo real.
          </div>
        </div>
      `;
    }

    const maxVal = Math.max(...porHora.map(h => h.bipagens), 5);
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
          <rect x="${x}" y="${y}" width="${barW - 4}" height="${hPx}" rx="3" fill="${cor}" opacity="${item.bipagens ? '0.92' : '0.12'}" />
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
     5. RENDERIZAÇÃO PRINCIPAL DO PAINEL
     ========================================================= */
  async function renderDashboard() {
    const root = document.getElementById('analyticsDashboardRoot');
    if (!root) return;

    root.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748B;">Carregando dados oficiais da operação P&amp;G Itatiaia...</div>`;

    const dados = await coletarDadosOficiais();
    const opcoesHierarquicas = calcularOpcoesFiltrosHierarquicos(dados, estadoFiltros);
    const metricas = processarMetricasOficiais(dados, estadoFiltros);

    // Dropdown 1: Data / Dia
    const optionsDias = `<option value="todas">📅 Todos os Dias</option>` +
      opcoesHierarquicas.dias.map(d => `<option value="${d.valor}" ${estadoFiltros.data === d.valor ? 'selected' : ''}>${d.valor} (${d.count} bips)</option>`).join('');

    // Dropdown 2: Turno
    const optionsTurnos = `<option value="todos">⏰ Todos os Turnos</option>` +
      opcoesHierarquicas.turnos.map(t => `<option value="${t.valor}" ${estadoFiltros.turno === t.valor ? 'selected' : ''}>${t.nome} (${t.count} bips)</option>`).join('');

    // Dropdown 3: Conferente / Usuário
    const optionsUsuarios = `<option value="todos">👤 Todos os Conferentes</option>` +
      opcoesHierarquicas.usuarios.map(u => `<option value="${u.valor}" ${estadoFiltros.usuario === u.valor ? 'selected' : ''}>${u.valor} (${u.count} bips)</option>`).join('');

    // Dropdown 4: Embarque
    const optionsEmbarques = `<option value="todos">📦 Todos os Embarques (${opcoesHierarquicas.embarques.length})</option>` +
      opcoesHierarquicas.embarques.slice(0, 300).map(e => `<option value="${e.valor}" ${estadoFiltros.embarque === e.valor ? 'selected' : ''}>Embarque ${e.valor} (${e.count} pal)</option>`).join('');

    // Dropdown 5: Stage Físico
    const optionsStages = `<option value="todos">📍 Todos os Stages (${opcoesHierarquicas.stages.length})</option>` +
      opcoesHierarquicas.stages.map(s => `<option value="${s.valor}" ${estadoFiltros.stage === s.valor ? 'selected' : ''}>${s.valor} (${s.count} pal)</option>`).join('');

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
                CD P&amp;G Itatiaia • Validação 100% Real de Produtividade, Turnos, Pátio e Consolidação
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

          <!-- Grade de Filtros Hierárquicos (Ramificados) -->
          <div class="dash-filter-grid">
            <div class="dash-f-item">
              <label>📅 Data / Período</label>
              <select onchange="window.AnalyticsDashboard.filtrar('data', this.value)">${optionsDias}</select>
            </div>
            <div class="dash-f-item">
              <label>⏰ Turno de Operação</label>
              <select onchange="window.AnalyticsDashboard.filtrar('turno', this.value)">${optionsTurnos}</select>
            </div>
            <div class="dash-f-item">
              <label>👤 Conferente / Usuário</label>
              <select onchange="window.AnalyticsDashboard.filtrar('usuario', this.value)">${optionsUsuarios}</select>
            </div>
            <div class="dash-f-item">
              <label>📦 Embarque (WMS)</label>
              <select onchange="window.AnalyticsDashboard.filtrar('embarque', this.value)">${optionsEmbarques}</select>
            </div>
            <div class="dash-f-item">
              <label>📍 Stage Físico</label>
              <select onchange="window.AnalyticsDashboard.filtrar('stage', this.value)">${optionsStages}</select>
            </div>
          </div>
        </header>

        <!-- Cards de KPIs 100% Oficiais (Zero Simulação) -->
        <div class="dash-kpi-grid">
          <div class="dash-kpi-card">
            <span class="d-label">Paletes Planejados (WMS)</span>
            <span class="d-val blue">${metricas.totalPaletesPlanejados.toLocaleString('pt-BR')}</span>
            <span class="d-sub">${metricas.totalEmbarques} embarque(s) no filtro</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Paletes Auditados (Físico)</span>
            <span class="d-val ${metricas.totalPaletesAuditados > 0 ? 'green' : 'gray'}">${metricas.totalPaletesAuditados.toLocaleString('pt-BR')}</span>
            <span class="d-sub">${metricas.totalPaletesAuditados > 0 ? 'Leituras concluídas' : 'Aguardando bipagem'}</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Assertividade Real</span>
            <span class="d-val ${metricas.assertividadePct !== null ? 'green' : 'gray'}">${metricas.assertividadePct !== null ? metricas.assertividadePct + '%' : '—'}</span>
            <span class="d-sub">${metricas.totalConferidosOK} conferidos sem erro</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Divergências de Pátio</span>
            <span class="d-val red">${metricas.totalDivergencias}</span>
            <span class="d-sub">Stages trocados / Lotes divergentes</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Stages com Carga (CD)</span>
            <span class="d-val purple">${metricas.totalStages}</span>
            <span class="d-sub">Stages ativos no filtro</span>
          </div>
          <div class="dash-kpi-card">
            <span class="d-label">Oportunidades de Consolidação</span>
            <span class="d-val orange">${metricas.oportunidades.length}</span>
            <span class="d-sub">Ações reais para liberar vagas</span>
          </div>
        </div>

        <!-- Painel Central: Gráfico de Horários & Oportunidades Reais -->
        <div class="dash-main-split">
          
          <!-- Coluna 1: Curva de Produtividade por Horário & Turno -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">⏱️ Curva de Produtividade por Horário &amp; Turno</h2>
                <span style="font-size:0.75rem;color:#64748B;">Distribuição de bipagens reais realizadas no CD (0h às 23h)</span>
              </div>
              <div style="display:flex;gap:10px;font-size:0.72rem;font-weight:700;">
                <span style="color:#0284C7;">■ T1 (06h-14h20)</span>
                <span style="color:#D97706;">■ T2 (14h20-22h40)</span>
                <span style="color:#7C3AED;">■ T3 (22h40-06h)</span>
              </div>
            </div>
            <div style="padding:14px;">
              ${renderSvgGraficoHorarios(metricas.porHora, metricas.totalPaletesAuditados)}
            </div>
          </div>

          <!-- Coluna 2: Oportunidades Reais de Consolidação & Qualidade -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">💡 Oportunidades de Consolidação &amp; Ação</h2>
                <span style="font-size:0.75rem;color:#64748B;">Junção física de paletes parciais (SKU+Lote) para liberação de vagas</span>
              </div>
              <span class="badge-op-count">${metricas.oportunidades.length} Disponíveis</span>
            </div>
            <div class="dash-op-list">
              ${metricas.oportunidades.length ? metricas.oportunidades.map(op => `
                <div class="dash-op-item op-${op.nivel}">
                  <div class="op-icon">${op.icone}</div>
                  <div style="flex:1;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <b style="font-size:0.86rem;color:#0F172A;">${op.titulo}</b>
                      <span class="op-tag">${op.tipo}</span>
                    </div>
                    <div style="font-size:0.76rem;color:#475569;margin-top:2px;">${op.descricao}</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                      <span style="font-size:0.74rem;font-weight:800;color:#0369A1;">🎯 ${op.acao}</span>
                      ${op.acaoClick ? `<button class="btn-clean-primary" style="margin:0;padding:4px 10px;font-size:0.72rem;background:#0284C7;" onclick="${op.acaoClick}">Abrir Módulo</button>` : ''}
                    </div>
                  </div>
                </div>
              `).join('') : `
                <div style="padding:32px;text-align:center;color:#64748B;">
                  <span style="font-size:1.8rem;display:block;margin-bottom:6px;">✔</span>
                  <b>Nenhuma pendência ou divergência encontrada</b>
                  <div style="font-size:0.76rem;margin-top:4px;">Não há paletes fracionados repetidos no mesmo stage para o filtro selecionado.</div>
                </div>
              `}
            </div>
          </div>

        </div>

        <!-- Grade Inferior: Produtividade dos Conferentes & Ocupação dos Stages -->
        <div class="dash-main-split" style="margin-top:16px;">
          
          <!-- Usuários / Conferentes -->
          <div class="dash-card">
            <div class="dash-card-header">
              <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">👤 Produtividade dos Conferentes</h2>
              <span style="font-size:0.75rem;color:#64748B;">Auditados e assertividade real por operador</span>
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
                  ${metricas.porUsuario.length ? metricas.porUsuario.map(u => `
                    <tr>
                      <td><b>${u.operador}</b></td>
                      <td><b>${u.totalBips}</b></td>
                      <td style="color:#059669;font-weight:700;">${u.ok}</td>
                      <td style="color:#DC2626;font-weight:700;">${u.divs}</td>
                      <td><b>${((u.ok / u.totalBips) * 100).toFixed(1)}%</b></td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="5" style="text-align:center;color:#64748B;padding:20px;">Nenhum operador com bipagens registradas neste filtro.</td></tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Stages & Ocupação Real -->
          <div class="dash-card">
            <div class="dash-card-header">
              <h2 style="font-size:1.05rem;font-weight:800;margin:0;color:#0F172A;">📍 Stages Ativos &amp; Ocupação</h2>
              <span style="font-size:0.75rem;color:#64748B;">Volume real de paletes planejados e auditados</span>
            </div>
            <div class="dash-table-wrap">
              <table class="dash-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Planejados</th>
                    <th>Auditados</th>
                    <th>Embarques</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  ${metricas.porStage.length ? metricas.porStage.slice(0, 50).map(s => `
                    <tr>
                      <td><b>${s.stage}</b></td>
                      <td><b>${s.planejados}</b></td>
                      <td style="color:${s.auditados > 0 ? '#059669' : '#64748B'};font-weight:700;">${s.auditados}</td>
                      <td style="font-size:0.74rem;color:#64748B;">${Array.from(s.embarques).slice(0, 2).join(', ')}${s.embarques.size > 2 ? '...' : ''}</td>
                      <td>
                        <button class="btn-secondary-clean" style="margin:0;padding:3px 8px;font-size:0.72rem;" onclick="if(typeof openStageDetailModal === 'function') openStageDetailModal('${s.stage}')">
                          🔍 Vagas
                        </button>
                      </td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="5" style="text-align:center;color:#64748B;padding:20px;">Nenhum stage com carga para os filtros selecionados.</td></tr>
                  `}
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
     6. API PÚBLICA & ESTILOS DO DASHBOARD
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
      estadoFiltros.data = 'todas';
      estadoFiltros.turno = 'todos';
      estadoFiltros.usuario = 'todos';
      estadoFiltros.embarque = 'todos';
      estadoFiltros.stage = 'todos';
      renderDashboard();
    },

    exportarRelatorioExcel: async function () {
      if (!window.XLSX) {
        alert('SheetJS (XLSX) não disponível.');
        return;
      }
      const dados = await coletarDadosOficiais();
      const metricas = processarMetricasOficiais(dados, estadoFiltros);
      const wb = window.XLSX.utils.book_new();

      // 1. Resumo Executivo
      const resumo = [
        { 'Indicador': 'Embarques Filtrados', 'Valor': metricas.totalEmbarques },
        { 'Indicador': 'Paletes Planejados (WMS)', 'Valor': metricas.totalPaletesPlanejados },
        { 'Indicador': 'Paletes Auditados (Físico)', 'Valor': metricas.totalPaletesAuditados },
        { 'Indicador': 'Paletes Conferidos (OK)', 'Valor': metricas.totalConferidosOK },
        { 'Indicador': 'Divergências Registradas', 'Valor': metricas.totalDivergencias },
        { 'Indicador': 'Assertividade Real', 'Valor': metricas.assertividadePct !== null ? metricas.assertividadePct + '%' : 'Aguardando auditoria' },
        { 'Indicador': 'Oportunidades de Consolidação', 'Valor': metricas.oportunidades.length }
      ];
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(resumo), 'Resumo Executivo');

      // 2. Horários
      const wsHoras = window.XLSX.utils.json_to_sheet(metricas.porHora.map(h => ({
        'Hora': h.hora + ':00',
        'Turno': TURNOS[obterTurnoDeHora(h.hora)].nome,
        'Bipagens': h.bipagens,
        'Conferidos (OK)': h.conferidos,
        'Divergências': h.divergencias
      })));
      window.XLSX.utils.book_append_sheet(wb, wsHoras, 'Produtividade por Horário');

      // 3. Conferentes
      if (metricas.porUsuario.length) {
        const wsUser = window.XLSX.utils.json_to_sheet(metricas.porUsuario.map(u => ({
          'Conferente': u.operador,
          'Total Bipagens': u.totalBips,
          'Conferidos (OK)': u.ok,
          'Divergências': u.divs,
          'Assertividade': ((u.ok / u.totalBips) * 100).toFixed(1) + '%'
        })));
        window.XLSX.utils.book_append_sheet(wb, wsUser, 'Conferentes');
      }

      // 4. Oportunidades de Consolidação
      if (metricas.oportunidades.length) {
        const wsOp = window.XLSX.utils.json_to_sheet(metricas.oportunidades.map(o => ({
          'Tipo': o.tipo,
          'Stage': o.stage,
          'Embarque': o.embarque,
          'Título': o.titulo,
          'Diagnóstico': o.descricao,
          'Ação Recomendada': o.acao
        })));
        window.XLSX.utils.book_append_sheet(wb, wsOp, 'Oportunidades Consolidação');
      }

      const hoje = new Date().toISOString().slice(0, 10);
      window.XLSX.writeFile(wb, `DHL_Dashboard_Operacional_Oficial_${hoje}.xlsx`);
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
    .dash-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .dash-kpi-card { background: #FFFFFF; border-radius: 10px; padding: 14px 18px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 4px; }
    .dash-kpi-card .d-label { font-size: 0.73rem; font-weight: 700; color: #64748B; text-transform: uppercase; }
    .dash-kpi-card .d-val { font-size: 1.6rem; font-weight: 900; line-height: 1.2; }
    .dash-kpi-card .d-val.blue { color: #0284C7; }
    .dash-kpi-card .d-val.green { color: #059669; }
    .dash-kpi-card .d-val.red { color: #DC2626; }
    .dash-kpi-card .d-val.purple { color: #7C3AED; }
    .dash-kpi-card .d-val.orange { color: #D97706; }
    .dash-kpi-card .d-val.gray { color: #94A3B8; }
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
