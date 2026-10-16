/* ElecPourTous — comptes et commentaires
   Le serveur (Supabase) ne contient que les comptes et les messages : les plans restent sur l'appareil.
   L'application n'appelle que des fonctions « ep_… » du serveur, qui vérifient elles-mêmes les droits.
   Les phrases de passe sont transformées ici en empreinte SHA-256 avant d'être envoyées. */
(function () {
  'use strict';
  const CFG = window.EP_CLOUD || {};
  const READY = !!(CFG.url && CFG.key);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  /* ---------- Libellés ---------- */
  const AGES = { '-15': 'Moins de 15 ans', '15-17': '15 à 17 ans', '18+': '18 ans et plus' };
  const STATUTS = { eleve: 'Élève', apprenti: 'Apprenti', etudiant: 'Étudiant', enseignant: 'Professeur / formateur', professionnel: 'Professionnel', autre: 'Autre' };
  const SUIVI = { non_traite: 'Non traité', en_cours: 'En cours de traitement', traite: 'Traité' };
  const STATE = { pending: 'En attente de validation', published: 'Publié', rejected: 'Refusé' };
  const ERRORS = {
    pseudo_invalide: 'Pseudo invalide : 3 à 24 caractères, sans < > " \\ / @.',
    pseudo_reserve: 'Ce pseudo est réservé : choisissez-en un autre.',
    pseudo_pris: 'Ce pseudo est déjà utilisé.',
    mdp_invalide: 'Phrase de passe invalide.',
    champs_invalides: 'Certaines informations sont invalides.',
    description_longue: 'La description est trop longue (200 caractères au plus).',
    identifiants: 'Pseudo ou phrase de passe incorrect.',
    bloque: 'Trop d’essais ratés : ce compte est bloqué 15 minutes.',
    session: 'Votre session a expiré : reconnectez-vous.',
    ancien_mdp: 'La phrase de passe actuelle est incorrecte.',
    dernier_admin: 'Vous êtes le seul administrateur : ce compte ne peut pas être supprimé.',
    code_utilise: 'Le code d’activation a déjà été utilisé.',
    code_bloque: 'Trop d’essais : le code est bloqué. Relancez le script sur Supabase pour en définir un nouveau.',
    code_faux: 'Code d’activation incorrect.',
    texte_longueur: 'Le message doit faire entre 2 et 2000 caractères.',
    sujet: 'Choisissez un sujet.',
    trop_vite: 'Patientez 30 secondes entre deux messages.',
    trop_en_attente: 'Vous avez déjà 5 messages en attente de validation.',
    admin: 'Action réservée à l’administrateur.',
    soi_meme: 'Vous ne pouvez pas supprimer votre propre compte d’ici.',
    sujet_longueur: 'Le sujet doit faire entre 1 et 30 caractères.',
    sujet_existe: 'Ce sujet existe déjà.',
    reseau: 'Impossible de joindre le serveur. Vérifiez votre connexion Internet.',
    serveur: 'Le serveur a répondu par une erreur. Réessayez plus tard.',
    https: 'Une connexion sécurisée (https) est nécessaire pour les comptes.',
  };
  const errText = (code) => ERRORS[code] || 'Une erreur est survenue.';

  /* ---------- Construction d'éléments (jamais de texte utilisateur en HTML) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const fmtDate = (d) => {
    try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  };

  /* ---------- Phrases de passe ---------- */
  // Même transformation que le serveur : apostrophes et guillemets typographiques, espaces insécables (claviers de téléphone)
  function normPw(s) {
    return String(s || '').replace(/[’‘ʼ´`]/g, "'").replace(/[“”„]/g, '"').replace(/[  ]/g, ' ').normalize('NFC');
  }
  async function prehash(s) {
    if (!window.crypto || !crypto.subtle) throw { code: 'https' };
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normPw(s)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Solidité : la longueur compte avant tout
  function strength(pw) {
    const s = normPw(pw), n = [...s].length;
    if (n < 12) return { lvl: 0, txt: n ? `Trop courte : encore ${12 - n} caractère${12 - n > 1 ? 's' : ''}` : 'Au moins 12 caractères' };
    if (/^(.)\1+$/.test(s)) return { lvl: 0, txt: 'Évitez de répéter un seul caractère' };
    const words = s.trim().split(/\s+/).filter((w) => w.length >= 2).length;
    let lvl = n >= 25 ? 3 : n >= 16 ? 2 : 1;
    if (words >= 4 && lvl < 3) lvl++;
    return { lvl, txt: ['', 'Correcte', 'Bonne', 'Excellente'][lvl] + (words >= 4 ? ' — une phrase, c’est parfait' : '') };
  }
  function cleanPseudo(p) { return String(p || '').trim().replace(/\s+/g, ' '); }
  function pseudoIssue(p) {
    const s = cleanPseudo(p), n = [...s].length;
    if (n < 3 || n > 24) return 'Le pseudo doit faire entre 3 et 24 caractères.';
    if (/[<>"\\/@\u0000-\u001f]/.test(s)) return 'Le pseudo ne peut pas contenir < > " \\ / @.';
    if (/(admin|moderat|elecpourtous)/i.test(s)) return errText('pseudo_reserve');
    return '';
  }

  /* ---------- Appels au serveur ---------- */
  async function rpc(fn, args) {
    const headers = { 'Content-Type': 'application/json', apikey: CFG.key };
    if (/^eyJ/.test(CFG.key)) headers.Authorization = 'Bearer ' + CFG.key;      // ancienne clé « anon » (JWT)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(CFG.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args || {}), signal: ctrl.signal });
    } catch (e) { throw { code: 'reseau' }; } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* réponse vide */ }
    if (!res.ok) throw { code: 'serveur', detail: data };
    if (data && data.ok === false) {
      if (data.error === 'session') logoutLocal();
      throw { code: data.error, data };
    }
    return data;
  }

  /* ---------- Session ---------- */
  const SKEY = 'ef_session';
  let session = null;               // { token, profile }
  try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { session = null; }
  const isAdmin = () => !!(session && session.profile && session.profile.role === 'admin');
  function saveSession() { try { if (session) localStorage.setItem(SKEY, JSON.stringify(session)); else localStorage.removeItem(SKEY); } catch (e) { /* ignoré */ } }
  function logoutLocal() { session = null; saveSession(); refreshHeader(); }
  function setSession(token, profile) { session = { token: token || (session && session.token), profile }; saveSession(); refreshHeader(); }

  /* ---------- En-tête ---------- */
  const acctBtn = $('#acct-btn');
  function refreshHeader() {
    if (!acctBtn) return;
    acctBtn.hidden = !READY;
    $('#acct-label').textContent = session ? session.profile.pseudo : 'Se connecter';
    acctBtn.classList.toggle('is-in', !!session);
    const adminTab = $('[data-com-tab="admin"]');
    if (adminTab) {
      adminTab.hidden = !isAdmin();
      if (!isAdmin() && adminTab.getAttribute('aria-selected') === 'true') showComTab('list');
    }
    if (currentComTab === 'mine') renderMine();
  }

  /* ---------- Petits composants de formulaire ---------- */
  function field(label, input, help) {
    return h('label', { class: 'com-field' }, h('span', { class: 'com-label', text: label }), input, help ? h('span', { class: 'com-help', text: help }) : null);
  }
  function select(options, value, attrs) {
    return h('select', { class: 'com-input', ...(attrs || {}) }, Object.entries(options).map(([k, v]) => h('option', { value: k, selected: k === value }, v)));
  }
  function pwInput(attrs, withMeter) {
    const input = h('input', { type: 'password', class: 'com-input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: '500', ...(attrs || {}) });
    const eye = h('button', { type: 'button', class: 'com-eye', 'aria-label': 'Afficher la phrase de passe', title: 'Afficher / masquer' }, '👁');
    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
    });
    const wrap = h('div', { class: 'com-pw' }, input, eye);
    if (!withMeter) return { wrap, input };
    const bar = h('span', { class: 'com-meter-bar' });
    const txt = h('span', { class: 'com-meter-txt', text: 'Au moins 12 caractères' });
    const meter = h('div', { class: 'com-meter', 'data-lvl': '0' }, h('span', { class: 'com-meter-track' }, bar), txt);
    input.addEventListener('input', () => { const s = strength(input.value); meter.dataset.lvl = String(s.lvl); txt.textContent = s.txt; });
    return { wrap: h('div', {}, wrap, meter), input };
  }
  const msgBox = () => h('p', { class: 'com-msg', role: 'status', 'aria-live': 'polite' });
  function showMsg(box, text, kind) { box.textContent = text || ''; box.dataset.kind = kind || 'err'; box.hidden = !text; }
  async function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  /* ---------- Fenêtre « Compte » ---------- */
  const dlg = $('#dlg-account');
  const body = $('#acct-body');
  let acctMode = 'login';
  function openAccount(mode) {
    if (!READY || !dlg) return;
    acctMode = mode || (session ? 'me' : 'login');
    renderAccount();
    if (!dlg.open) dlg.showModal();
  }
  function privacyLink(txt) {
    return h('button', { type: 'button', class: 'com-link', onclick: () => $('#dlg-privacy').showModal() }, txt || 'Confidentialité');
  }
  function renderAccount() {
    body.replaceChildren();
    if (session) acctMode = acctMode === 'login' || acctMode === 'signup' ? 'me' : acctMode;
    $('#acct-title').textContent = session ? 'Mon compte' : acctMode === 'signup' ? 'Créer un compte' : 'Se connecter';
    if (!session) {
      body.append(h('div', { class: 'sch-subtabs com-seg', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', class: 'sch-subtab', 'aria-selected': String(acctMode === 'login'), onclick: () => { acctMode = 'login'; renderAccount(); } }, 'Se connecter'),
        h('button', { type: 'button', role: 'tab', class: 'sch-subtab', 'aria-selected': String(acctMode === 'signup'), onclick: () => { acctMode = 'signup'; renderAccount(); } }, 'Créer un compte')));
      body.append(acctMode === 'signup' ? signupForm() : loginForm());
    } else body.append(meForm());
    body.append(h('p', { class: 'com-foot' }, 'Vos plans restent sur votre appareil. ', privacyLink('Comment vos données sont protégées')));
  }

  function loginForm() {
    const pseudo = h('input', { type: 'text', class: 'com-input', autocomplete: 'username', maxlength: '40', autocapitalize: 'off' });
    const pw = pwInput({ autocomplete: 'current-password' });
    const msg = msgBox(); msg.hidden = true;
    const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Se connecter');
    const form = h('form', { class: 'com-form', novalidate: true },
      field('Pseudo', pseudo), field('Phrase de passe', pw.wrap), msg,
      h('div', { class: 'dialog-actions' }, btn),
      h('p', { class: 'com-help' }, 'Phrase de passe oubliée ? Demandez à l’administrateur une phrase provisoire.'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        showMsg(msg, '');
        if (!cleanPseudo(pseudo.value) || !pw.input.value) { showMsg(msg, 'Entrez votre pseudo et votre phrase de passe.'); return; }
        try {
          const r = await rpc('ep_login', { p_pseudo: cleanPseudo(pseudo.value), p_pw: await prehash(pw.input.value) });
          setSession(r.token, r.profile);
          dlg.close();
          afterLogin();
        } catch (err) { showMsg(msg, errText(err.code)); }
      });
    });
    setTimeout(() => pseudo.focus(), 0);
    return form;
  }

  function signupForm() {
    const pseudo = h('input', { type: 'text', class: 'com-input', autocomplete: 'username', maxlength: '40', autocapitalize: 'off' });
    const pw = pwInput({ autocomplete: 'new-password' }, true);
    const pw2 = pwInput({ autocomplete: 'new-password' });
    const age = select({ '': 'Choisir…', ...AGES }, '');
    const statut = select({ '': 'Choisir…', ...STATUTS }, '');
    const desc = h('textarea', { class: 'com-input', rows: '2', maxlength: '200', placeholder: 'Ex. : « En première MELEC, passionné de domotique »' });
    const parent = h('input', { type: 'checkbox' });
    const parentRow = h('label', { class: 'com-check', hidden: true }, parent, h('span', { text: 'Un de mes parents est d’accord pour que je crée ce compte.' }));
    const priv = h('input', { type: 'checkbox' });
    const msg = msgBox(); msg.hidden = true;
    const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Créer mon compte');
    age.addEventListener('change', () => { parentRow.hidden = age.value !== '-15'; });
    const form = h('form', { class: 'com-form', novalidate: true },
      field('Pseudo', pseudo, '3 à 24 caractères. N’utilisez pas votre vrai nom.'),
      field('Phrase de passe', pw.wrap, 'Au moins 12 caractères, tous permis : une phrase inventée comme « Banane aux cornichons que j’aime déguster. » est idéale.'),
      field('Confirmer la phrase de passe', pw2.wrap),
      h('div', { class: 'com-grid2' }, field('Tranche d’âge', age), field('Statut', statut)),
      field('Courte description (facultative)', desc, 'Sans nom, lieu ni contact. 200 caractères au plus.'),
      parentRow,
      h('label', { class: 'com-check' }, priv, h('span', {}, 'J’ai lu la page ', privacyLink('Confidentialité'), '.')),
      msg,
      h('div', { class: 'dialog-actions' }, btn));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        showMsg(msg, '');
        const pi = pseudoIssue(pseudo.value);
        if (pi) { showMsg(msg, pi); return; }
        if (strength(pw.input.value).lvl < 1) { showMsg(msg, 'La phrase de passe doit faire au moins 12 caractères.'); return; }
        if (normPw(pw.input.value) !== normPw(pw2.input.value)) { showMsg(msg, 'Les deux phrases de passe sont différentes.'); return; }
        if (!age.value || !statut.value) { showMsg(msg, 'Choisissez votre tranche d’âge et votre statut.'); return; }
        if (age.value === '-15' && !parent.checked) { showMsg(msg, 'Avant 15 ans, l’accord d’un parent est nécessaire.'); return; }
        if (!priv.checked) { showMsg(msg, 'Cochez la case après avoir lu la page Confidentialité.'); return; }
        try {
          const r = await rpc('ep_signup', { p_pseudo: cleanPseudo(pseudo.value), p_pw: await prehash(pw.input.value), p_age: age.value, p_statut: statut.value, p_desc: desc.value.trim() });
          setSession(r.token, r.profile);
          acctMode = 'me';
          renderAccount();
          showMsg($('.com-msg', body), 'Compte créé ! Vous pouvez choisir ci-dessous ce qui s’affiche avec vos messages.', 'ok');
          afterLogin();
        } catch (err) { showMsg(msg, errText(err.code)); }
      });
    });
    setTimeout(() => pseudo.focus(), 0);
    return form;
  }

  function meForm() {
    const p = session.profile;
    const wrap = h('div', { class: 'com-me' });
    wrap.append(h('p', { class: 'com-who' }, h('strong', { text: p.pseudo }), p.role === 'admin' ? h('span', { class: 'com-badge com-badge-admin', text: 'Administrateur' }) : null,
      h('span', { class: 'com-muted', text: ` · membre depuis le ${fmtDate(p.created_at)}` })));
    // informations et affichage
    const age = select(AGES, p.age_range), statut = select(STATUTS, p.statut);
    const desc = h('textarea', { class: 'com-input', rows: '2', maxlength: '200' }); desc.value = p.description || '';
    const sa = h('input', { type: 'checkbox', checked: p.show_age }), ss = h('input', { type: 'checkbox', checked: p.show_statut }), sd = h('input', { type: 'checkbox', checked: p.show_desc });
    const msg = msgBox(); msg.hidden = true;
    const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Enregistrer');
    const f1 = h('form', { class: 'com-form', novalidate: true },
      h('div', { class: 'com-grid2' }, field('Tranche d’âge', age), field('Statut', statut)),
      field('Courte description (facultative)', desc, 'Sans nom, lieu ni contact.'),
      h('fieldset', { class: 'com-fs' }, h('legend', { text: 'Afficher avec mes messages (le pseudo est toujours affiché)' }),
        h('label', { class: 'com-check' }, sa, h('span', { text: 'ma tranche d’âge' })),
        h('label', { class: 'com-check' }, ss, h('span', { text: 'mon statut' })),
        h('label', { class: 'com-check' }, sd, h('span', { text: 'ma description' }))),
      msg, h('div', { class: 'dialog-actions' }, save));
    f1.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(save, async () => {
        try {
          const r = await rpc('ep_update_me', { p_token: session.token, p_age: age.value, p_statut: statut.value, p_desc: desc.value.trim(), p_show_age: sa.checked, p_show_statut: ss.checked, p_show_desc: sd.checked });
          setSession(null, r.profile);
          showMsg(msg, 'Enregistré.', 'ok');
          loadList(true);
        } catch (err) { showMsg(msg, errText(err.code)); if (!session) renderAccount(); }
      });
    });
    wrap.append(f1);

    // phrase de passe
    const o = pwInput({ autocomplete: 'current-password' }), n1 = pwInput({ autocomplete: 'new-password' }, true), n2 = pwInput({ autocomplete: 'new-password' });
    const m2 = msgBox(); m2.hidden = true;
    const b2 = h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'Changer la phrase de passe');
    const f2 = h('form', { class: 'com-form', novalidate: true }, field('Phrase de passe actuelle', o.wrap), field('Nouvelle phrase de passe', n1.wrap), field('Confirmer', n2.wrap), m2, h('div', { class: 'dialog-actions' }, b2));
    f2.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(b2, async () => {
        if (strength(n1.input.value).lvl < 1) { showMsg(m2, 'La nouvelle phrase doit faire au moins 12 caractères.'); return; }
        if (normPw(n1.input.value) !== normPw(n2.input.value)) { showMsg(m2, 'Les deux nouvelles phrases sont différentes.'); return; }
        try {
          await rpc('ep_change_password', { p_token: session.token, p_old: await prehash(o.input.value), p_new: await prehash(n1.input.value) });
          f2.reset(); showMsg(m2, 'Phrase de passe changée. Vos autres appareils devront se reconnecter.', 'ok');
        } catch (err) { showMsg(m2, errText(err.code)); }
      });
    });
    wrap.append(h('details', { class: 'com-details' }, h('summary', { text: 'Changer de phrase de passe' }), f2));

    // devenir administrateur (code à usage unique)
    if (p.role !== 'admin') {
      const code = pwInput({ autocomplete: 'off' });
      const m3 = msgBox(); m3.hidden = true;
      const b3 = h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'Activer');
      const f3 = h('form', { class: 'com-form', novalidate: true }, field('Code d’activation', code.wrap, 'Réservé au propriétaire du site. Le code ne fonctionne qu’une seule fois.'), m3, h('div', { class: 'dialog-actions' }, b3));
      f3.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(b3, async () => {
          try {
            const r = await rpc('ep_claim_admin', { p_token: session.token, p_code: await prehash(code.input.value) });
            setSession(null, r.profile);
            loadPendingCount();
            renderAccount();
            showMsg($('.com-msg', body), 'Vous êtes maintenant administrateur. L’onglet « Administration » est disponible dans Commentaires.', 'ok');
          } catch (err) { showMsg(m3, errText(err.code)); }
        });
      });
      wrap.append(h('details', { class: 'com-details' }, h('summary', { text: 'Devenir administrateur' }), f3));
    }

    // suppression du compte
    const d = pwInput({ autocomplete: 'current-password' });
    const m4 = msgBox(); m4.hidden = true;
    const b4 = h('button', { type: 'submit', class: 'btn btn-danger btn-sm' }, 'Supprimer définitivement mon compte');
    const f4 = h('form', { class: 'com-form', novalidate: true },
      h('p', { class: 'com-help', text: 'Votre compte et tous vos messages seront effacés du serveur. Vos plans, eux, restent sur cet appareil.' }),
      field('Phrase de passe', d.wrap), m4, h('div', { class: 'dialog-actions' }, b4));
    f4.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(b4, async () => {
        if (!window.confirm('Supprimer définitivement votre compte et tous vos messages ?')) return;
        try {
          await rpc('ep_delete_me', { p_token: session.token, p_pw: await prehash(d.input.value) });
          logoutLocal(); dlg.close(); loadList(true);
        } catch (err) { showMsg(m4, errText(err.code)); }
      });
    });
    wrap.append(h('details', { class: 'com-details com-danger' }, h('summary', { text: 'Supprimer mon compte' }), f4));

    wrap.append(h('div', { class: 'dialog-actions' }, h('button', {
      type: 'button', class: 'btn btn-ghost', onclick: async () => {
        const t = session && session.token;
        logoutLocal(); dlg.close();
        try { await rpc('ep_logout', { p_token: t }); } catch (e) { /* déjà déconnecté localement */ }
      },
    }, 'Se déconnecter')));
    return wrap;
  }

  function afterLogin() {
    refreshHeader();
    if (currentComTab === 'mine') renderMine();
    if (isAdmin()) loadPendingCount();
  }

  /* ---------- Section Commentaires ---------- */
  let currentComTab = 'list';
  let tags = [];
  let filterTag = null, listOffset = 0;
  function showComTab(name) {
    currentComTab = name;
    $$('[data-com-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.comTab === name)));
    $$('[data-com-panel]').forEach((p) => { p.hidden = p.dataset.comPanel !== name; });
    if (name === 'list') loadList(true);
    if (name === 'mine') renderMine();
    if (name === 'admin') loadAdmin();
  }
  async function loadTags() {
    try { tags = await rpc('ep_tags', {}); } catch (e) { tags = []; }
    renderFilters();
  }
  function renderFilters() {
    const box = $('#com-filters');
    if (!box) return;
    const chip = (id, label) => h('button', { type: 'button', class: 'com-chip', 'aria-pressed': String(filterTag === id), onclick: () => { filterTag = id; renderFilters(); loadList(true); } }, label);
    box.replaceChildren(chip(null, 'Tous'), ...tags.map((t) => chip(t.id, t.label)));
  }
  function authorLine(c) {
    const info = [c.age_range ? AGES[c.age_range] : '', c.statut ? STATUTS[c.statut] : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'com-author' },
      h('strong', { text: c.pseudo }),
      c.is_admin ? h('span', { class: 'com-badge com-badge-admin', text: 'Administrateur' }) : null,
      info ? h('span', { class: 'com-muted', text: info }) : null,
      h('span', { class: 'com-muted com-date', text: fmtDate(c.published_at || c.created_at) }));
  }
  const suiviBadge = (s) => h('span', { class: 'com-badge com-suivi-' + s, text: SUIVI[s] || s });
  function commentCard(c, opts) {
    const o = opts || {};
    return h('article', { class: 'com-card' },
      o.noAuthor ? null : authorLine(c),
      h('div', { class: 'com-tags' }, c.tag ? h('span', { class: 'com-badge com-tag', text: c.tag }) : null,
        o.state ? h('span', { class: 'com-badge com-state-' + c.state, text: STATE[c.state] }) : null,
        (o.state || c.suivi !== 'non_traite') ? suiviBadge(c.suivi) : null),
      c.description ? h('p', { class: 'com-desc', text: '« ' + c.description + ' »' }) : null,
      h('p', { class: 'com-body', text: c.body }),
      c.reply ? h('div', { class: 'com-reply' }, h('span', { class: 'com-reply-h', text: 'Réponse de l’administrateur' }), h('p', { text: c.reply })) : null,
      o.extra || null);
  }
  async function loadList(reset) {
    const list = $('#com-list');
    if (!list || !READY) return;
    if (reset) { listOffset = 0; list.replaceChildren(h('p', { class: 'com-empty', text: 'Chargement…' })); }
    try {
      const rows = await rpc('ep_comments', { p_tag: filterTag, p_offset: listOffset });
      if (reset) list.replaceChildren();
      if (!rows.length && !listOffset) list.append(h('p', { class: 'com-empty', text: filterTag ? 'Aucun message publié sur ce sujet pour l’instant.' : 'Aucun message publié pour l’instant. Soyez le premier !' }));
      rows.forEach((c) => list.append(commentCard(c)));
      listOffset += rows.length;
      $('#com-more').hidden = rows.length < 50;
    } catch (err) { list.replaceChildren(h('p', { class: 'com-empty com-error', text: errText(err.code) })); }
  }

  async function renderMine() {
    const write = $('#com-write'), mine = $('#com-mine');
    if (!write || !READY) return;
    if (!session) {
      write.replaceChildren(h('div', { class: 'com-login-cta' },
        h('p', { text: 'Pour écrire un message, connectez-vous ou créez un compte (pseudo et phrase de passe, aucun e-mail).' }),
        h('div', { class: 'com-row' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openAccount('login') }, 'Se connecter'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openAccount('signup') }, 'Créer un compte'))));
      mine.replaceChildren();
      return;
    }
    if (!tags.length) await loadTags();
    const tag = h('select', { class: 'com-input' }, h('option', { value: '' }, 'Choisir un sujet…'), tags.map((t) => h('option', { value: String(t.id) }, t.label)));
    const text = h('textarea', { class: 'com-input', rows: '5', maxlength: '2000', placeholder: 'Votre message…' });
    const count = h('span', { class: 'com-help', text: '0 / 2000' });
    text.addEventListener('input', () => { count.textContent = `${text.value.length} / 2000`; });
    const msg = msgBox(); msg.hidden = true;
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Envoyer pour validation');
    const form = h('form', { class: 'com-form com-write', novalidate: true },
      h('h3', { class: 'com-h3', text: 'Écrire un message' }),
      field('Sujet', tag), field('Message', text), count,
      h('p', { class: 'com-help', text: 'Votre message sera visible par tous une fois validé par l’administrateur. N’y mettez pas d’informations personnelles.' }),
      msg, h('div', { class: 'dialog-actions' }, btn));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(btn, async () => {
        if (!tag.value) { showMsg(msg, errText('sujet')); return; }
        if (text.value.trim().length < 2) { showMsg(msg, errText('texte_longueur')); return; }
        try {
          await rpc('ep_post_comment', { p_token: session.token, p_tag: Number(tag.value), p_body: text.value.trim() });
          form.reset(); count.textContent = '0 / 2000';
          showMsg(msg, 'Message envoyé ! Il apparaîtra dans « Messages publiés » après validation.', 'ok');
          loadMine();
          if (isAdmin()) loadPendingCount();
        } catch (err) { showMsg(msg, errText(err.code)); if (!session) renderMine(); }
      });
    });
    write.replaceChildren(form);
    loadMine();
  }
  async function loadMine() {
    const mine = $('#com-mine');
    if (!session) return;
    try {
      const r = await rpc('ep_my_comments', { p_token: session.token });
      mine.replaceChildren();
      if (!r.comments.length) mine.append(h('p', { class: 'com-empty', text: 'Vous n’avez encore écrit aucun message.' }));
      r.comments.forEach((c) => mine.append(commentCard(c, {
        noAuthor: true, state: true,
        extra: h('div', { class: 'com-row' }, h('span', { class: 'com-muted', text: 'Écrit le ' + fmtDate(c.created_at) }),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
            if (!window.confirm('Supprimer ce message ?')) return;
            try { await rpc('ep_delete_comment', { p_token: session.token, p_id: c.id }); loadMine(); loadList(true); } catch (err) { window.alert(errText(err.code)); }
          } }, 'Supprimer')),
      })));
    } catch (err) { mine.replaceChildren(h('p', { class: 'com-empty com-error', text: errText(err.code) })); }
  }

  /* ---------- Administration ---------- */
  let admTab = 'pending';
  async function loadPendingCount() {
    if (!isAdmin()) return;
    try {
      const r = await rpc('ep_admin_comments', { p_token: session.token, p_state: 'pending' });
      $('#com-pending-count').textContent = r.comments.length ? String(r.comments.length) : '';
    } catch (e) { /* ignoré */ }
  }
  function loadAdmin() {
    if (!isAdmin()) return;
    $$('[data-adm-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.admTab === admTab)));
    const box = $('#com-admin');
    box.replaceChildren(h('p', { class: 'com-empty', text: 'Chargement…' }));
    if (admTab === 'tags') return loadAdminTags(box);
    if (admTab === 'accounts') return loadAdminAccounts(box);
    return loadAdminComments(box, admTab);
  }
  async function admin(fn, args, then) {
    try { await rpc(fn, { p_token: session.token, ...args }); if (then) then(); }
    catch (err) { window.alert(errText(err.code)); }
  }
  async function loadAdminComments(box, state) {
    let r, at;
    try {
      [r, at] = await Promise.all([rpc('ep_admin_comments', { p_token: session.token, p_state: state }), rpc('ep_admin_tags', { p_token: session.token })]);
    } catch (err) { box.replaceChildren(h('p', { class: 'com-empty com-error', text: errText(err.code) })); return; }
    box.replaceChildren();
    if (state === 'pending') $('#com-pending-count').textContent = r.comments.length ? String(r.comments.length) : '';
    if (!r.comments.length) { box.append(h('p', { class: 'com-empty', text: { pending: 'Aucun message à valider.', published: 'Aucun message publié.', rejected: 'Aucun message refusé.' }[state] })); return; }
    const refresh = () => { loadAdmin(); loadList(true); };
    for (const c of r.comments) {
      const tagSel = h('select', { class: 'com-input com-input-sm', 'aria-label': 'Sujet' }, at.tags.map((t) => h('option', { value: String(t.id), selected: t.id === c.tag_id }, t.label + (t.hidden ? ' (masqué)' : ''))));
      tagSel.addEventListener('change', () => admin('ep_admin_update_comment', { p_id: c.id, p_tag: Number(tagSel.value) }, refresh));
      const suivi = select(SUIVI, c.suivi, { 'aria-label': 'Suivi', class: 'com-input com-input-sm' });
      suivi.addEventListener('change', () => admin('ep_admin_update_comment', { p_id: c.id, p_suivi: suivi.value }, refresh));
      const reply = h('textarea', { class: 'com-input', rows: '2', maxlength: '1000', placeholder: 'Réponse publique (facultative)…' }); reply.value = c.reply || '';
      const actions = h('div', { class: 'com-row com-admin-actions' },
        c.state !== 'published' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => admin('ep_admin_update_comment', { p_id: c.id, p_state: 'published', p_reply: reply.value }, refresh) }, 'Valider et publier') : null,
        c.state !== 'rejected' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => admin('ep_admin_update_comment', { p_id: c.id, p_state: 'rejected' }, refresh) }, c.state === 'published' ? 'Retirer (refuser)' : 'Refuser') : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => admin('ep_admin_update_comment', { p_id: c.id, p_reply: reply.value }, refresh) }, 'Enregistrer la réponse'),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => { if (window.confirm('Supprimer définitivement ce message ?')) admin('ep_delete_comment', { p_id: c.id }, refresh); } }, 'Supprimer'));
      box.append(commentCard({ ...c, reply: '' }, {
        extra: h('div', { class: 'com-admin-tools' },
          h('div', { class: 'com-grid2' }, field('Sujet', tagSel), field('Suivi', suivi)),
          field('Réponse', reply), actions),
      }));
    }
  }
  async function loadAdminTags(box) {
    let r;
    try { r = await rpc('ep_admin_tags', { p_token: session.token }); } catch (err) { box.replaceChildren(h('p', { class: 'com-empty com-error', text: errText(err.code) })); return; }
    const after = () => { loadAdmin(); loadTags(); };
    const rows = r.tags.map((t, i) => {
      const lab = h('input', { type: 'text', class: 'com-input com-input-sm', maxlength: '30', 'aria-label': 'Nom du sujet' }); lab.value = t.label;
      const swap = (j) => {
        const o = r.tags[j];
        if (!o) return;
        admin('ep_admin_save_tag', { p_id: t.id, p_label: t.label, p_hidden: t.hidden, p_ord: o.ord === t.ord ? o.ord + (j > i ? 1 : -1) : o.ord },
          () => admin('ep_admin_save_tag', { p_id: o.id, p_label: o.label, p_hidden: o.hidden, p_ord: t.ord }, after));
      };
      return h('div', { class: 'com-tagrow' + (t.hidden ? ' is-hidden' : '') },
        lab,
        h('span', { class: 'com-muted', text: `${t.used} message${t.used > 1 ? 's' : ''}` }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Monter', disabled: i === 0, onclick: () => swap(i - 1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Descendre', disabled: i === r.tags.length - 1, onclick: () => swap(i + 1) }, '↓'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => admin('ep_admin_save_tag', { p_id: t.id, p_label: lab.value, p_hidden: t.hidden }, after) }, 'Renommer'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => admin('ep_admin_save_tag', { p_id: t.id, p_label: t.label, p_hidden: !t.hidden }, after) }, t.hidden ? 'Afficher' : 'Masquer'));
    });
    const nl = h('input', { type: 'text', class: 'com-input com-input-sm', maxlength: '30', placeholder: 'Nouveau sujet (ex. : Unifilaire)' });
    const add = h('form', { class: 'com-tagrow com-tagadd', novalidate: true }, nl, h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Ajouter'));
    add.addEventListener('submit', (e) => { e.preventDefault(); if (nl.value.trim()) admin('ep_admin_save_tag', { p_label: nl.value.trim() }, after); });
    box.replaceChildren(
      h('p', { class: 'com-help', text: 'Les sujets sont choisis par les utilisateurs. Un sujet masqué n’est plus proposé, mais les anciens messages le gardent. Le suivi (Non traité, En cours de traitement, Traité) vous est réservé et se règle sur chaque message.' }),
      ...rows, add);
  }
  async function loadAdminAccounts(box) {
    let r;
    try { r = await rpc('ep_admin_accounts', { p_token: session.token }); } catch (err) { box.replaceChildren(h('p', { class: 'com-empty com-error', text: errText(err.code) })); return; }
    const me = session.profile.id;
    const table = h('table', { class: 'des-table com-table' },
      h('thead', {}, h('tr', {}, ['Pseudo', 'Âge', 'Statut', 'Description', 'Inscrit le', 'Messages', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, r.accounts.map((a) => h('tr', {},
        h('td', {}, h('strong', { text: a.pseudo }), a.role === 'admin' ? h('span', { class: 'com-badge com-badge-admin', text: 'Admin' }) : null),
        h('td', { text: AGES[a.age_range] || '' }), h('td', { text: STATUTS[a.statut] || '' }),
        h('td', { class: 'com-desc-cell', text: a.description || '—' }), h('td', { text: fmtDate(a.created_at) }), h('td', { text: String(a.comments) }),
        h('td', { class: 'com-row' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
            const v = window.prompt(`Nouvelle phrase de passe provisoire pour « ${a.pseudo} » (au moins 12 caractères). Transmettez-la à la personne : elle pourra la changer dans « Mon compte ».`);
            if (v === null) return;
            if (strength(v).lvl < 1) { window.alert('Au moins 12 caractères.'); return; }
            admin('ep_admin_reset_password', { p_id: a.id, p_pw: await prehash(v) }, () => window.alert('Phrase de passe provisoire enregistrée.'));
          } }, 'Phrase provisoire'),
          a.id === me ? null : h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => {
            if (window.confirm(`Supprimer le compte « ${a.pseudo} » et tous ses messages ?`)) admin('ep_admin_delete_account', { p_id: a.id }, () => { loadAdmin(); loadList(true); });
          } }, 'Supprimer'))))));
    box.replaceChildren(h('p', { class: 'com-help', text: `${r.accounts.length} compte${r.accounts.length > 1 ? 's' : ''}. Seules les informations non personnelles sont enregistrées.` }), h('div', { class: 'com-table-wrap' }, table));
  }

  /* ---------- Démarrage ---------- */
  function init() {
    const notice = $('#com-notice');
    if (!READY) {
      if (notice) { notice.hidden = false; notice.textContent = 'Les commentaires ne sont pas encore activés sur ce site.'; }
      $$('.com-tabs, .com-panel').forEach((e) => { e.hidden = true; });
      return;
    }
    refreshHeader();
    acctBtn.addEventListener('click', () => openAccount());
    $('#acct-close').addEventListener('click', () => dlg.close());
    $('#priv-close').addEventListener('click', () => $('#dlg-privacy').close());
    $$('[data-com-tab]').forEach((b) => b.addEventListener('click', () => showComTab(b.dataset.comTab)));
    $$('[data-adm-tab]').forEach((b) => b.addEventListener('click', () => { admTab = b.dataset.admTab; loadAdmin(); }));
    $('#com-more').addEventListener('click', () => loadList(false));
    let loaded = false;
    const onShow = () => {
      if ($('#main-community').hidden || loaded) return;
      loaded = true;
      loadTags(); showComTab(currentComTab);
    };
    $$('[data-view-tab]').forEach((t) => t.addEventListener('click', () => setTimeout(onShow, 0)));
    onShow();
    // session encore valide ? (informations à jour, rôle)
    if (session) {
      rpc('ep_me', { p_token: session.token }).then((r) => { setSession(null, r.profile); if (isAdmin()) loadPendingCount(); }).catch(() => { /* hors ligne : on garde la session locale */ });
    }
  }
  init();
  window.EPCommunity = { _norm: normPw, _hash: prehash, _strength: strength, _session: () => session };
})();
