/* ============================================================
   Éditeur de schémas architecturaux (plan + symboles électriques)
   Données : window.localStorage, clé « ef_schemas »
   Éléments d'un schéma (schema.items) :
     wall   {x1,y1,x2,y2}
     door   {x,y,rot,len,flip}     window {x,y,rot,len}
     sym    {key,x,y,rot,s}        text   {x,y,text,size}
     link   {a:{id?,x,y}, b:{id?,x,y}}
   ============================================================ */
(function () {
  'use strict';

  const SYM = window.SchSymbols;
  const root = document.getElementById('main-schemas');
  if (!SYM || !root) return;

  const $ = (s) => root.querySelector(s);
  const svg = $('#sch-svg');

  const GRID = 20;          // pas de la grille (murs)
  const STEP = 10;          // pas d'accrochage des symboles
  const INK = SYM.INK;
  const WALL_COLOR = '#3b3b3b';
  const LINK_COLOR = '#5a6b86';
  const SEL = '#2f7df6';
  const WALL_W = 8;

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
        if (d && Array.isArray(d.list)) db = { list: d.list.filter((s) => s && Array.isArray(s.items)), current: d.current };
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
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveNow(); });

  /* ---------- État ---------- */
  const S = {
    tool: 'select',
    placeKey: null,
    sel: null,
    view: { x: 40, y: 40, k: 1 },
    snap: true,
    draft: null,
    cursor: null,
    drag: null,
    pointers: new Map(),
    gesture: null,
    undo: [],
    redo: [],
  };

  const schema = () => db.list.find((s) => s.id === db.current) || null;
  const items = () => (schema() ? schema().items : []);
  const snapJSON = () => JSON.stringify(items());
  const findItem = (id) => items().find((i) => i.id === id) || null;

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
    schema().items = arr;
    if (S.sel && !findItem(S.sel)) S.sel = null;
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
  function placeOpening(it, c) {
    let best = null;
    for (const w of items()) {
      if (w.t !== 'wall') continue;
      const r = distSeg(c, w.x1, w.y1, w.x2, w.y2);
      if (r.d <= 16 && (!best || r.d < best.d)) best = { d: r.d, qx: r.qx, qy: r.qy, w };
    }
    if (best) {
      it.rot = rnd((Math.atan2(best.w.y2 - best.w.y1, best.w.x2 - best.w.x1) * 180) / Math.PI);
      c = { x: best.qx, y: best.qy };
    } else {
      c = snapPt(c, STEP);
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

  function wallSVG(w) {
    return `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${WALL_COLOR}" stroke-width="${WALL_W}" stroke-linecap="square"/>`;
  }

  function openingSVG(o) {
    const L = o.len;
    let g = `<rect x="0" y="-7" width="${L}" height="14" fill="#fff"/>`;
    if (o.t === 'door') {
      g += `<g${o.flip ? ' transform="scale(1 -1)"' : ''}>` +
        `<line x1="0" y1="0" x2="0" y2="${-L}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
        `<path d="M0 ${-L} A${L} ${L} 0 0 1 ${L} 0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 3"/></g>`;
    } else {
      g += `<rect x="0" y="-4" width="${L}" height="8" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` +
        `<line x1="0" y1="0" x2="${L}" y2="0" stroke="${INK}" stroke-width="1"/>`;
    }
    g += `<line x1="0" y1="-5" x2="0" y2="5" stroke="${WALL_COLOR}" stroke-width="2"/>` +
      `<line x1="${L}" y1="-5" x2="${L}" y2="5" stroke="${WALL_COLOR}" stroke-width="2"/>`;
    return `<g transform="translate(${o.x} ${o.y}) rotate(${o.rot || 0})">${g}</g>`;
  }

  function linkSVG(list, l) {
    const a = resolveEnd(list, l.a), b = resolveEnd(list, l.b);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${LINK_COLOR}" stroke-width="1.4" stroke-linecap="round"/>`;
  }

  function symSVG(s) {
    return `<g transform="translate(${s.x} ${s.y}) rotate(${s.rot || 0}) scale(${s.s || 1})">${SYM.inner(s.key, s.rot || 0)}</g>`;
  }

  function textSVG(t) {
    const lines = String(t.text).split('\n');
    const h = lines.length * t.size * 1.2;
    const y0 = t.y - h / 2 + t.size * 0.95;
    const tsp = lines.map((l, i) => `<tspan x="${t.x}" y="${rnd(y0 + i * t.size * 1.2)}">${esc(l)}</tspan>`).join('');
    return `<text font-size="${t.size}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="600" fill="#222">${tsp}</text>`;
  }

  function sceneSVG(list) {
    let walls = '', open = '', links = '', syms = '', texts = '';
    for (const it of list) {
      if (it.t === 'wall') walls += wallSVG(it);
      else if (it.t === 'door' || it.t === 'window') open += openingSVG(it);
      else if (it.t === 'link') links += linkSVG(list, it);
      else if (it.t === 'sym') syms += symSVG(it);
      else if (it.t === 'text') texts += textSVG(it);
    }
    return walls + open + links + syms + texts;
  }

  function selSVG(it) {
    const dash = `fill="none" stroke="${SEL}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"`;
    const handle = (x, y) => `<circle cx="${x}" cy="${y}" r="${7 / S.view.k}" fill="#fff" stroke="${SEL}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    if (it.t === 'wall') {
      return `<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${SEL}" stroke-opacity="0.35" stroke-width="${WALL_W + 6}" stroke-linecap="round"/>` +
        handle(it.x1, it.y1) + handle(it.x2, it.y2);
    }
    if (it.t === 'link') {
      const a = resolveEnd(items(), it.a), b = resolveEnd(items(), it.b);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${SEL}" stroke-opacity="0.5" stroke-width="5" stroke-linecap="round"/>`;
    }
    if (it.t === 'text') {
      const [x0, y0, x1, y1] = textBox(it);
      return `<rect x="${x0 - 4}" y="${y0 - 2}" width="${x1 - x0 + 8}" height="${y1 - y0 + 4}" ${dash}/>`;
    }
    if (it.t === 'sym') {
      const [x0, y0, x1, y1] = SYM.map[it.key].b;
      return `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0}) scale(${it.s || 1})"><rect x="${x0 - 2}" y="${y0 - 2}" width="${x1 - x0 + 4}" height="${y1 - y0 + 4}" ${dash}/></g>`;
    }
    // porte / fenêtre
    const top = it.t === 'door' ? (it.flip ? -9 : -(it.len + 3)) : -9;
    const hgt = it.t === 'door' ? it.len + 12 : 18;
    return `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})"><rect x="-3" y="${top}" width="${it.len + 6}" height="${hgt}" ${dash}/></g>`;
  }

  function overlaySVG() {
    let o = '';
    const sel = S.sel && findItem(S.sel);
    if (sel) o += selSVG(sel);
    const c = S.cursor;
    const k = S.view.k;
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
      o += `<line x1="${S.draft.x}" y1="${S.draft.y}" x2="${q.x}" y2="${q.y}" stroke="${SEL}" stroke-opacity="0.6" stroke-width="${WALL_W}" stroke-linecap="square"/>`;
      o += `<circle cx="${S.draft.x}" cy="${S.draft.y}" r="${5 / k}" fill="${SEL}"/>`;
    }
    if (S.drag && S.drag.mode === 'room' && c) {
      const a = S.drag.a, q = snapPt(c, GRID);
      o += `<rect x="${Math.min(a.x, q.x)}" y="${Math.min(a.y, q.y)}" width="${Math.abs(q.x - a.x)}" height="${Math.abs(q.y - a.y)}" fill="${SEL}" fill-opacity="0.08" stroke="${SEL}" stroke-width="${WALL_W}" stroke-opacity="0.6" stroke-linejoin="miter"/>`;
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

  function applyView() {
    worldG.setAttribute('transform', `translate(${rnd(S.view.x)} ${rnd(S.view.y)}) scale(${S.view.k})`);
  }
  function renderOverlay() { overG.innerHTML = overlaySVG(); }
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
    applyView();
    renderBg();
    sceneG.innerHTML = sceneSVG(items());
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
      if (l.x / s >= x0 - tol && l.x / s <= x1 + tol && l.y / s >= y0 - tol && l.y / s <= y1 + tol) return it;
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
      if (l.x >= -tol && l.x <= it.len + tol && Math.abs(l.y) <= 9 + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'link') continue;
      const a = resolveEnd(list, it.a), b = resolveEnd(list, it.b);
      if (distSeg(p, a.x, a.y, b.x, b.y).d <= 4 + tol) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t !== 'wall') continue;
      if (distSeg(p, it.x1, it.y1, it.x2, it.y2).d <= WALL_W / 2 + tol) return it;
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

  function contentBBox(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const it of list) {
      if (it.t === 'wall') { add(it.x1 - 5, it.y1 - 5); add(it.x2 + 5, it.y2 + 5); }
      else if (it.t === 'sym') { const [a, b, c, d] = SYM.map[it.key].b; const s = it.s || 1, m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) * s; add(it.x - m, it.y - m); add(it.x + m, it.y + m); }
      else if (it.t === 'text') { const [a, b, c, d] = textBox(it); add(a, b); add(c, d); }
      else if (it.t === 'door' || it.t === 'window') { add(it.x - it.len, it.y - it.len); add(it.x + it.len, it.y + it.len); }
    }
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
  }

  function fullBBox() {
    const bb = contentBBox(items());
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
    select: 'Sélection : cliquez un élément pour le déplacer ; faites glisser le fond pour vous déplacer ; molette ou pincement pour zoomer.',
    wall: 'Mur : cliquez pour poser le point de départ, puis cliquez à chaque angle. Double-clic ou Échap pour terminer.',
    room: 'Pièce : faites glisser d’un angle à l’angle opposé pour créer les 4 murs.',
    door: 'Porte : cliquez sur un mur pour la poser (elle s’aligne sur le mur). « Miroir » change le sens d’ouverture.',
    window: 'Fenêtre : cliquez sur un mur pour la poser.',
    text: 'Texte : cliquez à l’endroit voulu (nom de pièce, repère…).',
    link: 'Liaison : faites glisser d’un symbole à un autre (commande vers éclairage, par exemple).',
    bg: 'Fond de plan : faites glisser l’image pour la déplacer, les coins pour la redimensionner. Choisissez ensuite un autre outil.',
    place: 'Cliquez sur le plan pour poser le symbole (plusieurs fois de suite). Échap pour arrêter.',
  };

  function setTool(tool, key) {
    S.tool = tool;
    S.placeKey = tool === 'place' ? key : null;
    S.draft = null;
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
  function addWall(a, b) {
    mutate(() => items().push({ id: uid(), t: 'wall', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }

  /* ---------- Souris / toucher ---------- */
  function startGesture() {
    const pts = [...S.pointers.values()];
    S.drag = null;
    S.draft = S.tool === 'wall' ? S.draft : null;
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

    if (e.button === 1 || e.button === 2) {
      S.drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y };
      return;
    }

    switch (S.tool) {
      case 'select': {
        const sel = S.sel && findItem(S.sel);
        if (sel && sel.t === 'wall') {
          const h = wallHandleAt(sel, p);
          if (h) { S.drag = { mode: 'wallEnd', id: sel.id, h, before: snapJSON() }; return; }
        }
        const hit = hitItem(p);
        if (hit) {
          S.sel = hit.id;
          S.drag = { mode: 'move', id: hit.id, p0: p, orig: clone(hit), before: snapJSON() };
        } else {
          S.sel = null;
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
        if (S.tool === 'door') it.flip = false;
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

    if (d.mode === 'pan') {
      S.view.x = d.vx + (e.clientX - d.cx);
      S.view.y = d.vy + (e.clientY - d.cy);
      applyView();
      return;
    }
    if (d.mode === 'move') {
      const it = findItem(d.id);
      if (!it) return;
      const dx = p.x - d.p0.x, dy = p.y - d.p0.y, o = d.orig;
      if (it.t === 'wall') {
        const ex = snapOn(o.x1 + dx, GRID) - o.x1, ey = snapOn(o.y1 + dy, GRID) - o.y1;
        it.x1 = o.x1 + ex; it.y1 = o.y1 + ey; it.x2 = o.x2 + ex; it.y2 = o.y2 + ey;
      } else if (it.t === 'sym' || it.t === 'text') {
        it.x = snapOn(o.x + dx, STEP); it.y = snapOn(o.y + dy, STEP);
      } else if (it.t === 'door' || it.t === 'window') {
        const c0 = openingCenter(o);
        it.rot = o.rot;
        placeOpening(it, { x: c0.x + dx, y: c0.y + dy });
      }
      sceneG.innerHTML = sceneSVG(items());
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
    if (d.mode === 'wallEnd') {
      const w = findItem(d.id);
      if (!w) return;
      const q = snapPt(p, GRID);
      if (d.h === 1) { w.x1 = q.x; w.y1 = q.y; } else { w.x2 = q.x; w.y2 = q.y; }
      sceneG.innerHTML = sceneSVG(items());
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
    if (d.mode === 'move' || d.mode === 'wallEnd') {
      const now = snapJSON();
      if (now !== d.before) { pushUndo(d.before); save(); }
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
    if (d.mode === 'room') {
      const a = d.a, q = snapPt(p, GRID);
      if (Math.abs(q.x - a.x) >= GRID && Math.abs(q.y - a.y) >= GRID) {
        const x0 = Math.min(a.x, q.x), x1 = Math.max(a.x, q.x), y0 = Math.min(a.y, q.y), y1 = Math.max(a.y, q.y);
        mutate(() => {
          const l = items();
          l.push({ id: uid(), t: 'wall', x1: x0, y1: y0, x2: x1, y2: y0 });
          l.push({ id: uid(), t: 'wall', x1: x1, y1: y0, x2: x1, y2: y1 });
          l.push({ id: uid(), t: 'wall', x1: x1, y1: y1, x2: x0, y2: y1 });
          l.push({ id: uid(), t: 'wall', x1: x0, y1: y1, x2: x0, y2: y0 });
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
        mutate(() => items().push({ id: uid(), t: 'link', a: d.a, b }));
      }
      renderOverlay();
    }
  }

  function onCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.gesture = null;
    if (S.drag && (S.drag.mode === 'move' || S.drag.mode === 'wallEnd')) setItems(JSON.parse(S.drag.before));
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
    if (S.tool === 'wall') { S.draft = null; renderOverlay(); return; }
    if (S.tool === 'select') {
      const hit = hitItem(toWorld(e));
      if (hit && hit.t === 'text') editText(hit.id);
    }
  });

  /* ---------- Actions sur la sélection ---------- */
  const sel = () => (S.sel ? findItem(S.sel) : null);

  function rotateSel(dir) {
    const it = sel();
    if (!it || !['sym', 'door', 'window'].includes(it.t)) return;
    mutate(() => { it.rot = ((it.rot || 0) + 90 * dir + 360) % 360; });
  }
  function flipSel() {
    const it = sel();
    if (!it || it.t !== 'door') return;
    mutate(() => { it.flip = !it.flip; });
  }
  function resizeSel(dir) {
    const it = sel();
    if (!it) return;
    if (it.t === 'sym') mutate(() => { it.s = rnd(Math.max(0.4, Math.min(3, (it.s || 1) * (dir > 0 ? 1.15 : 1 / 1.15)))); });
    else if (it.t === 'door' || it.t === 'window') {
      mutate(() => {
        const c = openingCenter(it);
        it.len = Math.max(20, Math.min(200, it.len + 10 * dir));
        const a = rad(it.rot || 0);
        it.x = rnd(c.x - Math.cos(a) * it.len / 2);
        it.y = rnd(c.y - Math.sin(a) * it.len / 2);
      });
    } else if (it.t === 'text') mutate(() => { it.size = Math.max(8, Math.min(80, it.size + 2 * dir)); });
  }
  function editText(id) {
    const it = findItem(id || S.sel);
    if (!it || it.t !== 'text') return;
    const t = window.prompt('Texte à afficher :', it.text);
    if (t !== null && t.trim()) mutate(() => { it.text = t.trim().slice(0, 80); });
  }
  function duplicateSel() {
    const it = sel();
    if (!it || it.t === 'link') return;
    const c = clone(it);
    c.id = uid();
    if (it.t === 'wall') { c.x1 += GRID; c.y1 += GRID; c.x2 += GRID; c.y2 += GRID; }
    else { c.x += GRID; c.y += GRID; }
    mutate(() => items().push(c));
    S.sel = c.id;
    renderOverlay(); updateUI();
  }
  function deleteSel() {
    const it = sel();
    if (!it) return;
    mutate(() => {
      const id = it.id;
      schema().items = items().filter((i) => i.id !== id && !(i.t === 'link' && ((i.a && i.a.id === id) || (i.b && i.b.id === id))));
    });
    S.sel = null;
    render(); updateUI();
  }
  function nudgeSel(dx, dy) {
    const it = sel();
    if (!it || it.t === 'link') return;
    mutate(() => {
      if (it.t === 'wall') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
      else { it.x += dx; it.y += dy; }
    });
  }

  /* ---------- Interface ---------- */
  function paletteHTML() {
    let h = '';
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
    return h;
  }

  function updateUI() {
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
    root.querySelectorAll('.sch-sym').forEach((b) => b.classList.toggle('is-active', S.tool === 'place' && b.dataset.sym === S.placeKey));
    const it = sel();
    const t = it ? it.t : null;
    const en = (id, ok) => { const b = $(id); if (b) b.disabled = !ok; };
    en('#sch-rot-l', ['sym', 'door', 'window'].includes(t));
    en('#sch-rot-r', ['sym', 'door', 'window'].includes(t));
    en('#sch-flip', t === 'door');
    en('#sch-size-m', ['sym', 'door', 'window', 'text'].includes(t));
    en('#sch-size-p', ['sym', 'door', 'window', 'text'].includes(t));
    en('#sch-dup', !!it && t !== 'link');
    en('#sch-edit', t === 'text');
    en('#sch-delete', !!it);
    en('#sch-undo', S.undo.length > 0);
    en('#sch-redo', S.redo.length > 0);
    const sch = schema();
    const hasBg = !!(sch && sch.bg && bgGet(sch.id));
    en('#sch-bg-tool', hasBg);
    en('#sch-bg-op', hasBg);
    en('#sch-bg-toggle', hasBg);
    en('#sch-bg-remove', hasBg);
    $('#sch-bg-toggle').textContent = hasBg && sch.bg.visible === false ? 'Afficher' : 'Masquer';
    if (hasBg) $('#sch-bg-op').value = Math.round((sch.bg.opacity || 0.5) * 100);
    $('#sch-hint').textContent = HINTS[S.tool] || '';
    $('#sch-snap').checked = S.snap;
    svg.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
  }

  function refreshSelect() {
    $('#sch-select').innerHTML = db.list.map((s) => `<option value="${s.id}"${s.id === db.current ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  function openSchema(id, keepView) {
    db.current = id;
    S.sel = null; S.draft = null; S.drag = null; S.undo = []; S.redo = [];
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
    const list = items();
    const bb = fullBBox() || { x: 0, y: 0, w: 400, h: 300 };
    const m = 30;
    const x = Math.floor(bb.x - m), y = Math.floor(bb.y - m), w = Math.ceil(bb.w + 2 * m), h = Math.ceil(bb.h + 2 * m);
    return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${bgImageSVG()}${sceneSVG(list)}</svg>` };
  }
  function exportSVG() {
    download(new Blob([exportSVGString().svg], { type: 'image/svg+xml' }), slug(schema().name) + '.svg');
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
      c.toBlob((b) => b && download(b, slug(schema().name) + '.png'), 'image/png');
    };
    img.onerror = () => window.alert('Export PNG impossible. Utilisez l’export SVG.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }
  function saveFile() {
    const s = schema();
    const bgData = s.bg ? bgGet(s.id) : null;
    const data = { app: 'electroformules-schema', version: 1, schema: { name: s.name, items: s.items, ...(bgData ? { bg: { ...s.bg, data: bgData } } : {}) } };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), slug(s.name) + '.schema.json');
  }

  const num = (v) => typeof v === 'number' && isFinite(v);
  function cleanItem(it) {
    if (!it || typeof it !== 'object') return null;
    const id = typeof it.id === 'string' && it.id ? it.id : uid();
    switch (it.t) {
      case 'wall': return [it.x1, it.y1, it.x2, it.y2].every(num) ? { id, t: 'wall', x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 } : null;
      case 'door': case 'window':
        if (![it.x, it.y, it.len].every(num)) return null;
        return { id, t: it.t, x: it.x, y: it.y, rot: num(it.rot) ? it.rot : 0, len: Math.max(20, Math.min(200, it.len)), ...(it.t === 'door' ? { flip: !!it.flip } : {}) };
      case 'sym':
        if (!SYM.map[it.key] || ![it.x, it.y].every(num)) return null;
        return { id, t: 'sym', key: it.key, x: it.x, y: it.y, rot: num(it.rot) ? it.rot : 0, s: num(it.s) ? Math.max(0.4, Math.min(3, it.s)) : 1 };
      case 'text':
        if (typeof it.text !== 'string' || ![it.x, it.y].every(num)) return null;
        return { id, t: 'text', x: it.x, y: it.y, text: it.text.slice(0, 80), size: num(it.size) ? Math.max(8, Math.min(80, it.size)) : 16 };
      case 'link': {
        const end = (e) => (e && num(e.x) && num(e.y) ? { ...(typeof e.id === 'string' ? { id: e.id } : {}), x: e.x, y: e.y } : null);
        const a = end(it.a), b = end(it.b);
        return a && b ? { id, t: 'link', a, b } : null;
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
        const list = data.schema.items.map(cleanItem).filter(Boolean);
        const s = newSchema(String(data.schema.name || 'Schéma importé').slice(0, 60));
        s.items = list;
        const rb = data.schema.bg;
        if (rb && typeof rb.data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rb.data) &&
            [rb.x, rb.y, rb.w, rb.h].every(num) && rb.w > 0 && rb.h > 0) {
          if (bgSet(s.id, rb.data)) {
            s.bg = { x: rb.x, y: rb.y, w: rb.w, h: rb.h, nw: num(rb.nw) ? rb.nw : rb.w, nh: num(rb.nh) ? rb.nh : rb.h,
              opacity: num(rb.opacity) ? Math.max(0.1, Math.min(1, rb.opacity)) : 0.5, visible: rb.visible !== false };
          }
        }
        openSchema(s.id, false);
        window.alert('Import réussi : ' + list.length + ' élément(s).');
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
      const b = e.target.closest('.sch-sym');
      if (b) setTool('place', b.dataset.sym);
    });
    root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#sch-snap').addEventListener('change', (e) => { S.snap = e.target.checked; });
    $('#sch-undo').addEventListener('click', doUndo);
    $('#sch-redo').addEventListener('click', doRedo);
    $('#sch-zoom-in').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.25));
    $('#sch-zoom-out').addEventListener('click', () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 0.8));
    $('#sch-fit').addEventListener('click', fitView);
    $('#sch-rot-l').addEventListener('click', () => rotateSel(-1));
    $('#sch-rot-r').addEventListener('click', () => rotateSel(1));
    $('#sch-flip').addEventListener('click', flipSel);
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
  }

  function onKey(e) {
    if (root.hidden) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (key === 'Delete' || key === 'Backspace') { if (sel()) { e.preventDefault(); deleteSel(); } return; }
    if (key === 'Escape') { S.draft = null; S.drag = null; setTool('select'); return; }
    if (key === 'r' || key === 'R') { rotateSel(e.shiftKey ? -1 : 1); return; }
    const step = e.shiftKey ? GRID : STEP;
    if (key === 'ArrowLeft') { if (sel()) { e.preventDefault(); nudgeSel(-step, 0); } }
    else if (key === 'ArrowRight') { if (sel()) { e.preventDefault(); nudgeSel(step, 0); } }
    else if (key === 'ArrowUp') { if (sel()) { e.preventDefault(); nudgeSel(0, -step); } }
    else if (key === 'ArrowDown') { if (sel()) { e.preventDefault(); nudgeSel(0, step); } }
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
      refreshSelect();
      // l'ajustement a besoin des dimensions réelles : on attend l'affichage
      requestAnimationFrame(() => { if (!(s && s.view)) fitView(); render(); updateUI(); });
    } else {
      render();
      updateUI();
    }
  }

  window.SchemasEditor = {
    show,
    // utilitaires exposés pour les tests
    _state: S, _db: () => db, _exportSVG: exportSVGString, _applyBackground: applyBackground, _bgGet: bgGet, _handleBgFile: handleBgFile,
  };

  if (!root.hidden) show();
})();
