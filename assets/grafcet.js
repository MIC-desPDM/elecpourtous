/* ============================================================
   Éditeur de Grafcet (Schémas > Grafcet)
   - Un seul cycle par projet (schema.grafcet) : étapes, transitions, actions et liaisons sont
     communs aux quatre points de vue. Seuls les textes changent d'un point de vue à l'autre.
   - Données : schema.grafcet = {
       items: [ {id,t:'step',x,y,n,init?}, {id,t:'trans',x,y}, {id,t:'act',step,ord},
                {id,t:'wire',pts:[[x,y],…],dbl?,a?:{id,port},b?:{id,port},arrows?:[{seg,f,rev}]} ],
       Les traits sont dessinés à la main ; leurs extrémités accrochées à une étape ou une transition la suivent.
       tx: { systeme: {id: texte}, operative: {...}, commande: {...}, automate: {...} } }
   - Point de vue Commande : chaque action et chaque réceptivité doit porter une désignation
     (ex. KM1, S1). Sinon un panneau « ! » l'indique (écran seulement, jamais dans les exports).
   ============================================================ */
(function () {
  'use strict';

  const root = document.getElementById('main-schemas');
  const svg = document.getElementById('gf-svg');
  if (!root || !svg) return;
  const API = () => (window.SchemasEditor && window.SchemasEditor.api) || null;

  const VIEWS = ['systeme', 'operative', 'commande', 'automate'];
  const VIEW_NAMES = { systeme: 'Point de vue Système', operative: 'Point de vue Opérative', commande: 'Point de vue Commande', automate: 'Point de vue Automate' };
  const GRID = 10;
  const STEP_H = 20;          // demi-côté d'une étape
  const TR_W = 14;            // demi-largeur d'une transition
  const ACT_H = 30;           // hauteur d'une action
  const INK = '#222';
  const SEL = '#2f7df6';
  const WARN = '#e8a10c';
  const BAD = '#d62828';
  const ON = '#1f9d55';
  const FONT = 'Arial, Helvetica, sans-serif';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const rnd = (v) => Math.round(v * 100) / 100;
  const num = (v) => typeof v === 'number' && isFinite(v);

  const S = {
    view: 'systeme',
    tool: 'select',
    sels: [],               // éléments sélectionnés
    multi: false,           // mode « sélection multiple » (écran tactile)
    lockMarks: true,        // affichage des cadenas
    snap: true,
    cam: { x: 80, y: 60, k: 1 },
    drag: null,
    pointers: new Map(),
    gesture: null,
    undo: [],
    redo: [],
    ref: '',
    refOp: 0.45,
    lastDown: null,
    paths: {},              // tracés des liaisons (pour le clic)
    schemaId: null,
    check: true,            // vérification de la structure (ronds rouges)
    sim: null,              // simulation : { active: Set d'étapes, topo, n }
  };
  // S.sel = l'élément sélectionné quand il est seul (sinon null)
  Object.defineProperty(S, 'sel', {
    get() { return S.sels.length === 1 ? S.sels[0] : null; },
    set(v) { S.sels = v ? [v] : []; },
  });
  try {
    if (window.localStorage.getItem('ef_gf_locks') === '0') S.lockMarks = false;
    if (window.localStorage.getItem('ef_gf_check') === '0') S.check = false;
    const v = window.localStorage.getItem('ef_gv');
    if (VIEWS.includes(v)) S.view = v;
    const r = JSON.parse(window.localStorage.getItem('ef_gf_ref') || 'null');
    if (r && (r.ref === '' || VIEWS.includes(r.ref))) { S.ref = r.ref; if (num(r.op)) S.refOp = r.op; }
  } catch (e) { /* ignoré */ }

  /* ---------- Données ---------- */
  function emptyG() { return { items: [], tx: { systeme: {}, operative: {}, commande: {}, automate: {} }, v27: true, v28: true }; }
  function G() {
    const api = API(), s = api && api.schema();
    if (!s) return null;
    if (!s.grafcet || !Array.isArray(s.grafcet.items)) s.grafcet = emptyG();
    for (const v of VIEWS) if (!s.grafcet.tx[v]) s.grafcet.tx[v] = {};
    return s.grafcet;
  }
  const items = () => { const g = G(); return g ? g.items : []; };
  const GAP_DEF = 100, GAP_MIN = 60, GAP_MAX = 300;
  const gap = () => { const g = G(); return g && num(g.gap) ? g.gap : GAP_DEF; };   // écart entre deux étapes (centre à centre)
  const selItems = () => S.sels.map((id) => find(id)).filter(Boolean);
  const find = (id) => items().find((i) => i.id === id) || null;
  const txt = (id, view) => { const g = G(); return (g && g.tx[view || S.view][id]) || ''; };
  const save = () => { const api = API(); if (api) api.save(); };

  // Nettoyage d'un Grafcet importé
  function clean(raw) {
    const g = emptyG();
    if (!raw || !Array.isArray(raw.items)) return g;
    const ids = new Set();
    for (const it of raw.items) {
      if (!it || typeof it.id !== 'string') continue;
      const lk = it.locked === true ? { locked: true } : {};
      if (it.t === 'step' && num(it.x) && num(it.y)) g.items.push({ id: it.id, t: 'step', x: it.x, y: it.y, n: num(it.n) ? Math.max(0, Math.round(it.n)) : 0, ...(it.init ? { init: true } : {}), ...lk });
      else if (it.t === 'trans' && num(it.x) && num(it.y)) g.items.push({ id: it.id, t: 'trans', x: it.x, y: it.y, ...lk });
      else continue;
      ids.add(it.id);
    }
    for (const it of raw.items) {
      if (!it || typeof it.id !== 'string') continue;
      if (it.t === 'act' && ids.has(it.step)) { g.items.push({ id: it.id, t: 'act', step: it.step, ord: num(it.ord) ? it.ord : 0, ...(it.locked === true ? { locked: true } : {}) }); ids.add(it.id); }
      if (it.t === 'link' && ids.has(it.a) && ids.has(it.b)) g.items.push({ id: it.id, t: 'link', a: it.a, b: it.b, ...(it.up === true ? { up: true } : {}) });
      if (it.t === 'wire' && Array.isArray(it.pts) && it.pts.length >= 2 && it.pts.length <= 200) {
        const pts = it.pts.map((q) => (Array.isArray(q) && num(q[0]) && num(q[1]) ? [q[0], q[1]] : null));
        if (pts.some((q) => !q)) continue;
        const end = (e) => (e && ids.has(e.id) && ['top', 'bot', 'c'].includes(e.port) ? { id: e.id, port: e.port } : null);
        const a = end(it.a), b = end(it.b);
        const arrows = Array.isArray(it.arrows) ? it.arrows.filter((r) => r && num(r.seg) && num(r.f)).map((r) => ({ seg: Math.max(0, Math.round(r.seg)), f: Math.max(0, Math.min(1, r.f)), ...(r.rev ? { rev: true } : {}) })) : [];
        g.items.push({ id: it.id, t: 'wire', pts, ...(it.dbl ? { dbl: true } : {}), ...(a ? { a } : {}), ...(b ? { b } : {}), ...(arrows.length ? { arrows } : {}), ...(it.locked === true ? { locked: true } : {}) });
      }
    }
    g.v27 = !!raw.v27;                                // fichier ancien : ses renvois seront reconnus à l'ouverture
    g.v28 = !!raw.v28;
    if (num(raw.gap)) g.gap = Math.max(GAP_MIN, Math.min(GAP_MAX, Math.round(raw.gap / 10) * 10));
    const tx = raw.tx || {};
    for (const v of VIEWS) {
      const src = tx[v] || {};
      for (const k of Object.keys(src)) if (ids.has(k) && typeof src[k] === 'string') g.tx[v][k] = src[k].slice(0, 120);
    }
    return g;
  }

  /* ---------- Annuler / rétablir ---------- */
  const snap = () => JSON.stringify(G());
  function pushUndo(before) {
    S.undo.push(before);
    if (S.undo.length > 150) S.undo.shift();
    S.redo.length = 0;
  }
  function mutate(fn) {
    if (S.sim) stopSim(true);
    const before = snap();
    fn();
    syncWires();
    if (snap() === before) { render(); updateUI(); return; }
    pushUndo(before);
    save(); render(); updateUI();
  }
  function restore(json) {
    if (S.sim) stopSim(true);
    const api = API(), s = api && api.schema();
    if (!s) return;
    s.grafcet = JSON.parse(json);
    S.sels = S.sels.filter((id) => find(id));
    save(); render(); updateUI();
  }
  function doUndo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); }
  function doRedo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); }

  /* ---------- Traits (liaisons dessinées à la main) ----------
     Un trait est une suite de segments horizontaux / verticaux. Une extrémité peut être accrochée au
     milieu du haut (top) ou du bas (bot) d'une étape, ou au centre (c) d'une transition : elle suit
     alors l'élément quand on le déplace, le segment voisin s'adaptant pour rester droit. */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function portPos(n, port) {
    if (n.t === 'trans') return [n.x, n.y];
    return [n.x, port === 'top' ? n.y - STEP_H : n.y + STEP_H];
  }
  // Déplace l'extrémité d'un trait en gardant ses segments horizontaux / verticaux
  function setEnd(w, which, P) {
    const pts = w.pts, last = pts.length - 1, idx = which === 'a' ? 0 : last, nb = which === 'a' ? 1 : last - 1;
    const old = pts[idx];
    if (old[0] === P[0] && old[1] === P[1]) return;
    if (pts.length === 2) {
      pts[idx] = [P[0], P[1]];
      const p0 = pts[0], p1 = pts[1];
      if (p0[0] !== p1[0] && p0[1] !== p1[1]) {        // plus droit : on ajoute un coude
        const m = rnd((p0[1] + p1[1]) / 2);
        w.pts = [p0, [p0[0], m], [p1[0], m], p1];
        if (w.arrows) for (const r of w.arrows) r.seg = 1;
      }
      return;
    }
    const nb2 = which === 'a' ? 2 : last - 2;
    if (pts.length >= 5) {                             // tracé à plusieurs coudes : le premier segment garde sa longueur
      const dx = P[0] - old[0], dy = P[1] - old[1], q = pts[nb], r = pts[nb2];
      if (q[0] === r[0]) r[0] += dx; else r[1] += dy;
      q[0] += dx; q[1] += dy;
      pts[idx] = [P[0], P[1]];
      return;
    }
    if (old[0] === pts[nb][0]) pts[nb][0] = P[0];      // segment vertical : il glisse de côté
    else if (old[1] === pts[nb][1]) pts[nb][1] = P[1]; // segment horizontal : il monte ou descend
    pts[idx] = [P[0], P[1]];
  }
  // Retire les points inutiles (doublons, points au milieu d'une ligne droite) en gardant les flèches
  function simplify(w) {
    let k = 1;
    while (k < w.pts.length - 1 && w.pts.length > 2) {
      const a = w.pts[k - 1], b = w.pts[k], c = w.pts[k + 1];
      const dup = a[0] === b[0] && a[1] === b[1];
      const line = (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
      if (dup || line) {
        w.pts.splice(k, 1);
        if (w.arrows) for (const r of w.arrows) if (r.seg >= k) r.seg--;
      } else k++;
    }
    if (w.pts.length === 2 && w.pts[0][0] === w.pts[1][0] && w.pts[0][1] === w.pts[1][1]) return;
    const n = w.pts.length - 1;
    if (n >= 1 && w.pts[n][0] === w.pts[n - 1][0] && w.pts[n][1] === w.pts[n - 1][1] && n > 1) { w.pts.splice(n - 1, 1); if (w.arrows) for (const r of w.arrows) r.seg = Math.min(r.seg, w.pts.length - 2); }
  }
  // Remet les extrémités accrochées sur leurs éléments (après un déplacement, « Ordonner », etc.)
  function syncWires(skip) {
    const g = G();
    if (!g) return;
    const byId = {};
    for (const it of g.items) byId[it.id] = it;
    for (const w of g.items) {
      if (w.t !== 'wire' || (skip && skip.has(w.id))) continue;
      for (const k of ['a', 'b']) {
        const e = w[k];
        if (!e) continue;
        const n = byId[e.id];
        if (!n) { delete w[k]; continue; }
        setEnd(w, k, portPos(n, e.port));
      }
      simplify(w);
    }
  }
  // Points d'accroche pour tracer : raccordements des étapes et transitions, sommets et segments des traits
  function snapWire(p, skipId) {
    const R = 12 / S.cam.k;
    let best = null;
    const take = (x, y, att, prio) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= R && (!best || prio > best.prio || (prio === best.prio && d < best.d))) best = { x: rnd(x), y: rnd(y), att, d, prio };
    };
    for (const n of items()) {
      if (n.t === 'step') { take(n.x, n.y - STEP_H, { id: n.id, port: 'top' }, 3); take(n.x, n.y + STEP_H, { id: n.id, port: 'bot' }, 3); }
      else if (n.t === 'trans') take(n.x, n.y, { id: n.id, port: 'c' }, 3);
    }
    if (best) return best;
    for (const w of items()) {
      if (w.t !== 'wire' || w.id === skipId) continue;
      for (const q of w.pts) take(q[0], q[1], null, 2);
      for (let k = 0; k < w.pts.length - 1; k++) {
        const a = w.pts[k], b = w.pts[k + 1];
        if (a[0] === b[0] && p.y >= Math.min(a[1], b[1]) && p.y <= Math.max(a[1], b[1])) take(a[0], snapV(p.y), null, 1);
        else if (a[1] === b[1] && p.x >= Math.min(a[0], b[0]) && p.x <= Math.max(a[0], b[0])) take(snapV(p.x), a[1], null, 1);
      }
    }
    if (best) return { ...best, onWire: true };
    return { x: snapV(p.x), y: snapV(p.y), att: null };
  }
  function finishWire() {
    const d = S.wdraft;
    S.wdraft = null;
    if (!d || d.pts.length < 2) { renderOverlay(); return; }
    const tmp = { pts: d.pts.map((q) => q.slice()) };
    simplify(tmp);
    const pts = tmp.pts;
    if (pts.length < 2 || (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) { renderOverlay(); return; }
    const w = { id: uid(), t: 'wire', pts, ...(S.wireDbl ? { dbl: true } : {}), ...(d.a ? { a: d.a } : {}), ...(d.b ? { b: d.b } : {}) };
    mutate(() => items().push(w));
    S.sel = w.id;
    render(); updateUI();
  }
  // Point suivant d'un trait : toujours horizontal ou vertical par rapport au précédent
  function orthoNext(last, q) {
    return Math.abs(q.x - last[0]) >= Math.abs(q.y - last[1]) ? [q.x, last[1]] : [last[0], q.y];
  }
  function wireDown(p) {
    const q = snapWire(p);
    const d = S.wdraft;
    if (!d) { S.wdraft = { pts: [[q.x, q.y]], a: q.att || null }; renderOverlay(); return; }
    const last = d.pts[d.pts.length - 1];
    if (q.att || q.onWire) {                         // arrivée sur un élément ou un autre trait : le trait se termine
      if (last[0] !== q.x && last[1] !== q.y) d.pts.push(q.att && q.att.port !== 'c' ? [q.x, last[1]] : orthoNext(last, q));
      const l2 = d.pts[d.pts.length - 1];
      if (l2[0] !== q.x && l2[1] !== q.y) d.pts.push([q.x, l2[1]]);
      d.pts.push([q.x, q.y]);
      d.b = q.att || null;
      finishWire();
      return;
    }
    const nx = orthoNext(last, q);
    if (nx[0] === last[0] && nx[1] === last[1]) { finishWire(); return; }   // même point : fin du trait
    d.pts.push(nx);
    renderOverlay();
  }
  // Flèches posées à la main sur un trait : 1er appui = flèche, 2e = sens inversé, 3e = retirée
  function arrowPos(w, r) {
    const k = Math.min(r.seg, w.pts.length - 2), a = w.pts[k], b = w.pts[k + 1];
    return { x: a[0] + (b[0] - a[0]) * r.f, y: a[1] + (b[1] - a[1]) * r.f, dx: Math.sign(b[0] - a[0]) * (r.rev ? -1 : 1), dy: Math.sign(b[1] - a[1]) * (r.rev ? -1 : 1) };
  }
  function arrowDown(p) {
    const tol = 9 / S.cam.k;
    const ws = items().filter((w) => w.t === 'wire');
    for (const w of ws) {
      for (let i = 0; i < (w.arrows || []).length; i++) {
        const q = arrowPos(w, w.arrows[i]);
        if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) {
          if (w.locked) { hint('Trait figé : libérez-le pour modifier ses flèches.'); return; }
          mutate(() => { if (!w.arrows[i].rev) w.arrows[i].rev = true; else { w.arrows.splice(i, 1); if (!w.arrows.length) delete w.arrows; } });
          return;
        }
      }
    }
    let best = null;
    for (const w of ws) {
      for (let k = 0; k < w.pts.length - 1; k++) {
        const a = w.pts[k], b = w.pts[k + 1], d = distSeg(p, a, b);
        if (d <= tol && (!best || d < best.d)) {
          const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
          const f = L2 ? Math.max(0.1, Math.min(0.9, ((p.x - a[0]) * (b[0] - a[0]) + (p.y - a[1]) * (b[1] - a[1])) / L2)) : 0.5;
          best = { w, k, f: Math.round(f * 20) / 20, d };
        }
      }
    }
    if (!best) { hint('Flèche : touchez un trait pour y poser une flèche.'); return; }
    if (best.w.locked) { hint('Trait figé : libérez-le pour lui ajouter une flèche.'); return; }
    mutate(() => { (best.w.arrows = best.w.arrows || []).push({ seg: best.k, f: best.f }); });
  }
  // « Ordonner » : étapes sélectionnées en colonne, toutes à l'écart réglé, transitions au milieu de chaque intervalle
  function orderSel() {
    const sel = selItems().filter((i) => (i.t === 'step' || i.t === 'trans') && !i.locked);
    const steps = sel.filter((i) => i.t === 'step').sort((a, b) => a.y - b.y || a.x - b.x);
    if (!steps.length || sel.length < 2) { hint('Ordonner : sélectionnez au moins deux étapes (Sélection multiple ou rectangle).'); return; }
    const colX = steps[0].x;
    const set = new Set(sel.map((i) => i.id));
    // transitions placées entre deux étapes sélectionnées, près de la colonne : rangées avec elles
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i], b = steps[i + 1];
      for (const t of items()) {
        if (t.t !== 'trans' || t.locked || set.has(t.id)) continue;
        if (t.y > a.y && t.y < b.y && Math.abs(t.x - a.x) <= 60) set.add(t.id);
      }
    }
    const list = items().filter((i) => set.has(i.id)).sort((a, b) => a.y - b.y || a.x - b.x);
    const half = gap() / 2;
    mutate(() => {
      let y = list[0].y, prev = null;
      for (const n of list) {
        if (prev) y += (prev.t === 'step' && n.t === 'step') ? gap() : half;
        n.x = colX; n.y = rnd(y);
        prev = n;
      }
    });
    hint(`${list.length} élément${list.length > 1 ? 's' : ''} ordonné${list.length > 1 ? 's' : ''} (écart ${gap()}).`);
  }
  function freeAt(x, y, skip) {
    return !items().some((n) => (n.t === 'step' || n.t === 'trans') && n.id !== skip && Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20);
  }
  function freeSpot(cands) {
    for (const c of cands) if (freeAt(c.x, c.y)) return c;
    const c = cands[cands.length - 1];
    let x = c.x;
    while (!freeAt(x, c.y)) x += 60;
    return { x, y: c.y };
  }
  // Transitions superposées (anciennes versions) : écartées pour être visibles
  function repairOverlaps() {
    const g = G();
    if (!g) return 0;
    let n = 0;
    if (!g.v27) {                                    // versions précédentes : une liaison vers le haut était un renvoi
      const byId = {};
      for (const it of g.items) byId[it.id] = it;
      for (const l of g.items) {
        if (l.t !== 'link' || l.up || !byId[l.a] || !byId[l.b]) continue;
        if (portTop(byId[l.b]).y <= portBot(byId[l.a]).y + 4) l.up = true;
      }
      g.v27 = true;
    }
    const nodes = g.items.filter((i) => i.t === 'step' || i.t === 'trans');
    for (let i = 0; i < nodes.length; i++) {
      for (let k = 0; k < i; k++) {
        const a = nodes[i], b = nodes[k];
        if (a.t === b.t && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2) {
          let x = a.x + 60;
          while (!freeAt(x, a.y, a.id)) x += 60;
          a.x = x; n++;
          break;
        }
      }
    }
    return n;
  }
  function changeGap(dir) {
    const g = G();
    if (!g) return;
    const v = Math.max(GAP_MIN, Math.min(GAP_MAX, gap() + 10 * dir));
    if (v === gap()) return;
    mutate(() => { g.gap = v; });
    hint(`Écart : ${v}. Il s’applique quand vous utilisez « Ordonner ».`);
  }
  // Anciennes liaisons automatiques (v22 à v27) : transformées en traits, à l'endroit exact où elles étaient dessinées
  function migrateLinks() {
    const g = G();
    if (!g || g.v28) return 0;
    const links = g.items.filter((l) => l.t === 'link');
    if (!links.length) { g.v28 = true; return 0; }
    const byId = {};
    for (const it of g.items) byId[it.id] = it;
    const { paths, bars } = linkGeometry();
    const wires = [];
    const same = (q, P) => Math.abs(q[0] - P[0]) < 0.6 && Math.abs(q[1] - P[1]) < 0.6;
    for (const l of links) {
      const p = paths[l.id];
      if (!p) continue;
      const a = byId[l.a], b = byId[l.b];
      const pts = p.pts.map((q) => [rnd(q[0]), rnd(q[1])]);
      const w = { id: uid(), t: 'wire', pts };
      if (a && same(pts[0], portPos(a, 'bot'))) w.a = { id: a.id, port: a.t === 'trans' ? 'c' : 'bot' };
      if (b && same(pts[pts.length - 1], portPos(b, 'top'))) w.b = { id: b.id, port: b.t === 'trans' ? 'c' : 'top' };
      if (p.up) w.arrows = [{ seg: 2, f: 0.5 }];
      else if (p.off && links.filter((x) => x.a === l.a).length < 2 && links.filter((x) => x.b === l.b).length < 2) {
        let k0 = -1, len = 0;
        for (let k = 0; k < pts.length - 1; k++) if (pts[k][0] === pts[k + 1][0] && Math.abs(pts[k + 1][1] - pts[k][1]) > len) { len = Math.abs(pts[k + 1][1] - pts[k][1]); k0 = k; }
        if (k0 >= 0 && len >= 10) w.arrows = [{ seg: k0, f: 0.5 }];
      }
      wires.push(w);
    }
    for (const b of bars) {
      const n = byId[b.id];
      const stem = { id: uid(), t: 'wire', pts: [[b.stem[0], b.stem[1]], [b.stem[0], b.stem[2]]] };
      if (n && b.kind === 'div') stem.a = { id: n.id, port: n.t === 'trans' ? 'c' : 'bot' };
      if (n && b.kind === 'conv') stem.b = { id: n.id, port: n.t === 'trans' ? 'c' : 'top' };
      if (stem.pts[0][1] !== stem.pts[1][1]) wires.push(stem);
      if (b.x1 - b.x0 >= 1) wires.push({ id: uid(), t: 'wire', pts: [[b.double ? b.x0 - 10 : b.x0, b.y], [b.double ? b.x1 + 10 : b.x1, b.y]], ...(b.double ? { dbl: true } : {}) });
    }
    g.items = g.items.filter((l) => l.t !== 'link').concat(wires);
    g.v28 = true;
    return links.length;
  }

  /* ---------- Désignation : vérification (point de vue Commande) ---------- */
  function letters() {
    const t = document.querySelectorAll('#main-designation .des-table');
    const col = (tb) => (tb ? [...tb.tBodies[0].rows].map((r) => r.cells[0].textContent.trim()) : []);
    return { first: new Set(col(t[0])), second: new Set(col(t[1])) };
  }
  // Vérification d'un texte selon le point de vue ; renvoie null si tout va bien, sinon la raison du panneau « ! »
  //  - Système / Opérative : une action, un évènement
  //  - Commande : une désignation connue (KM1, S1…)
  //  - Automate : une sortie %Q2.x pour une action, une entrée %I1.x pour une réceptivité
  function textIssue(text, kind, view) {
    const t = String(text || '').trim();
    const isAct = kind === 'act';
    if (view === 'commande') return designationIssue(t);
    if (view === 'automate') return automateIssue(t, isAct);
    if (!t) return isAct ? 'Action manquante' : 'Évènement manquant';
    return null;
  }
  function automateIssue(t, isAct) {
    if (!t) return isAct ? 'Sortie manquante' : 'Entrée manquante';
    // adresse écrite sans « % » devant (ex. Q2.1, I1.0)
    if (/(^|[^%A-Za-z0-9])[QqIi]\d+(\.\d+)?\b/.test(t)) return 'Faute d’écriture';
    const addr = t.match(/%[A-Za-z]*[0-9.]*/g) || [];
    if (!addr.length) return 'Faute d’écriture';
    const ok = isAct ? /^%Q2\.\d+$/ : /^%I1\.\d+$/;
    if (addr.some((a) => !ok.test(a))) return 'Faute d’écriture';
    return null;
  }
  // Point de vue Commande : désignation présente et connue du tableau Désignation MELEC
  function designationIssue(text) {
    const t = String(text || '').trim();
    if (!t) return 'Attribution manquante';
    const L = letters();
    const re = /\b([A-Z])([A-Z])?(\d+)\b/g;
    let m, found = 0;
    const bad = [];
    while ((m = re.exec(t))) {
      if (m[1] === 'X' && !m[2]) continue;            // X6 : variable d'étape (temporisation 10s/X6)
      found++;
      if (!L.first.has(m[1]) || (m[2] && !L.second.has(m[2]))) bad.push(m[0]);
    }
    if (!found) return 'Attribution manquante';
    if (bad.length) return 'Désignation inconnue : ' + bad.join(', ');
    return null;
  }

  /* ---------- Réceptivités : NON écrit « /a » (ou « !a »), affiché avec une barre au-dessus ----------
     Le « / » ne vaut NON qu'en début de texte ou après un espace, « . », « + », « ( », « ↑ », « ↓ » :
     « 10s/X6 » (temporisation) reste écrit tel quel. */
  function notParts(t) {
    const s = String(t || ''), out = [];
    let buf = '', i = 0;
    const opBefore = (k) => k === 0 || /[\s.+(·*↑↓]/.test(s[k - 1]);
    while (i < s.length) {
      const c = s[i];
      if ((c === '/' || c === '!') && opBefore(i) && i + 1 < s.length) {
        const j = i + 1;
        let end = j;
        if (s[j] === '(') {
          let d = 0;
          for (end = j; end < s.length; end++) { if (s[end] === '(') d++; else if (s[end] === ')') { d--; if (!d) { end++; break; } } }
        } else {
          const m = s.slice(j).match(/^[↑↓]?%?[A-Za-z0-9_]+(\.\d+)?/);
          end = m ? j + m[0].length : j;
        }
        if (end > j) { if (buf) { out.push({ t: buf }); buf = ''; } out.push({ t: s.slice(j, end), over: true }); i = end; continue; }
      }
      buf += c; i++;
    }
    if (buf) out.push({ t: buf });
    return out;
  }
  const plain = (t) => notParts(t).map((q) => q.t).join('');
  const richSVG = (t) => notParts(t).map((q) => (q.over ? `<tspan style="text-decoration:overline">${esc(q.t)}</tspan>` : esc(q.t))).join('');
  const normText = (t) => String(t || '').replace(/\^/g, '↑').trim().slice(0, 120);

  /* ---------- Géométrie ---------- */
  const snapV = (v) => (S.snap ? Math.round(v / GRID) * GRID : rnd(v));
  const actsOf = (stepId) => items().filter((i) => i.t === 'act' && i.step === stepId).sort((a, b) => a.ord - b.ord);
  const textW = (t, size) => plain(t).length * size * 0.58;
  const PLACEHOLDER = {
    systeme: ['action', 'évènement'], operative: ['action', 'évènement'],
    commande: ['désignation', 'désignation'], automate: ['sortie %Q2.x', 'entrée %I1.x'],
  };
  const ph = (kind, view) => PLACEHOLDER[view || S.view][kind === 'act' ? 0 : 1];

  // Boîtes des actions d'une étape (en ligne, à droite de l'étape)
  function actBoxes(st, view, withRef) {
    const out = [];
    let x = st.x + STEP_H + 18;
    const h = withRef ? ACT_H + 14 : ACT_H;
    for (const a of actsOf(st.id)) {
      const main = txt(a.id, view), ref = withRef ? txt(a.id, S.ref) : '';
      const w = Math.max(70, textW(main || ph('act', view), 12) + 20, withRef ? textW(ref, 11) + 20 : 0);
      out.push({ a, x, y: st.y - h / 2, w, h, main, ref });
      x += w;
    }
    return out;
  }
  const portTop = (n) => ({ x: n.x, y: n.t === 'step' ? n.y - STEP_H : n.y });
  const portBot = (n) => ({ x: n.x, y: n.t === 'step' ? n.y + STEP_H : n.y });

  // Distance entre un élément et sa barre de divergence / convergence (un ET sous une transition laisse la place à la réceptivité)
  const barGap = (n, kind) => (n.t === 'trans' ? Math.min(18, gap() / 4) : 10);
  // Tracé de toutes les liaisons : divergences / convergences en OU (trait simple) et en ET (trait double)
  function linkGeometry() {
    const list = items();
    const byId = {};
    for (const it of list) byId[it.id] = it;
    const links = list.filter((l) => l.t === 'link' && byId[l.a] && byId[l.b]);
    const outs = {}, ins = {};
    for (const l of links) { (outs[l.a] = outs[l.a] || []).push(l); (ins[l.b] = ins[l.b] || []).push(l); }
    const paths = {}, bars = [];
    const isUp = (l) => !!l.up;                       // renvoi : liaison tracée vers le haut (mémorisée)
    for (const l of links) {
      const a = byId[l.a], b = byId[l.b];
      const p0 = portBot(a), p1 = portTop(b);
      const div = outs[l.a].length > 1, conv = ins[l.b].length > 1;
      // barre double (ET) : on part du trait du bas, on arrive sur le trait du haut
      const dA = div && a.t === 'trans' ? 3 : 0, dB = conv && b.t === 'trans' ? 3 : 0;
      if (isUp(l)) {                                  // reprise de séquence : par la gauche, flèche vers le haut
        const L = Math.min(a.x, b.x) - 60;
        const y0 = p0.y + (div ? barGap(a, 'div') + dA : 12), y1 = p1.y - (conv ? barGap(b, 'conv') + dB : 12);
        paths[l.id] = { pts: [[p0.x, p0.y], [p0.x, y0], [L, y0], [L, y1], [p1.x, y1], [p1.x, p1.y]], up: true, off: true };
        continue;
      }
      const ya = p0.y + barGap(a, 'div') + dA, yb = p1.y - barGap(b, 'conv') - dB;
      const col = div ? b.x : (conv ? a.x : b.x);
      const s0 = div ? [col, ya] : [p0.x, p0.y];
      const s1 = conv ? [col, yb] : [p1.x, p1.y];
      let pts;
      if (s0[0] === s1[0]) pts = [s0, s1];
      else { const m = rnd((s0[1] + s1[1]) / 2); pts = [s0, [s0[0], m], [s1[0], m], s1]; }
      paths[l.id] = { pts, off: Math.abs(a.x - b.x) >= 1 };      // off : pas face à face (flèche de sens)
    }
    // traits coudés au même niveau : légèrement décalés pour ne pas se recouvrir
    const bands = {};
    for (const id of Object.keys(paths)) {
      const p = paths[id];
      if (p.up || p.pts.length !== 4) continue;
      const key = Math.round(p.pts[1][1] / 6);
      (bands[key] = bands[key] || []).push(p);
    }
    for (const k of Object.keys(bands)) {
      const ps = bands[k];
      if (ps.length < 2) continue;
      ps.sort((p, q) => p.pts[0][0] - q.pts[0][0]);
      ps.forEach((p, i) => {
        const dy = (i - (ps.length - 1) / 2) * 6;
        const lo = Math.min(p.pts[0][1], p.pts[3][1]) + 3, hi = Math.max(p.pts[0][1], p.pts[3][1]) - 3;
        const m = Math.max(lo, Math.min(hi, p.pts[1][1] + dy));
        p.pts[1][1] = m; p.pts[2][1] = m;
      });
    }
    // barres de divergence (sous la source) et de convergence (au-dessus de la cible)
    for (const id of Object.keys(outs)) {
      const ls = outs[id];
      if (ls.length < 2) continue;
      const a = byId[id], y = portBot(a).y + barGap(a, 'div');
      const xs = [a.x, ...ls.filter((l) => !isUp(l)).map((l) => byId[l.b].x), ...ls.filter(isUp).map(() => a.x)];
      const dbl = a.t === 'trans';
      bars.push({ x0: Math.min(...xs), x1: Math.max(...xs), y, double: dbl, stem: [a.x, portBot(a).y, dbl ? y - 3 : y], id, kind: 'div' });
    }
    for (const id of Object.keys(ins)) {
      const ls = ins[id];
      if (ls.length < 2) continue;
      const b = byId[id], y = portTop(b).y - barGap(b, 'conv');
      const xs = [b.x, ...ls.filter((l) => !isUp(l)).map((l) => byId[l.a].x)];
      const dbl = b.t === 'trans';
      bars.push({ x0: Math.min(...xs), x1: Math.max(...xs), y, double: dbl, stem: [b.x, dbl ? y + 3 : y, portTop(b).y], id, kind: 'conv' });
    }
    return { paths, bars };
  }

  /* ---------- Structure : lecture des traits ----------
     Les traits sont découpés aux raccordements qu'ils traversent (centre d'une transition, haut / bas d'une étape),
     puis regroupés en « nœuds de liaison » : morceaux qui se touchent par une extrémité libre, ou qui partent du
     même côté d'un élément. Chaque nœud relie des sources (bas d'étape, dessous de transition) à des cibles
     (haut d'étape, dessus de transition). C'est ce qui permet de vérifier les règles et de simuler. */
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6;
  function inSeg(P, a, b) {                      // P strictement à l'intérieur du segment [a, b]
    if (Math.abs(a[0] - b[0]) < 0.6 && Math.abs(P[0] - a[0]) < 0.6) return P[1] > Math.min(a[1], b[1]) + 0.5 && P[1] < Math.max(a[1], b[1]) - 0.5;
    if (Math.abs(a[1] - b[1]) < 0.6 && Math.abs(P[1] - a[1]) < 0.6) return P[0] > Math.min(a[0], b[0]) + 0.5 && P[0] < Math.max(a[0], b[0]) - 0.5;
    return false;
  }
  const onPath = (P, pts) => pts.some((q) => near(P, q)) || pts.some((q, k) => k < pts.length - 1 && inSeg(P, q, pts[k + 1]));
  function topo() {
    const list = items(), byId = {};
    for (const it of list) byId[it.id] = it;
    const nodes = list.filter((i) => i.t === 'step' || i.t === 'trans');
    const ports = [];
    for (const n of nodes) {
      if (n.t === 'step') { ports.push({ id: n.id, port: 'top', P: portPos(n, 'top') }); ports.push({ id: n.id, port: 'bot', P: portPos(n, 'bot') }); }
      else ports.push({ id: n.id, port: 'c', P: portPos(n, 'c') });
    }
    const portAt = (P) => ports.find((q) => near(q.P, P)) || null;
    // 1. découpe des traits aux raccordements traversés
    const pieces = [];
    for (const w of list.filter((i) => i.t === 'wire')) {
      const endAtt = (k) => {
        const e = w[k];
        if (e && byId[e.id]) return { id: e.id, port: e.port };
        const q = portAt(k === 'a' ? w.pts[0] : w.pts[w.pts.length - 1]);
        return q ? { id: q.id, port: q.port } : null;
      };
      let cur = [w.pts[0]], curA = endAtt('a');
      for (let k = 0; k < w.pts.length - 1; k++) {
        const a = w.pts[k], b = w.pts[k + 1];
        const cut = ports.filter((q) => inSeg(q.P, a, b)).sort((q, r) => Math.hypot(q.P[0] - a[0], q.P[1] - a[1]) - Math.hypot(r.P[0] - a[0], r.P[1] - a[1]));
        for (const q of cut) {
          cur.push(q.P);
          pieces.push({ w, pts: cur, a: curA, b: { id: q.id, port: q.port } });
          cur = [q.P]; curA = { id: q.id, port: q.port };
        }
        cur.push(b);
      }
      pieces.push({ w, pts: cur, a: curA, b: endAtt('b') });
    }
    // morceau à l'intérieur d'une étape (du haut au bas de la même étape) : ignoré
    const ps = pieces.filter((pc) => !(pc.a && pc.b && pc.a.id === pc.b.id && byId[pc.a.id].t === 'step'));
    // côté de l'élément : « out » = la liaison part de l'élément vers le bas, « in » = elle y arrive par le haut
    const side = (pc, end) => {
      const e = pc[end];
      const n = byId[e.id];
      if (n.t === 'step') return e.port === 'bot' ? 'out' : 'in';
      const pts = pc.pts, nb = end === 'a' ? pts[1] : pts[pts.length - 2], far = end === 'a' ? pts[pts.length - 1] : pts[0];
      const dy = (nb[1] - n.y) || (far[1] - n.y);
      return dy < 0 ? 'in' : 'out';
    };
    // 2. regroupement
    const par = ps.map((_, i) => i);
    const root = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const join = (i, j) => { par[root(i)] = root(j); };
    const bySide = {};
    const dangling = [];
    ps.forEach((pc, i) => {
      for (const end of ['a', 'b']) {
        const P = end === 'a' ? pc.pts[0] : pc.pts[pc.pts.length - 1];
        if (pc[end]) {
          const key = pc[end].id + ':' + side(pc, end);
          if (bySide[key] !== undefined) join(i, bySide[key]); else bySide[key] = i;
          continue;
        }
        let touched = false;
        ps.forEach((o, j) => {
          if (j === i) return;
          // sur un trait double, on accepte les deux traits extérieurs (± 3)
          const ok = o.w.dbl ? o.pts.some((q, k) => k < o.pts.length - 1 && distSeg({ x: P[0], y: P[1] }, q, o.pts[k + 1]) <= 3.6) : onPath(P, o.pts);
          if (ok) { join(i, j); touched = true; }
        });
        if (!touched && !pc.w.dbl) dangling.push({ i, P });          // une barre double dépasse normalement des branches
      }
    });
    const nets = {};
    ps.forEach((pc, i) => {
      const r = root(i);
      const n = nets[r] || (nets[r] = { pieces: [], src: new Map(), dst: new Map(), dbl: false, arrow: false, dangling: [] });
      n.pieces.push(pc);
      if (pc.w.dbl) n.dbl = true;
      if (pc.w.arrows && pc.w.arrows.length) n.arrow = true;
      for (const end of ['a', 'b']) {
        if (!pc[end]) continue;
        const sd = side(pc, end), P = end === 'a' ? pc.pts[0] : pc.pts[pc.pts.length - 1];
        (sd === 'out' ? n.src : n.dst).set(pc[end].id, P);
      }
    });
    for (const d of dangling) nets[root(d.i)].dangling.push(d.P);
    // 3. liens élément → élément
    const next = {}, prev = {};
    for (const n of nodes) { next[n.id] = new Set(); prev[n.id] = new Set(); }
    const netList = Object.values(nets);
    for (const n of netList) for (const a of n.src.keys()) for (const b of n.dst.keys()) if (a !== b) { next[a].add(b); prev[b].add(a); }
    return { nets: netList, next, prev, byId, nodes };
  }
  // Point d'ancrage d'un nœud de liaison : milieu de son plus long segment (horizontal de préférence pour une barre)
  function netAnchor(n, horiz) {
    let best = null;
    for (const pc of n.pieces) for (let k = 0; k < pc.pts.length - 1; k++) {
      const a = pc.pts[k], b = pc.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const score = L + (horiz && a[1] === b[1] ? 10000 : 0);
      if (!best || score > best.s) best = { s: score, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    }
    return best || { x: 0, y: 0 };
  }
  // Trait simple qui se raccorde sur un trait double : il s'arrête sur le trait extérieur (comme sur une feuille)
  function trimToDouble(w, list) {
    const pts = w.pts.map((q) => q.slice());
    const dbls = list.filter((x) => x.t === 'wire' && x.dbl && x !== w);
    if (!dbls.length) return pts;
    for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
      const P = pts[i], Q = pts[j];
      if (P[0] !== Q[0]) continue;                   // seulement pour un départ vertical
      for (const d of dbls) {
        if (d.pts.some((q, k) => k < d.pts.length - 1 && q[1] === d.pts[k + 1][1] && Math.abs(P[1] - q[1]) < 0.6 && P[0] >= Math.min(q[0], d.pts[k + 1][0]) - 0.5 && P[0] <= Math.max(q[0], d.pts[k + 1][0]) + 0.5)) {
          P[1] += Q[1] > P[1] ? 3 : -3;
          break;
        }
      }
    }
    return pts;
  }

  /* ---------- Vérification de la structure (règles du cours) ---------- */
  function structIssues() {
    const T = topo();
    const { byId, next, prev, nodes } = T;
    const out = [];
    const add = (x, y, why, key) => {
      const k = key || `${Math.round(x)}:${Math.round(y)}`;
      const q = out.find((o) => o.k === k);
      if (q) { if (!q.why.includes(why)) q.why += ' · ' + why; } else out.push({ k, x, y, why });
    };
    const atStep = (st, why) => add(st.x - STEP_H - 3, st.y - STEP_H - 3, why, st.id);
    const atTrans = (tr, why) => add(tr.x - TR_W - 12, tr.y, why, tr.id);
    const steps = nodes.filter((n) => n.t === 'step'), trans = nodes.filter((n) => n.t === 'trans');
    const label = (n) => (n.t === 'step' ? `étape ${n.n}` : 'transition');
    // règle 1 : une étape initiale
    if (steps.length && !steps.some((s) => s.init)) {
      const top = steps.slice().sort((a, b) => a.y - b.y || a.x - b.x)[0];
      atStep(top, 'Aucune étape initiale : le Grafcet ne peut pas démarrer (règle 1). Utilisez l’outil « Étape initiale ».');
    }
    // numéros en double
    const seen = {};
    for (const st of steps) (seen[st.n] = seen[st.n] || []).push(st);
    for (const k of Object.keys(seen)) if (seen[k].length > 1) for (const st of seen[k]) atStep(st, `Numéro ${k} utilisé par plusieurs étapes`);
    // nœuds de liaison
    for (const n of T.nets) {
      const src = [...n.src.keys()].map((id) => byId[id]), dst = [...n.dst.keys()].map((id) => byId[id]);
      const sS = src.filter((x) => x.t === 'step'), sT = src.filter((x) => x.t === 'trans');
      const dS = dst.filter((x) => x.t === 'step'), dT = dst.filter((x) => x.t === 'trans');
      const A = netAnchor(n, false), B = netAnchor(n, true);
      for (const P of n.dangling) add(P[0], P[1], 'Trait non raccordé à ce bout : terminez-le sur une étape, une transition ou un autre trait');
      if (!n.dangling.length && (!src.length || !dst.length) && (src.length || dst.length)) {
        add(A.x, A.y, !src.length ? 'Ce trait n’arrive d’aucune étape ni transition' : 'Ce trait ne mène à aucune étape ni transition');
      }
      if (sS.length && dS.length) add(A.x, A.y, `Étape reliée à une étape (${sS.map(label).join(', ')} → ${dS.map(label).join(', ')}) : il manque une transition entre les deux`);
      if (sT.length && dT.length) add(A.x, A.y, 'Transition reliée à une transition : il manque une étape entre les deux');
      // ET : trait double ; OU : trait simple
      if (sT.length === 1 && dS.length >= 2 && !sS.length && !n.dbl) add(B.x, B.y, 'Divergence en ET (une transition vers plusieurs étapes) : tracez la barre en trait double');
      if (sS.length >= 2 && dT.length === 1 && !sT.length && !n.dbl) add(B.x, B.y, 'Convergence en ET (plusieurs étapes vers une transition) : tracez la barre en trait double');
      if (n.dbl && sS.length === 1 && dT.length >= 2 && !sT.length) add(B.x, B.y, 'Divergence en OU (une étape vers plusieurs transitions) : trait simple — le trait double est réservé au ET');
      if (n.dbl && sT.length >= 2 && dS.length === 1 && !sS.length) add(B.x, B.y, 'Convergence en OU (plusieurs transitions vers une étape) : trait simple — le trait double est réservé au ET');
      if (n.dbl && src.length === 1 && dst.length === 1) add(B.x, B.y, 'Trait double inutile : une liaison simple suffit (le double trait sert aux ET)');
      // aiguillage : réceptivités exclusives
      if (sS.length === 1 && dT.length >= 2) {
        const byTxt = {};
        for (const t of dT) { const v = plain(txt(t.id)).replace(/\s+/g, ''); if (v) (byTxt[v] = byTxt[v] || []).push(t); }
        for (const v of Object.keys(byTxt)) if (byTxt[v].length > 1) for (const t of byTxt[v]) atTrans(t, 'Aiguillage : réceptivités identiques, elles doivent être exclusives (une seule vraie à la fois)');
      }
      // liaison qui remonte : flèche obligatoire
      if (!n.arrow) {
        let up = false;
        for (const a of n.src.values()) for (const b of n.dst.values()) if (b[1] < a[1] - 1) up = true;
        if (up) add(A.x, A.y, 'Liaison qui remonte : ajoutez une flèche vers le haut (outil « Flèche »)');
      }
    }
    // étapes et transitions isolées
    for (const st of steps) {
      if (![...next[st.id]].some((id) => byId[id].t === 'trans')) atStep(st, 'Aucune transition sous cette étape : le Grafcet s’arrête ici');
      if (!st.init && ![...prev[st.id]].some((id) => byId[id].t === 'trans')) atStep(st, 'Étape jamais activée : aucune transition au-dessus');
    }
    for (const tr of trans) {
      if (![...prev[tr.id]].some((id) => byId[id].t === 'step')) atTrans(tr, 'Aucune étape au-dessus de cette transition : elle ne peut jamais être validée (règle 2)');
      if (![...next[tr.id]].some((id) => byId[id].t === 'step')) atTrans(tr, 'Aucune étape sous cette transition : rien ne sera activé (règle 3)');
    }
    return out;
  }

  /* ---------- Simulation (règles d'évolution) ---------- */
  function startSim() {
    if (S.wdraft) finishWire();
    const T = topo();
    const init = T.nodes.filter((n) => n.t === 'step' && n.init).map((n) => n.id);
    S.sim = { topo: T, active: new Set(init), n: 0 };
    S.sels = []; S.drag = null; S.tool = 'select';
    render(); updateUI();
    if (!init.length) hint('Aucune étape initiale : touchez une étape pour l’activer à la main, puis franchissez les transitions.');
  }
  function stopSim(silent) {
    if (!S.sim) return;
    S.sim = null;
    if (!silent) { render(); updateUI(); }
  }
  const stepsAbove = (T, tr) => [...T.prev[tr.id]].map((id) => T.byId[id]).filter((n) => n && n.t === 'step');
  const stepsBelow = (T, tr) => [...T.next[tr.id]].map((id) => T.byId[id]).filter((n) => n && n.t === 'step');
  const validated = (tr) => { const up = stepsAbove(S.sim.topo, tr); return up.length > 0 && up.every((s) => S.sim.active.has(s.id)); };
  function simDown(p) {
    const T = S.sim.topo;
    // transition touchée (trait ou réceptivité)
    const tr = T.nodes.find((n) => n.t === 'trans' && Math.abs(p.y - n.y) <= 10 / S.cam.k + 4 &&
      p.x >= n.x - TR_W - 8 && p.x <= n.x + TR_W + 12 + textW(txt(n.id) || '', 12));
    if (tr) { simFire(tr); return true; }
    const st = T.nodes.find((n) => n.t === 'step' && Math.abs(p.x - n.x) <= STEP_H + 3 && Math.abs(p.y - n.y) <= STEP_H + 3);
    if (st) {
      if (S.sim.active.has(st.id)) S.sim.active.delete(st.id); else S.sim.active.add(st.id);
      renderOverlay(); updateUI();
      hint(`Étape ${st.n} ${S.sim.active.has(st.id) ? 'activée' : 'désactivée'} à la main.`);
      return true;
    }
    return false;
  }
  function simFire(tr) {
    const T = S.sim.topo;
    const up = stepsAbove(T, tr), down = stepsBelow(T, tr);
    const r = txt(tr.id) ? ` « ${plain(txt(tr.id))} »` : '';
    if (!up.length) { hint('Cette transition n’a aucune étape au-dessus : elle ne peut jamais être validée.'); return; }
    const off = up.filter((s) => !S.sim.active.has(s.id));
    if (off.length) {
      hint(`Transition${r} non validée : ${off.length > 1 ? 'les étapes' : 'l’étape'} ${off.map((s) => s.n).join(', ')} ${off.length > 1 ? 'ne sont pas actives' : 'n’est pas active'} (règle 2).`);
      return;
    }
    // règle 3 : désactivation des étapes précédentes puis activation des suivantes (règle 5 : une étape à la fois désactivée et activée reste active)
    for (const s of up) S.sim.active.delete(s.id);
    for (const s of down) S.sim.active.add(s.id);
    S.sim.n++;
    renderOverlay(); updateUI();
    hint(`Transition${r} franchie : ${up.map((s) => s.n).join(', ')} désactivée${up.length > 1 ? 's' : ''}` +
      (down.length ? `, ${down.map((s) => s.n).join(', ')} activée${down.length > 1 ? 's' : ''}` : ', aucune étape en dessous') + ' (règle 3).');
  }
  function simOverlay() {
    const T = S.sim.topo;
    const withRef = S.ref && S.ref !== S.view;
    let o = '';
    for (const st of T.nodes.filter((n) => n.t === 'step')) {
      if (!S.sim.active.has(st.id)) continue;
      for (const b of actBoxes(st, S.view, withRef)) o += `<rect x="${rnd(b.x + 1)}" y="${rnd(b.y + 1)}" width="${rnd(b.w - 2)}" height="${b.h - 2}" fill="${ON}" fill-opacity="0.18"/>`;
      o += `<circle cx="${st.x - STEP_H + 8}" cy="${st.y + STEP_H - 8}" r="4.5" fill="${BAD}"/>`;
    }
    for (const tr of T.nodes.filter((n) => n.t === 'trans')) {
      if (validated(tr)) o += `<line x1="${tr.x - TR_W - 4}" y1="${tr.y}" x2="${tr.x + TR_W + 4}" y2="${tr.y}" stroke="${ON}" stroke-opacity="0.55" stroke-width="9" stroke-linecap="round"/>`;
    }
    return o;
  }

  /* ---------- Modèles : structures de base du cours ---------- */
  const TEMPLATES = {
    lineaire: (b) => {
      const s0 = b.step(0, 0, true), t0 = b.tr(0, 50), s1 = b.step(0, 100), t1 = b.tr(0, 150), s2 = b.step(0, 200), t2 = b.tr(0, 250);
      b.link(s0, t0); b.link(t0, s1); b.link(s1, t1); b.link(t1, s2); b.link(s2, t2);
      b.back(t2, s0, -60);
    },
    aiguillage: (b) => {
      const s0 = b.step(0, 0, true), sa = b.step(-100, 100), sb = b.step(100, 100), s3 = b.step(0, 200);
      const ta = b.tr(-100, 50), tb = b.tr(100, 50), tc = b.tr(-100, 150), td = b.tr(100, 150), te = b.tr(0, 250);
      b.wire([[0, 20], [0, 30]], s0, 'bot'); b.wire([[-100, 30], [100, 30]]);
      b.wire([[-100, 30], [-100, 50]], null, null, ta, 'c'); b.wire([[100, 30], [100, 50]], null, null, tb, 'c');
      b.link(ta, sa); b.link(tb, sb); b.link(sa, tc); b.link(sb, td);
      b.wire([[-100, 150], [-100, 170]], tc, 'c'); b.wire([[100, 150], [100, 170]], td, 'c'); b.wire([[-100, 170], [100, 170]]);
      b.wire([[0, 170], [0, 180]], null, null, s3, 'top');
      b.link(s3, te); b.back(te, s0, -140);
    },
    simultanees: (b) => {
      const s0 = b.step(0, 0, true), sa = b.step(-100, 100), sb = b.step(100, 100), s3 = b.step(0, 200);
      const t0 = b.tr(0, 50), t1 = b.tr(0, 150), t2 = b.tr(0, 250);
      b.link(s0, t0);
      b.wire([[0, 50], [0, 70]], t0, 'c'); b.wire([[-100, 70], [100, 70]], null, null, null, null, true);
      b.wire([[-100, 70], [-100, 80]], null, null, sa, 'top'); b.wire([[100, 70], [100, 80]], null, null, sb, 'top');
      b.wire([[-100, 120], [-100, 130]], sa, 'bot'); b.wire([[100, 120], [100, 130]], sb, 'bot'); b.wire([[-100, 130], [100, 130]], null, null, null, null, true);
      b.wire([[0, 130], [0, 150]], null, null, t1, 'c');
      b.link(t1, s3); b.link(s3, t2); b.back(t2, s0, -140);
    },
    saut: (b) => {
      const s0 = b.step(0, 0, true), s1 = b.step(0, 100), s2 = b.step(0, 200);
      const tj = b.tr(-120, 50), tn = b.tr(0, 50), t1 = b.tr(0, 150), t2 = b.tr(0, 250);
      b.wire([[0, 20], [0, 30]], s0, 'bot'); b.wire([[-120, 30], [0, 30]]);
      b.wire([[-120, 30], [-120, 50]], null, null, tj, 'c'); b.wire([[0, 30], [0, 50]], null, null, tn, 'c');
      b.link(tn, s1); b.link(s1, t1);
      b.wire([[0, 150], [0, 170]], t1, 'c'); b.wire([[-120, 50], [-120, 170]], tj, 'c'); b.wire([[-120, 170], [0, 170]]);
      b.wire([[0, 170], [0, 180]], null, null, s2, 'top');
      b.link(s2, t2); b.back(t2, s0, -160);
    },
    reprise: (b) => {
      const s0 = b.step(0, 0, true), s1 = b.step(0, 100), s2 = b.step(0, 200), s3 = b.step(0, 300);
      const t0 = b.tr(0, 50), t1 = b.tr(0, 150), tr = b.tr(-120, 250), tn = b.tr(0, 250), t3 = b.tr(0, 350);
      b.link(s0, t0); b.link(t0, s1); b.link(s1, t1); b.link(t1, s2);
      b.wire([[0, 220], [0, 230]], s2, 'bot'); b.wire([[-120, 230], [0, 230]]);
      b.wire([[-120, 230], [-120, 250]], null, null, tr, 'c'); b.wire([[0, 230], [0, 250]], null, null, tn, 'c');
      b.wire([[-120, 250], [-120, 265], [-160, 265], [-160, 75], [0, 75]], tr, 'c', null, null, false, [{ seg: 2, f: 0.5 }]);
      b.link(tn, s3); b.link(s3, t3); b.back(t3, s0, -200);
    },
  };
  const TEMPLATE_NAMES = { lineaire: 'Séquence linéaire', aiguillage: 'Aiguillage (OU)', simultanees: 'Séquences simultanées (ET)', saut: 'Saut d’étapes', reprise: 'Reprise de séquence' };
  function insertTemplate(key) {
    const make = TEMPLATES[key];
    if (!make) return;
    const g = G();
    if (!g) return;
    if (S.sim) stopSim(true);
    const bb = bbox();
    const ox = 0, oy = 0;
    const made = [];
    const hasInit = g.items.some((i) => i.t === 'step' && i.init);
    let n = nextStepNumber();
    const P = (x, y) => [ox + x, oy + y];
    const b = {
      step(x, y, first) { const it = { id: uid(), t: 'step', x: ox + x, y: oy + y, n: n++, ...(first && !hasInit ? { init: true } : {}) }; made.push(it); return it; },
      tr(x, y) { const it = { id: uid(), t: 'trans', x: ox + x, y: oy + y }; made.push(it); return it; },
      wire(pts, a, ap, z, zp, dbl, arrows) {
        made.push({ id: uid(), t: 'wire', pts: pts.map((q) => P(q[0], q[1])), ...(dbl ? { dbl: true } : {}), ...(a ? { a: { id: a.id, port: ap } } : {}), ...(z ? { b: { id: z.id, port: zp } } : {}), ...(arrows ? { arrows } : {}) });
      },
      link(a, z) {
        const ap = a.t === 'step' ? 'bot' : 'c', zp = z.t === 'step' ? 'top' : 'c';
        const A = portPos(a, ap), Z = portPos(z, zp);
        made.push({ id: uid(), t: 'wire', pts: [A, Z], a: { id: a.id, port: ap }, b: { id: z.id, port: zp } });
      },
      back(t, s, xl) {                                 // renvoi à gauche, flèche vers le haut
        const A = portPos(t, 'c'), Z = portPos(s, 'top'), X = ox + xl;
        made.push({ id: uid(), t: 'wire', pts: [A, [A[0], A[1] + 20], [X, A[1] + 20], [X, Z[1] - 20], [Z[0], Z[1] - 20], Z], a: { id: t.id, port: 'c' }, b: { id: s.id, port: 'top' }, arrows: [{ seg: 2, f: 0.5 }] });
      },
    };
    // numérotation de haut en bas : les étapes sont créées dans l'ordre du dessin
    make(b);
    // placé à droite de ce qui existe déjà, en haut
    let mx = Infinity, my = Infinity;
    for (const it of made) {
      if (it.t === 'wire') for (const q of it.pts) { mx = Math.min(mx, q[0]); my = Math.min(my, q[1]); }
      else { mx = Math.min(mx, it.x - STEP_H); my = Math.min(my, it.y - STEP_H); }
    }
    const dx = Math.round(((bb ? bb.x + bb.w + 80 : 80) - mx) / GRID) * GRID, dy = Math.round(((bb ? bb.y : 60) - my) / GRID) * GRID;
    for (const it of made) {
      if (it.t === 'wire') it.pts = it.pts.map((q) => [q[0] + dx, q[1] + dy]);
      else { it.x += dx; it.y += dy; }
    }
    mutate(() => { g.items.push(...made); });
    S.sels = made.map((i) => i.id);
    render(); fit(); updateUI();
    hint(`Modèle « ${TEMPLATE_NAMES[key]} » ajouté (sélectionné : faites-le glisser pour le placer). Complétez les actions et réceptivités.`);
  }


  /* ---------- Dessin ---------- */
  function sceneSVG(opts) {
    const o = opts || {};
    const view = o.view || S.view;
    const withRef = !o.export && S.ref && S.ref !== view;
    const list = items();
    let s = '';
    // traits (simples ou doubles) et flèches posées à la main
    for (const w of list.filter((x) => x.t === 'wire')) {
      if (w.dbl) {
        for (let k = 0; k < w.pts.length - 1; k++) {
          const a = w.pts[k], b = w.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / L * 3, ny = (b[0] - a[0]) / L * 3;
          for (const sg of [1, -1]) s += `<line x1="${rnd(a[0] + nx * sg)}" y1="${rnd(a[1] + ny * sg)}" x2="${rnd(b[0] + nx * sg)}" y2="${rnd(b[1] + ny * sg)}" stroke="${INK}" stroke-width="1.4"/>`;
        }
      } else s += `<polyline points="${trimToDouble(w, list).map((q) => q.join(',')).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="miter"/>`;
      for (const r of w.arrows || []) {
        const q = arrowPos(w, r);
        const ux = q.dx, uy = q.dy, px = -uy, py = ux;          // sens du trait et perpendiculaire
        const tip = [q.x + ux * 4.5, q.y + uy * 4.5], b1 = [q.x - ux * 4 + px * 5, q.y - uy * 4 + py * 5], b2 = [q.x - ux * 4 - px * 5, q.y - uy * 4 - py * 5];
        s += `<path d="M${rnd(tip[0])} ${rnd(tip[1])} L${rnd(b1[0])} ${rnd(b1[1])} L${rnd(b2[0])} ${rnd(b2[1])} Z" fill="${INK}"/>`;
      }
    }
    // étapes et actions
    for (const st of list.filter((i) => i.t === 'step')) {
      const h = STEP_H;
      s += `<rect x="${st.x - h}" y="${st.y - h}" width="${2 * h}" height="${2 * h}" fill="#fff" stroke="${INK}" stroke-width="1.8"/>`;
      if (st.init) s += `<rect x="${st.x - h + 4}" y="${st.y - h + 4}" width="${2 * h - 8}" height="${2 * h - 8}" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
      s += `<text x="${st.x}" y="${st.y + 5}" font-size="15" font-weight="700" text-anchor="middle" font-family="${FONT}" fill="${INK}">${esc(st.n)}</text>`;
      const boxes = actBoxes(st, view, withRef);
      if (boxes.length) s += `<line x1="${st.x + h}" y1="${st.y}" x2="${boxes[0].x}" y2="${st.y}" stroke="${INK}" stroke-width="1.6"/>`;
      for (const b of boxes) {
        s += `<rect x="${rnd(b.x)}" y="${rnd(b.y)}" width="${rnd(b.w)}" height="${b.h}" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
        const ty = withRef ? b.y + 18 : st.y + 4.5;
        if (b.main) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(ty)}" font-size="12" text-anchor="middle" font-family="${FONT}" fill="${INK}">${richSVG(b.main)}</text>`;
        else if (!o.export && !withRef) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(ty)}" font-size="11" font-style="italic" text-anchor="middle" font-family="${FONT}" fill="#9aa1ac">${esc(ph('act', view))}</text>`;
        if (withRef && b.ref) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(b.y + b.h - 8)}" font-size="11" font-style="italic" text-anchor="middle" font-family="${FONT}" fill="#5a6b86" opacity="${S.refOp}">${esc(b.ref)}</text>`;
      }
    }
    // transitions et réceptivités
    for (const tr of list.filter((i) => i.t === 'trans')) {
      s += `<line x1="${tr.x - TR_W}" y1="${tr.y}" x2="${tr.x + TR_W}" y2="${tr.y}" stroke="${INK}" stroke-width="3"/>`;
      const main = txt(tr.id, view), ref = withRef ? txt(tr.id, S.ref) : '';
      if (main) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 4.5}" font-size="12" font-family="${FONT}" fill="${INK}">${richSVG(main)}</text>`;
      else if (!o.export) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 4.5}" font-size="11" font-style="italic" font-family="${FONT}" fill="#9aa1ac">${esc(ph('trans', view))}</text>`;
      if (ref) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 18}" font-size="11" font-style="italic" font-family="${FONT}" fill="#5a6b86" opacity="${S.refOp}">${richSVG(ref)}</text>`;
    }
    return s;
  }

  // Éléments à texte (actions, transitions) et position du panneau « ! »
  function textTargets() {
    const out = [];
    const withRef = S.ref && S.ref !== S.view;
    for (const st of items().filter((i) => i.t === 'step')) {
      for (const b of actBoxes(st, S.view, withRef)) out.push({ id: b.a.id, kind: 'act', x: b.x + b.w - 2, y: b.y + 2 });
    }
    for (const tr of items().filter((i) => i.t === 'trans')) {
      out.push({ id: tr.id, kind: 'trans', x: tr.x + TR_W + 10 + textW(txt(tr.id) || ph('trans'), 12) + 8, y: tr.y - 6 });
    }
    return out;
  }

  function overlaySVG() {
    if (S.sim) return simOverlay();
    let o = '';
    const k = S.cam.k;
    const dash = `fill="none" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"`;
    for (const it of selItems()) {
      if (it.t === 'step') o += `<rect x="${it.x - STEP_H - 4}" y="${it.y - STEP_H - 4}" width="${2 * STEP_H + 8}" height="${2 * STEP_H + 8}" ${dash}/>`;
      else if (it.t === 'trans') o += `<rect x="${it.x - TR_W - 4}" y="${it.y - 7}" width="${2 * TR_W + 8}" height="14" ${dash}/>`;
      else if (it.t === 'act') {
        const st = find(it.step);
        const b = st && actBoxes(st, S.view, S.ref && S.ref !== S.view).find((q) => q.a.id === it.id);
        if (b) o += `<rect x="${rnd(b.x - 3)}" y="${rnd(b.y - 3)}" width="${rnd(b.w + 6)}" height="${b.h + 6}" ${dash}/>`;
      } else if (it.t === 'wire') {
        o += `<polyline points="${it.pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${SEL}" stroke-opacity="0.45" stroke-width="${it.dbl ? 11 : 7}" stroke-linejoin="round"/>`;
        for (const q of [it.pts[0], it.pts[it.pts.length - 1]]) o += `<circle cx="${q[0]}" cy="${q[1]}" r="${3.5 / k}" fill="${SEL}"/>`;
      }
    }
    // cadenas : un tiers de l'élément figé, sans dépasser sa largeur visible
    if (S.lockMarks) for (const it of items()) if (it.locked) o += lockSVG(it);
    // rectangle de sélection
    const d = S.drag;
    if (d && d.mode === 'marquee' && d.cur) {
      o += `<rect x="${Math.min(d.a.x, d.cur.x)}" y="${Math.min(d.a.y, d.cur.y)}" width="${Math.abs(d.cur.x - d.a.x)}" height="${Math.abs(d.cur.y - d.a.y)}" fill="${SEL}" fill-opacity="0.08" ${dash.replace('fill="none" ', '')}/>`;
    }
    // trait en cours de tracé + point d'accroche sous le curseur
    if (S.tool === 'wire' && S.cursor) {
      const q = snapWire(S.cursor);
      if (S.wdraft) {
        const pts = S.wdraft.pts.slice();
        const nx = q.att || q.onWire ? [q.x, q.y] : orthoNext(pts[pts.length - 1], q);
        const last = pts[pts.length - 1];
        if (nx[0] !== last[0] && nx[1] !== last[1]) pts.push([nx[0], last[1]]);
        pts.push(nx);
        o += `<polyline points="${pts.map((r) => r.join(',')).join(' ')}" fill="none" stroke="${SEL}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
      }
      if (q.att || q.onWire) o += `<circle cx="${q.x}" cy="${q.y}" r="${6 / k}" fill="none" stroke="#ff8a00" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
    // panneaux « ! » : texte manquant ou mal écrit pour le point de vue affiché
    {
      for (const t of textTargets()) {
        const why = textIssue(txt(t.id), t.kind, S.view);
        if (!why) continue;
        const sc = 1 / Math.max(0.6, k);
        o += `<g class="gf-warn" data-warn="${esc(t.id)}" transform="translate(${rnd(t.x)} ${rnd(t.y)}) scale(${rnd(sc)})"><title>${esc(why)}</title>` +
          `<path d="M0 -9 L9 7 L-9 7 Z" fill="${WARN}" stroke="#7a5200" stroke-width="1" stroke-linejoin="round"/>` +
          `<text x="0" y="5.2" font-size="11" font-weight="700" text-anchor="middle" font-family="${FONT}" fill="#fff">!</text></g>`;
      }
    }
    // ronds rouges : erreurs de structure (règles du Grafcet)
    if (S.check) {
      const sc = 1 / Math.max(0.6, k);
      structIssues().forEach((q, i) => {
        o += `<g class="gf-sissue" data-sissue="${i}" transform="translate(${rnd(q.x)} ${rnd(q.y)}) scale(${rnd(sc)})"><title>${esc(q.why)}</title>` +
          `<circle r="8" fill="${BAD}" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="0" y="4.2" font-size="11" font-weight="700" text-anchor="middle" font-family="${FONT}" fill="#fff">!</text></g>`;
      });
    }
    return o;
  }

  function lockSVG(it) {
    let x, y, size;
    if (it.t === 'step') { x = it.x + STEP_H; y = it.y - STEP_H; size = Math.min(2 * STEP_H / 3, 2 * STEP_H); }
    else if (it.t === 'trans') { x = it.x + TR_W; y = it.y; size = Math.min(2 * TR_W / 3, 14); }
    else if (it.t === 'act') {
      const st = find(it.step);
      const b = st && actBoxes(st, S.view, S.ref && S.ref !== S.view).find((q) => q.a.id === it.id);
      if (!b) return '';
      x = b.x + b.w; y = b.y; size = Math.min(b.w / 3, b.h);
    } else if (it.t === 'wire') {
      const a = it.pts[0], b = it.pts[1];
      x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2; size = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3, it.dbl ? 8 : 6);
    } else return '';
    const sc = size / 20;
    return `<g transform="translate(${rnd(x)} ${rnd(y)}) scale(${rnd(sc * 1000) / 1000})">` +
      '<circle r="10" fill="#fff" fill-opacity="0.92" stroke="#d62828" stroke-width="1.2"/>' +
      '<path d="M-3.6 -0.5 V-3.4 a3.6 3.6 0 0 1 7.2 0 V-0.5" fill="none" stroke="#d62828" stroke-width="1.9" stroke-linecap="round"/>' +
      '<rect x="-5.4" y="-0.8" width="10.8" height="8" rx="1.6" fill="#d62828"/><circle cx="0" cy="3.1" r="1.25" fill="#fff"/></g>';
  }

  const sceneG = document.getElementById('gf-scene');
  const overG = document.getElementById('gf-overlay');
  const worldG = document.getElementById('gf-world');
  function applyCam() { worldG.setAttribute('transform', `translate(${rnd(S.cam.x)} ${rnd(S.cam.y)}) scale(${S.cam.k})`); }
  function render() {
    if (!G()) { sceneG.innerHTML = ''; overG.innerHTML = ''; return; }
    applyCam();
    sceneG.innerHTML = sceneSVG();
    overG.innerHTML = overlaySVG();
  }
  const renderOverlay = () => { overG.innerHTML = overlaySVG(); };

  /* ---------- Clic : recherche de l'élément touché ---------- */
  function distSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
  }
  function hit(p) {
    const tol = 5 / S.cam.k;
    const list = items();
    const withRef = S.ref && S.ref !== S.view;
    for (const st of list.filter((i) => i.t === 'step')) {
      for (const b of actBoxes(st, S.view, withRef)) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.a;
    }
    for (const st of list.filter((i) => i.t === 'step')) if (Math.abs(p.x - st.x) <= STEP_H + tol && Math.abs(p.y - st.y) <= STEP_H + tol) return st;
    for (const tr of list.filter((i) => i.t === 'trans')) {
      const w = textW(txt(tr.id) || ph('trans'), 12);
      if (Math.abs(p.y - tr.y) <= 8 + tol && p.x >= tr.x - TR_W - tol && p.x <= tr.x + TR_W + 10 + w) return tr;
    }
    for (const w of list.filter((i) => i.t === 'wire').reverse()) {
      for (let i = 0; i < w.pts.length - 1; i++) if (distSeg(p, w.pts[i], w.pts[i + 1]) <= (w.dbl ? 6 : 4) + tol) return w;
    }
    return null;
  }

  function nodeAt(p) {
    const tol = 12 / S.cam.k;
    let best = null, bd = Infinity;
    for (const it of items()) {
      if (it.t === 'step') {
        const dx = Math.max(0, Math.abs(p.x - it.x) - STEP_H), dy = Math.max(0, Math.abs(p.y - it.y) - STEP_H), d = Math.hypot(dx, dy);
        if (d <= tol && d < bd) { best = it; bd = d; }
      } else if (it.t === 'trans') {
        const dx = Math.max(0, Math.abs(p.x - it.x) - TR_W), dy = Math.abs(p.y - it.y), d = Math.hypot(dx, dy);
        if (d <= tol + 4 && d < bd) { best = it; bd = d; }
      }
    }
    if (best) return best;
    const h = hit(p);
    return h && h.t === 'act' ? find(h.step) : null;
  }

  /* ---------- Vue : zoom et ajustement ---------- */
  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - S.cam.x) / S.cam.k, y: (e.clientY - r.top - S.cam.y) / S.cam.k };
  }
  function zoomAt(cx, cy, f) {
    const k = Math.max(0.2, Math.min(4, S.cam.k * f));
    const ff = k / S.cam.k;
    S.cam.x = cx - (cx - S.cam.x) * ff; S.cam.y = cy - (cy - S.cam.y) * ff; S.cam.k = k;
    applyCam(); renderOverlay();
  }
  function bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const withRef = S.ref && S.ref !== S.view;
    for (const it of items()) {
      if (it.t === 'step') {
        add(it.x - STEP_H - 70, it.y - STEP_H - 14); add(it.x + STEP_H, it.y + STEP_H + 14);
        for (const b of actBoxes(it, S.view, withRef)) add(b.x + b.w, b.y + b.h);
      } else if (it.t === 'trans') {
        add(it.x - TR_W - 70, it.y - 10); add(it.x + TR_W + 10 + textW(txt(it.id) || ph('trans'), 12), it.y + 20);
      } else if (it.t === 'wire') for (const q of it.pts) add(q[0], q[1]);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function fit() {
    const bb = bbox();
    const W = svg.clientWidth || 800, H = svg.clientHeight || 500;
    if (!bb) S.cam = { x: 80, y: 60, k: 1 };
    else {
      const k = Math.max(0.2, Math.min(1.6, (W - 60) / bb.w, (H - 60) / bb.h));
      S.cam = { k, x: (W - bb.w * k) / 2 - bb.x * k, y: (H - bb.h * k) / 2 - bb.y * k };
    }
    applyCam(); renderOverlay();
  }

  /* ---------- Création ---------- */
  function nextStepNumber() {
    let m = -1;
    for (const st of items()) if (st.t === 'step') m = Math.max(m, st.n);
    return m + 1;
  }
  const outCount = (id) => items().filter((l) => l.t === 'link' && l.a === id).length;
  const inCount = (id) => items().filter((l) => l.t === 'link' && l.b === id).length;
  function addNode(kind, p) {
    const q = { x: snapV(p.x), y: snapV(p.y) };
    let it;
    mutate(() => {
      if (kind === 'trans') it = { id: uid(), t: 'trans', x: q.x, y: q.y };
      else {
        const hasInit = items().some((i) => i.t === 'step' && i.init);
        const init = kind === 'init';
        it = { id: uid(), t: 'step', x: q.x, y: q.y, n: init && !hasInit ? 0 : nextStepNumber(), ...(init ? { init: true } : {}) };
      }
      items().push(it);
    });
    S.sel = it.id;
    renderOverlay(); updateUI();
  }
  function addAction(st) {
    const acts = actsOf(st.id);
    const it = { id: uid(), t: 'act', step: st.id, ord: acts.length ? acts[acts.length - 1].ord + 1 : 0 };
    mutate(() => items().push(it));
    S.sel = it.id;
    render(); updateUI();
    setTimeout(() => editText(it.id, true), 0);
  }

  /* ---------- Textes ---------- */
  function promptLabel(it) {
    const isAct = it.t === 'act';
    const name = VIEW_NAMES[S.view];
    if (S.view === 'commande') {
      return isAct ? `${name} — désignation de l’action (repère du préactionneur, ex. KM1) :`
        : `${name} — réceptivité avec la désignation des capteurs (ex. S1, S1.S2, ↑S3) :`;
    }
    if (S.view === 'automate') return isAct ? `${name} — sortie (forme %Q2.x, ex. %Q2.0) :` : `${name} — entrée (forme %I1.x, ex. %I1.0 ; plusieurs : %I1.0 . %I1.2) :`;
    return isAct ? `${name} — action :` : `${name} — évènement :`;
  }
  function editText(id, fresh) {
    const it = find(id || S.sel);
    if (!it) return;
    if (it.locked) { hint('Élément figé : libérez-le (bouton « Libérer ») pour le modifier.'); return; }
    if (it.t === 'step') { editStep(it); return; }
    if (it.t !== 'act' && it.t !== 'trans') return;
    const g = G();
    askText(it, g.tx[S.view][it.id] || '').then((v) => {
      if (v === null) { if (fresh) render(); return; }
      const gg = G();
      if (!gg || !find(it.id)) return;
      mutate(() => { const t = normText(v); if (t) gg.tx[S.view][it.id] = t; else delete gg.tx[S.view][it.id]; });
    });
  }
  // Fenêtre de saisie : touches ↑ ↓ NON ET OU temporisation, aperçu avec la barre du NON et vérification immédiate
  const KEYS = {
    trans: [['↑', '↑ front montant'], ['↓', '↓ front descendant'], ['/', 'NON (barre)'], [' . ', 'ET'], [' + ', 'OU'], ['(', '('], [')', ')'], ['5s/X', 'Temporisation t/Xn'], ['1', '= 1 (toujours vraie)']],
    act: [],
  };
  function askText(it, cur) {
    const dlg = $('#dlg-gftext');
    if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.prompt(promptLabel(it), cur));
    return new Promise((resolve) => {
      const kind = it.t === 'act' ? 'act' : 'trans';
      const input = $('#gft-input'), prev = $('#gft-preview'), keys = $('#gft-keys');
      const st = kind === 'act' ? find(it.step) : null;
      $('#gft-cat').textContent = VIEW_NAMES[S.view];
      $('#gft-title').textContent = kind === 'act' ? `Action de l’étape ${st ? st.n : ''}` : 'Réceptivité de la transition';
      $('#gft-help').textContent = promptLabel(it).replace(VIEW_NAMES[S.view] + ' — ', '').replace(/ :$/, '') +
        (kind === 'trans' ? ' — NON : « / » devant la variable (/a s’affiche avec une barre) ; ET : « . » ; OU : « + ».' : '');
      let ks = KEYS[kind].slice();
      if (S.view === 'automate') ks = [kind === 'act' ? ['%Q2.', '%Q2.'] : ['%I1.', '%I1.'], ...ks];
      keys.innerHTML = ks.map(([ins, lab], i) => `<button type="button" class="btn btn-ghost btn-sm" data-k="${i}">${esc(lab)}</button>`).join('');
      keys.hidden = !ks.length;
      input.value = cur;
      const upd = () => {
        const t = normText(input.value);
        const why = textIssue(t, kind, S.view);
        prev.innerHTML = (t ? `<svg class="gft-svg" height="26" width="100%"><text x="6" y="18" font-size="15" font-family="${FONT}" fill="currentColor">${richSVG(t)}</text></svg>` : '<span class="gft-empty">(vide)</span>') +
          (why ? `<span class="gft-issue">⚠ ${esc(why)}</span>` : '<span class="gft-ok">✓</span>');
      };
      const onKey = (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        const ins = ks[Number(b.dataset.k)][0];
        const a = input.selectionStart == null ? input.value.length : input.selectionStart, z = input.selectionEnd == null ? a : input.selectionEnd;
        input.setRangeText(ins, a, z, 'end');
        if (ins === '5s/X') input.setSelectionRange(a, a + 1);          // le nombre de secondes est sélectionné, prêt à être remplacé
        input.focus(); upd();
      };
      const done = () => {
        keys.removeEventListener('click', onKey); input.removeEventListener('input', upd); dlg.removeEventListener('close', done);
        resolve(dlg.returnValue === 'ok' ? input.value : null);
      };
      keys.addEventListener('click', onKey); input.addEventListener('input', upd); dlg.addEventListener('close', done);
      upd();
      dlg.returnValue = '';
      dlg.showModal();
      input.focus(); input.select();
    });
  }
  function editStep(st) {
    const v = window.prompt('Numéro de l’étape :', String(st.n));
    if (v === null || !String(v).trim()) return;
    const n = Math.round(Number(String(v).trim()));
    if (!Number.isSafeInteger(n) || n < 0) { window.alert('Entrez un nombre entier positif ou nul (0, 1, 2…).'); return; }
    mutate(() => { st.n = n; });
  }
  function deleteSel() {
    const list = selItems().filter((i) => !i.locked);
    if (!list.length) return;
    mutate(() => {
      const g = G();
      const gone = new Set(list.map((i) => i.id));
      for (const it of list) if (it.t === 'step') for (const a of actsOf(it.id)) gone.add(a.id);
      g.items = g.items.filter((i) => !gone.has(i.id) && !(i.t === 'link' && (gone.has(i.a) || gone.has(i.b))));
      for (const w of g.items) if (w.t === 'wire') { if (w.a && gone.has(w.a.id)) delete w.a; if (w.b && gone.has(w.b.id)) delete w.b; }
      for (const v of VIEWS) for (const k of gone) delete g.tx[v][k];
    });
    S.sels = [];
    render(); updateUI();
  }
  // Dupliquer : étapes, transitions, leurs actions, les liaisons entre éléments copiés et les textes des 4 points de vue
  function duplicateSel() {
    const list = selItems();
    if (!list.length) return;
    const g = G();
    const nodes = list.filter((i) => i.t === 'step' || i.t === 'trans');
    for (const w of list.filter((i) => i.t === 'wire')) for (const q of w.pts) { /* largeur prise en compte ci-dessous */ }
    // décalage vers la droite : largeur de la sélection (actions et textes compris) + une marge
    let x0 = Infinity, x1 = -Infinity;
    const withRef = S.ref && S.ref !== S.view;
    for (const it of nodes) {
      x0 = Math.min(x0, it.x - STEP_H);
      if (it.t === 'step') { x1 = Math.max(x1, it.x + STEP_H); for (const b of actBoxes(it, S.view, withRef)) x1 = Math.max(x1, b.x + b.w); }
      else x1 = Math.max(x1, it.x + TR_W + 10 + textW(txt(it.id) || ph('trans'), 12));
    }
    for (const w of list.filter((i) => i.t === 'wire')) for (const q of w.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
    const DX = x1 > x0 ? Math.ceil((x1 - x0 + 60) / GRID) * GRID : 60;
    const map = {}, copies = [];
    mutate(() => {
      let n = nextStepNumber();
      for (const it of nodes.slice().sort((p, q) => p.y - q.y || p.x - q.x)) {        // numérotation de haut en bas
        const c = { ...it, id: uid(), x: it.x + DX };
        delete c.locked;
        if (c.t === 'step') c.n = n++;
        map[it.id] = c.id; copies.push(c);
      }
      const acts = [];
      for (const it of nodes) if (it.t === 'step') for (const a of actsOf(it.id)) acts.push([a, map[it.id]]);
      for (const a of list.filter((i) => i.t === 'act' && !map[i.step])) {          // action seule : copiée dans la même étape
        const last = actsOf(a.step);
        acts.push([{ ...a, ord: last[last.length - 1].ord + 1 }, a.step]);
      }
      for (const [a, stepId] of acts) { const c = { id: uid(), t: 'act', step: stepId, ord: a.ord }; map[a.id] = c.id; copies.push(c); }
      // traits : ceux sélectionnés, et ceux qui relient deux éléments copiés
      const selW = new Set(list.filter((i) => i.t === 'wire').map((i) => i.id));
      for (const w of g.items) {
        if (w.t !== 'wire') continue;
        const both = w.a && w.b && map[w.a.id] && map[w.b.id];
        if (!selW.has(w.id) && !both) continue;
        const c = { ...clone(w), id: uid(), pts: w.pts.map((q) => [q[0] + DX, q[1]]) };
        delete c.locked;
        if (c.a) { if (map[c.a.id]) c.a.id = map[c.a.id]; else delete c.a; }
        if (c.b) { if (map[c.b.id]) c.b.id = map[c.b.id]; else delete c.b; }
        copies.push(c);
      }
      g.items.push(...copies);
      for (const v of VIEWS) for (const k of Object.keys(map)) if (g.tx[v][k]) g.tx[v][map[k]] = g.tx[v][k];
    });
    S.sels = copies.map((c) => c.id);
    render(); updateUI();
  }
  // Figer / libérer la sélection ; un élément figé ne peut plus être déplacé, modifié ni supprimé
  function toggleLock() {
    const list = selItems();
    if (!list.length) return;
    const unlock = list.every((i) => i.locked);
    mutate(() => { for (const it of list) { if (unlock) delete it.locked; else it.locked = true; } });
  }
  function toggleLockMarks() {
    S.lockMarks = !S.lockMarks;
    try { window.localStorage.setItem('ef_gf_locks', S.lockMarks ? '1' : '0'); } catch (e) { /* ignoré */ }
    renderOverlay(); updateUI();
  }
  function copyFromRef() {
    if (!S.ref || S.ref === S.view) return;
    const g = G();
    let n = 0;
    mutate(() => {
      for (const it of g.items) {
        if (it.t !== 'act' && it.t !== 'trans') continue;
        const src = g.tx[S.ref][it.id];
        if (src && !g.tx[S.view][it.id]) { g.tx[S.view][it.id] = src; n++; }
      }
    });
    hint(n ? `${n} texte${n > 1 ? 's' : ''} recopié${n > 1 ? 's' : ''} depuis le ${VIEW_NAMES[S.ref]}.` : 'Aucune case vide à remplir.');
  }

  /* ---------- Souris / toucher ---------- */
  function onDown(e) {
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ } }
    S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()];
      S.drag = null;
      S.gesture = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (S.pointers.size > 2) return;
    const p = toWorld(e);
    const pan = () => { S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.cam.x, vy: S.cam.y }; };
    if (e.button === 1 || e.button === 2) { pan(); return; }
    if (S.sim) { if (!simDown(p)) pan(); return; }
    const h = hit(p);
    switch (S.tool) {
      case 'select': {
        const now = Date.now(), last = S.lastDown;
        S.lastDown = { t: now, x: e.clientX, y: e.clientY, id: h ? h.id : null };
        if (h && last && last.id === h.id && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10) {
          S.lastDown = null; S.sel = h.id; S.drag = null;
          render(); updateUI();
          setTimeout(() => editText(h.id), 0);
          return;
        }
        const additive = e.shiftKey || e.ctrlKey || e.metaKey || S.multi;
        if (h) {
          let click = null;
          if (additive) { if (S.sels.includes(h.id)) click = 'toggle'; else S.sels = [...S.sels, h.id]; }
          else if (!S.sels.includes(h.id)) S.sels = [h.id];
          else if (S.sels.length > 1) click = 'collapse';
          // les étapes, transitions et traits sélectionnés bougent ensemble ; les traits accrochés suivent
          const moving = selItems().filter((i) => i.t === 'step' || i.t === 'trans' || i.t === 'wire');
          if ((h.t === 'step' || h.t === 'trans' || h.t === 'wire') && S.sels.includes(h.id)) {
            if (moving.some((n) => n.locked)) hint('Un élément figé est sélectionné : libérez-le pour le déplacer.');
            else S.drag = { mode: 'move', p0: p, orig: moving.map((n) => (n.t === 'wire' ? [n.id, n.pts.map((q) => q.slice())] : [n.id, n.x, n.y])), before: snap(), moved: false, cx: e.clientX, cy: e.clientY, hitId: h.id, click };
          } else if (click === 'toggle') S.sels = S.sels.filter((x) => x !== h.id);
        } else if (additive) {
          S.drag = { mode: 'marquee', a: p, cur: p, add: true };
        } else { S.sels = []; pan(); }
        render(); updateUI();
        break;
      }
      case 'step': case 'init': case 'trans':
        addNode(S.tool, p);
        break;
      case 'act': {
        const st = h && (h.t === 'step' ? h : h.t === 'act' ? find(h.step) : null);
        if (st && st.locked) hint('Étape figée : libérez-la pour lui ajouter une action.');
        else if (st) addAction(st); else hint('Action : touchez une étape pour lui ajouter une action.');
        break;
      }
      case 'wire': {
        const now = Date.now(), last = S.lastDown;
        S.lastDown = { t: now, x: e.clientX, y: e.clientY, id: 'wire' };
        if (S.wdraft && last && last.id === 'wire' && now - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) { finishWire(); break; }
        wireDown(p);
        break;
      }
      case 'arrow':
        arrowDown(p);
        break;
    }
  }
  function onMove(e) {
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.gesture && S.pointers.size >= 2) {
      const [a, b] = [...S.pointers.values()];
      const r = svg.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      S.cam.x += cx - S.gesture.cx; S.cam.y += cy - S.gesture.cy;
      zoomAt(cx - r.left, cy - r.top, d / S.gesture.d);
      S.gesture = { d, cx, cy };
      return;
    }
    const d = S.drag;
    if (!d) { if (S.tool === 'wire') { S.cursor = toWorld(e); renderOverlay(); } return; }
    if (d.mode === 'pan') { S.cam.x = d.vx + (e.clientX - d.cx); S.cam.y = d.vy + (e.clientY - d.cy); applyCam(); return; }
    const p = toWorld(e);
    if (d.mode === 'move') {
      if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3) return;
      d.moved = true;
      const dx = snapV(p.x - d.p0.x), dy = snapV(p.y - d.p0.y);
      const movedIds = new Set(d.orig.map((o) => o[0]));
      for (const o of d.orig) {
        const it = find(o[0]);
        if (!it) continue;
        if (it.t === 'wire') {
          it.pts = o[1].map((q) => [q[0] + dx, q[1] + dy]);
          // extrémité accrochée à un élément qui ne bouge pas : elle se détache
          for (const k of ['a', 'b']) if (it[k] && !movedIds.has(it[k].id)) delete it[k];
        } else { it.x = o[1] + dx; it.y = o[2] + dy; }
      }
      syncWires(new Set(d.orig.filter((o) => find(o[0]) && find(o[0]).t === 'wire').map((o) => o[0])));
      sceneG.innerHTML = sceneSVG(); renderOverlay();
      return;
    }
    if (d.mode === 'marquee') { d.cur = p; renderOverlay(); }
  }
  function onUp(e) {
    S.pointers.delete(e.pointerId);
    if (S.gesture) { if (S.pointers.size < 2) S.gesture = null; return; }
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    if (d.mode === 'move') {
      syncWires();
      if (snap() !== d.before) { pushUndo(d.before); save(); }
      else if (d.click === 'collapse') S.sels = [d.hitId];          // simple clic dans une sélection : on ne garde que l'élément touché
      else if (d.click === 'toggle') S.sels = S.sels.filter((x) => x !== d.hitId);
      render(); updateUI();
      return;
    }
    if (d.mode === 'marquee') {
      const p = toWorld(e);
      const x0 = Math.min(d.a.x, p.x), x1 = Math.max(d.a.x, p.x), y0 = Math.min(d.a.y, p.y), y1 = Math.max(d.a.y, p.y);
      const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const inside = items().filter((i) => ((i.t === 'step' || i.t === 'trans') && inBox(i.x, i.y)) || (i.t === 'wire' && i.pts.every((q) => inBox(q[0], q[1])))).map((i) => i.id);
      S.sels = [...new Set([...S.sels, ...inside])];
      render(); updateUI();
      return;
    }
  }
  function onCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.gesture = null;
    if (S.drag && S.drag.mode === 'move') restore(S.drag.before);
    if (S.drag && S.drag.mode === 'marquee') renderOverlay();
    S.drag = null;
  }
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('dblclick', () => { if (S.tool === 'wire' && S.wdraft) finishWire(); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  // le panneau « ! » touché affiche sa raison dans la ligne d'aide
  svg.addEventListener('click', (e) => {
    const w = e.target.closest && e.target.closest('[data-warn]');
    if (w) { const it = find(w.dataset.warn); if (it) hint('⚠ ' + textIssue(txt(it.id), it.t, S.view) + ' — touchez deux fois l’élément pour corriger son texte.'); }
    const r = e.target.closest && e.target.closest('[data-sissue]');
    if (r) { const q = structIssues()[Number(r.dataset.sissue)]; if (q) hint('● ' + q.why); }
  });

  /* ---------- Clavier ---------- */
  document.addEventListener('keydown', (e) => {
    if (root.hidden || root.dataset.schMode !== 'grafcet') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (S.sim) { if (e.key === 'Escape') stopSim(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sels = items().filter((i) => i.t !== 'link' && i.t !== 'act').map((i) => i.id); render(); updateUI(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (!mod && (e.key === 'l' || e.key === 'L')) { toggleLock(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sels.length) { e.preventDefault(); deleteSel(); } return; }
    if (e.key === 'Enter' && S.sel) { e.preventDefault(); editText(S.sel); return; }
    if (e.key === 'Escape' && S.wdraft) { finishWire(); return; }
    if (e.key === 'Escape') { if (S.drag) S.drag = null; else if (S.sels.length) S.sels = []; else setTool('select'); render(); updateUI(); }
  });

  /* ---------- Interface ---------- */
  const HINTS = {
    multi: 'Sélection multiple : touchez les éléments pour les ajouter ou les retirer ; glissez sur le fond pour tracer un rectangle de sélection. Déplacement de la vue : deux doigts, clic droit ou molette.',
    select: 'Sélection : touchez un élément pour le choisir (Maj+clic : plusieurs), faites glisser un élément pour le déplacer (les traits accrochés suivent). « Ordonner » range les étapes sélectionnées en colonne, à l’écart réglé. Double appui (ou Entrée) : modifier le texte, ou le numéro d’une étape. Glisser le fond déplace la vue ; molette ou pincement pour zoomer.',
    init: 'Étape initiale : touchez le plan pour la poser.',
    step: 'Étape : touchez le plan pour la poser (numérotée automatiquement). Reliez ensuite avec l’outil Trait.',
    trans: 'Transition : touchez le plan pour la poser. Reliez-la ensuite avec l’outil Trait.',
    act: 'Action : touchez une étape pour lui ajouter une action (plusieurs possibles).',
    wire: 'Trait : touchez le départ (il s’accroche au haut ou au bas d’une étape, au centre d’une transition, ou à un autre trait), puis chaque coude. Le trait se termine sur un élément ou un trait, par un double appui ou Échap. Les segments sont toujours horizontaux ou verticaux. « Trait double » pour les ET.',
    sim: 'Simulation : le jeton rouge marque les étapes actives, les actions en cours sont en vert. Touchez une transition validée (en vert) pour la franchir quand sa réceptivité devient vraie. Touchez une étape pour l’activer ou la désactiver à la main. Échap ou « Arrêter » pour revenir au dessin.',
    arrow: 'Flèche : touchez un trait pour y poser une flèche dans le sens du tracé ; touchez la flèche pour l’inverser, encore une fois pour la retirer.',
  };
  let hintTimer = null;
  function hint(msg) {
    const h = $('#gf-hint');
    h.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(updateUI, 5000);
  }
  function setTool(t) { if (S.sim) stopSim(true); if (S.wdraft) finishWire(); S.tool = t; S.drag = null; renderOverlay(); updateUI(); }
  function updateUI() {
    document.querySelectorAll('[data-gtool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gtool === S.tool)));
    document.querySelectorAll('[data-gv-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.gvTab === S.view)));
    const it = S.sel ? find(S.sel) : null;
    const list = selItems();
    const nl = list.filter((i) => i.t !== 'link');
    $('#gf-undo').disabled = !S.undo.length;
    $('#gf-redo').disabled = !S.redo.length;
    $('#gf-delete').disabled = !list.some((i) => !i.locked);
    $('#gf-edit').disabled = !it || it.t === 'link' || !!it.locked;
    $('#gf-dup').disabled = !nl.length;
    $('#gf-lock').disabled = !nl.length;
    $('#gf-lock').textContent = nl.length && nl.every((i) => i.locked) ? 'Libérer' : 'Figer';
    $('#gf-lockmarks').textContent = S.lockMarks ? 'Masquer les cadenas' : 'Afficher les cadenas';
    $('#gf-lockmarks').setAttribute('aria-pressed', String(!S.lockMarks));
    $('#gf-multi').setAttribute('aria-pressed', String(S.multi && S.tool === 'select'));
    $('#gf-gap-val').textContent = String(gap());
    $('#gf-order').disabled = list.filter((i) => i.t === 'step').length < 1 || list.length < 2;
    const sw = list.filter((i) => i.t === 'wire');
    $('#gf-dbl').setAttribute('aria-pressed', String(sw.length ? sw.every((w) => w.dbl) : !!S.wireDbl));
    $('#gf-gap-m').disabled = gap() <= GAP_MIN;
    $('#gf-gap-p').disabled = gap() >= GAP_MAX;
    $('#gf-selcount').textContent = list.length > 1 ? list.length + ' éléments sélectionnés' : '';
    $('#gf-edit').textContent = it && it.t === 'step' ? 'Modifier le numéro' : 'Modifier le texte';
    $('#gf-ref').value = S.ref;
    $('#gf-ref-op').value = String(Math.round(S.refOp * 100));
    $('#gf-ref-op').disabled = !S.ref;
    $('#gf-copy').disabled = !S.ref || S.ref === S.view;
    $('#gf-snap').checked = S.snap;
    $('#gf-check').setAttribute('aria-pressed', String(S.check));
    $('#gf-sim').setAttribute('aria-pressed', String(!!S.sim));
    $('#gf-sim').textContent = S.sim ? 'Arrêter la simulation' : 'Simuler';
    $('#gf-sim-reset').hidden = !S.sim;
    let h = (S.tool === 'select' && S.multi ? HINTS.multi : HINTS[S.tool]) || '';
    if (S.sim) h = `${S.sim.n} transition${S.sim.n > 1 ? 's' : ''} franchie${S.sim.n > 1 ? 's' : ''}. ` + HINTS.sim;
    else {
      if (S.check) {
        const m = structIssues().length;
        if (m) h = `● ${m} erreur${m > 1 ? 's' : ''} de structure (rond rouge : touchez-le pour lire la règle). ` + h;
      }
      const n = textTargets().filter((t) => textIssue(txt(t.id), t.kind, S.view)).length;
      if (n) h = `⚠ ${n} élément${n > 1 ? 's' : ''} à compléter ou à corriger (panneau « ! »). ` + h;
    }
    if (S.ref === S.view) h = 'Le calque choisi est le point de vue affiché : choisissez-en un autre pour le voir en transparence. ' + h;
    $('#gf-hint').textContent = h;
    svg.style.cursor = S.sim ? 'pointer' : S.tool === 'select' ? 'default' : 'crosshair';
  }
  function setView(v) {
    if (!VIEWS.includes(v)) return;
    S.view = v;
    try { window.localStorage.setItem('ef_gv', v); } catch (e) { /* ignoré */ }
    render(); updateUI();
  }
  function saveRef() { try { window.localStorage.setItem('ef_gf_ref', JSON.stringify({ ref: S.ref, op: S.refOp })); } catch (e) { /* ignoré */ } }

  /* ---------- Exports ---------- */
  function exportString() {
    const bb = bbox() || { x: 0, y: 0, w: 300, h: 200 };
    const m = 30, x = Math.floor(bb.x - m), y = Math.floor(bb.y - m), w = Math.ceil(bb.w + 2 * m), h = Math.ceil(bb.h + 2 * m);
    return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${sceneSVG({ export: true })}</svg>` };
  }
  function fileName() {
    const api = API(), s = api && api.schema();
    const base = (s ? s.name : 'grafcet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'grafcet';
    return base + '_grafcet_' + S.view;
  }
  function download(blob, name) {
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSVG() { download(new Blob([exportString().svg], { type: 'image/svg+xml' }), fileName() + '.svg'); }
  function exportPNG() {
    const { w, h, svg: str } = exportString();
    const sc = Math.min(2, 4000 / Math.max(w, h));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && download(b, fileName() + '.png'), 'image/png');
    };
    img.onerror = () => window.alert('Export PNG impossible. Utilisez l’export SVG.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }

  /* ---------- Branchements ---------- */
  document.querySelectorAll('[data-gv-tab]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.gvTab)));
  document.querySelectorAll('[data-gtool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.gtool)));
  $('#gf-undo').addEventListener('click', doUndo);
  $('#gf-redo').addEventListener('click', doRedo);
  $('#gf-zoom-in').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.25));
  $('#gf-zoom-out').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 0.8));
  $('#gf-fit').addEventListener('click', fit);
  $('#gf-edit').addEventListener('click', () => editText());
  $('#gf-delete').addEventListener('click', deleteSel);
  $('#gf-png').addEventListener('click', exportPNG);
  $('#gf-svgfile').addEventListener('click', exportSVG);
  $('#gf-snap').addEventListener('change', (e) => { S.snap = e.target.checked; });
  $('#gf-ref').addEventListener('change', (e) => { S.ref = e.target.value; saveRef(); render(); updateUI(); });
  $('#gf-ref-op').addEventListener('input', (e) => { S.refOp = Number(e.target.value) / 100; saveRef(); render(); });
  $('#gf-copy').addEventListener('click', copyFromRef);
  $('#gf-multi').addEventListener('click', () => {
    if (S.tool !== 'select') { S.multi = true; setTool('select'); }
    else { S.multi = !S.multi; updateUI(); }
  });
  $('#gf-dup').addEventListener('click', duplicateSel);
  $('#gf-lock').addEventListener('click', toggleLock);
  $('#gf-lockmarks').addEventListener('click', toggleLockMarks);
  $('#gf-gap-m').addEventListener('click', () => changeGap(-1));
  $('#gf-order').addEventListener('click', orderSel);
  $('#gf-dbl').addEventListener('click', () => {
    const ws = selItems().filter((i) => i.t === 'wire' && !i.locked);
    if (ws.length) { const on = !ws.every((w) => w.dbl); S.wireDbl = on; mutate(() => { for (const w of ws) { if (on) w.dbl = true; else delete w.dbl; } }); return; }
    S.wireDbl = !S.wireDbl; updateUI();
  });
  $('#gf-gap-p').addEventListener('click', () => changeGap(1));
  { const c = $('#gft-cancel'); if (c) c.addEventListener('click', () => $('#dlg-gftext').close('cancel')); }
  $('#gf-check').addEventListener('click', () => {
    S.check = !S.check;
    try { window.localStorage.setItem('ef_gf_check', S.check ? '1' : '0'); } catch (e) { /* ignoré */ }
    renderOverlay(); updateUI();
  });
  $('#gf-sim').addEventListener('click', () => (S.sim ? stopSim() : startSim()));
  $('#gf-sim-reset').addEventListener('click', () => startSim());
  $('#gf-tpl').addEventListener('change', (e) => { const v = e.target.value; e.target.value = ''; if (v) insertTemplate(v); });

  // Changement de projet : nouveau Grafcet, historique vidé, vue ajustée
  function onSchema() {
    const api = API(), s = api && api.schema();
    const id = s ? s.id : null;
    if (id !== S.schemaId) {
      S.schemaId = id; S.sels = []; S.drag = null; S.undo = []; S.redo = []; S.sim = null;
      const fixed = repairOverlaps();
      const conv = migrateLinks();
      if (conv) { save(); setTimeout(() => hint(`${conv} liaison${conv > 1 ? 's' : ''} transformée${conv > 1 ? 's' : ''} en traits : vous pouvez maintenant les modifier librement.`), 60); }
      if (fixed) { save(); setTimeout(() => hint(`${fixed} élément${fixed > 1 ? 's' : ''} superposé${fixed > 1 ? 's' : ''} (anciennes versions) écarté${fixed > 1 ? 's' : ''} sur le côté : supprimez ceux en trop.`), 50); }
      if (root.dataset.schMode === 'grafcet') requestAnimationFrame(() => { render(); fit(); updateUI(); });
      else { S.needFit = true; render(); updateUI(); }
    } else { render(); updateUI(); }
  }
  function onVisible() {
    if (root.hidden || root.dataset.schMode !== 'grafcet') return;
    requestAnimationFrame(() => {
      render();
      if (S.needFit) { S.needFit = false; fit(); }
      updateUI();
    });
  }
  document.addEventListener('sch:schema', onSchema);
  document.addEventListener('sch:mode', onVisible);
  document.addEventListener('sch:shown', onVisible);
  S.needFit = true;
  updateUI();

  window.GrafcetEditor = { clean, _state: S, _G: () => G(), _issue: designationIssue, _textIssue: textIssue, _render: render, _topo: () => topo(), _struct: () => structIssues(), _not: notParts };
})();
