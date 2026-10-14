/* ============================================================
   Éditeur de Grafcet (Schémas > Grafcet)
   - Un seul cycle par projet (schema.grafcet) : étapes, transitions, actions et liaisons sont
     communs aux quatre points de vue. Seuls les textes changent d'un point de vue à l'autre.
   - Données : schema.grafcet = {
       items: [ {id,t:'step',x,y,n,init?}, {id,t:'trans',x,y}, {id,t:'act',step,ord}, {id,t:'link',a,b} ],
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
  };
  // S.sel = l'élément sélectionné quand il est seul (sinon null)
  Object.defineProperty(S, 'sel', {
    get() { return S.sels.length === 1 ? S.sels[0] : null; },
    set(v) { S.sels = v ? [v] : []; },
  });
  try {
    if (window.localStorage.getItem('ef_gf_locks') === '0') S.lockMarks = false;
    const v = window.localStorage.getItem('ef_gv');
    if (VIEWS.includes(v)) S.view = v;
    const r = JSON.parse(window.localStorage.getItem('ef_gf_ref') || 'null');
    if (r && (r.ref === '' || VIEWS.includes(r.ref))) { S.ref = r.ref; if (num(r.op)) S.refOp = r.op; }
  } catch (e) { /* ignoré */ }

  /* ---------- Données ---------- */
  function emptyG() { return { items: [], tx: { systeme: {}, operative: {}, commande: {}, automate: {} } }; }
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
      if (it.t === 'link' && ids.has(it.a) && ids.has(it.b)) g.items.push({ id: it.id, t: 'link', a: it.a, b: it.b });
    }
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
    const before = snap();
    fn();
    relayout();
    if (snap() === before) { render(); updateUI(); return; }
    pushUndo(before);
    save(); render(); updateUI();
  }
  function restore(json) {
    const api = API(), s = api && api.schema();
    if (!s) return;
    s.grafcet = JSON.parse(json);
    S.sels = S.sels.filter((id) => find(id));
    save(); render(); updateUI();
  }
  function doUndo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); }
  function doRedo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); }

  /* ---------- Disposition : l'écart vertical entre deux étapes est toujours le même ----------
     Chaque élément reçoit un rang (plus long chemin depuis le début du cycle, sans compter les reprises
     de séquence) ; sa hauteur vaut : hauteur du début + rang × (écart / 2). Étapes et transitions alternent,
     donc deux étapes qui se suivent sont toujours séparées d'un écart. Seule la position horizontale est libre. */
  function relayout() {
    const g = G();
    if (!g) return;
    const nodes = g.items.filter((i) => i.t === 'step' || i.t === 'trans');
    if (!nodes.length) return;
    const byId = {};
    for (const n of nodes) byId[n.id] = n;
    const links = g.items.filter((l) => l.t === 'link' && byId[l.a] && byId[l.b]);
    const out = {}, inc = {};
    for (const n of nodes) { out[n.id] = []; inc[n.id] = 0; }
    for (const l of links) { out[l.a].push(l); inc[l.b]++; }
    // ordre de départ : étapes initiales, puis éléments sans prédécesseur, puis les autres (de haut en bas)
    const byY = (a, b) => a.y - b.y || a.x - b.x;
    const order = [
      ...nodes.filter((n) => n.t === 'step' && n.init).sort(byY),
      ...nodes.filter((n) => !inc[n.id]).sort(byY),
      ...nodes.slice().sort(byY),
    ];
    // parcours en profondeur : une liaison vers un élément « en cours » est une reprise de séquence
    const state = {}, back = new Set();
    for (const r of order) {
      if (state[r.id]) continue;
      const stack = [[r.id, 0]];
      state[r.id] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const ls = out[top[0]].slice().sort((a, b) => byY(byId[a.b], byId[b.b]));
        if (top[1] < ls.length) {
          const l = ls[top[1]++];
          if (state[l.b] === 1) back.add(l.id);
          else if (!state[l.b]) { state[l.b] = 1; stack.push([l.b, 0]); }
        } else { state[top[0]] = 2; stack.pop(); }
      }
    }
    const fwd = links.filter((l) => !back.has(l.id));
    // rang = plus long chemin (ordre topologique)
    const indeg = {}, rank = {};
    for (const n of nodes) { indeg[n.id] = 0; rank[n.id] = 0; }
    for (const l of fwd) indeg[l.b]++;
    const queue = nodes.filter((n) => !indeg[n.id]).map((n) => n.id);
    const fout = {};
    for (const l of fwd) (fout[l.a] = fout[l.a] || []).push(l.b);
    while (queue.length) {
      const id = queue.shift();
      for (const b of fout[id] || []) { rank[b] = Math.max(rank[b], rank[id] + 1); if (--indeg[b] === 0) queue.push(b); }
    }
    // groupes reliés : chacun garde la hauteur de son élément de départ
    const parent = {};
    const findP = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const n of nodes) parent[n.id] = n.id;
    for (const l of fwd) parent[findP(l.a)] = findP(l.b);
    const anchor = {};
    for (const r of order) {
      const c = findP(r.id);
      if (anchor[c] === undefined && rank[r.id] === 0) anchor[c] = r.y;
    }
    const half = gap() / 2;
    for (const n of nodes) {
      const c = findP(n.id);
      if (anchor[c] === undefined) continue;
      n.y = rnd(anchor[c] + rank[n.id] * half);
    }
  }
  function changeGap(dir) {
    const g = G();
    if (!g) return;
    const v = Math.max(GAP_MIN, Math.min(GAP_MAX, gap() + 10 * dir));
    if (v === gap()) return;
    mutate(() => { g.gap = v; });
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
      found++;
      if (!L.first.has(m[1]) || (m[2] && !L.second.has(m[2]))) bad.push(m[0]);
    }
    if (!found) return 'Attribution manquante';
    if (bad.length) return 'Désignation inconnue : ' + bad.join(', ');
    return null;
  }

  /* ---------- Géométrie ---------- */
  const snapV = (v) => (S.snap ? Math.round(v / GRID) * GRID : rnd(v));
  const actsOf = (stepId) => items().filter((i) => i.t === 'act' && i.step === stepId).sort((a, b) => a.ord - b.ord);
  const textW = (t, size) => String(t).length * size * 0.58;
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
    const isUp = (l) => portTop(byId[l.b]).y <= portBot(byId[l.a]).y + 4;
    for (const l of links) {
      const a = byId[l.a], b = byId[l.b];
      const p0 = portBot(a), p1 = portTop(b);
      const div = outs[l.a].length > 1, conv = ins[l.b].length > 1;
      // barre double (ET) : on part du trait du bas, on arrive sur le trait du haut
      const dA = div && a.t === 'trans' ? 3 : 0, dB = conv && b.t === 'trans' ? 3 : 0;
      if (isUp(l)) {                                  // reprise de séquence : par la gauche, flèche vers le haut
        const L = Math.min(a.x, b.x) - 60;
        const y0 = p0.y + (div ? barGap(a, 'div') + dA : 12), y1 = p1.y - (conv ? barGap(b, 'conv') + dB : 12);
        paths[l.id] = { pts: [[p0.x, p0.y], [p0.x, y0], [L, y0], [L, y1], [p1.x, y1], [p1.x, p1.y]], up: true };
        continue;
      }
      const ya = p0.y + barGap(a, 'div') + dA, yb = p1.y - barGap(b, 'conv') - dB;
      const col = div ? b.x : (conv ? a.x : b.x);
      const s0 = div ? [col, ya] : [p0.x, p0.y];
      const s1 = conv ? [col, yb] : [p1.x, p1.y];
      let pts;
      if (s0[0] === s1[0]) pts = [s0, s1];
      else { const m = rnd((s0[1] + s1[1]) / 2); pts = [s0, [s0[0], m], [s1[0], m], s1]; }
      paths[l.id] = { pts };
    }
    // barres de divergence (sous la source) et de convergence (au-dessus de la cible)
    for (const id of Object.keys(outs)) {
      const ls = outs[id];
      if (ls.length < 2) continue;
      const a = byId[id], y = portBot(a).y + barGap(a, 'div');
      const xs = [a.x, ...ls.filter((l) => !isUp(l)).map((l) => byId[l.b].x), ...ls.filter(isUp).map(() => a.x)];
      const dbl = a.t === 'trans';
      bars.push({ x0: Math.min(...xs), x1: Math.max(...xs), y, double: dbl, stem: [a.x, portBot(a).y, dbl ? y - 3 : y] });
    }
    for (const id of Object.keys(ins)) {
      const ls = ins[id];
      if (ls.length < 2) continue;
      const b = byId[id], y = portTop(b).y - barGap(b, 'conv');
      const xs = [b.x, ...ls.filter((l) => !isUp(l)).map((l) => byId[l.a].x)];
      const dbl = b.t === 'trans';
      bars.push({ x0: Math.min(...xs), x1: Math.max(...xs), y, double: dbl, stem: [b.x, dbl ? y + 3 : y, portTop(b).y] });
    }
    return { paths, bars };
  }

  /* ---------- Dessin ---------- */
  function sceneSVG(opts) {
    const o = opts || {};
    const view = o.view || S.view;
    const withRef = !o.export && S.ref && S.ref !== view;
    const list = items();
    let s = '';
    const { paths, bars } = linkGeometry();
    if (!o.export) S.paths = paths;
    // liaisons
    for (const id of Object.keys(paths)) {
      const p = paths[id];
      s += `<polyline points="${p.pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="miter"/>`;
      if (p.up) {                                     // flèche au milieu du segment montant
        const [x, y0] = p.pts[2], y1 = p.pts[3][1], ym = (y0 + y1) / 2;
        s += `<path d="M${x - 5} ${ym + 4} L${x} ${ym - 4} L${x + 5} ${ym + 4} Z" fill="${INK}"/>`;
      }
    }
    for (const b of bars) {
      s += `<line x1="${b.stem[0]}" y1="${b.stem[1]}" x2="${b.stem[0]}" y2="${b.stem[2]}" stroke="${INK}" stroke-width="1.6"/>`;
      if (b.double) {
        s += `<line x1="${b.x0 - 10}" y1="${b.y - 3}" x2="${b.x1 + 10}" y2="${b.y - 3}" stroke="${INK}" stroke-width="1.4"/>` +
          `<line x1="${b.x0 - 10}" y1="${b.y + 3}" x2="${b.x1 + 10}" y2="${b.y + 3}" stroke="${INK}" stroke-width="1.4"/>`;
      } else s += `<line x1="${b.x0}" y1="${b.y}" x2="${b.x1}" y2="${b.y}" stroke="${INK}" stroke-width="1.6"/>`;
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
        if (b.main) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(ty)}" font-size="12" text-anchor="middle" font-family="${FONT}" fill="${INK}">${esc(b.main)}</text>`;
        else if (!o.export && !withRef) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(ty)}" font-size="11" font-style="italic" text-anchor="middle" font-family="${FONT}" fill="#9aa1ac">${esc(ph('act', view))}</text>`;
        if (withRef && b.ref) s += `<text x="${rnd(b.x + b.w / 2)}" y="${rnd(b.y + b.h - 8)}" font-size="11" font-style="italic" text-anchor="middle" font-family="${FONT}" fill="#5a6b86" opacity="${S.refOp}">${esc(b.ref)}</text>`;
      }
    }
    // transitions et réceptivités
    for (const tr of list.filter((i) => i.t === 'trans')) {
      s += `<line x1="${tr.x - TR_W}" y1="${tr.y}" x2="${tr.x + TR_W}" y2="${tr.y}" stroke="${INK}" stroke-width="3"/>`;
      const main = txt(tr.id, view), ref = withRef ? txt(tr.id, S.ref) : '';
      if (main) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 4.5}" font-size="12" font-family="${FONT}" fill="${INK}">${esc(main)}</text>`;
      else if (!o.export) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 4.5}" font-size="11" font-style="italic" font-family="${FONT}" fill="#9aa1ac">${esc(ph('trans', view))}</text>`;
      if (ref) s += `<text x="${tr.x + TR_W + 8}" y="${tr.y + 18}" font-size="11" font-style="italic" font-family="${FONT}" fill="#5a6b86" opacity="${S.refOp}">${esc(ref)}</text>`;
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
      } else if (it.t === 'link' && S.paths[it.id]) {
        o += `<polyline points="${S.paths[it.id].pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${SEL}" stroke-opacity="0.45" stroke-width="7" stroke-linejoin="round"/>`;
      }
    }
    // cadenas : un tiers de l'élément figé, sans dépasser sa largeur visible
    if (S.lockMarks) for (const it of items()) if (it.locked) o += lockSVG(it);
    // rectangle de sélection
    const d = S.drag;
    if (d && d.mode === 'marquee' && d.cur) {
      o += `<rect x="${Math.min(d.a.x, d.cur.x)}" y="${Math.min(d.a.y, d.cur.y)}" width="${Math.abs(d.cur.x - d.a.x)}" height="${Math.abs(d.cur.y - d.a.y)}" fill="${SEL}" fill-opacity="0.08" ${dash.replace('fill="none" ', '')}/>`;
    }
    // liaison en cours de tracé
    if (d && d.mode === 'link' && d.cur) {
      const a = find(d.a);
      if (a) o += `<line x1="${a.x}" y1="${a.y}" x2="${d.cur.x}" y2="${d.cur.y}" stroke="${SEL}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
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
    for (const id of Object.keys(S.paths)) {
      const pts = S.paths[id].pts;
      for (let i = 0; i < pts.length - 1; i++) if (distSeg(p, pts[i], pts[i + 1]) <= 4 + tol) return find(id);
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
      }
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
  const linkExists = (a, b) => items().some((l) => l.t === 'link' && l.a === a && l.b === b);
  const outCount = (id) => items().filter((l) => l.t === 'link' && l.a === id).length;
  const inCount = (id) => items().filter((l) => l.t === 'link' && l.b === id).length;
  // Trait bien vertical : l'élément du dessous se cale sous celui du dessus (sauf divergence / convergence)
  function alignBelow(a, b) {
    if (b.y > a.y && outCount(a.id) <= 1 && inCount(b.id) <= 1) {
      const dx = a.x - b.x;
      b.x = a.x;
      return dx;
    }
    return 0;
  }
  // Relie a -> b ; deux étapes (ou deux transitions) reçoivent automatiquement l'élément intermédiaire
  function connect(a, b) {
    if (!a || !b || a.id === b.id) return false;
    if (a.t === b.t) {
      const down = b.y > a.y;
      const mid = down
        ? { x: a.x, y: snapV((a.y + b.y) / 2) }
        : { x: a.x, y: snapV(a.y + STEP_H + 30) };
      const m = a.t === 'step' ? { id: uid(), t: 'trans', x: mid.x, y: mid.y } : { id: uid(), t: 'step', x: mid.x, y: mid.y, n: nextStepNumber() };
      items().push(m);
      items().push({ id: uid(), t: 'link', a: a.id, b: m.id });
      items().push({ id: uid(), t: 'link', a: m.id, b: b.id });
      alignBelow(m, b);
      return true;
    }
    if (linkExists(a.id, b.id)) return false;
    items().push({ id: uid(), t: 'link', a: a.id, b: b.id });
    alignBelow(a, b);
    return true;
  }
  function validPair(a, b) {
    return a && b && a.id !== b.id && ((a.t === 'step' && b.t === 'trans') || (a.t === 'trans' && b.t === 'step'));
  }
  function addNode(kind, p) {
    const q = { x: snapV(p.x), y: snapV(p.y) };
    const prev = S.sel ? find(S.sel) : null;
    let it;
    mutate(() => {
      if (kind === 'trans') it = { id: uid(), t: 'trans', x: q.x, y: q.y };
      else {
        const hasInit = items().some((i) => i.t === 'step' && i.init);
        const init = kind === 'init';
        it = { id: uid(), t: 'step', x: q.x, y: q.y, n: init && !hasInit ? 0 : nextStepNumber(), ...(init ? { init: true } : {}) };
      }
      items().push(it);
      // enchaînement automatique : l'élément sélectionné juste au-dessus est relié au nouveau
      if (prev && validPair(prev, it) && prev.y < it.y && !linkExists(prev.id, it.id)) connect(prev, it);
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
    const v = window.prompt(promptLabel(it), g.tx[S.view][it.id] || '');
    if (v === null) { if (fresh) render(); return; }
    mutate(() => { const t = v.trim().slice(0, 120); if (t) g.tx[S.view][it.id] = t; else delete g.tx[S.view][it.id]; });
  }
  function editStep(st) {
    const v = window.prompt('Numéro de l’étape :', String(st.n));
    if (v === null) return;
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
    // décalage vers la droite : largeur de la sélection (actions et textes compris) + une marge
    let x0 = Infinity, x1 = -Infinity;
    const withRef = S.ref && S.ref !== S.view;
    for (const it of nodes) {
      x0 = Math.min(x0, it.x - STEP_H);
      if (it.t === 'step') { x1 = Math.max(x1, it.x + STEP_H); for (const b of actBoxes(it, S.view, withRef)) x1 = Math.max(x1, b.x + b.w); }
      else x1 = Math.max(x1, it.x + TR_W + 10 + textW(txt(it.id) || ph('trans'), 12));
    }
    const DX = nodes.length ? Math.ceil((x1 - x0 + 60) / GRID) * GRID : 0;
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
      for (const l of g.items) if (l.t === 'link' && map[l.a] && map[l.b]) copies.push({ id: uid(), t: 'link', a: map[l.a], b: map[l.b] });
      g.items.push(...copies);
      for (const v of VIEWS) for (const k of Object.keys(map)) if (g.tx[v][k]) g.tx[v][map[k]] = g.tx[v][k];
    });
    S.sels = copies.filter((c) => c.t !== 'link').map((c) => c.id);
    render(); updateUI();
  }
  // Figer / libérer la sélection ; un élément figé ne peut plus être déplacé, modifié ni supprimé
  function toggleLock() {
    const list = selItems().filter((i) => i.t !== 'link');
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
          if (additive) S.sels = S.sels.includes(h.id) ? S.sels.filter((x) => x !== h.id) : [...S.sels, h.id];
          else if (!S.sels.includes(h.id)) S.sels = [h.id];
          // déplacement : toutes les étapes et transitions sélectionnées (non figées) bougent ensemble
          const nodes = selItems().filter((i) => (i.t === 'step' || i.t === 'trans') && !i.locked);
          if (S.sels.includes(h.id) && (h.t === 'step' || h.t === 'trans') && !h.locked) {
            S.drag = { mode: 'move', p0: p, orig: nodes.map((n) => [n.id, n.x, n.y]), before: snap(), moved: false, cx: e.clientX, cy: e.clientY, hitId: h.id, collapse: !additive && S.sels.length > 1 };
          } else if (h.locked && !additive) hint('Élément figé : il ne peut pas être déplacé.');
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
      case 'link': {
        const n = nodeAt(p);
        if (n) { S.drag = { mode: 'link', a: n.id, cur: p }; renderOverlay(); }
        else pan();
        break;
      }
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
    if (!d) return;
    if (d.mode === 'pan') { S.cam.x = d.vx + (e.clientX - d.cx); S.cam.y = d.vy + (e.clientY - d.cy); applyCam(); return; }
    const p = toWorld(e);
    if (d.mode === 'move') {
      if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3) return;
      d.moved = true;
      const dx = snapV(p.x - d.p0.x), dy = snapV(p.y - d.p0.y);
      for (const [id, x, y] of d.orig) { const it = find(id); if (it) { it.x = x + dx; it.y = y + dy; } }
      relayout();
      sceneG.innerHTML = sceneSVG(); renderOverlay();
      return;
    }
    if (d.mode === 'link' || d.mode === 'marquee') { d.cur = p; renderOverlay(); }
  }
  function onUp(e) {
    S.pointers.delete(e.pointerId);
    if (S.gesture) { if (S.pointers.size < 2) S.gesture = null; return; }
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    if (d.mode === 'move') {
      relayout();
      if (snap() !== d.before) { pushUndo(d.before); save(); }
      else if (d.collapse) S.sels = [d.hitId];          // simple clic dans une sélection : on ne garde que l'élément touché
      render(); updateUI();
      return;
    }
    if (d.mode === 'marquee') {
      const p = toWorld(e);
      const x0 = Math.min(d.a.x, p.x), x1 = Math.max(d.a.x, p.x), y0 = Math.min(d.a.y, p.y), y1 = Math.max(d.a.y, p.y);
      const inside = items().filter((i) => (i.t === 'step' || i.t === 'trans') && i.x >= x0 && i.x <= x1 && i.y >= y0 && i.y <= y1).map((i) => i.id);
      S.sels = [...new Set([...S.sels, ...inside])];
      render(); updateUI();
      return;
    }
    if (d.mode === 'link') {
      const a = find(d.a), b = nodeAt(toWorld(e));
      if (a && b && b.id !== a.id) {
        let made = false;
        mutate(() => { made = connect(a, b); });
        if (made && a.t === b.t) hint(a.t === 'step' ? 'Une transition a été ajoutée entre les deux étapes : double appui dessus pour écrire sa réceptivité.' : 'Une étape a été ajoutée entre les deux transitions.');
        else if (!made) hint('Ces deux éléments sont déjà reliés.');
      }
      renderOverlay();
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
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  // le panneau « ! » touché affiche sa raison dans la ligne d'aide
  svg.addEventListener('click', (e) => {
    const w = e.target.closest && e.target.closest('[data-warn]');
    if (w) { const it = find(w.dataset.warn); if (it) hint('⚠ ' + textIssue(txt(it.id), it.t, S.view) + ' — touchez deux fois l’élément pour corriger son texte.'); }
  });

  /* ---------- Clavier ---------- */
  document.addEventListener('keydown', (e) => {
    if (root.hidden || root.dataset.schMode !== 'grafcet') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sels = items().filter((i) => i.t !== 'link').map((i) => i.id); render(); updateUI(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (!mod && (e.key === 'l' || e.key === 'L')) { toggleLock(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sels.length) { e.preventDefault(); deleteSel(); } return; }
    if (e.key === 'Enter' && S.sel) { e.preventDefault(); editText(S.sel); return; }
    if (e.key === 'Escape') { if (S.drag) S.drag = null; else if (S.sels.length) S.sels = []; else setTool('select'); render(); updateUI(); }
  });

  /* ---------- Interface ---------- */
  const HINTS = {
    multi: 'Sélection multiple : touchez les éléments pour les ajouter ou les retirer ; glissez sur le fond pour tracer un rectangle de sélection. Déplacement de la vue : deux doigts, clic droit ou molette.',
    select: 'Sélection : touchez un élément pour le choisir (Maj+clic : plusieurs), faites glisser une étape ou une transition pour la déplacer de côté ; la hauteur suit l’écart entre étapes. Double appui (ou Entrée) : modifier le texte, ou le numéro d’une étape. Glisser le fond déplace la vue ; molette ou pincement pour zoomer.',
    init: 'Étape initiale : touchez le plan pour la poser. Si une transition est sélectionnée juste au-dessus, elles sont reliées automatiquement.',
    step: 'Étape : touchez le plan pour la poser (numérotée automatiquement). Si une transition est sélectionnée au-dessus, elles sont reliées automatiquement : posez ainsi tout le cycle d’affilée.',
    trans: 'Transition : touchez le plan pour la poser. Si une étape est sélectionnée au-dessus, elles sont reliées automatiquement.',
    act: 'Action : touchez une étape pour lui ajouter une action (plusieurs possibles).',
    link: 'Liaison : faites glisser d’une étape vers une transition, ou d’une transition vers une étape. Plusieurs transitions sous une étape = divergence en OU ; plusieurs étapes sous une transition = divergence en ET. Une liaison vers le haut est une reprise de séquence.',
  };
  let hintTimer = null;
  function hint(msg) {
    const h = $('#gf-hint');
    h.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(updateUI, 5000);
  }
  function setTool(t) { S.tool = t; S.drag = null; renderOverlay(); updateUI(); }
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
    $('#gf-gap-m').disabled = gap() <= GAP_MIN;
    $('#gf-gap-p').disabled = gap() >= GAP_MAX;
    $('#gf-selcount').textContent = list.length > 1 ? list.length + ' éléments sélectionnés' : '';
    $('#gf-edit').textContent = it && it.t === 'step' ? 'Modifier le numéro' : 'Modifier le texte';
    $('#gf-ref').value = S.ref;
    $('#gf-ref-op').value = String(Math.round(S.refOp * 100));
    $('#gf-ref-op').disabled = !S.ref;
    $('#gf-copy').disabled = !S.ref || S.ref === S.view;
    $('#gf-snap').checked = S.snap;
    let h = (S.tool === 'select' && S.multi ? HINTS.multi : HINTS[S.tool]) || '';
    {
      const n = textTargets().filter((t) => textIssue(txt(t.id), t.kind, S.view)).length;
      if (n) h = `⚠ ${n} élément${n > 1 ? 's' : ''} à compléter ou à corriger (panneau « ! »). ` + h;
    }
    if (S.ref === S.view) h = 'Le calque choisi est le point de vue affiché : choisissez-en un autre pour le voir en transparence. ' + h;
    $('#gf-hint').textContent = h;
    svg.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
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
  $('#gf-gap-p').addEventListener('click', () => changeGap(1));

  // Changement de projet : nouveau Grafcet, historique vidé, vue ajustée
  function onSchema() {
    const api = API(), s = api && api.schema();
    const id = s ? s.id : null;
    if (id !== S.schemaId) {
      S.schemaId = id; S.sels = []; S.drag = null; S.undo = []; S.redo = [];
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

  window.GrafcetEditor = { clean, _state: S, _G: () => G(), _issue: designationIssue, _textIssue: textIssue, _render: render };
})();
