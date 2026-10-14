/* ============================================================
   Éditeur de schémas architecturaux (plan + symboles électriques)
   Données : window.localStorage, clé « ef_schemas »
   Éléments d'un schéma (schema.items) :
     wall   {x1,y1,x2,y2}
     door   {x,y,rot,len,flip}     window {x,y,rot,len}
     sym    {key,x,y,rot,s}        text   {x,y,text,size}
     link   {a:{id?,x,y}, b:{id?,x,y}}
   Schémas unifilaires : calque séparé (schema.uni) avec les mêmes éléments, plus
     uline  {x1,y1,x2,y2,m:{c:{couleur:n},N,T}}   (trait marqué de ses conducteurs)
     shape  {..., bd:n}                            (boîte de dérivation « BDn »)
   ============================================================ */
(function () {
  'use strict';

  const SYM = window.SchSymbols;
  const MAT = window.SchMaterials;
  const root = document.getElementById('main-schemas');
  if (!SYM || !MAT || !root) return;

  const $ = (s) => root.querySelector(s);
  const svg = $('#sch-svg');
  svg.querySelector('defs').insertAdjacentHTML('beforeend', MAT.defsSVG());   // motifs des matériaux

  const GRID = 20;          // pas de la grille (murs)
  const STEP = 10;          // pas d'accrochage des symboles
  const INK = '#0a2a66';    // portes et fenêtres (les symboles électriques ont leur propre couleur : SYM.INK)
  const WALL_COLOR = '#3b3b3b';
  const LINK_COLOR = '#ff1a1a';   // liaisons : rouge vif
  const LINK_W = 2;               // épaisseur par défaut des liaisons
  const clampLW = (v) => Math.max(0.5, Math.min(12, Math.round(v * 2) / 2));
  const clampLT = (v) => Math.max(0, Math.min(0.9, Math.round(v * 100) / 100));
  const SEL = '#2f7df6';
  const WALL_TH = 8;        // épaisseur des murs créés avant l'ajout des matériaux
  const LINE = '#222';
  // poignées d'une forme : 4 coins (proportionnel) puis 4 milieux de côtés (étirement)
  const SHAPE_HANDLES = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const rnd = (v) => Math.round(v * 100) / 100;
  const snapTo = (v, step) => Math.round(v / step) * step;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const rad = (d) => (d * Math.PI) / 180;

  /* ---------- Stockage ---------- */
  let store = null;
  try { store = window.localStorage; store.setItem('__t', '1'); store.removeItem('__t'); } catch (e) { store = null; }
  const KEY = 'ef_schemas';
  let db = { list: [], current: null };

  function loadDb() {
    try {
      const raw = store && store.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.list)) {
          db = { list: d.list.filter((s) => s && Array.isArray(s.items)), current: d.current };
          // anciennes portes : « flip » (sens d'ouverture) devient « my » (miroir vertical)
          for (const s of db.list) for (const it of s.items) if (it && it.t === 'door' && it.flip !== undefined) { if (it.flip) it.my = true; delete it.flip; }
          // premiers traits unifilaires (sans type) : ce sont des « uline »
          for (const s of db.list) if (Array.isArray(s.uni)) s.uni = s.uni.filter(Boolean).map((l) => (l.t ? l : { ...l, t: 'uline' }));
        }
      }
    } catch (e) { /* données illisibles : on repart de zéro */ }
  }
  let quotaWarned = false;
  function warnQuota() {
    if (quotaWarned) return;
    quotaWarned = true;
    window.alert('Le stockage de l’appareil est plein : les dernières modifications ne sont pas enregistrées. Exportez vos schémas ou supprimez un fond de plan volumineux.');
  }
  function saveNow() {
    try { if (store) store.setItem(KEY, JSON.stringify(db)); } catch (e) { warnQuota(); }
  }

  // Fonds de plan : stockés à part (une clé par schéma) pour garder la base légère
  const BGPREFIX = 'ef_bg_';
  const bgCache = {};
  function bgGet(id) {
    if (bgCache[id] !== undefined) return bgCache[id];
    let v = null;
    try { v = store ? store.getItem(BGPREFIX + id) : null; } catch (e) { v = null; }
    bgCache[id] = v;
    return v;
  }
  function bgSet(id, data) {
    try { if (store) store.setItem(BGPREFIX + id, data); } catch (e) { return false; }
    bgCache[id] = data;
    return true;
  }
  function bgDel(id) {
    delete bgCache[id];
    try { if (store) store.removeItem(BGPREFIX + id); } catch (e) { /* ignoré */ }
  }
  let saveTimer = null;
  function save() {
    const s = schema();
    if (s) s.updated = Date.now();
    if (S.readonly && typeof uniRetag === 'function') uniRetag();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveNow(); });

  /* ---------- État ---------- */
  const S = {
    tool: 'select',
    placeKey: null,
    sels: [],              // identifiants des éléments sélectionnés
    multi: false,          // mode « sélection multiple » (pour l'écran tactile)
    view: { x: 40, y: 40, k: 1 },
    snap: true,
    mat: 'plein',          // matériau des prochains murs
    th: 12,                // épaisseur des prochains murs
    floorMat: 'sol-carrelage',   // matériau des prochains sols
    fdraft: null,          // sol en cours de tracé (liste de points)
    space: false,          // touche Espace enfoncée : glisser = déplacer la vue
    draft: null,
    cursor: null,
    drag: null,
    pointers: new Map(),
    gesture: null,
    undo: [],
    redo: [],
    // Schémas unifilaires : S.readonly = vrai quand la sous-partie « Unifilaire » est ouverte.
    // On travaille alors sur le calque schema.uni ; le plan d'implantation reste affiché mais n'est pas modifiable.
    readonly: false,
    umark: { c: { '#FF0000': 1 }, N: 1, T: 1 },   // marquage des prochains traits
    hist: null,            // historiques Annuler / Rétablir propres à chaque sous-partie
    linkW: LINK_W,         // épaisseur des prochaines liaisons
    linkT: 0,              // transparence des prochaines liaisons (0 = opaque, 0.9 = presque invisible)
    lockMarks: true,       // affichage des cadenas des éléments figés
    uw: 2,                 // épaisseur des prochains traits unifilaires
    usec: null,            // section (mm²) des prochains traits
    uhs: false,            // prochains traits : section masquée
    uhm: false,            // prochains traits : marques des conducteurs masquées
  };
  try { if (window.localStorage.getItem('ef_sch_locks') === '0') S.lockMarks = false; } catch (e) { /* ignoré */ }
  function resetHist() {
    S.hist = { implantation: { undo: [], redo: [] }, unifilaire: { undo: [], redo: [] } };
    const h = S.hist[S.readonly ? 'unifilaire' : 'implantation'];
    S.undo = h.undo; S.redo = h.redo;
  }
  resetHist();

  // S.sel = identifiant de l'élément sélectionné quand il y en a exactement un (sinon null) ;
  // S.sels = sélection complète. Les actions « un seul élément » restent donc inchangées.
  Object.defineProperty(S, 'sel', {
    get() { return S.sels.length === 1 ? S.sels[0] : null; },
    set(v) { S.sels = v ? [v] : []; },
  });

  const schema = () => db.list.find((s) => s.id === db.current) || null;
  const layerKey = () => (S.readonly ? 'uni' : 'items');
  const implItems = () => (schema() ? schema().items : []);
  const uniItems = () => { const s = schema(); if (!s) return []; if (!Array.isArray(s.uni)) s.uni = []; return s.uni; };
  const items = () => (S.readonly ? uniItems() : implItems());   // calque modifiable de la sous-partie ouverte
  const snapJSON = () => JSON.stringify(items());
  const findItem = (id) => items().find((i) => i.id === id) || null;
  const selItems = () => S.sels.map(findItem).filter(Boolean);
  const pruneSel = () => { S.sels = S.sels.filter((id) => findItem(id)); };

  function newSchema(name) {
    const s = { id: uid(), name: name || 'Schéma ' + (db.list.length + 1), items: [], view: null, updated: Date.now() };
    db.list.push(s);
    return s;
  }

  function pushUndo(before) {
    S.undo.push(before);
    if (S.undo.length > 100) S.undo.shift();
    S.redo.length = 0;
  }
  // Modification immédiate annulable
  function mutate(fn) {
    const before = snapJSON();
    fn();
    pushUndo(before);
    save();
    render();
    updateUI();
  }
  function setItems(arr) {
    schema()[layerKey()] = arr;
    pruneSel();
    save();
    render();
    updateUI();
  }
  function doUndo() {
    if (!S.undo.length) return;
    S.redo.push(snapJSON());
    setItems(JSON.parse(S.undo.pop()));
  }
  function doRedo() {
    if (!S.redo.length) return;
    S.undo.push(snapJSON());
    setItems(JSON.parse(S.redo.pop()));
  }

  /* ---------- Géométrie ---------- */
  const isSeg = (it) => it.t === 'wall' || it.t === 'uline';   // éléments définis par deux extrémités
  const snapOn = (v, step) => (S.snap ? snapTo(v, step) : v);
  const snapPt = (p, step) => ({ x: snapOn(p.x, step), y: snapOn(p.y, step) });

  function distSeg(p, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - x1) * dx + (p.y - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return { d: Math.hypot(p.x - qx, p.y - qy), t, qx, qy };
  }

  function toLocal(it, p) {
    const dx = p.x - it.x, dy = p.y - it.y;
    const a = rad(it.rot || 0);
    const c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  function textBox(it) {
    const lines = String(it.text).split('\n');
    const w = Math.max(...lines.map((l) => l.length), 1) * it.size * 0.6;
    const h = lines.length * it.size * 1.2;
    return [it.x - w / 2, it.y - h / 2, it.x + w / 2, it.y + h / 2];
  }

  function openingCenter(it) {
    const a = rad(it.rot || 0);
    return { x: it.x + Math.cos(a) * it.len / 2, y: it.y + Math.sin(a) * it.len / 2 };
  }

  // Place une porte / fenêtre : s'aligne sur le mur le plus proche
  /* ----- Murs courbes : arc de cercle défini par sa flèche (distance entre le milieu de la corde et le sommet) ----- */
  function arcInfo(w) {
    const s = w.bend || 0;
    if (!s) return null;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
    if (L < 1) return null;
    const r = (L * L / 4 + s * s) / (2 * Math.abs(s));
    const nx = -dy / L, ny = dx / L, mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
    const off = s - Math.sign(s) * r;
    const cx = mx + nx * off, cy = my + ny * off;
    const half = Math.abs(s) <= L / 2 ? Math.asin(Math.min(1, L / 2 / r)) : Math.PI - Math.asin(Math.min(1, L / 2 / r));
    let theta = 2 * half;
    const ax = mx + nx * s, ay = my + ny * s;
    const at = (ang) => {
      const x0 = w.x1 - cx, y0 = w.y1 - cy;
      return { x: cx + x0 * Math.cos(ang) - y0 * Math.sin(ang), y: cy + x0 * Math.sin(ang) + y0 * Math.cos(ang) };
    };
    // sens de parcours : le milieu de l'arc doit tomber sur le sommet
    const p1 = at(theta / 2), p2 = at(-theta / 2);
    if (Math.hypot(p2.x - ax, p2.y - ay) < Math.hypot(p1.x - ax, p1.y - ay)) theta = -theta;
    return { r, L, s, nx, ny, mx, my, cx, cy, theta, ax, ay, large: Math.abs(s) > L / 2 ? 1 : 0, sweep: theta > 0 ? 1 : 0, at };
  }
  function wallPoints(w, n) {
    const a = arcInfo(w);
    if (!a) return [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(a.at((a.theta * i) / n));
    return pts;
  }
  function wallPathD(w) {
    const a = arcInfo(w);
    return a ? `M${w.x1} ${w.y1} A${rnd(a.r)} ${rnd(a.r)} 0 ${a.large} ${a.sweep} ${w.x2} ${w.y2}` : null;
  }
  // point le plus proche de p sur l'axe du mur (droit ou courbe) + direction de la tangente
  function wallNearest(w, p) {
    const pts = wallPoints(w, 48);
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const r = distSeg(p, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (!best || r.d < best.d) best = { d: r.d, qx: r.qx, qy: r.qy, ang: (Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) * 180) / Math.PI };
    }
    return best;
  }
  function bendHandlePos(w) {
    const a = arcInfo(w);
    return a ? { x: a.ax, y: a.ay } : { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
  }
  function wallBendHandleAt(w, p) {
    const q = bendHandlePos(w);
    return Math.hypot(p.x - q.x, p.y - q.y) <= 12 / S.view.k;
  }

  /* ----- Formes (cercle, carré, triangle) remplies d'un matériau de mur ----- */
  function shapeHandlePos(s, hx, hy) {
    const a = rad(s.rot || 0), lx = (hx * s.w) / 2, ly = (hy * s.h) / 2;
    return { x: s.x + lx * Math.cos(a) - ly * Math.sin(a), y: s.y + lx * Math.sin(a) + ly * Math.cos(a) };
  }
  function shapeHandleAt(s, p) {
    const r = 12 / S.view.k;
    for (const [hx, hy] of SHAPE_HANDLES) {
      const q = shapeHandlePos(s, hx, hy);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= r) return { hx, hy };
    }
    return null;
  }
  function inShape(s, p, tol) {
    const l = toLocal(s, p), hw = s.w / 2 + tol, hh = s.h / 2 + tol;
    if (s.kind === 'circle') return (l.x * l.x) / (hw * hw) + (l.y * l.y) / (hh * hh) <= 1;
    if (s.kind === 'triangle') {
      if (l.y < -hh || l.y > hh) return false;
      return Math.abs(l.x) <= hw * ((l.y + hh) / (2 * hh));
    }
    return Math.abs(l.x) <= hw && Math.abs(l.y) <= hh;
  }
  // rectangle englobant d'une forme à partir d'un glisser (Maj = carré / cercle parfait) ; clic simple = taille standard
  function shapeFromDrag(a, q, moved, shift) {
    if (!moved || (Math.abs(q.x - a.x) < 10 && Math.abs(q.y - a.y) < 10)) return { x: a.x, y: a.y, w: 60, h: 60 };
    let dx = q.x - a.x, dy = q.y - a.y;
    if (shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m; }
    return { x: a.x + dx / 2, y: a.y + dy / 2, w: Math.max(10, Math.abs(dx)), h: Math.max(10, Math.abs(dy)) };
  }
  function addShape(kind, g) {
    const it = { id: uid(), t: 'shape', kind, x: rnd(g.x), y: rnd(g.y), w: rnd(g.w), h: rnd(g.h), rot: 0, mat: S.mat };
    mutate(() => items().push(it));
    S.sel = it.id;
    renderOverlay(); updateUI();
  }

  function placeOpening(it, c) {
    let best = null;
    for (const w of items()) {
      if (w.t !== 'wall') continue;
      const r = wallNearest(w, c);
      if (r.d <= 16 && (!best || r.d < best.d)) best = { d: r.d, qx: r.qx, qy: r.qy, ang: r.ang, w };
    }
    if (best) {
      const wa = best.ang;
      const gap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
      const cur = it.rot || 0;
      const pick = gap(wa, cur) <= gap(wa + 180, cur) ? wa : wa + 180;
      it.rot = rnd(((pick % 360) + 360) % 360);
      c = { x: best.qx, y: best.qy };
      it.th = best.w.th || WALL_TH;
    } else {
      c = snapPt(c, STEP);
      it.th = S.th;
    }
    const a = rad(it.rot || 0);
    it.x = rnd(c.x - Math.cos(a) * it.len / 2);
    it.y = rnd(c.y - Math.sin(a) * it.len / 2);
  }

  /* ---------- Dessin de la scène ---------- */
  function resolveEnd(list, e) {
    if (e.id) {
      const s = list.find((i) => i.id === e.id);
      if (s) return { x: s.x, y: s.y };
    }
    return { x: e.x, y: e.y };
  }

  // Un mur est un rectangle dans son repère local (le motif suit donc la direction du mur).
  // Passe 1 : contours ; passe 2 : remplissages. Les angles et les T se raccordent proprement.
  function wallGeom(w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    return { L: Math.hypot(dx, dy), ang: rnd((Math.atan2(dy, dx) * 180) / Math.PI), th: w.th || WALL_TH };
  }
  function wallRect(w, attrs) {
    const g = wallGeom(w);
    return `<g transform="translate(${w.x1} ${w.y1}) rotate(${g.ang})"><rect x="${-g.th / 2}" y="${-g.th / 2}" width="${rnd(g.L + g.th)}" height="${g.th}" ${attrs}/></g>`;
  }
  function wallOutlineSVG(w) {
    const m = w.mat || 'plein';
    if (m === 'plein' || m === 'verre') return '';
    const dc = w.bend ? wallPathD(w) : null;
    if (dc) return `<path d="${dc}" fill="none" stroke="${LINE}" stroke-width="${(w.th || WALL_TH) + 3}" stroke-linecap="square"/>`;
    return wallRect(w, `fill="#fff" stroke="${LINE}" stroke-width="3" stroke-linejoin="miter"`);
  }
  function wallFillSVG(w) {
    const f = MAT.fill(w.mat || 'plein');
    const dc = w.bend ? wallPathD(w) : null;
    if (dc) {
      const th = w.th || WALL_TH;
      if (f === null) return `<path d="${dc}" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="square"/>`;
      return (f.startsWith('url(') ? `<path d="${dc}" fill="none" stroke="#fff" stroke-width="${th}" stroke-linecap="square"/>` : '') +
        `<path d="${dc}" fill="none" stroke="${f}" stroke-width="${th}" stroke-linecap="square"/>`;
    }
    if (f === null) {
      return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${LINE}" stroke-width="1.8" stroke-linecap="square"/>`;
    }
    return (f.startsWith('url(') ? wallRect(w, 'fill="#fff"') : '') + wallRect(w, `fill="${f}"`);
  }

  function openingSVG(o) {
    const L = o.len, th = o.th || WALL_TH, h = th / 2;
    let g = `<rect x="0" y="${-(h + 2)}" width="${L}" height="${th + 4}" fill="#fff"/>`;
    if (o.t === 'door') {
      const tf = `translate(${L / 2} 0) scale(${o.mx ? -1 : 1} ${(o.my || o.flip) ? -1 : 1}) translate(${-L / 2} 0)`;
      g += `<g transform="${tf}">` +
        `<line x1="0" y1="0" x2="0" y2="${-L}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<path d="M0 ${-L} A${L} ${L} 0 0 1 ${L} 0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 3"/></g>`;
    } else {
      g += `<line x1="0" y1="${-h}" x2="${L}" y2="${-h}" stroke="${INK}" stroke-width="1.3"/>` +
        `<line x1="0" y1="${h}" x2="${L}" y2="${h}" stroke="${INK}" stroke-width="1.3"/>` +
        `<line x1="0" y1="0" x2="${L}" y2="0" stroke="${INK}" stroke-width="1"/>`;
    }
    g += `<line x1="0" y1="${-h}" x2="0" y2="${h}" stroke="${LINE}" stroke-width="1.6"/>` +
      `<line x1="${L}" y1="${-h}" x2="${L}" y2="${h}" stroke="${LINE}" stroke-width="1.6"/>`;
    return `<g transform="translate(${o.x} ${o.y}) rotate(${o.rot || 0})">${g}</g>`;
  }

  function linkSVG(list, l) {
    const a = resolveEnd(list, l.a), b = resolveEnd(list, l.b);
    const op = 1 - (l.tr || 0);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${LINK_COLOR}" stroke-width="${l.w || LINK_W}"${op < 1 ? ` stroke-opacity="${rnd(op)}"` : ''} stroke-linecap="round"/>`;
  }

  function symSVG(s) {
    const k = s.s || 1, sx = s.mx ? -1 : 1, sy = s.my ? -1 : 1;
    return `<g transform="translate(${s.x} ${s.y}) rotate(${s.rot || 0}) scale(${k * sx} ${k * sy})">${SYM.inner(s.key, s.rot || 0, sx, sy)}</g>`;
  }

  function textSVG(t) {
    const lines = String(t.text).split('\n');
    const h = lines.length * t.size * 1.2;
    const y0 = t.y - h / 2 + t.size * 0.95;
    const tsp = lines.map((l, i) => `<tspan x="${t.x}" y="${rnd(y0 + i * t.size * 1.2)}">${esc(l)}</tspan>`).join('');
    return `<text font-size="${t.size}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="#222">${tsp}</text>`;
  }

  function shapeEl(s, attrs) {
    const hw = s.w / 2, hh = s.h / 2;
    let el;
    if (s.kind === 'circle') el = `<ellipse cx="0" cy="0" rx="${hw}" ry="${hh}" ${attrs}/>`;
    else if (s.kind === 'triangle') el = `<polygon points="0,${-hh} ${hw},${hh} ${-hw},${hh}" ${attrs}/>`;
    else el = `<rect x="${-hw}" y="${-hh}" width="${s.w}" height="${s.h}" ${attrs}/>`;
    return `<g transform="translate(${s.x} ${s.y}) rotate(${s.rot || 0})">${el}</g>`;
  }
  function shapeOutlineSVG(s) {
    const m = s.mat || 'plein';
    if (m === 'plein' || m === 'verre') return '';
    return shapeEl(s, `fill="#fff" stroke="${LINE}" stroke-width="3"`);
  }
  function shapeFillSVG(s) {
    const f = MAT.fill(s.mat || 'plein');
    if (f === null) return shapeEl(s, `fill="none" stroke="${LINE}" stroke-width="1.8"`);
    return (f.startsWith('url(') ? shapeEl(s, 'fill="#fff"') : '') + shapeEl(s, `fill="${f}"`);
  }

  // Sols : surfaces (polygones) dessinées sous les murs
  function floorSVG(f) {
    const pts = f.pts.map((q) => q[0] + ',' + q[1]).join(' ');
    return `<polygon points="${pts}" fill="#fff"/><polygon points="${pts}" fill="${MAT.floorFill(f.mat)}" stroke="#8a93a3" stroke-width="1"/>`;
  }
  function inPoly(p, pts) {
    let inside = false;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const [xi, yi] = pts[i], [xk, yk] = pts[k];
      if ((yi > p.y) !== (yk > p.y) && p.x < ((xk - xi) * (p.y - yi)) / (yk - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function floorHandleAt(f, p) {
    const r = 12 / S.view.k;
    for (let i = 0; i < f.pts.length; i++) if (Math.hypot(p.x - f.pts[i][0], p.y - f.pts[i][1]) <= r) return i;
    return -1;
  }

  function sceneSVG(list) {
    let floors = '', walls = '', open = '', links = '', syms = '', texts = '', wallsFill = '', shOut = '', shFill = '', ulines = '', jbx = '';
    for (const it of list) {
      if (it.t === 'floor') floors += floorSVG(it);
      else if (it.t === 'shape' && isJbox(it)) jbx += jboxSVG(it);
      else if (it.t === 'shape') { shOut += shapeOutlineSVG(it); shFill += shapeFillSVG(it); }
      else if (it.t === 'uline') ulines += ulineSVG(it);
      else if (it.t === 'door' || it.t === 'window') open += openingSVG(it);
      else if (it.t === 'link') links += linkSVG(list, it);
      else if (it.t === 'sym') syms += symSVG(it);
      else if (it.t === 'text') texts += textSVG(it);
    }
    // Les murs épais sont dessinés en dernier : une cloison fine s'arrête proprement contre un mur épais
    const wl = list.filter((i) => i.t === 'wall').sort((a, b) => (a.th || WALL_TH) - (b.th || WALL_TH));
    for (const w of wl) { walls += wallOutlineSVG(w); wallsFill += wallFillSVG(w); }
    return floors + walls + shOut + wallsFill + shFill + open + links + ulines + jbx + syms + texts;
  }

  function selSVG(it, multi) {
    const dash = `fill="none" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"`;
    const handle = (x, y) => (multi || it.locked) ? '' : `<circle cx="${x}" cy="${y}" r="${7 / S.view.k}" fill="#fff" stroke="${SEL}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    if (it.t === 'uline') {
      return `<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${SEL}" stroke-opacity="0.35" stroke-width="${(it.w || 2) + 8}" stroke-linecap="round"/>` +
        handle(it.x1, it.y1) + handle(it.x2, it.y2);
    }
    if (it.t === 'wall') {
      const dc = it.bend ? wallPathD(it) : null;
      const sw = (it.th || WALL_TH) + 6;
      const halo = dc
        ? `<path d="${dc}" fill="none" stroke="${SEL}" stroke-opacity="0.35" stroke-width="${sw}" stroke-linecap="round"/>`
        : `<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${SEL}" stroke-opacity="0.35" stroke-width="${sw}" stroke-linecap="round"/>`;
      let bh = '';
      if (!(multi || it.locked)) {
        const b = bendHandlePos(it), k = S.view.k;
        bh = `<rect x="${b.x - 6 / k}" y="${b.y - 6 / k}" width="${12 / k}" height="${12 / k}" transform="rotate(45 ${b.x} ${b.y})" fill="#fff" stroke="#ff8a00" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      }
      return halo + handle(it.x1, it.y1) + handle(it.x2, it.y2) + bh;
    }
    if (it.t === 'shape') {
      const hw = it.w / 2, hh = it.h / 2;
      const el = it.kind === 'circle' ? `<ellipse rx="${hw}" ry="${hh}" ${dash}/>`
        : it.kind === 'triangle' ? `<polygon points="0,${-hh} ${hw},${hh} ${-hw},${hh}" ${dash}/>`
        : `<rect x="${-hw}" y="${-hh}" width="${it.w}" height="${it.h}" ${dash}/>`;
      let o = `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">${el}<rect x="${-hw}" y="${-hh}" width="${it.w}" height="${it.h}" ${dash} stroke-opacity="0.35"/></g>`;
      for (const [hx, hy] of SHAPE_HANDLES) { const q = shapeHandlePos(it, hx, hy); o += handle(q.x, q.y); }
      return o;
    }
    if (it.t === 'link') {
      const a = resolveEnd(items(), it.a), b = resolveEnd(items(), it.b);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${SEL}" stroke-opacity="0.5" stroke-width="${(it.w || LINK_W) + 4}" stroke-linecap="round"/>`;
    }
    if (it.t === 'floor') {
      const pts = it.pts.map((q) => q[0] + ',' + q[1]).join(' ');
      return `<polygon points="${pts}" ${dash}/>` + it.pts.map((q) => handle(q[0], q[1])).join('');
    }
    if (it.t === 'text') {
      const [x0, y0, x1, y1] = textBox(it);
      return `<rect x="${x0 - 4}" y="${y0 - 2}" width="${x1 - x0 + 8}" height="${y1 - y0 + 4}" ${dash}/>`;
    }
    if (it.t === 'sym') {
      const [x0, y0, x1, y1] = SYM.map[it.key].b;
      return `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0}) scale(${(it.s || 1) * (it.mx ? -1 : 1)} ${(it.s || 1) * (it.my ? -1 : 1)})"><rect x="${x0 - 2}" y="${y0 - 2}" width="${x1 - x0 + 4}" height="${y1 - y0 + 4}" ${dash}/></g>`;
    }
    // porte / fenêtre
    const hh = (it.th || WALL_TH) / 2 + 4;
    const top = it.t === 'door' ? ((it.my || it.flip) ? -hh : -(it.len + 3)) : -hh;
    const hgt = it.t === 'door' ? it.len + hh + 3 : hh * 2;
    return `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})"><rect x="-3" y="${top}" width="${it.len + 6}" height="${hgt}" ${dash}/></g>`;
  }

  const LOCK_RED = '#d62828';
  function lockPos(it) {
    if (isSeg(it)) return { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
    if (it.t === 'link') {
      const a = resolveEnd(items(), it.a), b = resolveEnd(items(), it.b);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (it.t === 'floor') {
      const n = it.pts.length;
      return { x: it.pts.reduce((s, q) => s + q[0], 0) / n, y: it.pts.reduce((s, q) => s + q[1], 0) / n };
    }
    const b = itemBounds(it);
    return { x: b[2], y: b[1] };
  }
  // Taille de l'objet (plus grande dimension), dans les unités du plan
  function itemSize(it) {
    if (it.t === 'link') {
      const a = resolveEnd(items(), it.a), b = resolveEnd(items(), it.b);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (isSeg(it)) return Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
    const b = itemBounds(it);
    return b ? Math.max(b[2] - b[0], b[3] - b[1]) : 30;
  }
  // Largeur visible de l'objet (épaisseur d'un mur, d'un trait, d'une liaison ; petit côté d'un objet)
  function itemWidth(it) {
    if (it.t === 'wall') return it.th || WALL_TH;
    if (it.t === 'uline') return Math.max(it.w || 2, !it.hm && uniMarkList(it.m || {}).length ? UNI_HALF * 2 : 0);
    if (it.t === 'link') return it.w || LINK_W;
    const b = itemBounds(it);
    return b ? Math.min(b[2] - b[0], b[3] - b[1]) : 20;
  }
  // Le cadenas mesure le tiers de l'objet figé, sans dépasser sa largeur visible ; il suit le zoom comme l'objet
  function lockSVG(it) {
    const p = lockPos(it);
    const size = Math.max(0.5, Math.min(itemSize(it) / 3, itemWidth(it)));
    const sc = size / 20;                                // dessin du cadenas : 20 unités de diamètre
    return `<g class="sch-lockmark" transform="translate(${rnd(p.x)} ${rnd(p.y)}) scale(${rnd(sc * 1000) / 1000})">` +
      `<circle r="10" fill="#fff" fill-opacity="0.92" stroke="${LOCK_RED}" stroke-width="1.2"/>` +
      `<path d="M-3.6 -0.5 V-3.4 a3.6 3.6 0 0 1 7.2 0 V-0.5" fill="none" stroke="${LOCK_RED}" stroke-width="1.9" stroke-linecap="round"/>` +
      `<rect x="-5.4" y="-0.8" width="10.8" height="8" rx="1.6" fill="${LOCK_RED}"/>` +
      `<circle cx="0" cy="3.1" r="1.25" fill="#fff"/></g>`;
  }

  function overlaySVG() {
    let o = '';
    const selList = selItems();
    for (const it of selList) o += selSVG(it, selList.length > 1);
    if (selList.length > 1) {
      const bb = contentBBox(selList);
      if (bb) o += `<rect x="${bb.x - 4}" y="${bb.y - 4}" width="${bb.w + 8}" height="${bb.h + 8}" fill="none" stroke="${SEL}" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>`;
    }
    const c = S.cursor;
    const k = S.view.k;
    if (S.lockMarks) for (const it of items()) if (it.locked) o += lockSVG(it);
    if (S.tool === 'bg') {
      const cb = currentBg();
      if (cb) {
        const b = cb.b;
        o += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
        for (const [hx, hy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
          o += `<rect x="${hx - 7 / k}" y="${hy - 7 / k}" width="${14 / k}" height="${14 / k}" fill="#fff" stroke="${SEL}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        }
      }
    }
    // aperçu du symbole à poser
    if (S.tool === 'place' && S.placeKey && c) {
      const p = snapPt(c, STEP);
      o += `<g opacity="0.5">${symSVG({ key: S.placeKey, x: p.x, y: p.y, rot: 0, s: 1 })}</g>`;
    }
    if ((S.tool === 'door' || S.tool === 'window') && c) {
      const g = { t: S.tool, len: S.tool === 'door' ? 40 : 60, rot: 0, flip: false, x: 0, y: 0 };
      placeOpening(g, c);
      o += `<g opacity="0.5">${openingSVG(g)}</g>`;
    }
    // murs en cours de tracé
    if (S.tool === 'wall' && S.draft) {
      const q = c ? snapPt(c, GRID) : S.draft;
      o += `<line x1="${S.draft.x}" y1="${S.draft.y}" x2="${q.x}" y2="${q.y}" stroke="${SEL}" stroke-opacity="0.6" stroke-width="${S.th}" stroke-linecap="square"/>`;
      o += `<circle cx="${S.draft.x}" cy="${S.draft.y}" r="${5 / k}" fill="${SEL}"/>`;
    }
    if (S.tool === 'uline' && c) {                     // repère d'aimantation sous le curseur
      const sn = uniSnap(c, S.draft);
      if (sn.hit) o += snapRingSVG(sn);
    }
    if (S.drag && S.drag.mode === 'wallEnd' && S.drag.snap && S.drag.snap.hit) o += snapRingSVG(S.drag.snap);
    if (S.tool === 'uline' && S.draft) {
      const q = c ? uniSnap(c, S.draft) : S.draft;
      o += `<g opacity="0.6">${ulineSVG({ x1: S.draft.x, y1: S.draft.y, x2: q.x, y2: q.y, m: S.umark })}</g>`;
      o += `<circle cx="${S.draft.x}" cy="${S.draft.y}" r="${5 / k}" fill="${SEL}"/>`;
    }
    if (S.tool === 'jbox' && c) {
      const dr = S.drag && S.drag.mode === 'shapeNew' ? S.drag : null;
      const g = dr ? jboxFromDrag(dr.a, snapPt(c, STEP), dr.moved, dr.shift) : { ...snapPt(c, STEP), w: JBOX_SIZE, h: JBOX_SIZE };
      o += `<g opacity="0.55">${jboxSVG({ x: g.x, y: g.y, w: g.w, h: g.h, rot: 0, bd: nextBd() })}</g>`;
    }
    if ((S.tool === 'circle' || S.tool === 'square' || S.tool === 'triangle') && c) {
      const dr = S.drag && S.drag.mode === 'shapeNew' ? S.drag : null;
      const g = dr ? shapeFromDrag(dr.a, snapPt(c, STEP), dr.moved, dr.shift) : { x: snapPt(c, STEP).x, y: snapPt(c, STEP).y, w: 60, h: 60 };
      o += `<g opacity="0.55">${shapeFillSVG({ kind: S.tool, x: g.x, y: g.y, w: g.w, h: g.h, rot: 0, mat: S.mat })}</g>`;
    }
    if (S.tool === 'floor' && S.fdraft && c) {
      const q = snapPt(c, GRID), a = S.fdraft[0];
      if (S.drag && S.drag.mode === 'floor' && S.drag.fresh && S.drag.moved) {
        o += `<rect x="${Math.min(a.x, q.x)}" y="${Math.min(a.y, q.y)}" width="${Math.abs(q.x - a.x)}" height="${Math.abs(q.y - a.y)}" fill="${SEL}" fill-opacity="0.12" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
      } else {
        const pts = [...S.fdraft, q].map((r) => r.x + ',' + r.y).join(' ');
        o += `<polygon points="${pts}" fill="${SEL}" fill-opacity="0.1" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
        for (const r of S.fdraft) o += `<circle cx="${r.x}" cy="${r.y}" r="${4 / S.view.k}" fill="${SEL}"/>`;
      }
    }
    if (S.drag && S.drag.mode === 'room' && c) {
      const a = S.drag.a, q = snapPt(c, GRID);
      o += `<rect x="${Math.min(a.x, q.x)}" y="${Math.min(a.y, q.y)}" width="${Math.abs(q.x - a.x)}" height="${Math.abs(q.y - a.y)}" fill="${SEL}" fill-opacity="0.08" stroke="${SEL}" stroke-width="${S.th}" stroke-opacity="0.6" stroke-linejoin="miter"/>`;
    }
    if (S.drag && S.drag.mode === 'marquee' && c) {
      const a = S.drag.a;
      o += `<rect x="${Math.min(a.x, c.x)}" y="${Math.min(a.y, c.y)}" width="${Math.abs(c.x - a.x)}" height="${Math.abs(c.y - a.y)}" fill="${SEL}" fill-opacity="0.08" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
    }
    if (S.drag && S.drag.mode === 'link' && c) {
      const a = resolveEnd(items(), S.drag.a);
      const t = symAt(c);
      const b = t ? { x: t.x, y: t.y } : snapPt(c, STEP);
      o += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${SEL}" stroke-width="2" stroke-dasharray="5 4"/>`;
    }
    return o;
  }

  const sceneG = svg.querySelector('#sch-scene');
  const overG = svg.querySelector('#sch-overlay');
  const worldG = svg.querySelector('#sch-world');
  const bgG = svg.querySelector('#sch-bgl');
  const uniG = svg.querySelector('#sch-uni');

  function applyView() {
    worldG.setAttribute('transform', `translate(${rnd(S.view.x)} ${rnd(S.view.y)}) scale(${S.view.k})`);
  }
  function renderOverlay() { overG.innerHTML = overlaySVG(); }
  // Redessine seulement le calque en cours de modification
  function renderScene() {
    if (S.readonly) uniG.innerHTML = sceneSVG(uniItems());
    else sceneG.innerHTML = sceneSVG(implItems());
  }
  // Fond de plan : l'élément <image> n'est reconstruit que si l'image change
  let bgSig = '';
  function currentBg() {
    const s = schema();
    if (!s || !s.bg || s.bg.visible === false) return null;
    const data = bgGet(s.id);
    return data ? { b: s.bg, data, id: s.id } : null;
  }
  function renderBg() {
    const cb = currentBg();
    if (!cb) { if (bgSig) { bgG.innerHTML = ''; bgSig = ''; } return; }
    const sig = cb.id + ':' + cb.data.length;
    let im = bgG.firstChild;
    if (sig !== bgSig || !im) {
      bgG.innerHTML = `<image preserveAspectRatio="none" href="${cb.data}"></image>`;
      im = bgG.firstChild;
      bgSig = sig;
    }
    im.setAttribute('x', cb.b.x); im.setAttribute('y', cb.b.y);
    im.setAttribute('width', cb.b.w); im.setAttribute('height', cb.b.h);
    im.setAttribute('opacity', cb.b.opacity);
  }
  function bgImageSVG() {
    const cb = currentBg();
    if (!cb) return '';
    return `<image x="${cb.b.x}" y="${cb.b.y}" width="${cb.b.w}" height="${cb.b.h}" opacity="${cb.b.opacity}" preserveAspectRatio="none" href="${cb.data}"/>`;
  }
  function render() {
    pruneSel();
    applyView();
    renderBg();
    sceneG.innerHTML = sceneSVG(implItems());
    uniG.innerHTML = S.readonly ? sceneSVG(uniItems()) : '';
    renderOverlay();
  }

  /* ---------- Sélection par clic ---------- */
  function symAt(p) {
    const list = items();
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'sym') continue;
      const l = toLocal(it, p);
      const [x0, y0, x1, y1] = SYM.map[it.key].b;
      const s = it.s || 1, tol = 4;
      const lx = l.x / (s * (it.mx ? -1 : 1)), ly = l.y / (s * (it.my ? -1 : 1));
      if (lx >= x0 - tol && lx <= x1 + tol && ly >= y0 - tol && ly <= y1 + tol) return it;
    }
    return null;
  }

  function hitItem(p) {
    const list = items();
    const tol = 6 / S.view.k;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'text') continue;
      const [x0, y0, x1, y1] = textBox(it);
      if (p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol) return it;
    }
    const s = symAt(p);
    if (s) return s;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'door' && it.t !== 'window') continue;
      const l = toLocal(it, p);
      if (l.x >= -tol && l.x <= it.len + tol && Math.abs(l.y) <= Math.max(9, (it.th || WALL_TH) / 2 + 3) + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'link') continue;
      const a = resolveEnd(list, it.a), b = resolveEnd(list, it.b);
      if (distSeg(p, a.x, a.y, b.x, b.y).d <= Math.max(4, (it.w || LINK_W) / 2 + 2) + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t === 'shape' && inShape(it, p, tol)) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t === 'uline' && distSeg(p, it.x1, it.y1, it.x2, it.y2).d <= Math.max(3, (it.w || 2) / 2 + 1) + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'wall') continue;
      if (wallNearest(it, p).d <= (it.th || WALL_TH) / 2 + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t === 'floor' && inPoly(p, it.pts)) return it;
    }
    return null;
  }

  function wallHandleAt(w, p) {
    const r = 12 / S.view.k;
    if (Math.hypot(p.x - w.x1, p.y - w.y1) <= r) return 1;
    if (Math.hypot(p.x - w.x2, p.y - w.y2) <= r) return 2;
    return 0;
  }

  /* ---------- Vue : conversion, zoom, ajustement ---------- */
  function toWorld(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - S.view.x) / S.view.k, y: (e.clientY - r.top - S.view.y) / S.view.k };
  }
  function zoomAt(cx, cy, factor) {
    const k = Math.max(0.15, Math.min(5, S.view.k * factor));
    const f = k / S.view.k;
    S.view.x = cx - (cx - S.view.x) * f;
    S.view.y = cy - (cy - S.view.y) * f;
    S.view.k = k;
    applyView();
    renderOverlay();
    rememberView();
  }
  let viewTimer = null;
  function rememberView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => { const s = schema(); if (s) { s.view = { ...S.view }; save(); } }, 400);
  }

  // Rectangle englobant [x0, y0, x1, y1] d'un élément (null pour une liaison)
  function itemBounds(it) {
    if (it.t === 'uline') return [Math.min(it.x1, it.x2) - 14, Math.min(it.y1, it.y2) - 14, Math.max(it.x1, it.x2) + 14, Math.max(it.y1, it.y2) + 14];
    if (it.t === 'wall') {
      const m = (it.th || WALL_TH) / 2 + 3;
      const pts = wallPoints(it, 24);
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      return [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    }
    if (it.t === 'shape') {
      const a = rad(it.rot || 0), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      const hw = (it.w * c + it.h * s) / 2, hh = (it.w * s + it.h * c) / 2;
      return [it.x - hw, it.y - hh, it.x + hw, it.y + hh];
    }
    if (it.t === 'sym') {
      const [a, b, c, d] = SYM.map[it.key].b;
      const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) * (it.s || 1);
      return [it.x - m, it.y - m, it.x + m, it.y + m];
    }
    if (it.t === 'floor') {
      const xs = it.pts.map((q) => q[0]), ys = it.pts.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    if (it.t === 'text') return textBox(it);
    if (it.t === 'door' || it.t === 'window') {
      const a = rad(it.rot || 0), ux = Math.cos(a), uy = Math.sin(a);
      const h = it.t === 'door' ? it.len : (it.th || WALL_TH) / 2 + 4;
      const pts = [[0, -h], [0, h], [it.len, -h], [it.len, h]].map(([u, v]) => [it.x + ux * u - uy * v, it.y + uy * u + ux * v]);
      return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    }
    return null;
  }

  function contentBBox(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of list) {
      const b = itemBounds(it);
      if (!b) continue;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
  }

  function fullBBox() {
    const bb = contentBBox(S.readonly ? implItems().concat(uniItems()) : implItems());
    const cb = currentBg();
    if (!cb) return bb;
    const b = cb.b;
    if (!bb) return { x: b.x, y: b.y, w: b.w, h: b.h };
    const x0 = Math.min(bb.x, b.x), y0 = Math.min(bb.y, b.y);
    const x1 = Math.max(bb.x + bb.w, b.x + b.w), y1 = Math.max(bb.y + bb.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function fitView() {
    const bb = fullBBox();
    const W = svg.clientWidth || 800, H = svg.clientHeight || 500;
    if (!bb) { S.view = { x: 40, y: 40, k: 1 }; }
    else {
      const k = Math.max(0.15, Math.min(2, (W - 60) / bb.w, (H - 60) / bb.h));
      S.view = { k, x: (W - bb.w * k) / 2 - bb.x * k, y: (H - bb.h * k) / 2 - bb.y * k };
    }
    applyView();
    renderOverlay();
    rememberView();
  }

  /* ---------- Outils ---------- */
  const HINTS = {
    select: 'Sélection : cliquez un élément pour le déplacer ; Maj+clic en ajoute ou en retire ; Maj+glisser sur le fond trace un rectangle de sélection ; glisser le fond (ou Espace+glisser) pour vous déplacer ; molette ou pincement pour zoomer.',
    multi: 'Sélection multiple : touchez les éléments pour les ajouter ou les retirer ; glissez sur le fond pour tracer un rectangle (tout ce qui est entièrement dedans est sélectionné). Déplacement de la vue : deux doigts, clic droit ou molette.',
    circle: 'Cercle : faites glisser pour fixer son encombrement (Maj : cercle parfait) ou cliquez pour en poser un de taille standard. Rempli du matériau de mur choisi dans la palette ; redimensionnez avec les poignées.',
    square: 'Carré : faites glisser pour fixer son encombrement (Maj : carré parfait) ou cliquez pour en poser un de taille standard. Rempli du matériau de mur choisi dans la palette ; redimensionnez avec les poignées.',
    triangle: 'Triangle : faites glisser pour fixer sa base et sa hauteur ou cliquez pour en poser un de taille standard. Rempli du matériau de mur choisi dans la palette ; pivotez-le avec les boutons Pivoter.',
    floor: 'Sol : faites glisser d’un angle à l’angle opposé (rectangle), ou cliquez les sommets d’une forme libre ; fermez avec un clic sur le premier point, un double-clic ou Entrée. Matériau : palette « Sols ». Le sol se dessine sous les murs.',
    wall: 'Mur : cliquez pour poser le point de départ, puis cliquez à chaque angle. Double-clic ou Échap pour terminer. Matériau : palette ; épaisseur : barre « Murs ».',
    room: 'Pièce : faites glisser d’un angle à l’angle opposé pour créer les 4 murs.',
    door: 'Porte : cliquez sur un mur pour la poser (elle s’aligne sur le mur). Les boutons « Miroir » changent le sens d’ouverture.',
    window: 'Fenêtre : cliquez sur un mur pour la poser.',
    text: 'Texte : cliquez à l’endroit voulu (nom de pièce, repère…).',
    link: 'Liaison : faites glisser d’un symbole à un autre (commande vers éclairage, par exemple).',
    bg: 'Fond de plan : faites glisser l’image pour la déplacer, les coins pour la redimensionner. Choisissez ensuite un autre outil.',
    place: 'Cliquez sur le plan pour poser le symbole (plusieurs fois de suite). Échap pour arrêter.',
    uline: 'Trait : faites glisser d’un point à un autre, ou cliquez le départ puis chaque point suivant (double-clic ou Échap pour terminer). Le marquage (neutre, terre, conducteurs) se règle dans le panneau « Marquage du trait ».',
    jbox: 'Boîte de dérivation : cliquez pour en poser une, ou faites glisser pour fixer sa taille (Maj : carré parfait). Elle est numérotée BD0, BD1, BD2… ; « Modifier le numéro » ou un double-clic change le numéro.',
  };
  const UNI_SELECT_HINT = 'Unifilaire : le plan d’implantation est affiché mais ne peut pas être modifié ici. Cliquez un trait, une boîte ou un texte pour le déplacer ; glisser le fond déplace la vue ; molette ou pincement pour zoomer.';

  function setTool(tool, key) {
    S.tool = tool;
    S.placeKey = tool === 'place' ? key : null;
    S.draft = null;
    S.fdraft = null;
    S.drag = null;
    if (tool !== 'select') { /* on garde la sélection pour les boutons d'action */ }
    renderOverlay();
    updateUI();
  }

  function addSymbol(key, p) {
    const q = snapPt(p, STEP);
    const it = { id: uid(), t: 'sym', key, x: q.x, y: q.y, rot: 0, s: 1 };
    mutate(() => items().push(it));
    S.sel = it.id;
    renderOverlay();
    updateUI();
  }
  function addFloor(pts) {
    mutate(() => items().push({ id: uid(), t: 'floor', pts: pts.map((q) => [q.x, q.y]), mat: S.floorMat }));
  }
  function closeFloor() {
    if (S.fdraft && S.fdraft.length >= 3) addFloor(S.fdraft);
    S.fdraft = null;
    renderOverlay();
  }
  function addWall(a, b) {
    mutate(() => items().push({ id: uid(), t: 'wall', x1: a.x, y1: a.y, x2: b.x, y2: b.y, mat: S.mat, th: S.th }));
  }

  /* ---------- Souris / toucher ---------- */
  function startGesture() {
    const pts = [...S.pointers.values()];
    S.drag = null;
    S.draft = S.tool === 'wall' || S.tool === 'uline' ? S.draft : null;
    S.gesture = {
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
  }
  function updateGesture() {
    const pts = [...S.pointers.values()];
    if (pts.length < 2 || !S.gesture) return;
    const r = svg.getBoundingClientRect();
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    S.view.x += cx - S.gesture.cx;
    S.view.y += cy - S.gesture.cy;
    zoomAt(cx - r.left, cy - r.top, d / S.gesture.d);
    S.gesture.d = d; S.gesture.cx = cx; S.gesture.cy = cy;
  }

  function onDown(e) {
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ } }
    S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pointers.size === 2) { startGesture(); return; }
    if (S.pointers.size > 2) return;
    const p = toWorld(e);
    S.cursor = p;

    if (e.button === 1 || e.button === 2 || S.space) {
      S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y };
      return;
    }

    switch (S.tool) {
      case 'select': {
        // Maj / Ctrl / Cmd (ou mode « Sélection multiple ») : on ajoute ou retire des éléments
        const additive = e.shiftKey || e.ctrlKey || e.metaKey || S.multi;
        const one = S.sel && findItem(S.sel);
        if (one && isSeg(one) && !one.locked) {
          const h = wallHandleAt(one, p);
          if (h) { S.drag = { mode: 'wallEnd', id: one.id, h, before: snapJSON() }; return; }
        }
        if (one && one.t === 'floor' && !one.locked) {
          const vi = floorHandleAt(one, p);
          if (vi >= 0) { S.drag = { mode: 'floorVertex', id: one.id, i: vi, before: snapJSON() }; return; }
        }
        if (one && one.t === 'wall' && !one.locked && wallBendHandleAt(one, p)) {
          S.drag = { mode: 'wallBend', id: one.id, before: snapJSON() };
          return;
        }
        if (one && one.t === 'shape' && !one.locked) {
          const sh = shapeHandleAt(one, p);
          if (sh) { S.drag = { mode: 'shapeResize', id: one.id, hx: sh.hx, hy: sh.hy, orig: clone(one), before: snapJSON() }; return; }
        }
        const hit = hitItem(p);
        const here = { cx: e.clientX, cy: e.clientY, moved: false, vx: S.view.x, vy: S.view.y };
        // double appui (souris ou doigt) sur un texte ou une boîte de dérivation : modification
        const now = Date.now(), last = S.lastDown;
        S.lastDown = { t: now, x: e.clientX, y: e.clientY, id: hit ? hit.id : null };
        if (hit && !additive && last && last.id === hit.id && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10 &&
            (hit.t === 'text' || isJbox(hit))) {
          S.lastDown = null; S.dblDone = now;
          S.sels = [hit.id]; S.drag = null;
          render(); updateUI();
          setTimeout(() => editText(hit.id), 0);
          return;
        }
        if (hit) {
          let click = null;
          if (additive) {
            if (S.sels.includes(hit.id)) click = 'toggle';
            else S.sels = [...S.sels, hit.id];
          } else if (S.sels.length > 1 && S.sels.includes(hit.id)) click = 'collapse';
          else S.sels = [hit.id];
          const ids = S.sels.slice();
          if (ids.length > 1) {
            const origs = {};
            for (const id of ids) origs[id] = clone(findItem(id));
            S.drag = { mode: 'gmove', ids, primary: hit.id, p0: p, origs, before: snapJSON(), hitId: hit.id, click, allLocked: ids.every((id) => findItem(id).locked), ...here };
          } else {
            S.drag = { mode: 'move', id: hit.id, p0: p, orig: clone(hit), before: snapJSON(), hitId: hit.id, click, ...here };
          }
        } else if (additive) {
          S.drag = { mode: 'marquee', a: p, add: e.shiftKey || e.ctrlKey || e.metaKey, ...here };
        } else {
          S.sels = [];
          S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y };
        }
        render(); updateUI();
        break;
      }
      case 'wall': {
        const q = snapPt(p, GRID);
        if (!S.draft) { S.draft = { x: q.x, y: q.y }; S.drag = { mode: 'wall', fresh: true, cx: e.clientX, cy: e.clientY }; }
        else { S.drag = { mode: 'wall', fresh: false, cx: e.clientX, cy: e.clientY }; }
        renderOverlay();
        break;
      }
      case 'uline': {
        const q = uniSnap(p, S.draft);
        if (!S.draft) { S.draft = { x: q.x, y: q.y }; S.drag = { mode: 'uline', fresh: true, cx: e.clientX, cy: e.clientY }; }
        else { S.drag = { mode: 'uline', fresh: false, cx: e.clientX, cy: e.clientY }; }
        renderOverlay();
        break;
      }
      case 'jbox':
      case 'circle':
      case 'square':
      case 'triangle':
        S.drag = { mode: 'shapeNew', kind: S.tool, a: snapPt(p, STEP), cx: e.clientX, cy: e.clientY, moved: false, shift: e.shiftKey };
        renderOverlay();
        break;
      case 'floor': {
        const q = snapPt(p, GRID);
        if (!S.fdraft) { S.fdraft = [{ x: q.x, y: q.y }]; S.drag = { mode: 'floor', fresh: true, cx: e.clientX, cy: e.clientY, moved: false }; }
        else { S.drag = { mode: 'floor', fresh: false, cx: e.clientX, cy: e.clientY, moved: false }; }
        renderOverlay();
        break;
      }
      case 'room':
        S.drag = { mode: 'room', a: snapPt(p, GRID) };
        renderOverlay();
        break;
      case 'link': {
        const s = symAt(p);
        const a = s ? { id: s.id, x: s.x, y: s.y } : { ...snapPt(p, STEP) };
        S.drag = { mode: 'link', a };
        renderOverlay();
        break;
      }
      case 'bg': {
        const cb = currentBg();
        if (!cb) { S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y }; break; }
        const b = cb.b, r = 14 / S.view.k;
        let corner = null;
        for (const [name, hx, hy] of [['tl', b.x, b.y], ['tr', b.x + b.w, b.y], ['bl', b.x, b.y + b.h], ['br', b.x + b.w, b.y + b.h]]) {
          if (Math.abs(p.x - hx) <= r && Math.abs(p.y - hy) <= r) { corner = name; break; }
        }
        if (corner) S.drag = { mode: 'bgScale', corner, orig: { ...b } };
        else if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) S.drag = { mode: 'bgMove', p0: p, orig: { ...b } };
        else S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y };
        break;
      }
      case 'place':
        if (S.placeKey) addSymbol(S.placeKey, p);
        break;
      case 'door':
      case 'window': {
        const it = { id: uid(), t: S.tool, x: 0, y: 0, rot: 0, len: S.tool === 'door' ? 40 : 60 };
        placeOpening(it, p);
        mutate(() => items().push(it));
        S.sel = it.id;
        renderOverlay(); updateUI();
        break;
      }
      case 'text':
        setTimeout(() => {
          const t = window.prompt('Texte à afficher (ex. : Chambre) :', '');
          if (t && t.trim()) {
            const q = snapPt(p, STEP);
            const it = { id: uid(), t: 'text', x: q.x, y: q.y, text: t.trim().slice(0, 80), size: 16 };
            mutate(() => items().push(it));
            S.sel = it.id;
            renderOverlay(); updateUI();
          }
        }, 0);
        break;
    }
  }

  function onMove(e) {
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.gesture && S.pointers.size >= 2) { updateGesture(); return; }
    const p = toWorld(e);
    S.cursor = p;
    const d = S.drag;
    if (!d) { renderOverlay(); return; }
    if (d.cx !== undefined && !d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true;
    if (d.mode === 'shapeNew') d.shift = e.shiftKey;

    if (d.mode === 'pan') {
      S.view.x = d.vx + (e.clientX - d.cx);
      S.view.y = d.vy + (e.clientY - d.cy);
      applyView();
      return;
    }
    if (d.mode === 'gmove') {
      if (!d.moved) return;
      if (d.allLocked) {                     // tout est figé : glisser déplace la vue
        S.view.x = d.vx + (e.clientX - d.cx); S.view.y = d.vy + (e.clientY - d.cy);
        d.panned = true; applyView(); return;
      }
      const hasWall = d.ids.some((id) => d.origs[id].t === 'wall' || d.origs[id].t === 'floor');
      const step = hasWall ? GRID : STEP;
      const dx = snapOn(p.x - d.p0.x, step), dy = snapOn(p.y - d.p0.y, step);
      for (const id of d.ids) {
        const it = findItem(id), o = d.origs[id];
        if (!it || it.t === 'link' || it.locked) continue;
        if (isSeg(it)) { it.x1 = o.x1 + dx; it.y1 = o.y1 + dy; it.x2 = o.x2 + dx; it.y2 = o.y2 + dy; }
        else if (it.t === 'floor') it.pts = o.pts.map(([x, y]) => [x + dx, y + dy]);
        else { it.x = o.x + dx; it.y = o.y + dy; }
      }
      renderScene();
      renderOverlay();
      return;
    }
    if (d.mode === 'move') {
      if (!d.moved) return;
      const it = findItem(d.id);
      if (!it) return;
      if (it.locked) {                       // élément figé : glisser déplace la vue
        S.view.x = d.vx + (e.clientX - d.cx); S.view.y = d.vy + (e.clientY - d.cy);
        d.panned = true; applyView(); return;
      }
      const dx = p.x - d.p0.x, dy = p.y - d.p0.y, o = d.orig;
      if (isSeg(it)) {
        const st = it.t === 'wall' ? GRID : STEP;
        const ex = snapOn(o.x1 + dx, st) - o.x1, ey = snapOn(o.y1 + dy, st) - o.y1;
        it.x1 = o.x1 + ex; it.y1 = o.y1 + ey; it.x2 = o.x2 + ex; it.y2 = o.y2 + ey;
      } else if (it.t === 'floor') {
        const ex = snapOn(o.pts[0][0] + dx, GRID) - o.pts[0][0], ey = snapOn(o.pts[0][1] + dy, GRID) - o.pts[0][1];
        it.pts = o.pts.map(([x, y]) => [x + ex, y + ey]);
      } else if (it.t === 'sym' || it.t === 'text' || it.t === 'shape') {
        it.x = snapOn(o.x + dx, STEP); it.y = snapOn(o.y + dy, STEP);
      } else if (it.t === 'door' || it.t === 'window') {
        const c0 = openingCenter(o);
        it.rot = o.rot;
        placeOpening(it, { x: c0.x + dx, y: c0.y + dy });
      }
      renderScene();
      renderOverlay();
      return;
    }
    if (d.mode === 'bgMove' || d.mode === 'bgScale') {
      const b = schema().bg;
      if (!b) return;
      const o = d.orig;
      if (d.mode === 'bgMove') {
        b.x = rnd(o.x + p.x - d.p0.x); b.y = rnd(o.y + p.y - d.p0.y);
      } else {
        const left = d.corner.includes('l'), top = d.corner.includes('t');
        const ox = left ? o.x + o.w : o.x, oy = top ? o.y + o.h : o.y;
        const w = Math.max(40, Math.abs(p.x - ox));
        const h = w * (o.h / o.w);
        b.w = rnd(w); b.h = rnd(h);
        b.x = rnd(left ? ox - w : ox); b.y = rnd(top ? oy - h : oy);
      }
      renderBg();
      renderOverlay();
      return;
    }
    if (d.mode === 'wallBend') {
      const w = findItem(d.id);
      if (!w) return;
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
      if (L < 1) return;
      let s = (p.x - (w.x1 + w.x2) / 2) * (-dy / L) + (p.y - (w.y1 + w.y2) / 2) * (dx / L);
      s = snapOn(s, 5);
      if (Math.abs(s) < 4) s = 0;
      s = Math.max(-L, Math.min(L, s));
      if (s) w.bend = rnd(s); else delete w.bend;
      renderScene();
      renderOverlay();
      return;
    }
    if (d.mode === 'shapeResize') {
      const s = findItem(d.id);
      if (!s) return;
      const o = d.orig, MIN = 10, hx = d.hx, hy = d.hy;
      const l = toLocal(o, snapPt(p, STEP));
      const ox = -hx * o.w / 2, oy = -hy * o.h / 2;
      let nw = o.w, nh = o.h;
      if (hx !== 0) nw = Math.max(MIN, (l.x - ox) * hx);
      if (hy !== 0) nh = Math.max(MIN, (l.y - oy) * hy);
      if (hx !== 0 && hy !== 0 && !e.shiftKey) {        // coins : proportions conservées (Maj = libre)
        const k = Math.max(nw / o.w, nh / o.h);
        nw = Math.max(MIN, o.w * k); nh = Math.max(MIN, o.h * k);
      }
      const cx = hx !== 0 ? ox + hx * nw / 2 : 0, cy = hy !== 0 ? oy + hy * nh / 2 : 0;
      const a = rad(o.rot || 0);
      s.w = rnd(nw); s.h = rnd(nh);
      s.x = rnd(o.x + cx * Math.cos(a) - cy * Math.sin(a));
      s.y = rnd(o.y + cx * Math.sin(a) + cy * Math.cos(a));
      renderScene();
      renderOverlay();
      return;
    }
    if (d.mode === 'floorVertex') {
      const f = findItem(d.id);
      if (!f) return;
      const q = snapPt(p, GRID);
      f.pts[d.i] = [q.x, q.y];
      renderScene();
      renderOverlay();
      return;
    }
    if (d.mode === 'wallEnd') {
      const w = findItem(d.id);
      if (!w) return;
      let q = snapPt(p, GRID);
      if (w.t === 'uline') {
        const other = d.h === 1 ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 };
        q = d.snap = uniSnap(p, other, w.id);
      }
      if (d.ox === undefined) { d.ox = d.h === 1 ? w.x1 : w.x2; d.oy = d.h === 1 ? w.y1 : w.y2; }
      if (d.h === 1) { w.x1 = q.x; w.y1 = q.y; } else { w.x2 = q.x; w.y2 = q.y; }
      if (w.t === 'uline' && w.x1 === w.x2 && w.y1 === w.y2) { if (d.h === 1) { w.x1 = d.ox; w.y1 = d.oy; } else { w.x2 = d.ox; w.y2 = d.oy; } }
      renderScene();
      renderOverlay();
      return;
    }
    renderOverlay();
  }

  function onUp(e) {
    const wasGesture = !!S.gesture;
    S.pointers.delete(e.pointerId);
    if (S.gesture) { if (S.pointers.size < 2) S.gesture = null; return; }
    if (wasGesture) return;
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    const p = toWorld(e);
    S.cursor = p;

    if (d.mode === 'pan') { rememberView(); return; }
    if (d.mode === 'bgMove' || d.mode === 'bgScale') { save(); renderOverlay(); return; }
    if (d.mode === 'move' || d.mode === 'gmove' || d.mode === 'wallEnd' || d.mode === 'floorVertex' || d.mode === 'wallBend' || d.mode === 'shapeResize') {
      if (d.panned) rememberView();
      const now = snapJSON();
      if (now !== d.before) { pushUndo(d.before); save(); }
      if (!d.moved && d.click === 'toggle') S.sels = S.sels.filter((id) => id !== d.hitId);
      else if (!d.moved && d.click === 'collapse') S.sels = [d.hitId];
      render(); updateUI();
      return;
    }
    if (d.mode === 'marquee') {
      if (!d.moved) { if (!d.add) S.sels = []; render(); updateUI(); return; }
      const x0 = Math.min(d.a.x, p.x), x1 = Math.max(d.a.x, p.x), y0 = Math.min(d.a.y, p.y), y1 = Math.max(d.a.y, p.y);
      const inside = items().filter((it) => {
        const b = itemBounds(it);
        return b && b[0] >= x0 && b[1] >= y0 && b[2] <= x1 && b[3] <= y1;
      }).map((it) => it.id);
      S.sels = d.add ? [...new Set([...S.sels, ...inside])] : inside;
      render(); updateUI();
      return;
    }
    if (d.mode === 'wall') {
      const q = snapPt(p, GRID);
      if (d.fresh) {
        const moved = Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 8;
        if (moved) {
          if (q.x !== S.draft.x || q.y !== S.draft.y) addWall(S.draft, q);
          S.draft = null;
        }
      } else if (q.x === S.draft.x && q.y === S.draft.y) {
        S.draft = null;
      } else {
        addWall(S.draft, q);
        S.draft = { x: q.x, y: q.y };
      }
      renderOverlay();
      return;
    }
    if (d.mode === 'shapeNew') {
      if (d.kind === 'jbox') addJbox(jboxFromDrag(d.a, snapPt(p, STEP), d.moved, e.shiftKey));
      else addShape(d.kind, shapeFromDrag(d.a, snapPt(p, STEP), d.moved, e.shiftKey));
      return;
    }
    if (d.mode === 'uline') {
      const q = uniSnap(p, S.draft);
      if (d.fresh) {
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 8) {
          if (q.x !== S.draft.x || q.y !== S.draft.y) addULine(S.draft, q);
          S.draft = null;
        }
      } else if (q.x === S.draft.x && q.y === S.draft.y) {
        S.draft = null;
      } else {
        addULine(S.draft, q);
        S.draft = { x: q.x, y: q.y };
      }
      renderOverlay();
      return;
    }
    if (d.mode === 'floor') {
      const q = snapPt(p, GRID);
      if (d.fresh) {
        if (d.moved) {                       // glisser = rectangle
          const a = S.fdraft[0];
          if (Math.abs(q.x - a.x) >= GRID && Math.abs(q.y - a.y) >= GRID) addFloor([{ x: a.x, y: a.y }, { x: q.x, y: a.y }, { x: q.x, y: q.y }, { x: a.x, y: q.y }]);
          S.fdraft = null;
        }                                    // sinon : clic = premier sommet d'une forme libre
      } else {
        const pts = S.fdraft, first = pts[0], last = pts[pts.length - 1];
        if (q.x === first.x && q.y === first.y && pts.length >= 3) { addFloor(pts); S.fdraft = null; }
        else if (q.x !== last.x || q.y !== last.y) pts.push({ x: q.x, y: q.y });
      }
      renderOverlay();
      return;
    }
    if (d.mode === 'room') {
      const a = d.a, q = snapPt(p, GRID);
      if (Math.abs(q.x - a.x) >= GRID && Math.abs(q.y - a.y) >= GRID) {
        const x0 = Math.min(a.x, q.x), x1 = Math.max(a.x, q.x), y0 = Math.min(a.y, q.y), y1 = Math.max(a.y, q.y);
        mutate(() => {
          const l = items();
          const mk = (ax, ay, bx, by) => l.push({ id: uid(), t: 'wall', x1: ax, y1: ay, x2: bx, y2: by, mat: S.mat, th: S.th });
          mk(x0, y0, x1, y0); mk(x1, y0, x1, y1); mk(x1, y1, x0, y1); mk(x0, y1, x0, y0);
        });
        setTimeout(() => {
          const name = window.prompt('Nom de la pièce (facultatif) :', '');
          if (name && name.trim()) {
            mutate(() => items().push({ id: uid(), t: 'text', x: snapTo((x0 + x1) / 2, STEP), y: snapTo((y0 + y1) / 2, STEP), text: name.trim().slice(0, 80), size: 16 }));
          }
        }, 0);
      }
      renderOverlay();
      return;
    }
    if (d.mode === 'link') {
      const t = symAt(p);
      const b = t ? { id: t.id, x: t.x, y: t.y } : { ...snapPt(p, STEP) };
      const same = (d.a.id && d.a.id === b.id) || (!d.a.id && !b.id && d.a.x === b.x && d.a.y === b.y);
      const a = resolveEnd(items(), d.a);
      if (!same && Math.hypot(a.x - b.x, a.y - b.y) > 2) {
        mutate(() => items().push({ id: uid(), t: 'link', a: d.a, b, w: S.linkW, ...(S.linkT ? { tr: S.linkT } : {}) }));
      }
      renderOverlay();
    }
  }

  function onCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.gesture = null;
    if (S.drag && (S.drag.mode === 'move' || S.drag.mode === 'gmove' || S.drag.mode === 'wallEnd' || S.drag.mode === 'floorVertex' || S.drag.mode === 'wallBend' || S.drag.mode === 'shapeResize')) setItems(JSON.parse(S.drag.before));
    S.drag = null;
    renderOverlay();
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('pointerleave', () => { if (!S.drag) { S.cursor = null; renderOverlay(); } });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => {
    if (S.tool === 'wall' || S.tool === 'uline') { S.draft = null; renderOverlay(); return; }
    if (S.tool === 'floor') { closeFloor(); return; }
    if (S.tool === 'select') {
      if (Date.now() - (S.dblDone || 0) < 800) return;     // déjà traité par le double appui
      const hit = hitItem(toWorld(e));
      if (hit && (hit.t === 'text' || isJbox(hit))) editText(hit.id);
    }
  });

  /* ---------- Actions sur la sélection ---------- */
  const sel = () => (S.sel ? findItem(S.sel) : null);

  function rotateSel(dir) {
    const one = sel();
    if (S.sels.length > 1 || (one && (one.t === 'floor' || one.t === 'uline'))) { rotateGroup(dir); return; }
    const it = sel();
    if (!it || it.locked || !['sym', 'door', 'window', 'shape'].includes(it.t)) return;
    mutate(() => { it.rot = ((it.rot || 0) + 90 * dir + 360) % 360; });
  }

  // Miroir par rapport à l'écran (comme « Retourner » dans un traitement de texte) :
  //   horizontal = gauche <-> droite ; vertical = haut <-> bas.
  // Un miroir inverse aussi le sens de rotation : rot devient -rot. Pour une porte, l'ouverture
  // (dont x,y est le point de départ) est recalée pour rester exactement à la même place.
  function mirrorInPlace(it, axis) {
    if (it.t === 'door' && it.flip !== undefined) { it.my = !!(it.my || it.flip); delete it.flip; }
    it.rot = rnd((((-(it.rot || 0)) % 360) + 360) % 360);
    if (it.t === 'window') return;          // une fenêtre est symétrique : seule sa rotation change
    if (axis === 'h') it.mx = !it.mx; else it.my = !it.my;
  }
  // Forme : cercle et carré sont symétriques ; le triangle (pointe en haut) change de sens avec un miroir vertical
  function mirrorShape(it, axis) {
    it.rot = rnd((((-(it.rot || 0) + (axis === 'v' && it.kind === 'triangle' ? 180 : 0)) % 360) + 360) % 360);
  }
  function mirrorSel(axis) {
    const one = sel();
    if (S.sels.length > 1 || (one && (one.t === 'floor' || one.t === 'uline'))) { mirrorGroup(axis); return; }
    const it = sel();
    if (!it || it.locked || (it.t !== 'sym' && it.t !== 'door' && it.t !== 'shape')) return;
    mutate(() => {
      const c = it.t === 'door' ? openingCenter(it) : null;
      if (it.t === 'shape') mirrorShape(it, axis); else mirrorInPlace(it, axis);
      if (c) {
        const a = rad(it.rot);
        it.x = rnd(c.x - Math.cos(a) * it.len / 2);
        it.y = rnd(c.y - Math.sin(a) * it.len / 2);
      }
    });
  }

  function resizeItem(it, dir) {
    if (it.t === 'sym') it.s = rnd(Math.max(0.4, Math.min(3, (it.s || 1) * (dir > 0 ? 1.15 : 1 / 1.15))));
    else if (it.t === 'door' || it.t === 'window') {
      const c = openingCenter(it);
      it.len = Math.max(20, Math.min(200, it.len + 10 * dir));
      const a = rad(it.rot || 0);
      it.x = rnd(c.x - Math.cos(a) * it.len / 2);
      it.y = rnd(c.y - Math.sin(a) * it.len / 2);
    } else if (it.t === 'text') it.size = Math.max(8, Math.min(80, it.size + 2 * dir));
    else if (it.t === 'shape') {
      const f = dir > 0 ? 1.15 : 1 / 1.15;
      it.w = rnd(Math.max(10, Math.min(2000, it.w * f))); it.h = rnd(Math.max(10, Math.min(2000, it.h * f)));
    }
  }
  function resizeSel(dir) {
    const list = selItems().filter((i) => !i.locked && ['sym', 'door', 'window', 'text', 'shape'].includes(i.t));
    if (!list.length) return;
    mutate(() => list.forEach((it) => resizeItem(it, dir)));
  }

  /* ----- Sélection multiple : rotation et miroir du groupe autour de son centre ----- */
  // Le centre est calculé sur les points d'ancrage (extrémités des murs, centres des objets), puis calé
  // sur la grille pour que les murs restent alignés. Il est mémorisé tant que la sélection n'a pas
  // été modifiée par autre chose qu'une rotation ou un miroir : ainsi 4 rotations (ou 2 miroirs)
  // ramènent exactement le groupe à sa place, même quand le centre tombe entre deux nœuds de grille.
  let gcMemo = null;
  function exactCenter(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const it of list) {
      if (isSeg(it)) { add(it.x1, it.y1); add(it.x2, it.y2); }
      else if (it.t === 'floor') { for (const q of it.pts) add(q[0], q[1]); }
      else if (it.t === 'door' || it.t === 'window') { const c = openingCenter(it); add(c.x, c.y); }
      else add(it.x, it.y);
    }
    return x0 === Infinity ? { x: 0, y: 0 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  function groupCenter(list) {
    const e = exactCenter(list);
    const key = list.map((i) => i.id).sort().join(',');
    if (gcMemo && gcMemo.key === key && Math.abs(gcMemo.e.x - e.x) < 0.5 && Math.abs(gcMemo.e.y - e.y) < 0.5) return gcMemo.c;
    const c = { x: snapTo(e.x, GRID), y: snapTo(e.y, GRID) };
    gcMemo = { key, c, e };
    return c;
  }
  function rememberCenter(list) { if (gcMemo) gcMemo.e = exactCenter(list); }
  function rotateGroup(dir) {
    const list = selItems().filter((i) => i.t !== 'link' && !i.locked);
    if (list.length < 1) return;
    const c = groupCenter(list);
    const rp = (x, y) => ({ x: rnd(c.x - (y - c.y) * dir), y: rnd(c.y + (x - c.x) * dir) });
    mutate(() => {
      for (const it of list) {
        if (isSeg(it)) {
          const a = rp(it.x1, it.y1), b = rp(it.x2, it.y2);
          it.x1 = a.x; it.y1 = a.y; it.x2 = b.x; it.y2 = b.y;
        } else if (it.t === 'floor') {
          it.pts = it.pts.map(([x, y]) => { const q = rp(x, y); return [q.x, q.y]; });
        } else if (it.t === 'sym' || it.t === 'text' || it.t === 'shape') {
          const q = rp(it.x, it.y);
          it.x = q.x; it.y = q.y;
          if (it.t === 'sym' || it.t === 'shape') it.rot = ((it.rot || 0) + 90 * dir + 360) % 360;
        } else {
          const cc = openingCenter(it), q = rp(cc.x, cc.y);
          it.rot = ((it.rot || 0) + 90 * dir + 360) % 360;
          const a = rad(it.rot);
          it.x = rnd(q.x - Math.cos(a) * it.len / 2);
          it.y = rnd(q.y - Math.sin(a) * it.len / 2);
        }
      }
    });
    rememberCenter(list);
  }
  function mirrorGroup(axis) {
    const list = selItems().filter((i) => i.t !== 'link' && !i.locked);
    if (list.length < 1) return;
    const c = groupCenter(list);
    const rx = (x) => rnd(2 * c.x - x), ry = (y) => rnd(2 * c.y - y);
    mutate(() => {
      for (const it of list) {
        if (isSeg(it)) {
          if (axis === 'h') { it.x1 = rx(it.x1); it.x2 = rx(it.x2); } else { it.y1 = ry(it.y1); it.y2 = ry(it.y2); }
          if (it.bend) it.bend = -it.bend;      // un miroir inverse le côté de la courbure
        } else if (it.t === 'floor') {
          it.pts = it.pts.map(([x, y]) => (axis === 'h' ? [rx(x), y] : [x, ry(y)]));
        } else if (it.t === 'text') {
          if (axis === 'h') it.x = rx(it.x); else it.y = ry(it.y);   // le texte reste lisible : seule sa position change
        } else if (it.t === 'shape') {
          mirrorShape(it, axis);
          if (axis === 'h') it.x = rx(it.x); else it.y = ry(it.y);
        } else if (it.t === 'sym') {
          mirrorInPlace(it, axis);
          if (axis === 'h') it.x = rx(it.x); else it.y = ry(it.y);
        } else {
          const cc = openingCenter(it);
          const q = axis === 'h' ? { x: rx(cc.x), y: cc.y } : { x: cc.x, y: ry(cc.y) };
          mirrorInPlace(it, axis);
          const a = rad(it.rot);
          it.x = rnd(q.x - Math.cos(a) * it.len / 2);
          it.y = rnd(q.y - Math.sin(a) * it.len / 2);
        }
      }
    });
    rememberCenter(list);
  }

  function editText(id) {
    const it = findItem(id || S.sel);
    if (it && !it.locked && isJbox(it)) { editJbox(it); return; }
    if (!it || it.locked || it.t !== 'text') return;
    const t = window.prompt('Texte à afficher :', it.text);
    if (t !== null && t.trim()) mutate(() => { it.text = t.trim().slice(0, 80); });
  }
  function duplicateSel() {
    const list = selItems().filter((i) => i.t !== 'link');
    if (!list.length) return;
    const map = {}, copies = [];
    for (const it of list) {
      const c = clone(it);
      c.id = uid();
      delete c.locked;                      // la copie d'un élément figé n'est pas figée
      map[it.id] = c.id;
      if (isSeg(it)) { c.x1 += GRID; c.y1 += GRID; c.x2 += GRID; c.y2 += GRID; }
      else if (it.t === 'floor') c.pts = c.pts.map(([x, y]) => [x + GRID, y + GRID]);
      else { c.x += GRID; c.y += GRID; }
      copies.push(c);
    }
    // les liaisons entre deux éléments dupliqués sont dupliquées aussi
    const moved = (e) => ({ ...e, id: map[e.id], x: e.x + GRID, y: e.y + GRID });
    for (const l of items()) {
      if (l.t === 'link' && l.a && l.b && l.a.id && l.b.id && map[l.a.id] && map[l.b.id]) {
        copies.push({ ...clone(l), id: uid(), a: moved(l.a), b: moved(l.b) });
      }
    }
    mutate(() => items().push(...copies));
    S.sels = copies.filter((c) => c.t !== 'link').map((c) => c.id);
    render(); updateUI();
  }
  function deleteSel() {
    const ids = new Set(selItems().filter((i) => !i.locked).map((i) => i.id));
    if (!ids.size) return;
    mutate(() => {
      schema()[layerKey()] = items().filter((i) => !ids.has(i.id) && !(i.t === 'link' && ((i.a && ids.has(i.a.id)) || (i.b && ids.has(i.b.id)))));
    });
    pruneSel();
    render(); updateUI();
  }
  function nudgeSel(dx, dy) {
    const list = selItems().filter((i) => i.t !== 'link' && !i.locked);
    if (!list.length) return;
    mutate(() => {
      for (const it of list) {
        if (isSeg(it)) { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
        else if (it.t === 'floor') it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
        else { it.x += dx; it.y += dy; }
      }
    });
  }
  // Figer : l'élément ne peut plus être déplacé ni modifié ; un cadenas rouge le signale (écran uniquement)
  function toggleLock() {
    const list = selItems();
    if (!list.length) return;
    const unlock = list.every((i) => i.locked);
    mutate(() => { for (const it of list) { if (unlock) delete it.locked; else it.locked = true; } });
  }
  function unlockAll() {
    if (!items().some((i) => i.locked)) return;
    mutate(() => { for (const it of items()) delete it.locked; });
  }
  function selectAll() {
    S.tool = 'select';
    S.sels = items().filter((i) => i.t !== 'link').map((i) => i.id);
    render(); updateUI();
  }

  /* ---------- Murs : matériau et épaisseur ---------- */
  const selWalls = () => selItems().filter((i) => i.t === 'wall');
  const clampTh = (v) => Math.max(2, Math.min(60, v));

  // Aligne l'épaisseur des portes / fenêtres sur celle du mur qui les porte
  function syncOpenings() {
    const list = items();
    for (const o of list) {
      if (o.t !== 'door' && o.t !== 'window') continue;
      const c = openingCenter(o);
      for (const w of list) {
        if (w.t === 'wall' && wallNearest(w, c).d <= 2) o.th = w.th || WALL_TH;
      }
    }
  }
  function setMaterial(key) {
    if (!MAT.map[key]) return;
    const ws = selItems().filter((w) => (w.t === 'wall' || w.t === 'shape') && !w.locked);
    S.mat = key;
    if (ws.length) mutate(() => { for (const w of ws) w.mat = key; });
    else updateUI();
  }
  function bendSelected(dir) {
    const ws = selWalls().filter((w) => !w.locked);
    if (!ws.length) return;
    mutate(() => {
      for (const w of ws) {
        const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        let b = (w.bend || 0) + 10 * dir;
        if (Math.abs(b) < 3) b = 0;
        b = Math.max(-L, Math.min(L, b));
        if (b) w.bend = rnd(b); else delete w.bend;
      }
    });
  }
  function straightenSelected() {
    const ws = selWalls().filter((w) => !w.locked && w.bend);
    if (!ws.length) return;
    mutate(() => { for (const w of ws) delete w.bend; });
  }
  function setFloorMaterial(key) {
    if (!MAT.floorMap[key]) return;
    const fs = selItems().filter((i) => i.t === 'floor' && !i.locked);
    S.floorMat = key;
    if (fs.length) mutate(() => { for (const f of fs) f.mat = key; });
    else updateUI();
  }
  function changeThickness(dir) {
    const ws = selWalls().filter((w) => !w.locked);
    const nt = clampTh((ws.length ? (ws[0].th || WALL_TH) : S.th) + 2 * dir);
    S.th = nt;
    if (ws.length) mutate(() => { for (const w of ws) w.th = nt; syncOpenings(); });
    else updateUI();
  }
  function applyAllWalls() {
    const walls = items().filter((i) => i.t === 'wall' && !i.locked);
    if (!walls.length) return;
    const src = selWalls()[0];
    const mat = src ? (src.mat || 'plein') : S.mat;
    const th = src ? (src.th || WALL_TH) : S.th;
    mutate(() => { for (const w of walls) { w.mat = mat; w.th = th; } syncOpenings(); });
  }

  /* ---------- Liaisons : épaisseur et transparence ---------- */
  const selLinks = () => selItems().filter((i) => i.t === 'link' && !i.locked);
  function changeLinkWidth(dir) {
    const ls = selLinks();
    const nw = clampLW((ls.length ? (ls[0].w || LINK_W) : S.linkW) + 0.5 * dir);
    S.linkW = nw;
    if (ls.length) mutate(() => { for (const l of ls) l.w = nw; });
    else updateUI();
  }
  function setLinkTransparency(v, final) {
    const t = clampLT(v);
    S.linkT = t;
    const ls = selLinks();
    if (!ls.length) { updateUI(); return; }
    if (!S.ltBefore) S.ltBefore = snapJSON();          // un seul « Annuler » pour tout le glissement du curseur
    for (const l of ls) { if (t) l.tr = t; else delete l.tr; }
    renderScene();
    if (final) {
      if (snapJSON() !== S.ltBefore) { pushUndo(S.ltBefore); save(); }
      S.ltBefore = null;
      updateUI();
    }
  }
  function applyAllLinks() {
    const ls = items().filter((i) => i.t === 'link' && !i.locked);
    if (!ls.length) return;
    const src = selLinks()[0];
    const w = src ? (src.w || LINK_W) : S.linkW, t = src ? (src.tr || 0) : S.linkT;
    mutate(() => { for (const l of ls) { l.w = w; if (t) l.tr = t; else delete l.tr; } });
  }
  function toggleLockMarks() {
    S.lockMarks = !S.lockMarks;
    try { window.localStorage.setItem('ef_sch_locks', S.lockMarks ? '1' : '0'); } catch (e) { /* ignoré */ }
    renderOverlay(); updateUI();
  }

  /* ---------- Interface ---------- */
  function paletteHTML() {
    let h = `<div class="uni-only">${uniPanelHTML()}</div><div class="impl-only">` +
      '<h3 class="sch-group sch-group-main">Matériaux des murs</h3>' +
      '<p class="sch-note">Cliquez un matériau : il s’applique au mur sélectionné et aux prochains murs.</p>';
    for (const g of MAT.groups) {
      h += `<h4 class="sch-subgroup">${esc(g.name)}</h4><div class="sch-mats">`;
      for (const it of g.items) {
        h += `<button type="button" class="sch-mat" data-mat="${it.key}" title="${esc(it.name)}" aria-label="${esc(it.name)}">${MAT.swatch(it.key)}<span>${esc(it.name)}</span></button>`;
      }
      h += '</div>';
    }
    h += '<h3 class="sch-group sch-group-main" style="margin-top:18px">Sols</h3>' +
      '<p class="sch-note">Outil « Sol » : un sol est une surface dessinée sous les murs. Cliquez un matériau pour l’appliquer au sol sélectionné et aux prochains sols.</p>';
    for (const g of MAT.floorGroups) {
      h += '<div class="sch-mats">';
      for (const it of g.items) {
        h += `<button type="button" class="sch-mat sch-flr" data-floor="${it.key}" title="${esc(it.name)}" aria-label="${esc(it.name)}">${MAT.swatch(it.key)}<span>${esc(it.name)}</span></button>`;
      }
      h += '</div>';
    }
    h += '</div><div class="impl-only"><h3 class="sch-group sch-group-main" style="margin-top:18px">Symboles électriques</h3>';
    for (const g of SYM.groups) {
      h += `<h3 class="sch-group">${esc(g.name)}</h3><div class="sch-syms">`;
      for (const d of g.items) {
        const [x0, y0, x1, y1] = d.b, pad = 4;
        h += `<button type="button" class="sch-sym" data-sym="${d.key}" title="${esc(d.name)}" aria-label="${esc(d.name)}">` +
          `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" width="52" height="40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${SYM.inner(d.key, 0)}</svg>` +
          `<span>${esc(d.name)}</span></button>`;
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function updateUI() {
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
    root.querySelectorAll('.sch-sym').forEach((b) => b.classList.toggle('is-active', S.tool === 'place' && b.dataset.sym === S.placeKey));
    const list = selItems();
    const free = list.filter((i) => !i.locked);
    const movable = free.filter((i) => i.t !== 'link');
    const nLocked = list.length - free.length;
    const t = list.length === 1 && free.length === 1 ? free[0].t : null;
    const en = (id, ok) => { const b = $(id); if (b) b.disabled = !ok; };
    const canRot = (list.length > 1 && movable.length > 0) || ['sym', 'door', 'window', 'floor', 'shape', 'uline'].includes(t);
    const canMirror = (list.length > 1 && movable.length > 0) || ['sym', 'door', 'floor', 'shape', 'uline'].includes(t);
    const canSize = free.some((i) => ['sym', 'door', 'window', 'text', 'shape'].includes(i.t));
    en('#sch-rot-l', canRot);
    en('#sch-rot-r', canRot);
    en('#sch-mirror-h', canMirror);
    en('#sch-mirror-v', canMirror);
    en('#sch-size-m', canSize);
    en('#sch-size-p', canSize);
    en('#sch-dup', list.some((i) => i.t !== 'link'));
    const jb = t === 'shape' && isJbox(free[0]);
    en('#sch-edit', t === 'text' || jb);
    $('#sch-edit').textContent = jb ? 'Modifier le numéro' : 'Modifier le texte';
    en('#sch-delete', free.length > 0);
    en('#sch-lock', list.length > 0);
    const bw = selWalls().filter((w) => !w.locked);
    en('#sch-bend-m', bw.length > 0);
    en('#sch-bend-p', bw.length > 0);
    en('#sch-straight', bw.some((w) => w.bend));
    en('#sch-unlockall', items().some((i) => i.locked));
    $('#sch-lockmarks').textContent = S.lockMarks ? 'Masquer les cadenas' : 'Afficher les cadenas';
    $('#sch-lockmarks').setAttribute('aria-pressed', String(!S.lockMarks));
    const lks = selLinks();
    const lw = lks.length ? (lks[0].w || LINK_W) : S.linkW, lt = lks.length ? (lks[0].tr || 0) : S.linkT;
    $('#sch-lw-val').textContent = String(lw);
    if (document.activeElement !== $('#sch-lt')) $('#sch-lt').value = String(Math.round(lt * 100));
    $('#sch-lt-val').textContent = Math.round(lt * 100) + ' %';
    en('#sch-link-all', items().some((i) => i.t === 'link'));
    $('#sch-lock').textContent = list.length && nLocked === list.length ? 'Libérer' : 'Figer';
    en('#sch-selectall', items().some((i) => i.t !== 'link'));
    $('#sch-selcount').textContent = list.length > 1
      ? list.length + ' éléments sélectionnés' + (nLocked ? ' (dont ' + nLocked + ' figé' + (nLocked > 1 ? 's' : '') + ')' : '')
      : (nLocked ? 'Élément figé' : '');
    $('#sch-multi').setAttribute('aria-pressed', String(S.multi && S.tool === 'select'));
    en('#sch-undo', S.undo.length > 0);
    en('#sch-redo', S.redo.length > 0);
    const ws = selWalls();
    const mt = selItems().filter((i) => i.t === 'wall' || i.t === 'shape');
    const sameMat = mt.length && mt.every((w) => (w.mat || 'plein') === (mt[0].mat || 'plein'));
    const sameTh = ws.length && ws.every((w) => (w.th || WALL_TH) === (ws[0].th || WALL_TH));
    const curMat = mt.length ? (sameMat ? (mt[0].mat || 'plein') : null) : S.mat;
    root.querySelectorAll('.sch-mat[data-mat]').forEach((b) => b.classList.toggle('is-active', b.dataset.mat === curMat));
    const fl = selItems().filter((i) => i.t === 'floor');
    const sameFl = fl.length && fl.every((f) => f.mat === fl[0].mat);
    const curFl = fl.length ? (sameFl ? fl[0].mat : null) : S.floorMat;
    root.querySelectorAll('.sch-flr').forEach((b) => b.classList.toggle('is-active', b.dataset.floor === curFl));
    $('#sch-th-val').textContent = ws.length ? (sameTh ? String(ws[0].th || WALL_TH) : '—') : String(S.th);
    en('#sch-mat-all', items().some((i) => i.t === 'wall'));
    const sch = schema();
    const hasBg = !!(sch && sch.bg && bgGet(sch.id));
    en('#sch-bg-tool', hasBg);
    en('#sch-bg-op', hasBg);
    en('#sch-bg-toggle', hasBg);
    en('#sch-bg-remove', hasBg);
    $('#sch-bg-toggle').textContent = hasBg && sch.bg.visible === false ? 'Afficher' : 'Masquer';
    if (hasBg) $('#sch-bg-op').value = Math.round((sch.bg.opacity || 0.5) * 100);
    $('#sch-hint').textContent = (S.tool === 'select' && S.multi) ? HINTS.multi : (HINTS[S.tool] || '');
    $('#sch-snap').checked = S.snap;
    svg.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
    if (S.readonly) {
      uniUpdateUI();
      if (S.tool === 'select' && !S.multi) $('#sch-hint').textContent = UNI_SELECT_HINT;
    }
  }

  function refreshSelect() {
    $('#sch-select').innerHTML = db.list.map((s) => `<option value="${s.id}"${s.id === db.current ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  function openSchema(id, keepView) {
    db.current = id;
    S.sel = null; S.draft = null; S.drag = null;
    resetHist();
    if (S.readonly) uniSync();
    const s = schema();
    if (s && s.view && !keepView) S.view = { ...s.view };
    else fitView();
    refreshSelect();
    render();
    updateUI();
    save();
  }

  /* ---------- Fond de plan (image) ---------- */
  const BG_MAX = 2200; // côté max en pixels après réduction (limite l'espace de stockage)

  function applyBackground(data, nw, nh) {
    const s = schema();
    if (!s) return;
    const k = S.view.k, W = svg.clientWidth || 800, H = svg.clientHeight || 500;
    const w = Math.max(100, Math.min(nw, (W / k) * 0.85));
    const h = (w * nh) / nw;
    const cx = (W / 2 - S.view.x) / k, cy = (H / 2 - S.view.y) / k;
    if (!bgSet(s.id, data)) {
      window.alert('Image trop volumineuse pour le stockage de l’appareil. Essayez une image plus petite.');
      return;
    }
    s.bg = { x: rnd(cx - w / 2), y: rnd(cy - h / 2), w: rnd(w), h: rnd(h), nw, nh, opacity: 0.5, visible: true };
    save();
    setTool('bg');
    render();
  }

  function handleBgFile(file) {
    if (!file || !(/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || ''))) {
      window.alert('Fichier non pris en charge : choisissez une image (JPG, PNG ou WebP).');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const nw0 = img.naturalWidth, nh0 = img.naturalHeight;
      if (!nw0 || !nh0) { window.alert('Image illisible.'); return; }
      const sc = Math.min(1, BG_MAX / Math.max(nw0, nh0));
      const cw = Math.round(nw0 * sc), ch = Math.round(nh0 * sc);
      try {
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        applyBackground(c.toDataURL('image/jpeg', 0.85), cw, ch);
      } catch (err) {
        window.alert('Impossible de traiter cette image.');
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); window.alert('Image illisible. Formats pris en charge : JPG, PNG, WebP.'); };
    img.src = url;
  }

  function removeBackground() {
    const s = schema();
    if (!s || !s.bg) return;
    if (!window.confirm('Retirer le fond de plan de ce schéma ?')) return;
    delete s.bg;
    bgDel(s.id);
    if (S.tool === 'bg') S.tool = 'select';
    save();
    render();
    updateUI();
  }

  /* ---------- Gestion des schémas ---------- */
  function slug(n) { return (n || 'schema').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'schema'; }
  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSVGString() {
    const scene = sceneSVG(implItems()) + (S.readonly ? sceneSVG(uniItems()) : '');
    const bb = fullBBox() || { x: 0, y: 0, w: 400, h: 300 };
    const m = 30;
    const x = Math.floor(bb.x - m), y = Math.floor(bb.y - m), w = Math.ceil(bb.w + 2 * m), h = Math.ceil(bb.h + 2 * m);
    return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${bgImageSVG()}<defs>${MAT.defsSVG()}</defs>${scene}</svg>` };
  }
  const exportName = () => slug(schema().name) + (S.readonly ? '_unifilaire' : '');
  function exportSVG() {
    download(new Blob([exportSVGString().svg], { type: 'image/svg+xml' }), exportName() + '.svg');
  }
  function exportPNG() {
    const { w, h, svg: str } = exportSVGString();
    const scale = Math.min(2, 4000 / Math.max(w, h));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && download(b, exportName() + '.png'), 'image/png');
    };
    img.onerror = () => window.alert('Export PNG impossible. Utilisez l’export SVG.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }
  function saveFile() {
    const s = schema();
    const bgData = s.bg ? bgGet(s.id) : null;
    const data = { app: 'electroformules-schema', version: 1, schema: { name: s.name, items: s.items, ...(s.uni && s.uni.length ? { uni: s.uni } : {}), ...(bgData ? { bg: { ...s.bg, data: bgData } } : {}) } };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), slug(s.name) + '.schema.json');
  }

  const num = (v) => typeof v === 'number' && isFinite(v);
  function cleanItem(it) {
    if (!it || typeof it !== 'object') return null;
    const id = typeof it.id === 'string' && it.id ? it.id : uid();
    switch (it.t) {
      case 'wall':
        if (![it.x1, it.y1, it.x2, it.y2].every(num)) return null;
        return { id, t: 'wall', x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2,
          ...(typeof it.mat === 'string' && MAT.map[it.mat] ? { mat: it.mat } : {}),
          ...(num(it.th) ? { th: clampTh(it.th) } : {}),
          ...(num(it.bend) && it.bend !== 0 ? { bend: Math.max(-5000, Math.min(5000, it.bend)) } : {}) };
      case 'door': case 'window':
        if (![it.x, it.y, it.len].every(num)) return null;
        return { id, t: it.t, x: it.x, y: it.y, rot: num(it.rot) ? it.rot : 0, len: Math.max(20, Math.min(200, it.len)), ...(num(it.th) ? { th: clampTh(it.th) } : {}), ...(it.t === 'door' ? { ...(it.mx ? { mx: true } : {}), ...(it.my || it.flip ? { my: true } : {}) } : {}) };
      case 'shape':
        if (!['circle', 'square', 'triangle'].includes(it.kind) || ![it.x, it.y, it.w, it.h].every(num)) return null;
        return { id, t: 'shape', kind: it.kind, x: it.x, y: it.y, w: Math.max(10, Math.min(2000, it.w)), h: Math.max(10, Math.min(2000, it.h)),
          rot: num(it.rot) ? it.rot : 0, mat: typeof it.mat === 'string' && MAT.map[it.mat] ? it.mat : 'plein',
          ...(num(it.bd) && it.bd >= 0 ? { bd: Math.round(it.bd) } : {}) };
      case 'uline':
        if (![it.x1, it.y1, it.x2, it.y2].every(num)) return null;
        return { id, t: 'uline', x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, m: uniCleanMarks(it.m),
          ...(num(it.w) ? { w: Math.max(0.5, Math.min(12, it.w)) } : {}),
          ...(num(it.sec) && it.sec > 0 ? { sec: it.sec } : {}),
          ...(it.hs === true ? { hs: true } : {}), ...(it.hm === true ? { hm: true } : {}),
          ...(typeof it.s1 === 'string' ? { s1: it.s1 } : {}), ...(typeof it.s2 === 'string' ? { s2: it.s2 } : {}) };
      case 'floor': {
        if (!Array.isArray(it.pts) || it.pts.length < 3 || it.pts.length > 200) return null;
        const pts = it.pts.map((q) => (Array.isArray(q) && q.length === 2 && num(q[0]) && num(q[1]) ? [q[0], q[1]] : null));
        if (pts.some((q) => !q)) return null;
        return { id, t: 'floor', pts, mat: typeof it.mat === 'string' && MAT.floorMap[it.mat] ? it.mat : 'sol-uni' };
      }
      case 'sym':
        if (!SYM.map[it.key] || ![it.x, it.y].every(num)) return null;
        return { id, t: 'sym', key: it.key, x: it.x, y: it.y, rot: num(it.rot) ? it.rot : 0, s: num(it.s) ? Math.max(0.4, Math.min(3, it.s)) : 1, ...(it.mx ? { mx: true } : {}), ...(it.my ? { my: true } : {}) };
      case 'text':
        if (typeof it.text !== 'string' || ![it.x, it.y].every(num)) return null;
        return { id, t: 'text', x: it.x, y: it.y, text: it.text.slice(0, 80), size: num(it.size) ? Math.max(8, Math.min(80, it.size)) : 16 };
      case 'link': {
        const end = (e) => (e && num(e.x) && num(e.y) ? { ...(typeof e.id === 'string' ? { id: e.id } : {}), x: e.x, y: e.y } : null);
        const a = end(it.a), b = end(it.b);
        return a && b ? { id, t: 'link', a, b, ...(num(it.w) ? { w: clampLW(it.w) } : {}), ...(num(it.tr) && it.tr > 0 ? { tr: clampLT(it.tr) } : {}) } : null;
      }
      default: return null;
    }
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== 'electroformules-schema' || !data.schema || !Array.isArray(data.schema.items)) throw new Error('Fichier de schéma invalide');
        const list = data.schema.items.map((raw) => { const c = cleanItem(raw); if (c && raw && raw.locked === true) c.locked = true; return c; }).filter(Boolean);
        const s = newSchema(String(data.schema.name || 'Schéma importé').slice(0, 60));
        s.items = list;
        if (Array.isArray(data.schema.uni)) {
          s.uni = data.schema.uni.map((raw) => { const c = cleanItem(raw && !raw.t ? { ...raw, t: 'uline' } : raw); if (c && raw && raw.locked === true) c.locked = true; return c; }).filter(Boolean);
        }
        const rb = data.schema.bg;
        if (rb && typeof rb.data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rb.data) &&
            [rb.x, rb.y, rb.w, rb.h].every(num) && rb.w > 0 && rb.h > 0) {
          if (bgSet(s.id, rb.data)) {
            s.bg = { x: rb.x, y: rb.y, w: rb.w, h: rb.h, nw: num(rb.nw) ? rb.nw : rb.w, nh: num(rb.nh) ? rb.nh : rb.h,
              opacity: num(rb.opacity) ? Math.max(0.1, Math.min(1, rb.opacity)) : 0.5, visible: rb.visible !== false };
          }
        }
        openSchema(s.id, false);
        const nu = (s.uni || []).length;
        window.alert('Import réussi : ' + list.length + ' élément(s) d’implantation' + (nu ? ' et ' + nu + ' élément(s) unifilaire(s).' : '.'));
      } catch (err) {
        window.alert('Import impossible : ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ---------- Événements de l'interface ---------- */
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    $('#sch-palette').innerHTML = paletteHTML();
    $('#sch-palette').addEventListener('click', (e) => {
      if (e.target.closest('#uni-w-m')) { uniChangeWidth(-1); return; }
      if (e.target.closest('#uni-w-p')) { uniChangeWidth(1); return; }
      const inc = e.target.closest('[data-uni-inc]');
      if (inc) { uniChange(inc.dataset.uniInc, 1); return; }
      const dec = e.target.closest('[data-uni-dec]');
      if (dec) { uniChange(dec.dataset.uniDec, -1); return; }
      const fb = e.target.closest('.sch-flr');
      if (fb) { setFloorMaterial(fb.dataset.floor); return; }
      const m = e.target.closest('.sch-mat');
      if (m) { setMaterial(m.dataset.mat); return; }
      const b = e.target.closest('.sch-sym');
      if (b) setTool('place', b.dataset.sym);
    });
    $('#sch-palette').addEventListener('change', (e) => {
      const inp = e.target.closest('[data-uni-val]');
      if (inp) uniSetCount(inp.dataset.uniVal, inp.value);
      if (e.target.id === 'uni-sec') uniSetSection(e.target.value);
      if (e.target.id === 'uni-show-sec') uniSetDisplay('sec', e.target.checked);
      if (e.target.id === 'uni-show-marks') uniSetDisplay('marks', e.target.checked);
    });
    $('#sch-palette').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.closest('[data-uni-val]') || e.target.id === 'uni-sec')) e.target.blur();
    });
    $('#sch-lw-m').addEventListener('click', () => changeLinkWidth(-1));
    $('#sch-lw-p').addEventListener('click', () => changeLinkWidth(1));
    $('#sch-lt').addEventListener('input', (e) => { setLinkTransparency(Number(e.target.value) / 100, false); $('#sch-lt-val').textContent = e.target.value + ' %'; });
    $('#sch-lt').addEventListener('change', (e) => setLinkTransparency(Number(e.target.value) / 100, true));
    $('#sch-link-all').addEventListener('click', applyAllLinks);
    $('#sch-lockmarks').addEventListener('click', toggleLockMarks);
    $('#sch-th-m').addEventListener('click', () => changeThickness(-1));
    $('#sch-th-p').addEventListener('click', () => changeThickness(1));
    $('#sch-mat-all').addEventListener('click', applyAllWalls);
    $('#sch-bend-m').addEventListener('click', () => bendSelected(-1));
    $('#sch-bend-p').addEventListener('click', () => bendSelected(1));
    $('#sch-straight').addEventListener('click', straightenSelected);
    root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#sch-snap').addEventListener('change', (e) => { S.snap = e.target.checked; });
    $('#sch-multi').addEventListener('click', () => {
      if (S.tool !== 'select') { S.multi = true; setTool('select'); }
      else { S.multi = !S.multi; updateUI(); }
    });
    $('#sch-selectall').addEventListener('click', selectAll);
    $('#sch-lock').addEventListener('click', toggleLock);
    $('#sch-unlockall').addEventListener('click', unlockAll);
    $('#sch-undo').addEventListener('click', doUndo);
    $('#sch-redo').addEventListener('click', doRedo);
    $('#sch-zoom-in').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.25));
    $('#sch-zoom-out').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 0.8));
    $('#sch-fit').addEventListener('click', fitView);
    $('#sch-rot-l').addEventListener('click', () => rotateSel(-1));
    $('#sch-rot-r').addEventListener('click', () => rotateSel(1));
    $('#sch-mirror-h').addEventListener('click', () => mirrorSel('h'));
    $('#sch-mirror-v').addEventListener('click', () => mirrorSel('v'));
    $('#sch-size-m').addEventListener('click', () => resizeSel(-1));
    $('#sch-size-p').addEventListener('click', () => resizeSel(1));
    $('#sch-dup').addEventListener('click', duplicateSel);
    $('#sch-edit').addEventListener('click', () => editText());
    $('#sch-delete').addEventListener('click', deleteSel);

    $('#sch-bg-import').addEventListener('click', () => $('#sch-bg-file').click());
    $('#sch-bg-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleBgFile(f);
      e.target.value = '';
    });
    $('#sch-bg-op').addEventListener('input', (e) => {
      const s = schema();
      if (!s || !s.bg) return;
      s.bg.opacity = Math.max(0.1, Math.min(1, Number(e.target.value) / 100));
      renderBg();
      save();
    });
    $('#sch-bg-toggle').addEventListener('click', () => {
      const s = schema();
      if (!s || !s.bg) return;
      s.bg.visible = s.bg.visible === false;
      if (s.bg.visible === false && S.tool === 'bg') S.tool = 'select';
      save();
      render();
      updateUI();
    });
    $('#sch-bg-remove').addEventListener('click', removeBackground);

    $('#sch-select').addEventListener('change', (e) => openSchema(e.target.value, false));
    $('#sch-new').addEventListener('click', () => {
      const name = window.prompt('Nom du nouveau schéma :', 'Schéma ' + (db.list.length + 1));
      if (name === null) return;
      const s = newSchema(name.trim().slice(0, 60) || undefined);
      openSchema(s.id, false);
    });
    $('#sch-rename').addEventListener('click', () => {
      const s = schema();
      const name = window.prompt('Nouveau nom du schéma :', s.name);
      if (name && name.trim()) { s.name = name.trim().slice(0, 60); refreshSelect(); save(); }
    });
    $('#sch-copy').addEventListener('click', () => {
      const s = schema();
      const c = newSchema((s.name + ' (copie)').slice(0, 60));
      c.items = clone(s.items);
      if (s.uni) c.uni = clone(s.uni);
      if (s.bg && bgGet(s.id) && bgSet(c.id, bgGet(s.id))) c.bg = clone(s.bg);
      openSchema(c.id, false);
    });
    $('#sch-del').addEventListener('click', () => {
      const s = schema();
      if (!window.confirm('Supprimer le schéma « ' + s.name + ' » ? Cette action est définitive.')) return;
      db.list = db.list.filter((x) => x.id !== s.id);
      bgDel(s.id);
      if (!db.list.length) newSchema('Schéma 1');
      openSchema(db.list[0].id, false);
    });
    $('#sch-png').addEventListener('click', exportPNG);
    $('#sch-svgfile').addEventListener('click', exportSVG);
    $('#sch-savefile').addEventListener('click', saveFile);
    $('#sch-import').addEventListener('click', () => $('#sch-file').click());
    $('#sch-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', (e) => { if (e.key === ' ') S.space = false; });
  }

  function onKey(e) {
    if (root.hidden || root.dataset.schMode === 'grafcet') return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === ' ' && !/BUTTON/.test(tag)) { S.space = true; e.preventDefault(); return; }
    if (key === 'Enter' && S.tool === 'floor' && S.fdraft) { e.preventDefault(); closeFloor(); return; }
    if (mod && key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (!mod && (key === 'l' || key === 'L')) { toggleLock(); return; }
    if (mod && key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (key === 'Delete' || key === 'Backspace') { if (S.sels.length) { e.preventDefault(); deleteSel(); } return; }
    if (key === 'Escape') {
      S.draft = null; S.drag = null;
      if (S.tool === 'select' && S.sels.length) { S.sels = []; render(); updateUI(); return; }
      setTool('select');
      return;
    }
    if (key === 'r' || key === 'R') { rotateSel(e.shiftKey ? -1 : 1); return; }
    const step = e.shiftKey ? GRID : STEP;
    if (key === 'ArrowLeft') { if (S.sels.length) { e.preventDefault(); nudgeSel(-step, 0); } }
    else if (key === 'ArrowRight') { if (S.sels.length) { e.preventDefault(); nudgeSel(step, 0); } }
    else if (key === 'ArrowUp') { if (S.sels.length) { e.preventDefault(); nudgeSel(0, -step); } }
    else if (key === 'ArrowDown') { if (S.sels.length) { e.preventDefault(); nudgeSel(0, step); } }
  }

  /* ---------- Sous-parties : Implantation / Unifilaire ---------- */
  const MODES = ['implantation', 'unifilaire', 'grafcet'];
  const UNI_TOOLS = ['select', 'uline', 'jbox', 'text', 'bg'];
  const IMPL_TOOLS = ['select', 'wall', 'room', 'floor', 'circle', 'square', 'triangle', 'door', 'window', 'text', 'link', 'place', 'bg'];
  function setMode(mode) {
    if (!MODES.includes(mode)) mode = 'implantation';
    root.dataset.schMode = mode;
    root.querySelectorAll('[data-sch-subtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.schSubtab === mode)));
    try { window.localStorage.setItem('ef_sch_mode', mode); } catch (e) { /* stockage indisponible */ }
    S.drag = null; S.draft = null; S.space = false;
    if (mode === 'grafcet') return;                // Grafcet : à venir, l'éditeur est masqué
    const ro = mode === 'unifilaire';
    if (ro !== !!S.readonly) {
      S.readonly = ro;
      S.undo = S.hist[mode].undo; S.redo = S.hist[mode].redo;     // chaque sous-partie a son historique
      S.drag = null; S.draft = null; S.fdraft = null; S.space = false; S.sels = []; gcMemo = null;
      const allowed = ro ? UNI_TOOLS : IMPL_TOOLS;
      if (!allowed.includes(S.tool)) { S.tool = 'select'; S.placeKey = null; }
      if (ro && ready) uniSync();
      const pal = $('#sch-palette'); if (pal) pal.scrollTop = 0;   // la palette change de contenu : retour en haut
    }
    if (ready) requestAnimationFrame(() => { render(); updateUI(); });   // la zone de dessin a pu changer de taille
  }
  root.querySelectorAll('[data-sch-subtab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.schSubtab)));
  let startMode = 'implantation';
  try { startMode = window.localStorage.getItem('ef_sch_mode') || startMode; } catch (e) { /* ignoré */ }

  /* ============================================================
     Schémas unifilaires : traits noirs (câbles) marqués de leurs conducteurs, boîtes de dérivation
     Chaque conducteur est une barre oblique de sa couleur ; le nombre est écrit à côté s'il dépasse 1.
     Aucune limite au nombre de conducteurs.
     ============================================================ */
  const UNI_NEUTRE = '#3FA9F5';
  const UNI_TERRE = '#00A859';
  const UNI_COND = [
    { c: '#FF0000', name: 'Rouge' },
    { c: '#FF7F00', name: 'Orange' },
    { c: '#8F00FF', name: 'Violet' },
    { c: '#FFFFFF', name: 'Blanc' },
    { c: '#7B3F00', name: 'Marron' },
    { c: '#000000', name: 'Noir' },
    { c: '#808080', name: 'Gris' },
  ];
  const UNI_SPACING = 10;     // écart entre deux marques le long du trait
  const UNI_NUM_GAP = 6;      // place supplémentaire par chiffre affiché
  const UNI_HALF = 9;         // demi-longueur d'une barre oblique
  const uniCount = (v) => { const n = Math.round(Number(v)); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

  function uniCleanMarks(m) {
    const out = { c: {}, N: 0, T: 0 };
    if (!m || typeof m !== 'object') return out;
    if (m.c && typeof m.c === 'object') for (const k of UNI_COND) { const n = uniCount(m.c[k.c]); if (n) out.c[k.c] = n; }
    out.N = uniCount(m.N);
    out.T = uniCount(m.T);
    return out;
  }

  // Liste ordonnée des marques : conducteurs (dans l'ordre de la palette), neutre, terre
  function uniMarkList(m) {
    const out = [];
    for (const k of UNI_COND) { const n = (m.c && m.c[k.c]) || 0; if (n > 0) out.push({ kind: 'c', color: k.c, n }); }
    if (m.N > 0) out.push({ kind: 'N', color: UNI_NEUTRE, n: m.N });
    if (m.T > 0) out.push({ kind: 'T', color: UNI_TERRE, n: m.T });
    return out;
  }
  // Barre oblique « / » : direction du trait tournée de ±50°, extrémité « haute » vers le haut de l'écran
  function uniSlashDir(ux, uy) {
    const a = rad(50), c = Math.cos(a), s = Math.sin(a);
    const r1 = { x: ux * c - uy * s, y: ux * s + uy * c }, r2 = { x: ux * c + uy * s, y: -ux * s + uy * c };
    let d = r1.x * r1.y < 0 ? r1 : r2.x * r2.y < 0 ? r2 : r1;
    if (d.y > 0 || (d.y === 0 && d.x < 0)) d = { x: -d.x, y: -d.y };
    return d;
  }
  function uniStroke(x1, y1, x2, y2, color, w) {
    const ln = (c, sw) => `<line x1="${rnd(x1)}" y1="${rnd(y1)}" x2="${rnd(x2)}" y2="${rnd(y2)}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
    return (color.toUpperCase() === '#FFFFFF' ? ln('#000', w + 1.8) : '') + ln(color, w);   // le blanc reçoit un fin contour noir
  }
  function uniMarkSVG(mk, cx, cy, d) {
    const W = 2.2, h = UNI_HALF;
    const tx = cx + d.x * h, ty = cy + d.y * h;          // extrémité haute
    let o = uniStroke(cx - d.x * h, cy - d.y * h, tx, ty, mk.color, W);
    if (mk.kind === 'N') {
      o += `<circle cx="${rnd(tx)}" cy="${rnd(ty)}" r="3" fill="${mk.color}"/>`;
    } else if (mk.kind === 'T') {
      const px = d.y, py = -d.x;                         // barre perpendiculaire en tête (symbole de terre)
      o += uniStroke(tx - px * 5, ty - py * 5, tx + px * 5, ty + py * 5, mk.color, W);
    }
    if (mk.n > 1) {
      o += `<text x="${rnd(tx + (mk.kind === 'c' ? 3 : 6))}" y="${rnd(ty + 1)}" font-size="10" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="#111">${mk.n}</text>`;
    }
    return o;
  }
  // Section en mm² : nombre entier ou à virgule (« 1,5 » ou « 1.5 »)
  function parseSection(v) {
    const t = String(v == null ? '' : v).trim().replace(/\s*mm²?$/i, '').replace(',', '.');
    if (!t) return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    const n = Number(t);
    return n > 0 ? n : NaN;
  }
  const fmtSection = (n) => String(n).replace('.', ',');
  function ulineSVG(l) {
    const w = l.w || 2;
    let o = `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#000" stroke-width="${w}" stroke-linecap="round"/>`;
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L = Math.hypot(dx, dy);
    if (L < 1) return o;
    const ux = dx / L, uy = dy / L;
    const d = uniSlashDir(ux, uy);
    const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
    // section : écrite à côté du trait, du côté opposé aux marques
    if (!l.hs && typeof l.sec === 'number') {
      let nx = -uy, ny = ux;
      if (nx * d.x + ny * d.y > 0) { nx = -nx; ny = -ny; }
      const off = w / 2 + 9;
      const tx = mx + nx * off, ty = my + ny * off;
      const anchor = Math.abs(nx) < 0.35 ? 'middle' : nx > 0 ? 'start' : 'end';
      o += `<text x="${rnd(tx)}" y="${rnd(ty + 3.5 + ny * 3)}" font-size="10" font-weight="600" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" fill="#111">${fmtSection(l.sec)} mm²</text>`;
    }
    const marks = l.hm ? [] : uniMarkList(l.m || {});
    if (!marks.length) return o;
    const sx = ux < 0 || (ux === 0 && uy < 0) ? -1 : 1;   // marques rangées de gauche à droite
    // positions le long du trait : un chiffre élargit l'écart avec la marque suivante
    const pos = [];
    let acc = 0;
    marks.forEach((mk, i) => {
      pos.push(acc);
      acc += UNI_SPACING + (mk.n > 1 && i < marks.length - 1 ? UNI_NUM_GAP * String(mk.n).length + 2 : 0);
    });
    const mid = pos[pos.length - 1] / 2;
    marks.forEach((mk, i) => {
      const off = (pos[i] - mid) * sx;
      o += uniMarkSVG(mk, mx + ux * off, my + uy * off, d);
    });
    return o;
  }
  function addULine(a, b) {
    const it = { id: uid(), t: 'uline', x1: a.x, y1: a.y, x2: b.x, y2: b.y, m: clone(S.umark), ...(S.uw !== 2 ? { w: S.uw } : {}), ...(S.usec ? { sec: S.usec } : {}),
      ...(S.uhs ? { hs: true } : {}), ...(S.uhm ? { hm: true } : {}) };
    mutate(() => items().push(it));
  }

  /* ----- Aimantation des traits ----- */
  // Points d'accroche, par priorité : extrémités des autres traits, centre des appareils (symboles électriques
  // du plan d'implantation), contour extérieur des boîtes de dérivation (milieu des côtés de préférence).
  // Sinon, la grille magnétique s'applique. Un trait accroché à un appareil le suit s'il est déplacé en implantation.
  function symRadius(sy) {
    const d = SYM.map[sy.key];
    if (!d) return 10;
    const [x0, y0, x1, y1] = d.b;
    return (Math.min(x1 - x0, y1 - y0) / 2) * (sy.s || 1);
  }
  // Centre de l'appareil, en tenant compte de sa rotation, de sa taille et de ses miroirs
  function symPoint(sy) {
    const d = SYM.map[sy.key], c = (d && d.c) || [0, 0];
    const k = sy.s || 1, lx = c[0] * k * (sy.mx ? -1 : 1), ly = c[1] * k * (sy.my ? -1 : 1);
    const a = rad(sy.rot || 0);
    return { x: rnd(sy.x + lx * Math.cos(a) - ly * Math.sin(a)), y: rnd(sy.y + lx * Math.sin(a) + ly * Math.cos(a)) };
  }
  const implSyms = () => implItems().filter((i) => i.t === 'sym' && SYM.map[i.key]);
  // Après chaque modification en unifilaire : une extrémité posée au centre d'un appareil y est rattachée
  function uniRetag() {
    const syms = implSyms().map((sy) => ({ id: sy.id, p: symPoint(sy) }));
    for (const l of uniItems()) {
      if (l.t !== 'uline') continue;
      for (const [k, x, y] of [['s1', l.x1, l.y1], ['s2', l.x2, l.y2]]) {
        const hit = syms.find((q) => Math.abs(q.p.x - x) < 0.6 && Math.abs(q.p.y - y) < 0.6);
        if (hit) l[k] = hit.id; else delete l[k];
      }
    }
  }
  // À l'ouverture de l'unifilaire : les extrémités rattachées suivent les appareils déplacés en implantation ;
  // les anciens traits arrêtés au bord d'un appareil sont ramenés en son centre.
  function uniSync() {
    const syms = implSyms();
    const byId = {};
    for (const sy of syms) byId[sy.id] = sy;
    for (const l of uniItems()) {
      if (l.t !== 'uline') continue;
      for (const [k, xk, yk] of [['s1', 'x1', 'y1'], ['s2', 'x2', 'y2']]) {
        let sy = l[k] ? byId[l[k]] : null;
        if (!sy) {
          delete l[k];
          sy = syms.find((q) => { const c = symPoint(q); return Math.hypot(l[xk] - c.x, l[yk] - c.y) <= symRadius(q) + 1; });
        }
        if (!sy) continue;
        const c = symPoint(sy);
        const o = xk === 'x1' ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 };
        if (c.x === o.x && c.y === o.y) continue;          // le trait ne doit pas se réduire à un point
        l[xk] = c.x; l[yk] = c.y; l[k] = sy.id;
      }
    }
  }
  function uniSnap(p, other, skipId) {
    const R = 14 / S.view.k;
    let best = null;
    const take = (x, y, d, kind) => { if (d <= R && (!best || d < best.d)) best = { x: rnd(x), y: rnd(y), d, kind }; };
    // 1. extrémités des autres traits
    for (const l of uniItems()) {
      if (l.t !== 'uline' || l.id === skipId) continue;
      take(l.x1, l.y1, Math.hypot(p.x - l.x1, p.y - l.y1), 'end');
      take(l.x2, l.y2, Math.hypot(p.x - l.x2, p.y - l.y2), 'end');
    }
    if (best) return { ...best, hit: true };
    // 2. centre des appareils (symboles électriques de l'implantation)
    for (const sy of implSyms()) {
      const c = symPoint(sy), d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d > symRadius(sy) + R) continue;
      if (other && c.x === other.x && c.y === other.y) continue;
      if (!best || d < best.d) best = { x: c.x, y: c.y, d, kind: 'sym' };
    }
    if (best) return { ...best, hit: true };
    // 3. contour extérieur des boîtes de dérivation
    for (const bx of uniItems()) {
      if (!isJbox(bx)) continue;
      const l = toLocal(bx, p), hw = bx.w / 2, hh = bx.h / 2;
      const inside = Math.abs(l.x) <= hw && Math.abs(l.y) <= hh;
      let qx = Math.max(-hw, Math.min(hw, l.x)), qy = Math.max(-hh, Math.min(hh, l.y));
      if (inside) {                                 // depuis l'intérieur : côté le plus proche
        const dl = [hw - Math.abs(l.x), hh - Math.abs(l.y)];
        if (dl[0] < dl[1]) qx = Math.sign(l.x || 1) * hw; else qy = Math.sign(l.y || 1) * hh;
      }
      const d = inside ? 0 : Math.hypot(l.x - qx, l.y - qy);
      if (d > R) continue;
      // milieu du côté si l'on en est proche
      for (const [mx, my] of [[0, -hh], [hw, 0], [0, hh], [-hw, 0]]) {
        if (Math.hypot(qx - mx, qy - my) <= R * 0.8) { qx = mx; qy = my; break; }
      }
      const a = rad(bx.rot || 0);
      const wx = bx.x + qx * Math.cos(a) - qy * Math.sin(a), wy = bx.y + qx * Math.sin(a) + qy * Math.cos(a);
      if (!best || d < best.d) best = { x: rnd(wx), y: rnd(wy), d, kind: 'box' };
    }
    if (best) return { ...best, hit: true };
    return { ...snapPt(p, STEP), hit: false };
  }
  function snapRingSVG(sn) {
    const k = S.view.k;
    return `<circle cx="${sn.x}" cy="${sn.y}" r="${7 / k}" fill="none" stroke="#ff8a00" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
      `<circle cx="${sn.x}" cy="${sn.y}" r="${2 / k}" fill="#ff8a00"/>`;
  }

  /* ----- Boîtes de dérivation : carré blanc repéré « BDx » (x commence à 0 et augmente de 1) ----- */
  const JBOX_SIZE = 40;
  const isJbox = (it) => !!it && it.t === 'shape' && typeof it.bd === 'number';
  function nextBd() {
    let m = -1;
    for (const it of items()) if (isJbox(it)) m = Math.max(m, it.bd);
    return m + 1;
  }
  function jboxFromDrag(a, q, moved, shift) {
    const g = shapeFromDrag(a, q, moved, shift);
    if (!moved || (Math.abs(q.x - a.x) < 10 && Math.abs(q.y - a.y) < 10)) { g.w = JBOX_SIZE; g.h = JBOX_SIZE; }
    return g;
  }
  function jboxSVG(it) {
    const box = shapeEl({ ...it, kind: 'square' }, `fill="#fff" stroke="#000" stroke-width="2"`);
    const fs = rnd(Math.max(7, Math.min(40, Math.min(it.w, it.h) * 0.34)));
    return box + `<text x="${it.x}" y="${rnd(it.y + fs * 0.36)}" font-size="${fs}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#000">BD${it.bd}</text>`;
  }
  function addJbox(g) {
    const it = { id: uid(), t: 'shape', kind: 'square', x: rnd(g.x), y: rnd(g.y), w: rnd(g.w), h: rnd(g.h), rot: 0, mat: 'contour', bd: nextBd() };
    mutate(() => items().push(it));
    S.sel = it.id;
    renderOverlay(); updateUI();
  }
  function editJbox(it) {
    const v = window.prompt('Numéro de la boîte de dérivation (BDx) :', String(it.bd));
    if (v === null) return;
    const n = Math.round(Number(String(v).trim()));
    if (!Number.isSafeInteger(n) || n < 0) { window.alert('Entrez un nombre entier positif ou nul (0, 1, 2…).'); return; }
    mutate(() => { it.bd = n; });
  }

  /* ----- Panneau « Marquage du trait » (dans la palette, sous-partie Unifilaire) ----- */
  function uniSwatch(kind, color) {
    return `<svg viewBox="-14 -12 28 24" width="34" height="28" aria-hidden="true"><line x1="-12" y1="4" x2="12" y2="4" stroke="#000" stroke-width="2"/>${uniMarkSVG({ kind, color, n: 1 }, 0, 4, uniSlashDir(1, 0))}</svg>`;
  }
  function uniRow(key, kind, color, name) {
    return `<div class="uni-row" data-uni-row="${key}">${uniSwatch(kind, color)}<span class="uni-name">${esc(name)}</span>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-uni-dec="${key}" aria-label="Retirer un conducteur ${esc(name)}">−</button>` +
      `<input type="number" class="uni-count" data-uni-val="${key}" min="0" step="1" inputmode="numeric" value="0" aria-label="Nombre : ${esc(name)}">` +
      `<button type="button" class="btn btn-ghost btn-sm" data-uni-inc="${key}" aria-label="Ajouter un conducteur ${esc(name)}">+</button></div>`;
  }
  function uniPanelHTML() {
    let h = '<h3 class="sch-group sch-group-main">Marquage du trait</h3>' +
      '<p class="uni-target" id="uni-target"></p>' +
      '<div class="uni-row"><span class="uni-name">Épaisseur du trait</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="uni-w-m" aria-label="Affiner le trait">−</button>' +
      '<span class="sch-thval" id="uni-w-val">2</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="uni-w-p" aria-label="Épaissir le trait">+</button></div>' +
      '<div class="uni-row"><label class="uni-name" for="uni-sec">Section (mm²)</label>' +
      '<input type="text" class="uni-sec" id="uni-sec" inputmode="decimal" placeholder="ex. 1,5" autocomplete="off" aria-label="Section du conducteur en millimètres carrés"></div>' +
      '<h4 class="sch-subgroup">Affichage</h4>' +
      '<p class="sch-note" id="uni-disp-scope"></p>' +
      '<label class="uni-row uni-check"><input type="checkbox" id="uni-show-sec"> <span class="uni-name">Afficher les sections</span></label>' +
      '<label class="uni-row uni-check"><input type="checkbox" id="uni-show-marks"> <span class="uni-name">Afficher les marques des conducteurs</span></label>' +
      '<p class="sch-note">Le nombre (sans limite) peut être tapé directement. Il est écrit à côté de la marque quand il dépasse 1 ; à 0, la marque disparaît.</p>' +
      '<h4 class="sch-subgroup">Neutre et terre</h4>' +
      uniRow('N', 'N', UNI_NEUTRE, 'Neutre') + uniRow('T', 'T', UNI_TERRE, 'Terre') +
      '<h4 class="sch-subgroup">Conducteurs</h4>';
    for (const k of UNI_COND) h += uniRow(k.c, 'c', k.c, k.name);
    return h;
  }
  const selULines = () => selItems().filter((i) => i.t === 'uline' && !i.locked);
  const uniGet = (m, key) => (key === 'N' || key === 'T' ? m[key] || 0 : (m.c && m.c[key]) || 0);
  function uniPut(m, key, n) {
    if (key === 'N' || key === 'T') m[key] = n;
    else { m.c = m.c || {}; if (n) m.c[key] = n; else delete m.c[key]; }
  }
  // Modifie le marquage des traits sélectionnés (sinon celui des prochains traits)
  function uniApply(key, fn) {
    const ls = selULines();
    if (ls.length) {
      mutate(() => { for (const l of ls) { l.m = l.m || { c: {}, N: 0, T: 0 }; uniPut(l.m, key, fn(uniGet(l.m, key))); } });
      S.umark = clone(ls[0].m);               // le trait modifié sert de modèle aux prochains traits
    } else {
      uniPut(S.umark, key, fn(uniGet(S.umark, key)));
      updateUI();
    }
  }
  function uniChange(key, delta) { uniApply(key, (n) => uniCount(n + delta)); }
  function uniSetCount(key, v) { const n = uniCount(v); uniApply(key, () => n); }
  function uniChangeWidth(dir) {
    const ls = selULines();
    const nw = Math.max(0.5, Math.min(12, (ls.length ? (ls[0].w || 2) : S.uw) + 0.5 * dir));
    S.uw = nw;
    if (ls.length) mutate(() => { for (const l of ls) { if (nw === 2) delete l.w; else l.w = nw; } });
    else updateUI();
  }
  function uniSetSection(v) {
    const n = parseSection(v);
    const si = $('#uni-sec');
    if (Number.isNaN(n)) {                       // seul un nombre (entier ou à virgule) est accepté
      si.classList.add('is-bad');
      window.alert('Section : entrez seulement un nombre, entier ou à virgule (ex. 1,5 ou 2.5). Elle est comptée en mm².');
      si.focus();
      return;
    }
    si.classList.remove('is-bad');
    S.usec = n;
    const ls = selULines();
    if (ls.length) mutate(() => { for (const l of ls) { if (n) l.sec = n; else delete l.sec; } });
    else updateUI();
  }
  // Afficher / masquer les sections ou les marques : sur les traits sélectionnés, sinon sur tous les traits
  function uniSetDisplay(which, on) {
    const k = which === 'sec' ? 'hs' : 'hm';
    const sel = selULines();
    const ls = sel.length ? sel : items().filter((i) => i.t === 'uline' && !i.locked);
    if (!sel.length) S[which === 'sec' ? 'uhs' : 'uhm'] = !on;     // les prochains traits suivent ce choix
    if (ls.length) mutate(() => { for (const l of ls) { if (on) delete l[k]; else l[k] = true; } });
    else updateUI();
  }
  // État d'une case : celui des traits concernés ; à moitié cochée (indéterminée) s'ils diffèrent
  function uniDisplayState(box, k, def) {
    const sel = selULines();
    const ls = sel.length ? sel : items().filter((i) => i.t === 'uline');
    const shown = ls.filter((l) => !l[k]).length;
    box.indeterminate = shown > 0 && shown < ls.length;
    box.checked = ls.length ? shown === ls.length : !def;
  }
  function uniUpdateUI() {
    const ls = selULines();
    const m = ls.length ? (ls[0].m || {}) : S.umark;
    root.querySelectorAll('[data-uni-row]').forEach((row) => {
      const key = row.dataset.uniRow, n = uniGet(m, key);
      const inp = row.querySelector('[data-uni-val]');
      if (document.activeElement !== inp) inp.value = String(n);
      row.classList.toggle('is-on', n > 0);
      row.querySelector('[data-uni-dec]').disabled = n <= 0;
    });
    const w = ls.length ? (ls[0].w || 2) : S.uw;
    $('#uni-w-val').textContent = String(w).replace('.', ',');
    const sec = ls.length ? (typeof ls[0].sec === 'number' ? ls[0].sec : null) : S.usec;
    const si = $('#uni-sec');
    if (document.activeElement !== si) { si.value = sec ? fmtSection(sec) : ''; si.classList.remove('is-bad'); }
    uniDisplayState($('#uni-show-sec'), 'hs', S.uhs);
    uniDisplayState($('#uni-show-marks'), 'hm', S.uhm);
    const scope = selULines().length ? (selULines().length > 1 ? 'traits sélectionnés' : 'trait sélectionné') : 'tous les traits';
    $('#uni-disp-scope').textContent = 'S’applique à : ' + scope;
    const tg = $('#uni-target');
    if (tg) tg.textContent = ls.length > 1 ? ls.length + ' traits sélectionnés' : ls.length ? 'Trait sélectionné' : 'Prochains traits';
  }

  /* ---------- Entrée publique ---------- */
  let ready = false;
  function show() {
    if (!ready) {
      ready = true;
      loadDb();
      if (!db.list.length) newSchema('Schéma 1');
      if (!schema()) db.current = db.list[0].id;
      bind();
      const s = schema();
      if (s && s.view) S.view = { ...s.view };
      if (S.readonly) uniSync();
      refreshSelect();
      // l'ajustement a besoin des dimensions réelles : on attend l'affichage
      requestAnimationFrame(() => { if (!(s && s.view)) fitView(); render(); updateUI(); });
    } else {
      render();
      updateUI();
    }
  }

  setMode(startMode);

  window.SchemasEditor = {
    show,
    setMode,
    // utilitaires exposés pour les tests
    _state: S, _db: () => db, _exportSVG: exportSVGString, _applyBackground: applyBackground, _wallPoints: wallPoints, _arcInfo: arcInfo, _bgGet: bgGet, _handleBgFile: handleBgFile,
  };

  if (!root.hidden) show();
})();
