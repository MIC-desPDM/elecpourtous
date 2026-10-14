/* ============================================================
   Bibliothèque de symboles électriques (style des fiches fournies)
   Chaque symbole est dessiné dans un repère local centré sur (0,0).
   - b : boîte englobante [x0, y0, x1, y1] (sélection / détection du clic)
   - draw(c) : renvoie le SVG du symbole ; c.rot = rotation courante
   - c : centre de l'appareil [x, y] quand il n'est pas en (0,0) (raccordement des traits unifilaires)
   Pour ajuster un symbole, modifier uniquement sa fonction draw ci-dessous.
   ============================================================ */
(function () {
  'use strict';

  const INK = '#3d9be9';     // bleu clair : couleur de tous les symboles électriques

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const circ = (r, cx = 0, cy = 0, x = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" ${x}/>`;
  const line = (x1, y1, x2, y2, x = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${x}/>`;
  const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
  const dots3 = (cx, cy, k) =>
    dot(cx, cy - 5.5 * k, 2.4 * k) + dot(cx - 5.2 * k, cy + 3.8 * k, 2.4 * k) + dot(cx + 5.2 * k, cy + 3.8 * k, 2.4 * k);

  // Texte toujours lisible : on annule la rotation ET le miroir du symbole (c.rot, c.sx, c.sy).
  // Pour les étiquettes « extérieures » (anchor start/end), le texte part du côté opposé au symbole.
  function label(c, t, x, y, size, anchor, bold) {
    const rot = c.rot || 0, sx = c.sx || 1, sy = c.sy || 1;
    let a = anchor || 'middle';
    if (a === 'start' || a === 'end') {
      const r = (rot * Math.PI) / 180;
      const wx = x * sx * Math.cos(r) - y * sy * Math.sin(r);   // position réelle de l'étiquette
      a = wx > 2 ? 'start' : wx < -2 ? 'end' : 'middle';
    }
    return `<g transform="translate(${x} ${y}) scale(${sx} ${sy}) rotate(${-rot}) translate(${-x} ${-y})"><text x="${x}" y="${y + size * 0.36}" font-size="${size}" ` +
      `text-anchor="${a}" font-family="Arial, Helvetica, sans-serif" font-weight="${bold ? 700 : 400}" ` +
      `fill="currentColor" stroke="none">${esc(t)}</text></g>`;
  }

  /* ---------- Prises de courant ---------- */
  const prise = (tag) => (c) => circ(14) + dots3(0, 0.5, 1) + (tag ? label(c, tag, 15, 17, 9, 'start', true) : '');
  const priseLabel = (t, size) => (c) => circ(14) + label(c, t, 0, 0, size, 'middle', true);

  /* ---------- Interrupteurs et commandes ---------- */
  const tickR = line(6.4, -3.4, 14, -11);
  const tickL = line(-6.4, -3.4, -14, -11);
  const crossSw = line(-6.4, -3.4, 6.4, 9.4) + line(6.4, -3.4, -6.4, 9.4);
  const crossBp = line(-6.4, -6.4, 6.4, 6.4) + line(6.4, -6.4, -6.4, 6.4);

  /* ---------- Éclairage ---------- */
  const hourglass = (k) =>
    `<path d="M${-7.07 * k} ${-7.07 * k} L${7.07 * k} ${-7.07 * k} L0 0 Z M${-7.07 * k} ${7.07 * k} L${7.07 * k} ${7.07 * k} L0 0 Z" fill="currentColor"/>`;

  const groups = [
    {
      name: 'Prises de courant',
      items: [
        { key: 'prise', name: 'Prise simple', b: [-16, -16, 16, 16], draw: prise('') },
        {
          key: 'prise2', name: 'Prise double', b: [-27, -14, 16, 12], c: [4, -2],
          draw: (c) => label(c, 'x2', -17, 8, 9, 'middle', false) + circ(11, 4, -2) + dots3(4, -1.5, 0.78),
        },
        { key: 'priseET', name: 'Prise étanche', b: [-16, -16, 28, 24], draw: prise('ET') },
        { key: 'priseHT', name: 'Prise haute', b: [-16, -16, 28, 24], draw: prise('HT') },
        { key: 'priseETHT', name: 'Prise étanche haute', b: [-16, -16, 42, 24], draw: prise('ET HT') },
        { key: 'priseUSB', name: 'Prise USB', b: [-16, -16, 36, 24], draw: prise('USB') },
        { key: 'priseRJ45', name: 'Prise RJ45', b: [-16, -16, 16, 16], draw: priseLabel('RJ', 12) },
        { key: 'priseTV', name: 'Prise TV', b: [-16, -16, 16, 16], draw: priseLabel('TV', 12) },
        { key: 'priseFour', name: 'Prise four', b: [-16, -16, 16, 16], draw: priseLabel('Four', 9) },
        { key: 'priseCongel', name: 'Prise congélateur', b: [-16, -16, 16, 16], draw: priseLabel('Congé', 7.5) },
        { key: 'priseLV', name: 'Prise lave-vaisselle', b: [-16, -16, 16, 16], draw: priseLabel('LV', 12) },
        { key: 'prisePE', name: 'Prise plaque cuisson', b: [-16, -16, 16, 16], draw: priseLabel('PE', 12) },
        { key: 'priseLL', name: 'Prise lave-linge', b: [-16, -16, 16, 16], draw: priseLabel('LL', 12) },
        { key: 'priseCE', name: 'Prise chauffe-eau', b: [-16, -16, 16, 16], draw: priseLabel('CE', 12) },
      ],
    },
    {
      name: 'Interrupteurs et commandes',
      items: [
        { key: 'inter1', name: 'Interrupteur simple allumage', b: [-11, -13, 16, 14], c: [0, 3], draw: () => circ(9, 0, 3) + tickR },
        { key: 'inter2', name: 'Interrupteur double allumage', b: [-16, -13, 16, 14], c: [0, 3], draw: () => circ(9, 0, 3) + tickR + tickL },
        {
          key: 'interVV', name: 'Interrupteur va-et-vient', b: [-11, -13, 16, 14], c: [0, 3],
          draw: () => circ(9, 0, 3) + line(-8.5, 11.5, 14, -11) + line(8, -11, 14, -5),
        },
        { key: 'inter1V', name: 'Interrupteur simple allumage avec voyant', b: [-11, -13, 16, 14], c: [0, 3], draw: () => circ(9, 0, 3) + crossSw + tickR },
        { key: 'inter2V', name: 'Interrupteur double allumage avec voyant', b: [-16, -13, 16, 14], c: [0, 3], draw: () => circ(9, 0, 3) + crossSw + tickR + tickL },
        { key: 'bp', name: 'Bouton poussoir', b: [-16, -16, 16, 16], draw: () => circ(14) + circ(9) },
        { key: 'bpV', name: 'Bouton poussoir avec voyant', b: [-16, -16, 16, 16], draw: () => circ(14) + circ(9) + crossBp },
      ],
    },
    {
      name: 'Points lumineux',
      items: [
        {
          // Croix épaisse (d'après l'image fournie)
          key: 'pl', name: 'Point lumineux', b: [-12, -12, 12, 12],
          draw: () => line(-8.5, -9.5, 8.5, 9.5, 'stroke-width="3.4" stroke-linecap="butt"') +
            line(8.5, -9.5, -8.5, 9.5, 'stroke-width="3.4" stroke-linecap="butt"'),
        },
        { key: 'spot', name: 'Spot', b: [-17, -17, 17, 17], draw: () => circ(15) + hourglass(1.5) },
        {
          // Croix épaisse soulignée d'une barre (d'après l'image fournie)
          key: 'applique', name: 'Applique', b: [-12, -14, 12, 18],
          draw: () => line(-8.5, -11.5, 8.5, 7.5, 'stroke-width="3.4" stroke-linecap="butt"') +
            line(8.5, -11.5, -8.5, 7.5, 'stroke-width="3.4" stroke-linecap="butt"') +
            line(-9.8, 14, 9.8, 14, 'stroke-width="2.4" stroke-linecap="butt"'),
        },
        {
          key: 'lampe', name: 'Éclairage lampe', b: [-12, -18, 12, 18],
          draw: () => circ(10) + line(-7.07, -7.07, 7.07, 7.07) + line(7.07, -7.07, -7.07, 7.07) + line(0, -10, 0, -16) + line(0, 10, 0, 16),
        },
        {
          key: 'plafond', name: 'Point lumineux plafond', b: [-14, -19, 14, 19],
          draw: () =>
            `<path d="M-4 -11.3 A12 12 0 1 0 4 -11.3"/>` + line(0, -12, 0, -18) + line(0, 12, 0, 18) +
            line(-4, -11.3, -4, -15) + line(4, -11.3, 4, -15),
        },
      ],
    },
    {
      name: 'Tableau électrique',
      items: [
        {
          key: 'tableau', name: 'Tableau électrique', b: [-20, -14, 20, 14],
          draw: () => `<rect x="-18" y="-12" width="36" height="24"/>` +
            `<path d="M3 -9 L-5 2 L-1 2 L-3 10 L5 -3 L1 -3 Z" fill="currentColor"/>`,
        },
      ],
    },
    {
      name: 'Équipements spéciaux',
      items: [
        {
          key: 'borne', name: 'Borne de recharge électrique', b: [-14, -16, 22, 16],
          draw: () => `<rect x="-12" y="-14" width="22" height="28" rx="4"/>` +
            `<path d="M1 -8 L-4 1 L-1 1 L-2 8 L4 -2 L1 -2 Z" stroke-width="1.4"/>` +
            `<path d="M10 -3 H13 A4 4 0 0 1 17 1 V8 A2.5 2.5 0 0 1 12 8" stroke-width="1.6"/>`,
        },
        {
          key: 'detecteur', name: 'Détecteur de mouvement', b: [-17, -15, 17, 15],
          draw: () => `<path d="M-15 0 L-3 -7 L-3 7 Z"/>` + `<path d="M-3 -5 Q3 0 -3 5" stroke-width="1.4"/>` +
            line(6, -9, 13, -13, 'stroke-width="1.4"') + line(8, 0, 16, 0, 'stroke-width="1.4"') + line(6, 9, 13, 13, 'stroke-width="1.4"'),
        },
        {
          key: 'pv', name: 'Panneau photovoltaïque', b: [-20, -10, 20, 10],
          draw: () => {
            let s = `<rect x="-18" y="-8" width="36" height="16" fill="#2c3e5c" stroke="${INK}"/>`;
            for (let x = -12; x <= 12; x += 6) s += line(x, -8, x, 8, 'stroke="#aebbd1" stroke-width="0.8"');
            s += line(-18, 0, 18, 0, 'stroke="#aebbd1" stroke-width="0.8"');
            return s;
          },
        },
        {
          key: 'radiateur', name: 'Radiateur', b: [-20, -9, 20, 9],
          draw: () => `<rect x="-18" y="-7" width="36" height="14"/>` + line(-18, -2.3, 18, -2.3, 'stroke-width="1.4"') + line(-18, 2.3, 18, 2.3, 'stroke-width="1.4"'),
        },
        {
          key: 'radiateurInertie', name: 'Radiateur à inertie', b: [-22, -6, 22, 6],
          draw: () => {
            let pts = '';
            for (let x = -18, i = 0; x <= 18; x += 3, i++) pts += `${x},${i % 2 ? 2.2 : -2.2} `;
            return `<rect x="-20" y="-4" width="40" height="8"/>` + `<polyline points="${pts.trim()}" stroke-width="1.2"/>`;
          },
        },
      ],
    },
  ];

  const map = {};
  for (const g of groups) for (const it of g.items) map[it.key] = it;

  window.SchSymbols = {
    INK,
    groups,
    map,
    // Contenu SVG d'un symbole (sans translation) ; rot sert à garder les textes droits
    inner(key, rot, sx, sy) {
      const d = map[key];
      if (!d) return '';
      return `<g style="color:${INK}" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.draw({ rot: rot || 0, sx: sx || 1, sy: sy || 1 })}</g>`;
    },
  };
})();
