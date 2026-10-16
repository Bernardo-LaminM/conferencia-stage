/* Planejador de consolidação — DHL Supply Chain
 * ConsolidationPlanner.plan({stages:[...]}, opts) -> { routes, stats, after }
 * Cada slot precisa de: pos, status, sku, lote, qtd (caixas no palete) e cap (caixas do palete cheio; se faltar, usa o maior qtd visto do SKU).
 * Fase 1 (juntar): paletes parciais do mesmo SKU+Lote são esvaziados dentro de outros, completando paletes cheios.
 * Fase 2 (liberar): paletes dos stages menos ocupados vão para vagas livres de stages vizinhos do mesmo embarque, esvaziando stages inteiros.
 * Respeita s.vagas (capacidade da rua) quando informado.
 * opts: embarque (null = todos), destino 'completar' | 'novo', liberarStages (padrão true), incluirAguardando (padrão false), positions. */
(function (root) {
  'use strict';
  var DEFPOS = 'ABCDEFGHIJ'.split('');
  var K = function (sid, pos) { return sid + '|' + pos; };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  function planScope(data, o) {
    var P = o.positions || DEFPOS, destino = o.destino || 'completar', liberar = o.liberarStages !== false, incl = !!o.incluirAguardando;
    // vagas úteis de cada stage (rua de 8 = A–H); s.vagas vem do mapa (planta do CAD)
    var PS = function (s) { return P.slice(0, +s.vagas || P.length); };
    var scope = data.stages.filter(function (s) { return o.embarque == null || String(s.embarque) === String(o.embarque); });
    var sidx = {}; scope.forEach(function (s, i) { sidx[s.id] = i; });
    var capE = {}, capO = {};
    data.stages.forEach(function (s) { (s.slots || []).forEach(function (x) {
      if (!x.sku) return;
      if (+x.cap > (capE[x.sku] || 0)) capE[x.sku] = +x.cap;
      if (+x.qtd > (capO[x.sku] || 0)) capO[x.sku] = +x.qtd;
    }); });
    var capOf = function (p) { return capE[p.sku] || capO[p.sku] || 0; };

    var occ = {}, orig = {};
    scope.forEach(function (s) { (s.slots || []).forEach(function (x) {
      if (x.status && x.status !== 'livre') {
        occ[K(s.id, x.pos)] = { sid: s.id, pos: x.pos, status: x.status, lpn: x.lpn, sku: x.sku, lote: x.lote, qtd: +x.qtd || 0, k0: K(s.id, x.pos) };
        orig[K(s.id, x.pos)] = x;
      }
    }); });
    var before = Object.keys(occ).length;
    var cellsBefore = {}; scope.forEach(function (s) { cellsBefore[s.id] = P.filter(function (p) { return occ[K(s.id, p)]; }).length; });
    var mov = function (p) { return (p.status === 'conferido' || (incl && p.status === 'aguardando')) && p.sku && p.qtd > 0 && capOf(p) > 0; };
    var routes = [];
    var tag = function (p) { return p.sku + (p.lote ? ' · ' + p.lote : ''); };
    var posI = function (p) { return P.indexOf(p); };

    /* ---------- Fase 1: juntar SKU+Lote ---------- */
    var groups = {};
    Object.keys(occ).forEach(function (k) {
      var p = occ[k]; if (!mov(p) || p.qtd >= capOf(p)) return;
      (groups[p.sku + '|' + (p.lote || '')] = groups[p.sku + '|' + (p.lote || '')] || []).push(p);
    });
    var nGrupos = 0;
    Object.keys(groups).forEach(function (g) {
      var L = groups[g]; if (L.length < 2) return;
      var cap = capOf(L[0]), total = L.reduce(function (a, p) { return a + p.qtd; }, 0);
      if (Math.ceil(total / cap) >= L.length) return;
      L.sort(function (a, b) { return b.qtd - a.qtd || sidx[a.sid] - sidx[b.sid] || posI(a.pos) - posI(b.pos); });
      var done = false;

      if (destino === 'novo') {
        var n = Math.ceil(total / cap), cx = L.reduce(function (a, p) { return a + sidx[p.sid]; }, 0) / L.length, free = [];
        scope.forEach(function (s) { PS(s).forEach(function (p) { if (!occ[K(s.id, p)]) free.push({ sid: s.id, pos: p, d: Math.abs(sidx[s.id] - cx) }); }); });
        free.sort(function (a, b) { return a.d - b.d || sidx[a.sid] - sidx[b.sid] || posI(a.pos) - posI(b.pos); });
        if (free.length >= n) {
          var neu = free.slice(0, n).map(function (f) { var p = { sid: f.sid, pos: f.pos, status: 'conferido', lpn: 'NOVO', sku: L[0].sku, lote: L[0].lote, qtd: 0, novo: true, chg: true }; occ[K(f.sid, f.pos)] = p; return p; });
          var t = 0;
          L.forEach(function (d) {
            var q = d.qtd;
            while (q > 0) {
              var mv = Math.min(q, cap - neu[t].qtd);
              routes.push({ type: 'merge', fase: 1, from: { id: d.sid, pos: d.pos }, to: { id: neu[t].sid, pos: neu[t].pos }, qtd: mv, label: tag(d) });
              neu[t].qtd += mv; q -= mv; if (neu[t].qtd >= cap && t < n - 1) t++;
            }
            delete occ[K(d.sid, d.pos)];
          });
          done = true;
        }
      }
      if (!done) {
        var i = 0, j = L.length - 1;
        while (i < j) {
          var r = L[i], d = L[j], space = cap - r.qtd;
          if (space <= 0) { i++; continue; }
          var m = Math.min(space, d.qtd);
          routes.push({ type: 'merge', fase: 1, from: { id: d.sid, pos: d.pos }, to: { id: r.sid, pos: r.pos }, qtd: m, label: tag(d) });
          r.qtd += m; d.qtd -= m; r.chg = true; d.chg = true;
          if (d.qtd <= 0) { delete occ[K(d.sid, d.pos)]; j--; }
          if (r.qtd >= cap) i++;
        }
      }
      nGrupos++;
    });

    /* ---------- Fase 2: liberar stages inteiros e compactar pátio ---------- */
    if (liberar) {
      var totalPal = Object.keys(occ).length;
      var stagesNecessarios = 0, capAcum = 0;
      while (stagesNecessarios < scope.length && (capAcum < totalPal || !stagesNecessarios)) capAcum += PS(scope[stagesNecessarios++]).length;
      
      var stagesDestino = scope.slice(0, stagesNecessarios);
      var stagesExcedentes = scope.slice(stagesNecessarios);

      var vagasLivresDestino = [];
      stagesDestino.forEach(function (sd) {
        PS(sd).forEach(function (p) {
          if (!occ[K(sd.id, p)]) {
            vagasLivresDestino.push({ sid: sd.id, pos: p });
          }
        });
      });

      var paletesExcedentes = [];
      stagesExcedentes.forEach(function (se) {
        P.forEach(function (p) {
          var item = occ[K(se.id, p)];
          if (item && mov(item)) {
            paletesExcedentes.push(item);
          }
        });
      });

      paletesExcedentes.sort(function (a, b) {
        return (sidx[b.sid] - sidx[a.sid]) || (posI(b.pos) - posI(a.pos));
      });
      vagasLivresDestino.sort(function (a, b) {
        return (sidx[a.sid] - sidx[b.sid]) || (posI(a.pos) - posI(b.pos));
      });

      var numMover = Math.min(paletesExcedentes.length, vagasLivresDestino.length);
      for (var mIdx = 0; mIdx < numMover; mIdx++) {
        var pOrig = paletesExcedentes[mIdx];
        var vDest = vagasLivresDestino[mIdx];
        routes.push({
          type: 'move',
          fase: 2,
          from: { id: pOrig.sid, pos: pOrig.pos },
          to: { id: vDest.sid, pos: vDest.pos },
          qtd: pOrig.qtd,
          label: pOrig.lpn ? ('LPN ' + String(pOrig.lpn).slice(-8)) : tag(pOrig)
        });
        delete occ[K(pOrig.sid, pOrig.pos)];
        pOrig.sid = vDest.sid;
        pOrig.pos = vDest.pos;
        pOrig.moved = true;
        pOrig.chg = true;
        occ[K(vDest.sid, vDest.pos)] = pOrig;
      }
    }

    /* ---------- Ordem da rota: fase 1, depois fase 2; vizinho mais próximo ao longo da fileira ---------- */
    var ordered = [], cur = 0;
    [1, 2].forEach(function (f) {
      var rest = routes.filter(function (r) { return r.fase === f; });
      while (rest.length) {
        var bi = 0;
        rest.forEach(function (r, k) {
          var a = Math.abs(sidx[r.from.id] - cur), b = Math.abs(sidx[rest[bi].from.id] - cur);
          if (a < b || (a === b && posI(r.from.pos) < posI(rest[bi].from.pos))) bi = k;
        });
        var nx = rest.splice(bi, 1)[0]; ordered.push(nx); cur = sidx[nx.to.id];
      }
    });

    /* ---------- Estado "depois" ---------- */
    var after = {};
    scope.forEach(function (s) {
      var c = clone(s), slots = [];
      P.forEach(function (p) {
        var x = occ[K(s.id, p)]; if (!x) return;
        var base = x.novo ? {} : clone(orig[x.k0] || {});
        slots.push(Object.assign(base, { pos: p, status: x.status, lpn: x.lpn, sku: x.sku, lote: x.lote, qtd: x.qtd, cap: capOf(x) || undefined, chg: x.chg || undefined }));
      });
      c.slots = slots;
      if (!slots.length && cellsBefore[s.id] > 0) { c.embarque = null; c.liberado = true; }
      after[s.id] = c;
    });
    var depois = Object.keys(occ).length, liberados = 0;
    scope.forEach(function (s) { if (after[s.id].liberado) liberados++; });
    return {
      routes: ordered, after: after,
      stats: { antes: before, depois: depois, liberados: before - depois, pct: before ? Math.round(100 * (before - depois) / before) : 0, stagesLiberados: liberados, movimentos: ordered.length, caixas: ordered.reduce(function (a, r) { return a + r.qtd; }, 0), grupos: nGrupos }
    };
  }

  function plan(data, o) {
    o = o || {};
    var ids = [];
    if (o.embarque != null) ids = [String(o.embarque)];
    else data.stages.forEach(function (s) { if (s.embarque != null && ids.indexOf(String(s.embarque)) < 0) ids.push(String(s.embarque)); });
    var routes = [], after = {}, st = { antes: 0, depois: 0, liberados: 0, stagesLiberados: 0, movimentos: 0, caixas: 0, grupos: 0 };
    ids.forEach(function (id) {
      var r = planScope(data, Object.assign({}, o, { embarque: id }));
      routes = routes.concat(r.routes);
      Object.keys(r.after).forEach(function (k) { after[k] = r.after[k]; });
      Object.keys(st).forEach(function (k) { st[k] += r.stats[k]; });
    });
    st.pct = st.antes ? Math.round(100 * st.liberados / st.antes) : 0;
    return { routes: routes, stats: st, after: data.stages.map(function (s) { return after[s.id] || s; }) };
  }

  root.ConsolidationPlanner = { plan: plan };
})(window);

