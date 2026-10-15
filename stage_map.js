/* Mapa de Stages 2D/3D — DHL Supply Chain
 * Uso: StageMap.mount(elemento, { loadData: () => ({stages:[...]}) })
 * Formato: { stages:[ { id:'SO01', band:0?, embarque:'1'|null,
 *            slots:[ {pos:'A', status:'conferido|aguardando|parcial|divergencia|ativo|livre', lpn, sku} ] } ] }
 * Para ligar ao app: defina window.StageMapAdapter = () => ({stages:[...]}) e chame StageMap.refresh() quando algo mudar. */
(function () {
  'use strict';
  var CW = 44, GAP = 0, CH = 44, LAB = 34, PLATE = 28, PLATE_GAP = 6, PADH = 8;
  var NAMES = { conferido: 'Conferido', aguardando: 'Aguardando conferência', divergencia: 'Divergência', ativo: 'Bipando agora', livre: 'Livre' };
  var ICON = { conferido: '✔', divergencia: '✖', ativo: '●', aguardando: '' };
  var CNAME = { conferido: 'Conferida', parcial: 'Parcial', aguardando: 'Aguardando' };
  var PAL = ['#6D4AFF', '#00A3A3', '#D6336C', '#7A9A01', '#C2651A', '#2F6BFF', '#B8860B', '#8E44AD', '#0E8F5B', '#C0392B'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };

  var UID = 0;
  function make() {
  var SM = {
    opts: { cols: Infinity, positions: 'ABCDEFGHIJ'.split(''), loadData: null, onStage: null, onEmbarque: null, planner: false, showFill: false, inicioNoLado: 'direita', mhe: { metrosStage: 1.3, metrosPos: 1.3, velocidade: 2.0, manuseio: 69 } },
    mode: '2d', tilt: 42, yaw: 0, filter: 'all', q: '', focus: null, data: null, root: null, sig: '', sel: null, id: ++UID, zoom: 1, ct: 0, cy: 0, raw: null, view: 'antes', po: { destino: 'completar', liberar: true, aguard: false }, plan: null
  };

  SM.mount = function (el, opts) {
    SM.root = el; el.classList.add('sm-root');
    for (var k in (opts || {})) SM.opts[k] = opts[k];
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('input', onInput);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', hideTip);
    window.addEventListener('resize', function () { if (visible()) fit(); });
    SM.refresh(true);
  };

  function visible() { return SM.root && SM.root.offsetParent !== null; }

  SM.refresh = function (force) {
    var d = SM.opts.loadData && SM.opts.loadData();
    if (!d || !d.stages) d = demo(SM.opts.planner);
    var sig = JSON.stringify(d);
    if (!force && sig === SM.sig) return;
    SM.sig = sig; SM.raw = norm(d);
    if (d.focus != null && !SM._f) { SM.focus = String(d.focus); SM._f = 1; }
    build(); render();
  };
  SM.setMode = function (m) { if (m === SM.mode) return; SM.mode = m; applyMode(true); };
  var CAMS = { frente: { tilt: 42, yaw: 0 }, iso: { tilt: 55, yaw: -30 } };
  SM.cam = function (name) {
    var c = CAMS[name]; if (!c) return;
    SM.tilt = c.tilt; SM.yaw = c.yaw; SM.mode = '3d'; syncSliders(); applyMode(true);
  };
  function syncSliders() {
    ['tilt', 'yaw'].forEach(function (k) { var i = SM.root.querySelector('[data-r="' + k + '"]'); if (i) i.value = Math.round(SM[k]); });
    var z = SM.root.querySelector('[data-r="zoom"]'); if (z) z.value = Math.round(SM.zoom * 100);
  }
  function refit() { if (SM.raf) cancelAnimationFrame(SM.raf); SM.raf = requestAnimationFrame(fit); }
  function onDown(ev) {
    if (ev.button !== 0 || !ev.target.closest('.sm-viewport')) return;
    var vp = SM.root.querySelector('.sm-viewport'), f = SM.root.querySelector('.sm-floor');
    var st = { x: ev.clientX, y: ev.clientY, sl: vp.scrollLeft, t: SM.tilt, yw: SM.yaw, orbit: SM.mode === '3d' && !ev.shiftKey, moved: false };
    var move = function (e) {
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      st.moved = true; vp.classList.add('drag');
      if (st.orbit) {
        SM.yaw = Math.max(-60, Math.min(60, st.yw + dx * 0.25));
        SM.tilt = Math.max(15, Math.min(75, st.t - dy * 0.2));
        SM.tw++; camVars(SM.tilt, SM.yaw); syncSliders(); refit();
      } else vp.scrollLeft = st.sl - dx;
    };
    var up = function () {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      vp.classList.remove('drag');
      if (st.moved) { SM.noClick = true; setTimeout(function () { SM.noClick = false; }, 0); }
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function onWheel(ev) {
    if (!ev.ctrlKey || !ev.target.closest('.sm-viewport')) return;
    ev.preventDefault();
    SM.zoom = Math.max(0.5, Math.min(2, SM.zoom * (ev.deltaY < 0 ? 1.08 : 1 / 1.08)));
    syncSliders(); refit();
  }
  SM.setFilter = function (f) { SM.filter = f || 'all'; applyDim(); };
  SM.setSearch = function (q) { SM.q = q || ''; applyDim(); };
  SM.setFocus = function (id) { SM.focus = id == null || id === '' ? null : String(id); SM._f = 1; if (SM.raw) refocus(); };

  function build() {
    var d = SM.raw, v = { stages: d.stages, demo: d.demo, focus: d.focus, zonas: d.zonas, routes: d.routes || [] };
    SM.plan = null;
    if (SM.opts.planner && window.ConsolidationPlanner) {
      SM.plan = window.ConsolidationPlanner.plan(d, { embarque: SM.focus, destino: SM.po.destino, liberarStages: SM.po.liberar, incluirAguardando: SM.po.aguard, positions: SM.opts.positions });
      v.routes = SM.plan.routes;
      var mh = SM.opts.mhe, ix = {}, tot = 0, seg = 0;
      d.stages.forEach(function (st, n) { ix[st.id] = n; });
      SM.plan.routes.forEach(function (r) {
        var dist = Math.abs(ix[r.to.id] - ix[r.from.id]) * mh.metrosStage + Math.abs(SM.opts.positions.indexOf(r.to.pos) - SM.opts.positions.indexOf(r.from.pos)) * mh.metrosPos;
        r.dist = Math.round(dist); r.seg = Math.round(dist / mh.velocidade + mh.manuseio);
        tot += r.dist; seg += r.seg;
      });
      SM.plan.stats.dist = tot; SM.plan.stats.seg = seg;
      SM.plan.stats.pph = seg ? Math.round(SM.plan.routes.length * 3600 / seg) : 0;
      if (SM.view === 'depois') { v.stages = SM.plan.after; v.routes = []; }
    }
    SM.data = v;
  }
  function fmtT(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), r = sec % 60; return m ? m + 'min ' + (r < 10 ? '0' : '') + r + 's' : r + 's'; }
  function refocus() { if (SM.opts.planner) { build(); render(); } else { chips(); applyDim(); } }
  function norm(d) {
    d.stages.forEach(function (s) { (s.slots || []).forEach(function (x) { if (x.status === 'parcial') x.status = 'aguardando'; }); });
    return d;
  }
  function cargaStatus(e) { return e.tot && e.ok === e.tot ? 'conferido' : e.ok > 0 ? 'parcial' : 'aguardando'; }
  function stageStatus(s) {
    var occ = (s.slots || []).filter(function (x) { return x.status && x.status !== 'livre'; });
    if (!occ.length) return 'livre';
    if (occ.some(function (x) { return x.status === 'divergencia'; })) return 'divergencia';
    if (occ.every(function (x) { return x.status === 'conferido'; })) return 'conferido';
    if (occ.some(function (x) { return x.status === 'conferido'; })) return 'conferido-parcial';
    return 'aguardando';
  }

  function render() {
    var d = SM.data, o = SM.opts, P = o.positions, emb = {}, order = [];
    var rev = o.inicioNoLado === 'direita', stages = rev ? d.stages.slice().reverse() : d.stages;
    d.stages.forEach(function (s) {
      if (s.embarque == null) return;
      var e = emb[s.embarque];
      if (!e) { e = emb[s.embarque] = { id: s.embarque, n: 0, tot: 0, ok: 0, bad: 0, color: PAL[order.length % PAL.length] }; order.push(s.embarque); }
      e.n++;
      (s.slots || []).forEach(function (x) { if (x.status && x.status !== 'livre') { e.tot++; if (x.status === 'conferido') e.ok++; if (x.status === 'divergencia') e.bad++; } });
    });

    // Sem divisão em grupos: stages um ao lado do outro, sequenciados
    var bands = [stages];

    var h = '<div class="sm-bar"><div class="sm-seg"><button data-m="2d">2D</button><button data-m="3d">3D</button></div>' +
      '<div class="sm-seg" data-3d><button data-cam="frente">Frente</button><button data-cam="iso">Isométrica</button></div>' +
      '<label class="sm-rng" data-3d>Inclinação <input type="range" min="15" max="75" value="' + SM.tilt + '" data-r="tilt"></label>' +
      '<label class="sm-rng" data-3d>Giro <input type="range" min="-60" max="60" value="' + SM.yaw + '" data-r="yaw"></label>' +
      '<label class="sm-rng">Zoom <input type="range" min="50" max="200" value="' + Math.round(SM.zoom * 100) + '" data-r="zoom"></label>' +
      '<span class="sm-hint">Arraste: girar (3D) ou mover (2D) · Shift+arraste: mover · Ctrl+scroll: zoom</span>' +
      '<div class="sm-leg">' + ['conferido', 'aguardando', 'divergencia', 'ativo', 'livre'].map(function (k) {
        return '<span><i class="st-' + k + '"></i>' + NAMES[k] + '</span>';
      }).join('') + '<span class="sm-sep">Carga:</span>' + ['conferido', 'parcial', 'aguardando'].map(function (k) {
        return '<span><u class="sm-dot s-' + k + '"></u>' + CNAME[k] + '</span>';
      }).join('') + '</div>' + (d.demo ? '<span class="sm-demo">Dados de demonstração</span>' : '') + '</div>';

    h += '<div class="sm-embs">' + order.map(function (id) {
      var e = emb[id], pct = e.tot ? Math.round(100 * e.ok / e.tot) : 0;
      var cs = cargaStatus(e);
      return '<button class="sm-chip' + (SM.focus === id ? ' on' : '') + '" data-e="' + esc(id) + '" style="--hc:' + e.color + '"><u class="sm-dot s-' + cs + '"></u><b>Embarque ' + esc(id) + '</b><span>' + CNAME[cs] + ' · ' + e.ok + '/' + e.tot + '</span><em style="width:calc((100% - 16px)*' + (pct / 100) + ')"></em></button>';
    }).join('') + '</div>';

    if (SM.opts.planner) {
      h += '<div class="sm-plan"><div class="sm-seg"><button data-v="antes" class="' + (SM.view === 'antes' ? 'on' : '') + '">Antes</button><button data-v="depois" class="' + (SM.view === 'depois' ? 'on' : '') + '">Depois</button></div>' +
        '<label>Destino <select data-po="destino"><option value="completar"' + (SM.po.destino === 'completar' ? ' selected' : '') + '>Completar palete existente</option><option value="novo"' + (SM.po.destino === 'novo' ? ' selected' : '') + '>Montar palete novo</option></select></label>' +
        '<label><input type="checkbox" data-po="liberar"' + (SM.po.liberar ? ' checked' : '') + '> Liberar stages inteiros</label>' +
        '<label><input type="checkbox" data-po="aguard"' + (SM.po.aguard ? ' checked' : '') + '> Incluir aguardando</label></div>';
      if (SM.plan) {
        var k = SM.plan.stats;
        h += '<div class="sm-kpis"><div><b>' + k.antes + ' → ' + k.depois + '</b><span>paletes</span></div><div class="g"><b>' + k.liberados + '</b><span>vagas liberadas (' + k.pct + '%)</span></div><div class="g"><b>' + k.stagesLiberados + '</b><span>stages liberados</span></div><div><b>' + k.movimentos + '</b><span>movimentos</span></div><div><b>' + (k.dist || 0) + ' m</b><span>distância total</span></div><div><b>' + fmtT(k.seg || 0) + '</b><span>tempo estimado</span></div><div><b>' + (k.pph || 0) + '</b><span>mov/h</span></div><div><b>' + k.caixas + '</b><span>caixas movidas</span></div><div><b>' + k.grupos + '</b><span>grupos SKU+Lote</span></div></div>';
      }
    }
    var R_ = d.routes || [];
    if (R_.length) h += '<div class="sm-rlist"><span class="sm-rtitle">Roteirização · ' + R_.length + ' movimentos <small>(linha cheia: juntar · tracejada: mover palete)</small></span>' + R_.map(function (r, i) {
      return '<button class="sm-rchip' + (r.type === 'move' ? ' mv' : '') + '" data-ri="' + i + '"><em>' + (i + 1) + '</em>' + esc(r.from.id) + esc(r.from.pos) + ' → ' + esc(r.to.id) + esc(r.to.pos) + (r.qtd ? ' <small>' + r.qtd + ' cx</small>' : '') + (r.seg ? ' <small>' + r.dist + ' m · ' + fmtT(r.seg) + '</small>' : '') + (r.label ? ' <small>' + esc(r.label) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
    h += '<div class="sm-viewport"><div class="sm-floor" data-mode="' + SM.mode + '">';
    if (stages.length) {
      var zix = {}; stages.forEach(function (st, n) { zix[st.id] = n; });
      var Z = d.zonas && d.zonas.length ? d.zonas : [{ nome: 'Stage Outbound', de: stages[0].id, ate: stages[stages.length - 1].id }];
      h += '<div class="sm-zones' + (rev ? ' rev' : '') + '">' + Z.map(function (z) {
        var a = zix[z.de], b = zix[z.ate]; if (a == null || b == null) return '';
        var lo = Math.min(a, b), hi = Math.max(a, b);
        return '<div class="sm-zone' + (rev ? ' rev' : '') + '" style="left:' + (lo * CW) + 'px;width:' + ((hi - lo + 1) * CW) + 'px"><b>' + esc(z.nome) + '</b><span>' + (rev ? esc(z.ate) + ' ← ' + esc(z.de) : esc(z.de) + ' → ' + esc(z.ate)) + '</span></div>';
      }).join('') + '</div>';
    }
    bands.forEach(function (list, bi) {
      h += '<div class="sm-band' + (rev ? ' rev' : '') + '"><div class="sm-ruler"><div class="sm-bname"></div>' + P.map(function (p) { return '<span>' + p + '</span>'; }).join('') + '</div>' +
        '<div class="sm-cols" style="--n:' + list.length + '">';
      list.forEach(function (s) {
        var isBlk = (typeof window.isStageBlocked === 'function' && window.isStageBlocked(s.id)) || !!s.isBlocked;
        h += '<div class="sm-stage' + (isBlk ? ' is-blocked' : '') + '" data-id="' + esc(s.id) + '">' +
             '<button class="sm-plate' + (isBlk ? ' st-blocked' : '') + (s.liberado ? ' free' : '') + '" data-st="' + esc(s.id) + '" title="' + (isBlk ? 'Stage BLOQUEADO (Clique na nomenclatura para DESBLOQUEAR)' : 'Clique na nomenclatura para BLOQUEAR este stage') + '">' +
             (isBlk ? '🔒 ' : '') + esc(s.id) + '</button><div class="sm-slots">';
        P.forEach(function (p) {
          var x = (s.slots || []).filter(function (q) { return q.pos === p; })[0] || {}, st = isBlk ? 'divergencia' : (x.status || 'livre');
          var pc = SM.opts.showFill && x.qtd > 0 && x.cap > 0 ? Math.min(100, Math.round(100 * x.qtd / x.cap)) : null;
          h += '<div class="sm-slot' + (st === 'livre' ? '' : ' has') + '">' + (st === 'livre' ? '' : '<i class="sm-pal st-' + st + (x.chg ? ' chg' : '') + '" data-s="' + esc(s.id) + '" data-p="' + p + '"><b>' + (isBlk ? '🔒' : (ICON[st] || '')) + '</b>' + (pc != null ? '<s class="sm-fill' + (pc < 100 ? ' part' : '') + '" style="width:' + pc + '%"></s>' : '') + '</i>') + '</div>';
        });
        h += '</div></div>';
      });
      // contornos: sequências contíguas de stages do mesmo embarque
      var i = 0;
      while (i < list.length) {
        var eid = list[i].embarque;
        if (eid == null) { i++; continue; }
        var j = i; while (j + 1 < list.length && list[j + 1].embarque === eid) j++;
        var e = emb[eid], len = j - i + 1, pad = 0;
        h += '<div class="sm-hull" data-e="' + esc(eid) + '" style="--hc:' + e.color + ';left:' + (i * (CW + GAP) - pad) + 'px;top:' + (LAB - PADH) + 'px;width:' + (len * (CW + GAP) - GAP + 2 * pad) + 'px;height:' + (PADH + PLATE + PLATE_GAP + P.length * CH + PADH) + 'px">' +
          '<button class="sm-hlabel s-' + cargaStatus(e) + '" data-e="' + esc(eid) + '">' + (len < 2 ? '' : '<u class="sm-dot s-' + cargaStatus(e) + '"></u>') + (len < 2 ? '#' : len < 3 ? 'Emb. ' : 'Embarque ') + esc(eid) + (len < 5 ? '' : '<i class="sm-pill s-' + cargaStatus(e) + '">' + CNAME[cargaStatus(e)] + ' · ' + e.ok + '/' + e.tot + (e.bad ? ' · ✖' + e.bad : '') + '</i>') + '</button></div>';
        i = j + 1;
      }
      h += routeSvg(list, P, d.routes || []) + '</div></div>';
    });
    h += '</div></div><div class="sm-tip"></div>';
    var vp0 = SM.root.querySelector('.sm-viewport'), sl = vp0 ? vp0.scrollLeft : 0;
    SM.root.innerHTML = h;
    SM.emb = emb;
    var vp1 = SM.root.querySelector('.sm-viewport'); if (vp1) vp1.scrollLeft = sl;
    applyMode(); applyDim();
  }

  function routeSvg(list, P, routes) {
    if (!routes.length) return '';
    var w = list.length * CW, hh = LAB + PLATE + PLATE_GAP + P.length * CH, idx = {}, mk = 'smar' + SM.id;
    list.forEach(function (s, i) { idx[s.id] = i; });
    var cx = function (id) { return idx[id] * CW + CW / 2; };
    var cy = function (p) { return LAB + PLATE + PLATE_GAP + P.indexOf(p) * CH + CH / 2; };
    var o = '<svg class="sm-routes" width="' + w + '" height="' + hh + '" viewBox="0 0 ' + w + ' ' + hh + '"><defs><marker id="' + mk + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0f172a"/></marker></defs>';
    var last = -1;
    routes.forEach(function (r, i) { if (r.from.id in idx && r.to.id in idx) last = i; });
    routes.forEach(function (r, i) {
      if (!(r.from.id in idx) || !(r.to.id in idx)) return;
      var x1 = cx(r.from.id), y1 = cy(r.from.pos), x2 = cx(r.to.id), y2 = cy(r.to.pos);
      var dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy) || 1, b = Math.min(60, d * .25) * (i % 2 ? -1 : 1);
      var qx = (x1 + x2) / 2 - dy / d * b, qy = (y1 + y2) / 2 + dx / d * b, ex = x2 - qx, ey = y2 - qy, el = Math.sqrt(ex * ex + ey * ey) || 1;
      var p = 'M' + x1 + ' ' + y1 + 'Q' + qx + ' ' + qy + ' ' + (x2 - ex / el * 11) + ' ' + (y2 - ey / el * 11);
      o += '<g class="rt" data-ri="' + i + '">' +
        '<rect x="' + (x2 - CW / 2 + 2) + '" y="' + (y2 - CH / 2 + 2) + '" width="' + (CW - 4) + '" height="' + (CH - 4) + '" rx="3" fill="rgba(47,107,255,.28)" stroke="#2F6BFF" stroke-width="2" stroke-dasharray="4 3"/>' +
        '<rect x="' + (x1 - CW / 2 + 2) + '" y="' + (y1 - CH / 2 + 2) + '" width="' + (CW - 4) + '" height="' + (CH - 4) + '" rx="3" fill="none" stroke="#0f172a" stroke-width="2"/>' +
        '<path d="' + p + '" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".85"/>' +
        '<path d="' + p + '" fill="none" stroke="#0f172a" stroke-width="2.6" stroke-linecap="round" marker-end="url(#' + mk + ')"/>' +
        '<circle cx="' + x1 + '" cy="' + y1 + '" r="9" fill="#0f172a" stroke="#fff" stroke-width="1.5"/>' +
        '<text x="' + x1 + '" y="' + y1 + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="10" font-weight="800">' + (i + 1) + '</text>' +
        (i === 0 ? '<g><rect x="' + (x1 - 20) + '" y="' + (y1 - CH / 2 - 14) + '" width="40" height="14" rx="3" fill="#22a861"/><text x="' + x1 + '" y="' + (y1 - CH / 2 - 7) + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9" font-weight="800">Início</text></g>' : '') +
        (i === last ? '<g><rect x="' + (x2 - 14) + '" y="' + (y2 - CH / 2 - 14) + '" width="28" height="14" rx="3" fill="#2F6BFF"/><text x="' + x2 + '" y="' + (y2 - CH / 2 - 7) + '" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="9" font-weight="800">Fim</text></g>' : '') +
        '</g>';
    });
    return o + '</svg>';
  }
  function selRoutes() {
    var R = SM.root; if (!R) return;
    [].forEach.call(R.querySelectorAll('g.rt'), function (g) { g.classList.toggle('dim', SM.sel != null && +g.dataset.ri !== SM.sel); });
    [].forEach.call(R.querySelectorAll('.sm-rchip'), function (c) { c.classList.toggle('on', SM.sel != null && +c.dataset.ri === SM.sel); });
  }
  function chips() {
    [].forEach.call(SM.root.querySelectorAll('.sm-chip'), function (c) { c.classList.toggle('on', c.dataset.e === SM.focus); });
  }

  function camVars(t, y) {
    var f = SM.root.querySelector('.sm-floor'); if (!f) return;
    SM.ct = t; SM.cy = y;
    f.style.setProperty('--tilt', t + 'deg'); f.style.setProperty('--yaw', y + 'deg');
  }
  function tween(tt, ty) {
    var t0 = null, ft = SM.ct, fy = SM.cy, id = ++SM.tw;
    if (!visible()) return camVars(tt, ty);
    (function step(now) {
      if (id !== SM.tw) return;
      if (t0 == null) t0 = now;
      var k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      camVars(ft + (tt - ft) * e, fy + (ty - fy) * e); fit();
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }
  SM.tw = 0;
  function applyMode(anim) {
    var R = SM.root, f = R.querySelector('.sm-floor'); if (!f) return;
    var is3 = SM.mode === '3d', tt = is3 ? SM.tilt : 0, ty = is3 ? SM.yaw : 0;
    f.dataset.mode = SM.mode;
    [].forEach.call(R.querySelectorAll('.sm-seg button[data-m]'), function (b) { b.classList.toggle('on', b.dataset.m === SM.mode); });
    [].forEach.call(R.querySelectorAll('[data-3d]'), function (l) { l.classList.toggle('off', !is3); });
    if (anim && visible()) tween(tt, ty);
    else { SM.tw++; camVars(tt, ty); if (visible()) fit(); }
  }

  function fit() {
    var R = SM.root, vp = R.querySelector('.sm-viewport'), f = R.querySelector('.sm-floor'); if (!vp || !f) return;
    var vw = vp.clientWidth, tx = 0, ty = 0;
    var set = function () { f.style.setProperty('--z', SM.zoom); f.style.setProperty('--tx', tx + 'px'); f.style.setProperty('--ty', ty + 'px'); };
    var rel = function () { var r = f.getBoundingClientRect(), v = vp.getBoundingClientRect(); return { l: r.left - v.left + vp.scrollLeft, t: r.top - v.top, w: r.width, h: r.height }; };
    set(); vp.style.height = '9999px';
    var r;
    for (var n = 0; n < 3; n++) { r = rel(); tx += Math.max(0, (vw - r.w) / 2) - r.l; ty += 4 - r.t; set(); }
    r = rel();
    var hmax = Math.max(420, Math.round(window.innerHeight * 0.75)), hh = Math.ceil(r.h + 24);
    vp.style.height = Math.min(hh, hmax) + 'px';
    vp.style.overflowY = hh > hmax ? 'auto' : 'hidden';
    if (!SM._scrolled) {
      vp.scrollLeft = SM.opts.inicioNoLado === 'direita' ? vp.scrollWidth : 0;
      SM._scrolled = 1;
    }
  }

  function applyDim() {
    var R = SM.root; if (!R || !SM.data) return;
    var q = SM.q.trim().toLowerCase(), f = SM.filter, fo = SM.focus, ok = {}, ebOk = {};
    var fm = function (s) {
      var occ = (s.slots || []).filter(function (x) { return x.status && x.status !== 'livre'; }), has = function (t) { return occ.some(function (x) { return x.status === t; }); };
      if (f === 'all') return true;
      if (f === 'parcial') { var e = SM.emb[s.embarque]; return !!e && cargaStatus(e) === 'parcial'; }
      if (f === 'conferido') return occ.length > 0 && occ.every(function (x) { return x.status === 'conferido'; });
      if (f === 'aguardando') return has('aguardando');
      if (f === 'divergencia') return has('divergencia');
      if (f === 'livre') return !occ.length;
      return true;
    };
    SM.data.stages.forEach(function (s) {
      var m = fm(s) && (!q || String(s.id).toLowerCase().indexOf(q) > -1 || String(s.embarque == null ? '' : s.embarque).toLowerCase().indexOf(q) > -1) && (fo == null || String(s.embarque) === String(fo));
      ok[s.id] = m; if (m && s.embarque != null) ebOk[s.embarque] = true;
    });
    [].forEach.call(R.querySelectorAll('.sm-stage'), function (el) { el.classList.toggle('is-dim', !ok[el.dataset.id]); });
    [].forEach.call(R.querySelectorAll('.sm-hull'), function (el) { el.classList.toggle('is-dim', !ebOk[el.dataset.e]); });
  }

  function onClick(ev) {
    var t = ev.target, b;
    if (SM.noClick) return;
    if ((b = t.closest('[data-cam]'))) return SM.cam(b.dataset.cam);
    if ((b = t.closest('[data-m]'))) return SM.setMode(b.dataset.m);
    if ((b = t.closest('[data-v]'))) { SM.view = b.dataset.v; SM.sel = null; build(); return render(); }
    if ((b = t.closest('[data-ri]')) && b.classList.contains('sm-rchip')) { var k = +b.dataset.ri; SM.sel = SM.sel === k ? null : k; return selRoutes(); }
    if ((b = t.closest('.sm-plate'))) {
      if (typeof window.solicitarToggleBloqueioStage === 'function') {
        window.solicitarToggleBloqueioStage(b.dataset.st);
        return;
      }
      var s = SM.data.stages.filter(function (x) { return String(x.id) === b.dataset.st; })[0];
      if (SM.opts.onStage) return SM.opts.onStage(s);
      if (typeof window.openStageDetailModal === 'function') window.openStageDetailModal(b.dataset.st);
      return;
    }
    if ((b = t.closest('.sm-pal'))) {
      if (typeof window.openStageDetailModal === 'function' && b.dataset.s) {
        window.openStageDetailModal(b.dataset.s);
        return;
      }
    }
    if ((b = t.closest('[data-e]'))) {
      var id = b.dataset.e; SM.focus = SM.focus === id ? null : id;
      refocus();
      if (SM.opts.onEmbarque) SM.opts.onEmbarque(id, SM.focus != null);
    }
  }
  function onInput(ev) {
    var po = ev.target.dataset && ev.target.dataset.po;
    if (po) { SM.po[po] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; SM.sel = null; build(); return render(); }
    var r = ev.target.dataset && ev.target.dataset.r; if (!r) return;
    if (r === 'zoom') { SM.zoom = +ev.target.value / 100; return refit(); }
    SM[r] = +ev.target.value;
    SM.tw++; camVars(r === 'tilt' ? SM[r] : SM.ct, r === 'yaw' ? SM[r] : SM.cy);
    refit();
  }
  function onMove(ev) {
    var p = ev.target.closest && ev.target.closest('.sm-pal'), tip = SM.root.querySelector('.sm-tip');
    if (!p || !tip) return hideTip();
    var s = SM.data.stages.filter(function (x) { return String(x.id) === p.dataset.s; })[0] || {};
    var x = (s.slots || []).filter(function (q) { return q.pos === p.dataset.p; })[0] || {};
    tip.innerHTML = '<b>' + esc(s.id) + p.dataset.p + '</b> · ' + esc(NAMES[x.status] || '') +
      (x.lpn ? '<br><small>LPN</small> ' + esc(x.lpn) : '') + (x.sku ? '<br><small>SKU</small> ' + esc(x.sku) + (x.lote ? ' · ' + esc(x.lote) : '') : '') + (x.qtd ? '<br><small>Qtd</small> ' + x.qtd + (x.cap ? '/' + x.cap + ' (' + Math.round(100 * x.qtd / x.cap) + '%)' : '') : '') +
      (s.embarque != null ? '<br><small>Embarque</small> ' + esc(s.embarque) : '');
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 270) + 'px';
    tip.style.top = (ev.clientY + 16) + 'px';
  }
  function hideTip() { var t = SM.root && SM.root.querySelector('.sm-tip'); if (t) t.style.display = 'none'; }

  function demo(planner) {
    var plan = [[1, 1, 8], [2, 10, 14], [3, 15, 22], [4, 23, 26], [5, 28, 33], [6, 34, 41], [7, 42, 47], [8, 49, 60]], seed = 7, stages = [];
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var skus = [['SKU-1001', 100], ['SKU-1002', 80], ['SKU-1003', 60], ['SKU-1004', 120]];
    for (var n = 1; n <= 67; n++) {
      var e = null; plan.forEach(function (p) { if (n >= p[1] && n <= p[2]) e = String(p[0]); });
      var slots = [], fill = e ? Math.round(2 + rnd() * 8) : 0;
      for (var k = 0; k < fill; k++) {
        var r = rnd(), st = r < .55 ? 'conferido' : r < .8 ? 'aguardando' : r < .9 ? 'divergencia' : 'conferido';
        var sk = skus[Math.floor(rnd() * skus.length)], full = rnd() < .4, q = full ? sk[1] : Math.max(5, Math.round(sk[1] * (.15 + rnd() * .7)));
        slots.push({ pos: 'ABCDEFGHIJ'[k], status: st, lpn: 'LPN' + (900000 + n * 100 + k), sku: sk[0], lote: 'L' + (1 + Math.floor(rnd() * 2)), qtd: q, cap: sk[1] });
      }
      stages.push({ id: 'SO' + (n < 10 ? '0' : '') + n, embarque: e, slots: slots });
    }
    stages[4].slots[2] = { pos: 'C', status: 'ativo', lpn: 'LPN-ATUAL', sku: 'SKU-1001', lote: 'L1', qtd: 100, cap: 100 };
    return { stages: stages, demo: true, focus: planner ? '3' : null };
  }

  return SM;
  }
  var main = window.StageMap = make();
  main.create = make;
  var SM = main;
  function visible() { return SM.root && SM.root.offsetParent !== null; }

  /* ---- Integração com a tela "Mapa de Stages" existente (opcional, só se os elementos existirem) ---- */
  SM.showLayout = function () {
    var c = $('dashStagesContainer'); if (c) c.style.display = 'none';
    SM.root.style.display = '';
    ['btnModeLanes', 'btnModeCards'].forEach(function (id) { var b = $(id); if (b) b.classList.remove('active'); });
    var l = $('btnModeLayout'); if (l) l.classList.add('active');
    SM.refresh(true);
  };
  SM.hideLayout = function () {
    var c = $('dashStagesContainer'); if (c) c.style.display = '';
    if (SM.root) SM.root.style.display = 'none';
    var l = $('btnModeLayout'); if (l) l.classList.remove('active');
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = $('stageMapRoot'); if (!root) return;
    SM.mount(root, { loadData: function () { return typeof window.StageMapAdapter === 'function' ? window.StageMapAdapter() : null; } });
    var cr = $('consMapRoot');
    if (cr) {
      var cm = window.StageMapConsolidacao = make();
      cm.mount(cr, { planner: true, onStage: function () {}, loadData: function () { return typeof window.StageMapConsolidacaoAdapter === 'function' ? window.StageMapConsolidacaoAdapter() : null; } });
      var tc = window.toggleConsolidacao;
      if (typeof tc === 'function') window.toggleConsolidacao = function () { var r = tc.apply(this, arguments); var v = $('viewConsolidacao'); if (v && v.style.display !== 'none') cm.refresh(true); return r; };
      var se = window.selecionarEmbarqueConsolidacao;
      if (typeof se === 'function') window.selecionarEmbarqueConsolidacao = function (v) { var r = se.apply(this, arguments); cm.setFocus(v); cm.refresh(true); return r; };
      setInterval(function () { if (cr.offsetParent !== null && typeof window.StageMapConsolidacaoAdapter === 'function') cm.refresh(); }, 4000);
    }
    var tg = document.querySelector('.dash-view-toggle');
    if (tg) tg.addEventListener('click', function (e) { if (e.target.closest('#btnModeLanes,#btnModeCards')) SM.hideLayout(); }, true);
    [].forEach.call(document.querySelectorAll('.dash-filter-btn'), function (b) {
      b.addEventListener('click', function () { SM.setFilter(b.dataset.filter); });
    });
    var si = $('dashSearchInput'); if (si) si.addEventListener('input', function () { SM.setSearch(si.value); });
    var td = window.toggleDashboard;
    if (typeof td === 'function') window.toggleDashboard = function () { var r = td.apply(this, arguments); var v = $('viewDashboard'); if (v && v.style.display !== 'none') SM.showLayout(); return r; };
    setInterval(function () { if (visible() && typeof window.StageMapAdapter === 'function') SM.refresh(); }, 4000);
  });
})();
