/* ============================================================
   Matériaux des murs (colonne « Plan » du tableau de symboles fourni)
   Chaque matériau est un motif SVG (<pattern>) rempli dans l'épaisseur du mur.
   Pour ajuster un motif ou un nom, modifier uniquement la liste ci-dessous.
   Le motif suit la direction du mur (repère local du mur).
   ============================================================ */
(function () {
  'use strict';

  const INK = '#222';
  const WALL_COLOR = '#3b3b3b';

  const L = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="${w || 1}"/>`;
  const D = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r || 0.8}" fill="${INK}"/>`;
  const P = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w || 1}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const R = (x, y, w, h, sw) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="${sw || 1}"/>`;

  // opts.rot : rotation du motif (hachures) ; opts.center : motif centré sur l'axe du mur
  function pat(key, w, h, inner, opts) {
    const o = opts || {};
    const tf = o.rot ? ` patternTransform="rotate(${o.rot})"` : '';
    const y = o.center ? -h / 2 : 0;
    return `<pattern id="m-${key}" x="0" y="${y}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${tf}>` +
      `${inner}</pattern>`;
  }

  const groups = [
    {
      name: 'Base',
      items: [
        { key: 'plein', name: 'Mur plein (noir)', special: 'plein' },
        { key: 'contour', name: 'Contour seul (blanc)', special: 'contour' },
        { key: 'verre', name: 'Verre (trait)', special: 'verre' },
      ],
    },
    {
      name: 'Maçonnerie',
      items: [
        { key: 'brique', name: 'Brique (commun ou parement)', def: pat('brique', 6, 6, L(3, 0, 3, 6, 1.2), { rot: 45 }) },
        { key: 'briqueRefr', name: 'Brique réfractaire', def: pat('briqueRefr', 4.5, 4.5, L(2.25, 0, 2.25, 4.5, 1.6), { rot: 45 }) },
        { key: 'betonLeger', name: 'Béton léger', def: pat('betonLeger', 9, 9, D(1.5, 2, 0.7) + D(5.5, 1, 0.6) + D(7, 6, 0.8) + D(3, 6.5, 0.6) + D(8, 3.5, 0.5)) },
        {
          key: 'betonStruct', name: 'Béton structurel',
          def: pat('betonStruct', 16, 16,
            `<ellipse cx="4" cy="4" rx="2" ry="1.5" fill="${INK}" transform="rotate(30 4 4)"/>` +
            `<ellipse cx="11" cy="10" rx="1.6" ry="2" fill="${INK}"/>` +
            `<path d="M12 2 L14.5 3 L13 5.2 Z" fill="${INK}"/>` +
            D(8, 6, 0.8) + D(2, 11, 0.7) + D(14, 14, 0.8) + D(7, 13, 0.6) + D(15, 8, 0.5)),
        },
        { key: 'betonBloc', name: 'Béton bloc', def: pat('betonBloc', 10, 12, L(0, 0, 0, 12, 1.2) + D(2.5, 3, 0.7) + D(2.5, 9, 0.7) + D(7.5, 6, 0.7) + D(7.5, 1.5, 0.6), { center: true }) },
        { key: 'pierreTaillee', name: 'Pierre taillée', def: pat('pierreTaillee', 5, 5, D(1, 1, 0.5) + D(3.5, 3.5, 0.5) + D(3.8, 0.8, 0.4) + D(1.2, 3.8, 0.4)) },
        { key: 'debris', name: 'Roche : débris', def: pat('debris', 8, 8, L(4, 0, 4, 8, 1), { rot: 45 }) },
        { key: 'pierreArt', name: 'Pierre artificielle (béton)', def: pat('pierreArt', 10, 10, L(0, 0, 0, 10, 1.2) + D(5, 2.5, 0.7) + D(5, 7.5, 0.7) + D(2.5, 5, 0.6) + D(7.5, 5, 0.6)) },
        { key: 'tuileArgile', name: 'Tuile en argile (structurel)', def: pat('tuileArgile', 3.5, 3.5, L(1.75, 0, 1.75, 3.5, 1.1) + L(0, 1.75, 3.5, 1.75, 1.1), { rot: 45 }) },
      ],
    },
    {
      name: 'Bois',
      items: [
        { key: 'boisCroix', name: 'Bois : croisillons', def: pat('boisCroix', 12, 12, R(0.6, 0.6, 10.8, 10.8) + L(0.6, 0.6, 11.4, 11.4) + L(11.4, 0.6, 0.6, 11.4), { center: true }) },
        { key: 'boisLignes', name: 'Bois : lignes', def: pat('boisLignes', 12, 4, L(0, 2, 12, 2, 1), { center: true }) },
        { key: 'boisOndule', name: 'Bois : ondulé', def: pat('boisOndule', 12, 6, P('M0 3 Q3 0 6 3 T12 3', 1), { center: true }) },
      ],
    },
    {
      name: 'Plâtre',
      items: [
        {
          key: 'platreOssature', name: 'Plâtre sur ossature bois (lattis)',
          def: pat('platreOssature', 8, 8, R(0.5, 0.5, 7, 7, 0.8) + L(0.5, 0.5, 7.5, 7.5, 0.8) + L(7.5, 0.5, 0.5, 7.5, 0.8), { center: true }),
        },
        {
          key: 'platreLatteMetal', name: 'Latte métallique et plâtre',
          def: pat('platreLatteMetal', 8, 12, D(1, 2, 0.6) + D(4, 4, 0.6) + D(7, 1.5, 0.6) + D(2.5, 9, 0.6) + D(6, 8, 0.6) + D(5, 11, 0.5) + P('M0 6 L2 4 L4 6 L6 4 L8 6', 0.9), { center: true }),
        },
        { key: 'platreSolide', name: 'Plâtre plein', def: pat('platreSolide', 24, 12, P('M0 6 Q6 -1 12 6 T24 6', 1.6), { center: true }) },
      ],
    },
    {
      name: 'Verre',
      items: [
        { key: 'blocVerre', name: 'Bloc de verre', def: pat('blocVerre', 8, 12, L(0, 0, 0, 12, 1) + R(1.2, 2.5, 5.6, 7, 0.7), { center: true }) },
      ],
    },
    {
      name: 'Isolation',
      items: [
        { key: 'isoVrac', name: 'Isolation : remplissage en vrac ou matelas', def: pat('isoVrac', 12, 10, P('M0 8 C0 0 6 0 6 8 C6 0 12 0 12 8', 1), { center: true }) },
        { key: 'isoRigide', name: 'Isolation : rigide', def: pat('isoRigide', 3.5, 3.5, D(0.9, 0.9, 0.6) + D(2.65, 2.65, 0.6)) },
        {
          key: 'isoMousse', name: 'Isolation : mousse',
          def: pat('isoMousse', 12, 12, D(2, 5, 0.5) + D(6, 6, 0.5) + D(10, 5, 0.5) + D(4, 7.5, 0.5) + D(8, 4, 0.5) + P('M0 2 Q3 -1 6 2 T12 2', 0.8) + P('M0 10 Q3 7 6 10 T12 10', 0.8), { center: true }),
        },
      ],
    },
  ];

  // Anciens murs « carrelage » (avant la création des sols) : toujours affichés, mais absents de la palette
  const legacy = [
    { key: 'carrelage', name: 'Carrelage (ancien mur)', def: pat('carrelage', 5, 5, L(0, 0, 5, 0, 0.8) + L(0, 0, 0, 5, 0.8)) },
  ];

  // Sols : surfaces dessinées sous les murs (colonne « Plan » : carrelage de sol ; les autres sols sont courants)
  const floorGroups = [
    {
      name: 'Sols',
      items: [
        { key: 'sol-uni', name: 'Sol uni (gris clair)', special: 'uni' },
        { key: 'sol-carrelage', name: 'Carrelage de sol', def: pat('sol-carrelage', 10, 10, L(0, 0, 10, 0, 0.8) + L(0, 0, 0, 10, 0.8)) },
        { key: 'sol-carrelageDiag', name: 'Carrelage en diagonale', def: pat('sol-carrelageDiag', 10, 10, L(0, 0, 10, 0, 0.8) + L(0, 0, 0, 10, 0.8), { rot: 45 }) },
        {
          key: 'sol-parquet', name: 'Parquet (lames)',
          def: pat('sol-parquet', 40, 16, L(0, 0, 40, 0, 0.9) + L(0, 8, 40, 8, 0.9) + L(0, 16, 40, 16, 0.9) + L(0, 0, 0, 8, 0.9) + L(20, 8, 20, 16, 0.9)),
        },
        { key: 'sol-dalle', name: 'Dalle béton', def: pat('sol-dalle', 12, 12, D(2, 3, 0.6) + D(8, 2, 0.5) + D(6, 8, 0.6) + D(10, 10, 0.5) + D(3, 10, 0.5)) },
      ],
    },
  ];
  const FLOOR_UNI = '#e9ecf1';

  const map = {};
  for (const g of groups) for (const it of g.items) map[it.key] = it;
  for (const it of legacy) map[it.key] = it;
  const floorMap = {};
  for (const g of floorGroups) for (const it of g.items) floorMap[it.key] = it;

  // Remplissage SVG d'un matériau (null = « verre », dessiné en trait)
  function fill(key) {
    const m = map[key] || map.plein;
    if (m.special === 'plein') return WALL_COLOR;
    if (m.special === 'contour') return '#fff';
    if (m.special === 'verre') return null;
    return `url(#m-${m.key})`;
  }

  // Remplissage SVG d'un sol
  function floorFill(key) {
    const f = floorMap[key] || floorMap['sol-uni'];
    return f.special === 'uni' ? FLOOR_UNI : `url(#m-${f.key})`;
  }

  window.SchMaterials = {
    groups,
    map,
    floorGroups,
    floorMap,
    floorFill,
    WALL_COLOR,
    INK,
    fill,
    // Tous les motifs (à placer dans un <defs>)
    defsSVG() {
      let s = '';
      for (const g of groups) for (const it of g.items) if (it.def) s += it.def;
      for (const it of legacy) s += it.def;
      for (const g of floorGroups) for (const it of g.items) if (it.def) s += it.def;
      return s;
    },
    // Petite vignette pour la palette
    swatch(key) {
      const fl = floorMap[key];
      if (fl) {
        return `<svg viewBox="0 0 64 24" width="64" height="24" aria-hidden="true"><rect x="2" y="3" width="60" height="18" fill="#fff"/>` +
          `<rect x="2" y="3" width="60" height="18" fill="${floorFill(key)}" stroke="#8a93a3" stroke-width="1.2"/></svg>`;
      }
      const m = map[key] || map.plein;
      let inner;
      if (m.special === 'verre') inner = `<line x1="4" y1="12" x2="60" y2="12" stroke="${INK}" stroke-width="1.8"/>`;
      else {
        inner = `<rect x="2" y="3" width="60" height="18" fill="#fff"/>` +
          `<rect x="2" y="3" width="60" height="18" fill="${fill(key)}" stroke="${m.special === 'plein' ? WALL_COLOR : INK}" stroke-width="1.5"/>`;
      }
      return `<svg viewBox="0 0 64 24" width="64" height="24" aria-hidden="true">${inner}</svg>`;
    },
  };
})();
