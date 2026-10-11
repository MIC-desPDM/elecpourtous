/* ============================================================
   ÉlectroFormules — app.js
   Bibliothèque + calculateur de formules d'électrotechnique
   ============================================================ */
'use strict';

/* ---------- Stockage sûr (l'aperçu intégré bloque le stockage du navigateur) ---------- */
const storage = (() => {
  try {
    const ls = window['local' + 'Storage'];
    if (!ls) return null;
    const t = '__ef_test__';
    ls.setItem(t, '1');
    ls.removeItem(t);
    return ls;
  } catch (e) {
    return null;
  }
})();

const state = {
  custom: [],        // formules personnelles
  favorites: [],     // ids favoris
  overrides: {},     // modifications des formules intégrées (id -> surcharges)
  filter: 'all',
  query: '',
};

function persist() {
  if (!storage) return;
  try {
    storage.setItem('ef_custom', JSON.stringify(state.custom));
    storage.setItem('ef_favorites', JSON.stringify(state.favorites));
    storage.setItem('ef_overrides', JSON.stringify(state.overrides));
  } catch (e) { /* quota plein : on ignore */ }
}

function load() {
  if (!storage) return;
  try {
    state.custom = JSON.parse(storage.getItem('ef_custom') || '[]');
    state.favorites = JSON.parse(storage.getItem('ef_favorites') || '[]');
    const ov = JSON.parse(storage.getItem('ef_overrides') || '{}');
    state.overrides = (ov && typeof ov === 'object' && !Array.isArray(ov)) ? ov : {};
  } catch (e) { /* données corrompues : on repart de zéro */ }
}

/* ---------- Bibliothèque de formules ----------
   solves : fonctions vérifiées (inconnue -> valeur à partir des autres) */
const S3 = Math.sqrt(3);
const FORMULAS = [
  /* ===== Lois fondamentales ===== */
  {
    id: 'ohm', cat: 'base',
    name: "Loi d'Ohm",
    latex: 'U = R \\times I',
    desc: "Tension aux bornes d'un conducteur ohmique : elle est proportionnelle au courant et à la résistance.",
    vars: {
      U: { label: 'Tension', unit: 'V' },
      R: { label: 'Résistance', unit: 'Ω' },
      I: { label: 'Intensité du courant', unit: 'A' },
    },
    solves: {
      U: v => v.R * v.I,
      R: v => v.U / v.I,
      I: v => v.U / v.R,
    },
  },
  {
    id: 'pui', cat: 'base',
    name: 'Puissance électrique (continu)',
    latex: 'P = U \\times I',
    desc: 'Puissance consommée par un récepteur en courant continu (ou alternatif résistif pur).',
    vars: {
      P: { label: 'Puissance', unit: 'W' },
      U: { label: 'Tension', unit: 'V' },
      I: { label: 'Intensité', unit: 'A' },
    },
    solves: {
      P: v => v.U * v.I,
      U: v => v.P / v.I,
      I: v => v.P / v.U,
    },
  },
  {
    id: 'joule', cat: 'base',
    name: 'Loi de Joule (effet Joule)',
    latex: 'P = R \\times I^{2}',
    desc: 'Puissance dissipée par effet Joule dans une résistance parcourue par un courant.',
    vars: {
      P: { label: 'Puissance dissipée', unit: 'W' },
      R: { label: 'Résistance', unit: 'Ω' },
      I: { label: 'Intensité', unit: 'A' },
    },
    solves: {
      P: v => v.R * v.I * v.I,
      R: v => v.P / (v.I * v.I),
      I: v => Math.sqrt(v.P / v.R),
    },
  },
  {
    id: 'resistivite', cat: 'base',
    name: "Résistance d'un conducteur",
    latex: 'R = \\rho \\, \\dfrac{L}{S}',
    desc: "Résistance d'un fil conducteur : ρ résistivité (Ω·mm²/m), L longueur (m), S section (mm²). Cuivre ≈ 0,0225 Ω·mm²/m, aluminium ≈ 0,036.",
    vars: {
      R: { label: 'Résistance', unit: 'Ω' },
      rho: { label: 'Résistivité', unit: 'Ω·mm²/m' },
      L: { label: 'Longueur', unit: 'm' },
      S: { label: 'Section', unit: 'mm²' },
    },
    solves: {
      R: v => (v.rho * v.L) / v.S,
      rho: v => (v.R * v.S) / v.L,
      L: v => (v.R * v.S) / v.rho,
      S: v => (v.rho * v.L) / v.R,
    },
  },
  {
    id: 'serie', cat: 'base',
    name: 'Résistances en série',
    latex: 'R_{eq} = R_{1} + R_{2} + \\cdots + R_{n}',
    desc: 'La résistance équivalente d’un montage en série est la somme des résistances.',
    vars: {
      Req: { label: 'Résistance équivalente', unit: 'Ω' },
      R1: { label: 'Résistance 1', unit: 'Ω' },
      R2: { label: 'Résistance 2', unit: 'Ω' },
    },
    solves: {
      Req: v => v.R1 + v.R2,
      R1: v => v.Req - v.R2,
      R2: v => v.Req - v.R1,
    },
  },
  {
    id: 'parallele', cat: 'base',
    name: 'Résistances en parallèle (2)',
    latex: 'R_{eq} = \\dfrac{R_{1} \\times R_{2}}{R_{1} + R_{2}}',
    desc: 'Deux résistances en parallèle. Pour n résistances : 1/Req = 1/R₁ + 1/R₂ + … + 1/Rₙ.',
    vars: {
      Req: { label: 'Résistance équivalente', unit: 'Ω' },
      R1: { label: 'Résistance 1', unit: 'Ω' },
      R2: { label: 'Résistance 2', unit: 'Ω' },
    },
    solves: {
      Req: v => (v.R1 * v.R2) / (v.R1 + v.R2),
      R1: v => (v.Req * v.R2) / (v.R2 - v.Req),
      R2: v => (v.Req * v.R1) / (v.R1 - v.Req),
    },
  },
  {
    id: 'diviseur', cat: 'base',
    name: 'Diviseur de tension',
    latex: 'U_{1} = U \\times \\dfrac{R_{1}}{R_{1} + R_{2}}',
    desc: 'Tension aux bornes de R₁ dans un montage de deux résistances en série alimentées sous U.',
    vars: {
      U1: { label: 'Tension aux bornes de R₁', unit: 'V' },
      U: { label: 'Tension totale', unit: 'V' },
      R1: { label: 'Résistance 1', unit: 'Ω' },
      R2: { label: 'Résistance 2', unit: 'Ω' },
    },
    solves: {
      U1: v => v.U * (v.R1 / (v.R1 + v.R2)),
      U: v => v.U1 * ((v.R1 + v.R2) / v.R1),
      R1: v => (v.U1 * v.R2) / (v.U - v.U1),
      R2: v => (v.R1 * (v.U - v.U1)) / v.U1,
    },
  },
  {
    id: 'noeuds', cat: 'base',
    name: 'Loi des nœuds',
    latex: 'I_{1} = I_{2} + I_{3}',
    desc: "La somme des courants entrant dans un nœud est égale à la somme des courants qui en sortent.",
    vars: {
      I1: { label: 'Courant entrant', unit: 'A' },
      I2: { label: 'Courant sortant 1', unit: 'A' },
      I3: { label: 'Courant sortant 2', unit: 'A' },
    },
    solves: {
      I1: v => v.I2 + v.I3,
      I2: v => v.I1 - v.I3,
      I3: v => v.I1 - v.I2,
    },
  },
  {
    id: 'coulomb', cat: 'base',
    name: "Quantité d'électricité",
    latex: 'Q = I \\times t',
    desc: 'Charge électrique (en ampères-heures) traversant un circuit pendant une durée donnée.',
    vars: {
      Q: { label: "Quantité d'électricité", unit: 'Ah' },
      I: { label: 'Intensité', unit: 'A' },
      t: { label: 'Durée', unit: 'h' },
    },
    solves: {
      Q: v => v.I * v.t,
      I: v => v.Q / v.t,
      t: v => v.Q / v.I,
    },
  },

  /* ===== Courant alternatif monophasé ===== */
  {
    id: 'periode', cat: 'mono',
    name: 'Fréquence et période',
    latex: 'f = \\dfrac{1}{T}',
    desc: 'Fréquence (Hz) et période (s) d’un courant alternatif. En France : f = 50 Hz, soit T = 20 ms.',
    vars: {
      f: { label: 'Fréquence', unit: 'Hz' },
      T: { label: 'Période', unit: 's' },
    },
    solves: {
      f: v => 1 / v.T,
      T: v => 1 / v.f,
    },
  },
  {
    id: 'efficace', cat: 'mono',
    name: 'Valeur maximale / valeur efficace',
    latex: 'U = \\dfrac{U_{max}}{\\sqrt{2}}',
    desc: 'Pour une grandeur sinusoïdale, la valeur efficace est la valeur maximale divisée par √2.',
    vars: {
      U: { label: 'Tension efficace', unit: 'V' },
      Umax: { label: 'Tension maximale', unit: 'V' },
    },
    solves: {
      U: v => v.Umax / Math.SQRT2,
      Umax: v => v.U * Math.SQRT2,
    },
  },
  {
    id: 'p-active-mono', cat: 'mono',
    name: 'Puissance active (monophasé)',
    latex: 'P = U \\times I \\times \\cos\\varphi',
    desc: 'Puissance réellement consommée par un récepteur monophasé en régime sinusoïdal. U et I sont les valeurs efficaces.',
    vars: {
      P: { label: 'Puissance active', unit: 'W' },
      U: { label: 'Tension (V)', unit: 'V' },
      I: { label: 'Intensité', unit: 'A' },
      cosphi: { label: 'Facteur de puissance', unit: '' },
    },
    solves: {
      P: v => v.U * v.I * v.cosphi,
      U: v => v.P / (v.I * v.cosphi),
      I: v => v.P / (v.U * v.cosphi),
      cosphi: v => v.P / (v.U * v.I),
    },
  },
  {
    id: 'p-apparente-mono', cat: 'mono',
    name: 'Puissance apparente (monophasé)',
    latex: 'S = U \\times I',
    desc: 'Puissance apparente d’un récepteur monophasé : c’est la puissance que doit fournir le réseau.',
    vars: {
      S: { label: 'Puissance apparente', unit: 'VA' },
      U: { label: 'Tension', unit: 'V' },
      I: { label: 'Intensité', unit: 'A' },
    },
    solves: {
      S: v => v.U * v.I,
      U: v => v.S / v.I,
      I: v => v.S / v.U,
    },
  },
  {
    id: 'p-reactive-mono', cat: 'mono',
    name: 'Puissance réactive (monophasé)',
    latex: 'Q = U \\times I \\times \\sin\\varphi',
    desc: 'Puissance réactive échangée avec les éléments inductifs (bobines, moteurs) ou capacitifs.',
    vars: {
      Q: { label: 'Puissance réactive', unit: 'var' },
      U: { label: 'Tension', unit: 'V' },
      I: { label: 'Intensité', unit: 'A' },
      sinphi: { label: 'sin φ', unit: '' },
    },
    solves: {
      Q: v => v.U * v.I * v.sinphi,
      U: v => v.Q / (v.I * v.sinphi),
      I: v => v.Q / (v.U * v.sinphi),
      sinphi: v => v.Q / (v.U * v.I),
    },
  },
  {
    id: 'triangle-p', cat: 'mono',
    name: 'Triangle des puissances',
    latex: 'S = \\sqrt{P^{2} + Q^{2}}',
    desc: 'Relation entre puissance apparente, active et réactive.',
    vars: {
      S: { label: 'Puissance apparente', unit: 'VA' },
      P: { label: 'Puissance active', unit: 'W' },
      Q: { label: 'Puissance réactive', unit: 'var' },
    },
    solves: {
      S: v => Math.sqrt(v.P * v.P + v.Q * v.Q),
      P: v => {
        const d = v.S * v.S - v.Q * v.Q;
        if (d < 0) throw new Error('Impossible : S doit être au moins égale à Q (hypoténuse du triangle).');
        return Math.sqrt(d);
      },
      Q: v => {
        const d = v.S * v.S - v.P * v.P;
        if (d < 0) throw new Error('Impossible : S doit être au moins égale à P (hypoténuse du triangle).');
        return Math.sqrt(d);
      },
    },
  },
  {
    id: 'cosphi', cat: 'mono',
    name: 'Facteur de puissance',
    latex: '\\cos\\varphi = \\dfrac{P}{S}',
    desc: 'Rapport entre puissance active et puissance apparente.',
    vars: {
      cosphi: { label: 'Facteur de puissance', unit: '' },
      P: { label: 'Puissance active', unit: 'W' },
      S: { label: 'Puissance apparente', unit: 'VA' },
    },
    solves: {
      cosphi: v => v.P / v.S,
      P: v => v.S * v.cosphi,
      S: v => v.P / v.cosphi,
    },
  },
  {
    id: 'tanphi', cat: 'mono',
    name: 'Tangente du déphasage',
    latex: '\\tan\\varphi = \\dfrac{Q}{P}',
    desc: 'Utile pour dimensionner une batterie de condensateurs de compensation.',
    vars: {
      tanphi: { label: 'tan φ', unit: '' },
      Q: { label: 'Puissance réactive', unit: 'var' },
      P: { label: 'Puissance active', unit: 'W' },
    },
    solves: {
      tanphi: v => v.Q / v.P,
      Q: v => v.P * v.tanphi,
      P: v => v.Q / v.tanphi,
    },
  },
  {
    id: 'impedance', cat: 'mono',
    name: 'Impédance',
    latex: 'Z = \\dfrac{U}{I}',
    desc: "Impédance d'un récepteur alternatif (équivalent de la loi d'Ohm en alternatif).",
    vars: {
      Z: { label: 'Impédance', unit: 'Ω' },
      U: { label: 'Tension', unit: 'V' },
      I: { label: 'Intensité', unit: 'A' },
    },
    solves: {
      Z: v => v.U / v.I,
      U: v => v.Z * v.I,
      I: v => v.U / v.Z,
    },
  },
  {
    id: 'impedance-rl', cat: 'mono',
    name: 'Impédance R-L série',
    latex: 'Z = \\sqrt{R^{2} + X^{2}}',
    desc: 'Impédance d’une résistance R en série avec une réactance X (bobine ou condensateur).',
    vars: {
      Z: { label: 'Impédance', unit: 'Ω' },
      R: { label: 'Résistance', unit: 'Ω' },
      X: { label: 'Réactance', unit: 'Ω' },
    },
    solves: {
      Z: v => Math.sqrt(v.R * v.R + v.X * v.X),
      R: v => {
        const d = v.Z * v.Z - v.X * v.X;
        if (d < 0) throw new Error('Impossible : Z doit être au moins égale à X.');
        return Math.sqrt(d);
      },
      X: v => {
        const d = v.Z * v.Z - v.R * v.R;
        if (d < 0) throw new Error('Impossible : Z doit être au moins égale à R.');
        return Math.sqrt(d);
      },
    },
  },
  {
    id: 'reactance-l', cat: 'mono',
    name: 'Réactance d’une bobine',
    latex: 'X_{L} = 2\\pi f L',
    desc: 'Réactance inductive d’une bobine : elle augmente avec la fréquence.',
    vars: {
      XL: { label: 'Réactance', unit: 'Ω' },
      f: { label: 'Fréquence', unit: 'Hz' },
      L: { label: 'Inductance', unit: 'H' },
    },
    solves: {
      XL: v => 2 * Math.PI * v.f * v.L,
      f: v => v.XL / (2 * Math.PI * v.L),
      L: v => v.XL / (2 * Math.PI * v.f),
    },
  },
  {
    id: 'reactance-c', cat: 'mono',
    name: 'Réactance d’un condensateur',
    latex: 'X_{C} = \\dfrac{1}{2\\pi f C}',
    desc: 'Réactance capacitive : elle diminue quand la fréquence ou la capacité augmente.',
    vars: {
      XC: { label: 'Réactance', unit: 'Ω' },
      f: { label: 'Fréquence', unit: 'Hz' },
      C: { label: 'Capacité', unit: 'F' },
    },
    solves: {
      XC: v => 1 / (2 * Math.PI * v.f * v.C),
      f: v => 1 / (2 * Math.PI * v.C * v.XC),
      C: v => 1 / (2 * Math.PI * v.f * v.XC),
    },
  },

  /* ===== Triphasé équilibré ===== */
  {
    id: 'p-active-tri', cat: 'tri',
    name: 'Puissance active (triphasé)',
    latex: 'P = \\sqrt{3} \\times U \\times I \\times \\cos\\varphi',
    desc: 'Régime triphasé équilibré : U est la tension entre phases (composée), I le courant de ligne. En France : U = 400 V.',
    vars: {
      P: { label: 'Puissance active', unit: 'W' },
      U: { label: 'Tension entre phases', unit: 'V' },
      I: { label: 'Courant de ligne', unit: 'A' },
      cosphi: { label: 'Facteur de puissance', unit: '' },
    },
    solves: {
      P: v => S3 * v.U * v.I * v.cosphi,
      U: v => v.P / (S3 * v.I * v.cosphi),
      I: v => v.P / (S3 * v.U * v.cosphi),
      cosphi: v => v.P / (S3 * v.U * v.I),
    },
  },
  {
    id: 'p-apparente-tri', cat: 'tri',
    name: 'Puissance apparente (triphasé)',
    latex: 'S = \\sqrt{3} \\times U \\times I',
    desc: 'Puissance apparente en triphasé équilibré (U composée, I courant de ligne).',
    vars: {
      S: { label: 'Puissance apparente', unit: 'VA' },
      U: { label: 'Tension entre phases', unit: 'V' },
      I: { label: 'Courant de ligne', unit: 'A' },
    },
    solves: {
      S: v => S3 * v.U * v.I,
      U: v => v.S / (S3 * v.I),
      I: v => v.S / (S3 * v.U),
    },
  },
  {
    id: 'p-reactive-tri', cat: 'tri',
    name: 'Puissance réactive (triphasé)',
    latex: 'Q = \\sqrt{3} \\times U \\times I \\times \\sin\\varphi',
    desc: 'Puissance réactive en triphasé équilibré.',
    vars: {
      Q: { label: 'Puissance réactive', unit: 'var' },
      U: { label: 'Tension entre phases', unit: 'V' },
      I: { label: 'Courant de ligne', unit: 'A' },
      sinphi: { label: 'sin φ', unit: '' },
    },
    solves: {
      Q: v => S3 * v.U * v.I * v.sinphi,
      U: v => v.Q / (S3 * v.I * v.sinphi),
      I: v => v.Q / (S3 * v.U * v.sinphi),
      sinphi: v => v.Q / (S3 * v.U * v.I),
    },
  },
  {
    id: 'tensions-tri', cat: 'tri',
    name: 'Tensions triphasé : composée / simple',
    latex: 'U = \\sqrt{3} \\times V',
    desc: 'U : tension entre phases (composée). V : tension entre phase et neutre (simple). Ex. : 400 V / 230 V.',
    vars: {
      U: { label: 'Tension composée', unit: 'V' },
      V: { label: 'Tension simple', unit: 'V' },
    },
    solves: {
      U: v => S3 * v.V,
      V: v => v.U / S3,
    },
  },
  {
    id: 'pertes-joule-tri', cat: 'tri',
    name: 'Pertes Joule en ligne (triphasé)',
    latex: 'P_{j} = 3 \\times R \\times I^{2}',
    desc: 'Puissance perdue par effet Joule dans les trois conducteurs de ligne (R : résistance d’un conducteur).',
    vars: {
      Pj: { label: 'Pertes Joule', unit: 'W' },
      R: { label: 'Résistance d’un conducteur', unit: 'Ω' },
      I: { label: 'Courant de ligne', unit: 'A' },
    },
    solves: {
      Pj: v => 3 * v.R * v.I * v.I,
      R: v => v.Pj / (3 * v.I * v.I),
      I: v => Math.sqrt(v.Pj / (3 * v.R)),
    },
  },
  {
    id: 'chute-mono', cat: 'tri',
    name: 'Chute de tension (monophasé)',
    latex: '\\Delta U = \\dfrac{2\\,\\rho\\, L\\, I}{S}',
    desc: 'Chute de tension dans une ligne monophasée (aller-retour) : ρ en Ω·mm²/m (à ~20 °C), L en m, S en mm². Approximation valable pour de faibles chutes.',
    vars: {
      dU: { label: 'Chute de tension', unit: 'V' },
      rho: { label: 'Résistivité', unit: 'Ω·mm²/m' },
      L: { label: 'Longueur de ligne', unit: 'm' },
      I: { label: 'Courant', unit: 'A' },
      S: { label: 'Section', unit: 'mm²' },
    },
    solves: {
      dU: v => (2 * v.rho * v.L * v.I) / v.S,
      I: v => (v.dU * v.S) / (2 * v.rho * v.L),
      S: v => (2 * v.rho * v.L * v.I) / v.dU,
      L: v => (v.dU * v.S) / (2 * v.rho * v.I),
    },
  },
  {
    id: 'chute-tri', cat: 'tri',
    name: 'Chute de tension (triphasé)',
    latex: '\\Delta U = \\dfrac{\\sqrt{3}\\,\\rho\\, L\\, I}{S}',
    desc: 'Chute de tension dans une ligne triphasée équilibrée (approximation, résistances à ~20 °C).',
    vars: {
      dU: { label: 'Chute de tension', unit: 'V' },
      rho: { label: 'Résistivité', unit: 'Ω·mm²/m' },
      L: { label: 'Longueur de ligne', unit: 'm' },
      I: { label: 'Courant de ligne', unit: 'A' },
      S: { label: 'Section', unit: 'mm²' },
    },
    solves: {
      dU: v => (S3 * v.rho * v.L * v.I) / v.S,
      I: v => (v.dU * v.S) / (S3 * v.rho * v.L),
      S: v => (S3 * v.rho * v.L * v.I) / v.dU,
      L: v => (v.dU * v.S) / (S3 * v.rho * v.I),
    },
  },

  /* ===== Énergie ===== */
  {
    id: 'energie', cat: 'energie',
    name: 'Énergie consommée',
    latex: 'E = \\dfrac{P \\times t}{1000}',
    desc: 'Énergie consommée par un appareil de puissance P (W) pendant une durée t (h), en kilowattheures.',
    vars: {
      E: { label: 'Énergie', unit: 'kWh' },
      P: { label: 'Puissance', unit: 'W' },
      t: { label: 'Durée', unit: 'h' },
    },
    solves: {
      E: v => (v.P * v.t) / 1000,
      P: v => (v.E * 1000) / v.t,
      t: v => (v.E * 1000) / v.P,
    },
  },
  {
    id: 'cout', cat: 'energie',
    name: 'Coût de consommation',
    latex: 'C = E \\times p',
    desc: 'Coût d’une consommation d’énergie E (kWh) au tarif p (€/kWh).',
    vars: {
      C: { label: 'Coût', unit: '€' },
      E: { label: 'Énergie', unit: 'kWh' },
      p: { label: 'Prix du kWh', unit: '€' },
    },
    solves: {
      C: v => v.E * v.p,
      E: v => v.C / v.p,
      p: v => v.C / v.E,
    },
  },

  /* ===== Moteurs ===== */
  {
    id: 'vitesse-synchro', cat: 'moteur',
    name: 'Vitesse de synchronisme',
    latex: 'n_{s} = \\dfrac{60 \\times f}{p}',
    desc: "Vitesse de synchronisme d'un moteur asynchrone (tr/min) : f la fréquence (Hz), p le nombre de paires de pôles.",
    vars: {
      ns: { label: 'Vitesse synchronisme', unit: 'tr/min' },
      f: { label: 'Fréquence', unit: 'Hz' },
      p: { label: 'Paires de pôles', unit: '' },
    },
    solves: {
      ns: v => (60 * v.f) / v.p,
      f: v => (v.ns * v.p) / 60,
      p: v => (60 * v.f) / v.ns,
    },
  },
  {
    id: 'glissement', cat: 'moteur',
    name: 'Glissement',
    latex: 'g = \\dfrac{n_{s} - n}{n_{s}}',
    desc: "Glissement d'un moteur asynchrone : différence relative entre vitesse de synchronisme et vitesse réelle.",
    vars: {
      g: { label: 'Glissement', unit: '' },
      ns: { label: 'Vitesse synchronisme', unit: 'tr/min' },
      n: { label: 'Vitesse du rotor', unit: 'tr/min' },
    },
    solves: {
      g: v => (v.ns - v.n) / v.ns,
      n: v => v.ns * (1 - v.g),
      ns: v => v.n / (1 - v.g),
    },
  },
  {
    id: 'rendement', cat: 'moteur',
    name: 'Rendement',
    latex: '\\eta = \\dfrac{P_{u}}{P_{a}}',
    desc: "Rendement : rapport entre la puissance utile (mécanique) et la puissance absorbée (électrique).",
    vars: {
      eta: { label: 'Rendement (0 à 1)', unit: '' },
      Pu: { label: 'Puissance utile', unit: 'W' },
      Pa: { label: 'Puissance absorbée', unit: 'W' },
    },
    solves: {
      eta: v => v.Pu / v.Pa,
      Pu: v => v.eta * v.Pa,
      Pa: v => v.Pu / v.eta,
    },
  },
  {
    id: 'couple', cat: 'moteur',
    name: 'Couple utile',
    latex: 'T_{u} = \\dfrac{P_{u}}{\\Omega}',
    desc: 'Couple utile (N·m) d’un moteur à partir de sa puissance utile et de sa vitesse angulaire (rad/s).',
    vars: {
      Tu: { label: 'Couple', unit: 'N·m' },
      Pu: { label: 'Puissance utile', unit: 'W' },
      omega: { label: 'Vitesse angulaire', unit: 'rad/s' },
    },
    solves: {
      Tu: v => v.Pu / v.omega,
      Pu: v => v.Tu * v.omega,
      omega: v => v.Pu / v.Tu,
    },
  },
  {
    id: 'vitesse-angulaire', cat: 'moteur',
    name: 'Vitesse angulaire',
    latex: '\\Omega = \\dfrac{2\\pi n}{60}',
    desc: 'Conversion d’une vitesse de rotation n (tr/min) en vitesse angulaire Ω (rad/s).',
    vars: {
      omega: { label: 'Vitesse angulaire', unit: 'rad/s' },
      n: { label: 'Vitesse de rotation', unit: 'tr/min' },
    },
    solves: {
      omega: v => (2 * Math.PI * v.n) / 60,
      n: v => (60 * v.omega) / (2 * Math.PI),
    },
  },

  /* ===== Transformateurs ===== */
  {
    id: 'rapport-transfo', cat: 'transfo',
    name: 'Rapport de transformation',
    latex: 'm = \\dfrac{U_{2}}{U_{1}} = \\dfrac{N_{2}}{N_{1}}',
    desc: "Rapport d'un transformateur : tensions et nombres de spires au primaire (1) et au secondaire (2).",
    vars: {
      m: { label: 'Rapport de transformation', unit: '' },
      U1: { label: 'Tension primaire', unit: 'V' },
      U2: { label: 'Tension secondaire', unit: 'V' },
    },
    solves: {
      m: v => v.U2 / v.U1,
      U2: v => v.m * v.U1,
      U1: v => v.U2 / v.m,
    },
  },
  {
    id: 's-transfo', cat: 'transfo',
    name: 'Puissance apparente (transfo)',
    latex: 'S = U_{2} \\times I_{2}',
    desc: 'Puissance apparente d’un transformateur monophasé au secondaire.',
    vars: {
      S: { label: 'Puissance apparente', unit: 'VA' },
      U2: { label: 'Tension secondaire', unit: 'V' },
      I2: { label: 'Courant secondaire', unit: 'A' },
    },
    solves: {
      S: v => v.U2 * v.I2,
      U2: v => v.S / v.I2,
      I2: v => v.S / v.U2,
    },
  },
];

const CATS = {
  base: 'Lois fondamentales',
  mono: 'Courant alternatif',
  tri: 'Triphasé et lignes',
  energie: 'Énergie',
  moteur: 'Moteurs',
  transfo: 'Transformateurs',
  custom: 'Mes formules',
};

/* ---------- Parseur d'expressions (shunting-yard, sans eval) ---------- */
const FUNCS = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, abs: Math.abs, exp: Math.exp, asin: Math.asin, acos: Math.acos, atan: Math.atan };
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numStr = src.slice(i, j);
      if ((numStr.match(/\./g) || []).length > 1) {
        throw new Error(`Nombre mal formé : « ${numStr} »`);
      }
      tokens.push({ type: 'num', value: parseFloat(numStr) });
      i = j;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
    } else if ('+-*/^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else {
      throw new Error(`Caractère non reconnu : « ${ch} »`);
    }
  }
  return tokens;
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

function parseExpression(src) {
  const tokens = tokenize(src);
  const output = [];
  const ops = [];
  let prev = null;

  const isUnary = (tok) => tok.type === 'op' && tok.value === '-' &&
    (prev === null || (prev.type === 'op' && prev.value !== ')'));

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.type === 'num') {
      output.push(tok);
    } else if (tok.type === 'ident') {
      const next = tokens[idx + 1];
      if (next && next.type === 'op' && next.value === '(' && FUNCS[tok.value]) {
        ops.push({ type: 'func', value: tok.value });
      } else if (CONSTS[tok.value] !== undefined) {
        output.push({ type: 'num', value: CONSTS[tok.value] });
      } else if (next && next.type === 'op' && next.value === '(') {
        throw new Error(`Fonction inconnue : « ${tok.value} »`);
      } else {
        output.push({ type: 'var', value: tok.value });
      }
    } else if (tok.type === 'op') {
      if (isUnary(tok)) {
        ops.push({ type: 'op', value: 'neg', prec: 3, right: true });
      } else if (tok.value === '(') {
        ops.push(tok);
      } else if (tok.value === ')') {
        while (ops.length && !(ops[ops.length - 1].type === 'op' && ops[ops.length - 1].value === '(')) {
          output.push(ops.pop());
        }
        if (!ops.length) throw new Error('Parenthèse fermante sans ouvrante');
        ops.pop();
        if (ops.length && ops[ops.length - 1].type === 'func') {
          output.push(ops.pop());
        }
      } else if (tok.value === ',') {
        throw new Error('Les virgules ne sont pas prises en charge dans les expressions');
      } else {
        const prec = PREC[tok.value];
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top.type === 'func') { output.push(ops.pop()); continue; }
          if (top.type !== 'op' || top.value === '(') break;
          const topPrec = top.value === 'neg' ? 3 : PREC[top.value];
          if (topPrec > prec || (topPrec === prec && tok.value !== '^')) output.push(ops.pop());
          else break;
        }
        ops.push({ type: 'op', value: tok.value, right: tok.value === '^' });
      }
    }
    prev = tok;
  }
  while (ops.length) {
    const top = ops.pop();
    if (top.type === 'op' && top.value === '(') throw new Error('Parenthèse ouvrante sans fermante');
    output.push(top);
  }

  return (env) => {
    const stack = [];
    for (const tok of output) {
      if (tok.type === 'num') stack.push(tok.value);
      else if (tok.type === 'var') {
        if (!(tok.value in env)) throw new Error(`Valeur manquante pour « ${tok.value} »`);
        stack.push(env[tok.value]);
      } else if (tok.type === 'func') {
        const a = stack.pop();
        stack.push(FUNCS[tok.value](a));
      } else if (tok.value === 'neg') {
        stack.push(-stack.pop());
      } else {
        const b = stack.pop();
        const a = stack.pop();
        switch (tok.value) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '^': stack.push(Math.pow(a, b)); break;
          default: throw new Error('Opérateur inconnu');
        }
      }
    }
    if (stack.length !== 1) throw new Error('Expression invalide');
    return stack[0];
  };
}

function extractVars(src) {
  const vars = new Set();
  const tokens = tokenize(src);
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.type !== 'ident') continue;
    if (FUNCS[tok.value] || CONSTS[tok.value] !== undefined) continue;
    if (tokens[k + 1] && tokens[k + 1].type === 'op' && tokens[k + 1].value === '(') continue;
    vars.add(tok.value);
  }
  return [...vars];
}

function parseCustomFormula(expr) {
  const eq = expr.split('=');
  if (eq.length !== 2) throw new Error('L’expression doit contenir un seul « = »');
  const lhs = eq[0].trim();
  const rhs = eq[1].trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs)) throw new Error('À gauche du « = », écrivez un seul nom de variable (ex. : P, dU, n1)');
  const vars = extractVars(rhs);
  if (!vars.length) throw new Error('Aucune variable détectée à droite du « = »');
  if (vars.includes(lhs)) throw new Error('La variable à calculer ne doit pas apparaître à droite du « = »');
  const compute = parseExpression(rhs);
  return { lhs, rhs, vars, compute };
}

/* Validation complète : structure + calculs d'essai sur plusieurs jeux de valeurs */
function validateCustom(expr) {
  const parsed = parseCustomFormula(expr);
  const trials = [1, 2, 0.5, 10];
  let ok = false;
  let lastErr = null;
  for (const base of trials) {
    try {
      const env = {};
      for (const s of parsed.vars) env[s] = base;
      const test = parsed.compute(env);
      if (isFinite(test)) { ok = true; break; }
    } catch (e) { lastErr = e; }
  }
  if (!ok) throw new Error(lastErr && lastErr.message ? lastErr.message : 'Expression non calculable');
  return parsed;
}

/* ---------- Formatage ---------- */
function parseNum(str) {
  const s = String(str).replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
  const n = Number(s);
  return n;
}

function fmt(x) {
  if (!isFinite(x) || isNaN(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e9 || (a > 0 && a < 1e-4)) {
    return x.toExponential(4).replace('.', ',');
  }
  return x.toLocaleString('fr-FR', { maximumSignificantDigits: 5 });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&' + 'amp;';
      case '<': return '&' + 'lt;';
      case '>': return '&' + 'gt;';
      case '"': return '&' + 'quot;';
      default: return '&' + '#39;';
    }
  });
}

function renderLatex(el, latex) {
  if (window.katex) {
    try {
      window.katex.render(latex, el, { throwOnError: false, displayMode: true });
      return;
    } catch (e) { /* retombe sur le texte brut */ }
  }
  el.textContent = latex.replace(/\\times|\\cdot/g, '·').replace(/\\dfrac|\\frac/g, '').replace(/[\\{}]/g, ' ');
}

function prettyExpr(expr) {
  return expr
    .replace(/\s*\/\s*/g, ' ÷ ')
    .replace(/\*\*/g, '^')
    .replace(/\s*\^\s*/g, '^')
    .replace(/(?<![A-Za-z0-9_)\]])\s*\*\s*/g, ' × ');
}

/* ---------- Formules personnalisées ---------- */
function newId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function customToCard(c) {
  let parsed;
  try { parsed = parseCustomFormula(c.expr); } catch (e) { return null; }
  const vars = {};
  vars[parsed.lhs] = { label: 'Résultat', unit: (c.units && c.units[parsed.lhs]) || '' };
  for (const s of parsed.vars) vars[s] = { label: 'Variable', unit: (c.units && c.units[s]) || '' };
  return {
    id: c.id, cat: 'custom', custom: true, name: c.name, catLabel: c.catName || 'Mes formules',
    latex: null, expr: c.expr, desc: c.desc || 'Formule personnelle.', vars,
    solves: { [parsed.lhs]: env => parsed.compute(env) },
  };
}

/* ---------- Modification des formules intégrées ----------
   Les formules d'origine (FORMULAS) ne sont jamais modifiées : les changements
   sont stockés à part (state.overrides) et appliqués à l'affichage.
   Surcharges possibles par formule : name, desc, labels{}, units{}, expr. */
function originalExpr(f) {
  // Reconstruit « inconnue = expression » à partir du premier solveur de la formule
  try {
    const key = Object.keys(f.solves)[0];
    const m = f.solves[key].toString().match(/=>\s*([\s\S]+)$/);
    if (!m) return '';
    let rhs = m[1].trim();
    if (rhs.startsWith('{')) return '';
    rhs = rhs
      .replace(/\bv\./g, '')
      .replace(/Math\.sqrt/g, 'sqrt')
      .replace(/Math\.SQRT2/g, 'sqrt(2)')
      .replace(/Math\.PI/g, 'pi')
      .replace(/\bS3\b/g, 'sqrt(3)');
    const expr = key + ' = ' + rhs;
    validateCustom(expr);
    return expr;
  } catch (e) { return ''; }
}

const normExpr = (e) => String(e || '').replace(/\s+/g, '');

function builtinToCard(f) {
  const o = state.overrides[f.id];
  const card = { ...f, catLabel: CATS[f.cat], builtin: true, modified: !!o };
  if (!o) return card;

  if (o.name) card.name = o.name;
  if (typeof o.desc === 'string') card.desc = o.desc;

  let vars = {};
  for (const [sym, info] of Object.entries(f.vars)) vars[sym] = { ...info };

  if (o.expr) {
    try {
      const parsed = parseCustomFormula(o.expr);
      const nv = {};
      for (const sym of [parsed.lhs, ...parsed.vars]) {
        nv[sym] = vars[sym] ? { ...vars[sym] } : { label: sym === parsed.lhs ? 'Résultat' : 'Variable', unit: '' };
      }
      vars = nv;
      card.expr = o.expr;
      card.latex = null;
      card.solves = { [parsed.lhs]: env => parsed.compute(env) };
    } catch (e) { /* expression invalide : on garde la formule d'origine */ }
  }

  for (const sym of Object.keys(vars)) {
    if (o.labels && o.labels[sym]) vars[sym].label = o.labels[sym];
    if (o.units && Object.prototype.hasOwnProperty.call(o.units, sym)) vars[sym].unit = o.units[sym];
  }
  card.vars = vars;
  return card;
}

/* ---------- Rendu de l'interface ---------- */
const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const chipsEl = $('#chips');
const emptyEl = $('#empty');

function allCards() {
  const cards = FORMULAS.map(builtinToCard);
  for (const c of state.custom) {
    const card = customToCard(c);
    if (card) cards.push(card);
  }
  return cards;
}

function renderChips() {
  const counts = {};
  for (const card of allCards()) counts[card.cat] = (counts[card.cat] || 0) + 1;
  const customCats = [...new Set(state.custom.map(c => c.catName).filter(Boolean))];

  let html = `<button class="chip" data-filter="all" aria-pressed="${state.filter === 'all'}">Tout</button>`;
  html += `<button class="chip" data-filter="fav" aria-pressed="${state.filter === 'fav'}">Favoris${state.favorites.length ? `<span class="chip-count">${state.favorites.length}</span>` : ''}</button>`;
  for (const [key, label] of Object.entries(CATS)) {
    if (key === 'custom' && !counts.custom) continue;
    html += `<button class="chip" data-filter="${key}" aria-pressed="${state.filter === key}">${label}<span class="chip-count">${counts[key] || 0}</span></button>`;
  }
  for (const c of customCats) {
    html += `<button class="chip" data-filter="cat:${escapeHtml(c)}" aria-pressed="${state.filter === 'cat:' + c}">${escapeHtml(c)}</button>`;
  }
  chipsEl.innerHTML = html;
  chipsEl.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      renderChips();
      renderGrid();
    });
  });
}

function visibleCards() {
  const q = state.query.trim().toLowerCase();
  return allCards().filter(card => {
    if (state.filter === 'fav' && !state.favorites.includes(card.id)) return false;
    if (state.filter === 'custom' && card.cat !== 'custom') return false;
    if (state.filter.startsWith('cat:') && (card.catLabel || CATS[card.cat]) !== state.filter.slice(4)) return false;
    if (!['all', 'fav'].includes(state.filter) && !state.filter.startsWith('cat:') && card.cat !== state.filter) return false;
    if (q) {
      const hay = (card.name + ' ' + (card.desc || '') + ' ' + (card.catLabel || '') + ' ' + (card.expr || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid() {
  const cards = visibleCards();
  grid.innerHTML = '';
  emptyEl.hidden = cards.length > 0;

  const isFav = (id) => state.favorites.includes(id);
  const sorted = [...cards].sort((a, b) => isFav(b.id) - isFav(a.id));

  for (const card of sorted) {
    const el = document.createElement('article');
    el.className = 'card' + (isFav(card.id) ? ' is-fav' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', card.name);
    el.innerHTML = `
      <div class="card-top">
        <span class="card-cat">${escapeHtml(card.catLabel || CATS[card.cat])}</span>
        <button class="star-btn ${isFav(card.id) ? 'is-fav' : ''}" data-star="${card.id}" aria-label="${isFav(card.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav(card.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L4.2 9.5l6.1-.9L12 3z"/></svg>
        </button>
      </div>
      <h2 class="card-name">${escapeHtml(card.name)}</h2>
      <div class="card-latex"></div>
      ${card.custom ? '<span class="card-custom-tag">Personnelle</span>' : (card.modified ? '<span class="card-custom-tag">Modifiée</span>' : '')}
    `;
    const latexEl = el.querySelector('.card-latex');
    if (card.custom || card.expr) {
      latexEl.innerHTML = `<span class="custom-expr" style="padding:0;background:none">${escapeHtml(prettyExpr(card.expr))}</span>`;
    } else {
      renderLatex(latexEl, card.latex);
    }
    el.querySelector('[data-star]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(card.id);
    });
    el.addEventListener('click', () => openFormula(card));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFormula(card); }
    });
    grid.appendChild(el);
  }
}

function toggleFav(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  persist();
  renderChips();
  renderGrid();
}

/* ---------- Dialogue détail + calculateur ---------- */
const dlgFormula = $('#dlg-formula');
let currentCard = null;
let currentUnknown = null;

function openFormula(card) {
  currentCard = card;
  $('#f-cat').textContent = card.catLabel || CATS[card.cat];
  $('#f-title').textContent = card.name;
  const latexEl = $('#f-latex');
  latexEl.innerHTML = '';
  if (card.custom || card.expr) {
    latexEl.innerHTML = `<span class="custom-expr" style="padding:0;background:none">${escapeHtml(prettyExpr(card.expr))}</span>`;
  } else {
    renderLatex(latexEl, card.latex);
  }
  $('#f-desc').textContent = card.desc || '';

  const varsList = $('#f-vars');
  varsList.innerHTML = '';
  for (const [sym, info] of Object.entries(card.vars)) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="var-sym">${escapeHtml(sym)}</span><span class="var-label">${escapeHtml(info.label)}</span><span class="var-unit">${escapeHtml(info.unit || 'sans unité')}</span>`;
    varsList.appendChild(li);
  }

  // Sélecteur d'inconnue
  const unknowns = Object.keys(card.solves);
  const sel = $('#f-unknown');
  sel.innerHTML = unknowns.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  currentUnknown = unknowns[0];

  // Actions (modifier / supprimer pour les personnalisées)
  const actions = $('#f-actions');
  actions.innerHTML = '';
  if (card.custom) {
    const c = state.custom.find(x => x.id === card.id);
    if (c) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost';
      editBtn.textContent = 'Modifier';
      editBtn.addEventListener('click', () => { dlgFormula.close(); openEditor(c); });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = 'Supprimer';
      delBtn.addEventListener('click', () => {
        if (confirm('Supprimer cette formule personnelle ?')) {
          state.custom = state.custom.filter(x => x.id !== c.id);
          state.favorites = state.favorites.filter(f => f !== c.id);
          persist();
          dlgFormula.close();
          renderChips();
          renderGrid();
        }
      });
      actions.append(editBtn, delBtn);
    }
  }

  if (card.builtin) {
    const f = FORMULAS.find(x => x.id === card.id);
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-ghost';
    editBtn.textContent = 'Modifier';
    editBtn.addEventListener('click', () => { dlgFormula.close(); openEditor(null, f); });
    actions.append(editBtn);
    if (card.modified) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn-danger';
      resetBtn.textContent = 'Rétablir l’original';
      resetBtn.addEventListener('click', () => {
        if (confirm('Rétablir la formule d’origine ? Vos modifications seront perdues.')) {
          delete state.overrides[card.id];
          persist();
          dlgFormula.close();
          renderChips();
          renderGrid();
        }
      });
      actions.append(resetBtn);
    }
  }

  buildCalcInputs();
  dlgFormula.showModal();
}

function buildCalcInputs() {
  const card = currentCard;
  const wrap = $('#f-inputs');
  wrap.innerHTML = '';
  const vars = Object.keys(card.vars);
  for (const sym of vars) {
    if (sym === currentUnknown) continue;
    const info = card.vars[sym];
    const div = document.createElement('div');
    div.className = 'calc-field';
    div.innerHTML = `
      <label for="calc-${escapeHtml(sym)}">${escapeHtml(sym)}</label>
      <input id="calc-${escapeHtml(sym)}" type="text" inputmode="decimal" placeholder="0" data-sym="${escapeHtml(sym)}" autocomplete="off">
      <span class="calc-unit">${escapeHtml(info.unit || '')}</span>
    `;
    wrap.appendChild(div);
  }
  updateCalc();
}

function updateCalc() {
  const card = currentCard;
  const resEl = $('#f-result');
  resEl.classList.remove('is-error');
  const inputs = [...$('#f-inputs').querySelectorAll('input[data-sym]')];
  const env = {};
  for (const inp of inputs) {
    const n = parseNum(inp.value);
    if (isNaN(n)) {
      resEl.innerHTML = '<span class="res-label">Saisissez les valeurs connues — le résultat se met à jour automatiquement.</span>';
      return;
    }
    env[inp.dataset.sym] = n;
  }
  let result;
  try {
    result = card.solves[currentUnknown](env);
  } catch (e) {
    resEl.textContent = 'Erreur : ' + e.message;
    resEl.classList.add('is-error');
    return;
  }
  if (!isFinite(result)) {
    resEl.textContent = 'Résultat non défini (vérifiez les divisions par zéro).';
    resEl.classList.add('is-error');
    return;
  }
  const unit = card.vars[currentUnknown] ? card.vars[currentUnknown].unit : '';
  resEl.innerHTML = `<span class="res-label">${escapeHtml(currentUnknown)} =</span> <strong>${fmt(result)}</strong> ${escapeHtml(unit || '')}`;
}

$('#f-unknown').addEventListener('change', (e) => {
  currentUnknown = e.target.value;
  buildCalcInputs();
});
$('#f-inputs').addEventListener('input', updateCalc);

/* ---------- Éditeur de formule personnalisée ---------- */
const dlgEditor = $('#dlg-editor');
let editingId = null;
let editingBuiltin = null;   // formule intégrée en cours de modification (objet de FORMULAS)
let editorUnits = {};
let editorLabels = {};

function openEditor(existing, builtin) {
  editingBuiltin = builtin || null;
  editingId = existing ? existing.id : null;
  editorUnits = existing && existing.units ? { ...existing.units } : {};
  editorLabels = {};

  const isB = !!editingBuiltin;
  $('#e-cat').closest('.field').hidden = isB;
  $('#e-builtin-note').hidden = !isB;
  $('#e-cat-label').textContent = isB ? 'Formule intégrée · ' + CATS[editingBuiltin.cat] : 'Mes formules';

  if (isB) {
    const card = builtinToCard(editingBuiltin);
    for (const [sym, info] of Object.entries(card.vars)) {
      editorUnits[sym] = info.unit || '';
      editorLabels[sym] = info.label || '';
    }
    $('#e-title').textContent = 'Modifier la formule';
    $('#e-name').value = card.name;
    $('#e-desc').value = card.desc || '';
    $('#e-expr').value = card.expr || originalExpr(editingBuiltin);
  } else {
    $('#e-title').textContent = existing ? 'Modifier la formule' : 'Nouvelle formule';
    $('#e-name').value = existing ? existing.name : '';
    $('#e-desc').value = existing && existing.desc ? existing.desc : '';
    $('#e-expr').value = existing ? existing.expr : '';
  }

  // catégories : suggestions + catégories perso existantes
  const customCats = [...new Set(state.custom.map(c => c.catName).filter(Boolean))];
  const suggestions = ['Thermique', 'Éclairage', 'Électronique', 'Autre'];
  const options = [...new Set([...customCats, ...suggestions])];
  let selHtml = '';
  for (const c of options) {
    const selected = existing && existing.catName === c ? ' selected' : '';
    selHtml += `<option value="${escapeHtml(c)}"${selected}>${escapeHtml(c)}</option>`;
  }
  selHtml += `<option value="__new">+ Nouvelle catégorie…</option>`;
  $('#e-cat').innerHTML = selHtml;

  const nameWrap = $('#e-cat').closest('.field');
  if (!document.getElementById('e-cat-new')) {
    const newField = document.createElement('input');
    newField.type = 'text';
    newField.id = 'e-cat-new';
    newField.placeholder = 'Nom de la nouvelle catégorie';
    newField.style.display = 'none';
    nameWrap.appendChild(newField);
  }

  $('#e-error').hidden = true;
  refreshEditorVars();
  dlgEditor.showModal();
  if (!existing) $('#e-name').focus();
}

$('#e-cat').addEventListener('change', (e) => {
  document.getElementById('e-cat-new').style.display = e.target.value === '__new' ? 'block' : 'none';
});

function refreshEditorVars() {
  const expr = $('#e-expr').value;
  const wrap = $('#e-vars');
  const preview = $('#e-preview');
  const errEl = $('#e-error');
  errEl.hidden = true;
  preview.textContent = '';

  // garde les unités déjà saisies avant de reconstruire
  const prev = { ...editorUnits };
  wrap.querySelectorAll('input[data-unit-var]').forEach(inp => { prev[inp.dataset.unitVar] = inp.value; });
  const prevL = { ...editorLabels };
  wrap.querySelectorAll('input[data-label-var]').forEach(inp => { prevL[inp.dataset.labelVar] = inp.value; });
  wrap.innerHTML = '';
  wrap.classList.toggle('has-labels', !!editingBuiltin);

  if (!expr.trim()) return;
  let parsed;
  try {
    parsed = validateCustom(expr);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
    return;
  }

  const allVars = [parsed.lhs, ...parsed.vars];
  for (const s of allVars) {
    const div = document.createElement('div');
    div.className = 'e-var';
    div.dataset.sym = s;
    const labelInput = editingBuiltin
      ? `<input type="text" class="e-var-label" placeholder="libellé" data-label-var="${escapeHtml(s)}" value="${escapeHtml(prevL[s] || '')}">`
      : '';
    div.innerHTML = `<span class="e-var-sym" title="${escapeHtml(s)}">${escapeHtml(s)}</span>${labelInput}<input type="text" placeholder="unité" data-unit-var="${escapeHtml(s)}" value="${escapeHtml(prev[s] || '')}">`;
    wrap.appendChild(div);
  }
  preview.textContent = prettyExpr(expr);
}

$('#e-expr').addEventListener('input', refreshEditorVars);

$('#editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#e-name').value.trim();
  const expr = $('#e-expr').value.trim();
  const errEl = $('#e-error');
  if (!name) { errEl.textContent = 'Donnez un nom à la formule.'; errEl.hidden = false; return; }
  const desc = $('#e-desc').value.trim();

  /* --- Formule intégrée : on enregistre uniquement les différences avec l'original --- */
  if (editingBuiltin) {
    const f = editingBuiltin;
    const orig = originalExpr(f);
    const exprChanged = expr !== '' && normExpr(expr) !== normExpr(orig);
    if (exprChanged) {
      try { validateCustom(expr); } catch (err) { errEl.textContent = err.message; errEl.hidden = false; return; }
    }
    const o = {};
    if (name !== f.name) o.name = name;
    if (desc !== (f.desc || '')) o.desc = desc;
    if (exprChanged) o.expr = expr;
    const labels = {}, units = {};
    document.querySelectorAll('#e-vars .e-var').forEach(row => {
      const sym = row.dataset.sym;
      const lab = row.querySelector('[data-label-var]').value.trim();
      const un = row.querySelector('[data-unit-var]').value.trim();
      const base = f.vars[sym];
      if (base) {
        if (lab && lab !== base.label) labels[sym] = lab;
        if (un !== (base.unit || '')) units[sym] = un;
      } else {
        if (lab) labels[sym] = lab;
        if (un) units[sym] = un;
      }
    });
    if (Object.keys(labels).length) o.labels = labels;
    if (Object.keys(units).length) o.units = units;
    if (Object.keys(o).length) state.overrides[f.id] = o;
    else delete state.overrides[f.id];
    persist();
    dlgEditor.close();
    renderChips();
    renderGrid();
    return;
  }

  let parsed;
  try {
    parsed = validateCustom(expr);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    return;
  }

  let catName = $('#e-cat').value;
  if (catName === '__new') {
    catName = document.getElementById('e-cat-new').value.trim() || 'Mes formules';
  }

  const units = {};
  document.querySelectorAll('#e-vars input[data-unit-var]').forEach(inp => {
    if (inp.value.trim()) units[inp.dataset.unitVar] = inp.value.trim();
  });

  if (editingId) {
    const c = state.custom.find(x => x.id === editingId);
    if (c) Object.assign(c, { name, expr, catName, units, desc });
  } else {
    state.custom.push({ id: newId(), name, expr, catName, units, desc });
  }
  persist();
  dlgEditor.close();
  state.filter = 'custom';
  renderChips();
  renderGrid();
});

/* ---------- Export / Import ---------- */
$('#btn-export').addEventListener('click', () => {
  const data = { version: 2, exported: new Date().toISOString(), custom: state.custom, favorites: state.favorites, overrides: state.overrides };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'electro-formules-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());

$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const hasOv = data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides);
      if (!Array.isArray(data.custom) && !hasOv) throw new Error('Fichier invalide');
      const customList = Array.isArray(data.custom) ? data.custom : [];
      let ovCount = 0;
      if (hasOv) {
        for (const [id, o] of Object.entries(data.overrides)) {
          if (o && typeof o === 'object' && FORMULAS.some(f => f.id === id)) { state.overrides[id] = o; ovCount++; }
        }
      }
      const byId = new Map(state.custom.map(c => [c.id, c]));
      for (const c of customList) {
        if (!c || !c.expr) continue;
        byId.set(c.id, { ...byId.get(c.id), ...c });
      }
      state.custom = [...byId.values()];
      if (Array.isArray(data.favorites)) {
        state.favorites = [...new Set([...state.favorites, ...data.favorites])].filter(id =>
          FORMULAS.some(f => f.id === id) || state.custom.some(c => c.id === id));
      }
      persist();
      renderChips();
      renderGrid();
      alert('Import réussi : ' + customList.length + ' formule(s) personnelle(s) et ' + ovCount + ' modification(s) de formule intégrée dans le fichier.');
    } catch (err) {
      alert('Import impossible : ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- Divers ---------- */
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
  btn.closest('dialog').close();
}));

$('#btn-add').addEventListener('click', () => openEditor());

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderGrid();
});

// Thème
(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  const setIcon = () => {
    t.innerHTML = d === 'dark'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    t.setAttribute('aria-label', d === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
  };
  setIcon();
  t.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', d);
    setIcon();
  });
})();

/* ---------- Initialisation ---------- */
load();
if (!storage) {
  $('#storage-note').hidden = false;
}
renderChips();
renderGrid();

/* ---------- Mode hors ligne (PWA) ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* le stockage n'est pas disponible (aperçu intégré) : le mode hors ligne ne s'active pas */
  });
}
