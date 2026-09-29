/* ════════════════════════════════════════════════════════
   AB2S Sécurité — Base de données Clients — Frontend
════════════════════════════════════════════════════════ */

const API = window.location.origin;

const state = {
  me: null,
  page: 'dashboard',
  clientId: null,          // client affiché sur la page fiche
  client: null,            // données complètes de ce client
  editingClientId: null,   // client en cours d'édition dans le modal
  typeFilter: '',
  caYear: new Date().getFullYear(),
  caRows: [],
  stats: null,
  sitesOpen: new Set(),
  pendingKeys: new Set(),  // éléments supprimés en attente (bouton « Annuler »)
};

// Catégories : ordre fixe → couleur fixe (--series-1…4)
const CATEGORIES = ['Collectivité locale', 'Grande distribution', 'Société de sécurité privée', 'Autres'];
// Qualifications proposées (saisie libre possible)
const QUALIFICATIONS = ['ADS', 'SSIAP 1', 'SSIAP 2', 'SSIAP 3', 'Cynophile', 'Chef de poste', 'Rondier intervenant', 'Opérateur télésurveillance', 'Agent événementiel', 'Agent de sûreté aéroportuaire'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/me');
  if (!me || !me.nom) { window.location.href = '/login.html'; return; }
  state.me = me;
  document.getElementById('connected-as').textContent = me.nom;
  document.getElementById('user-avatar').textContent = me.nom.trim().charAt(0);
  const h = new Date().getHours();
  document.getElementById('dash-greeting').textContent = `${h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'} ${me.nom}`;
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('kbd-hint').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  updateThemeButton();
  setupKeyboard();
  setupPalette();
  setupDialog();
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', debounce(renderVisibleCharts, 150));
  window.addEventListener('pagehide', flushPendingDeleteOnExit);
  route();
});

async function logout() {
  await api('/api/logout', { method: 'POST', body: {} });
  window.location.href = '/login.html';
}

async function changePassword() {
  await uiDialog({
    title: 'Changer mon mot de passe',
    message: 'Le nouveau mot de passe doit faire au moins 6 caractères.',
    icon: 'key',
    okText: 'Changer le mot de passe',
    fields: [
      { name: 'ancien', label: 'Mot de passe actuel', type: 'password', autocomplete: 'current-password' },
      { name: 'nouveau', label: 'Nouveau mot de passe', type: 'password', autocomplete: 'new-password' },
      { name: 'confirmation', label: 'Confirmer le nouveau mot de passe', type: 'password', autocomplete: 'new-password' },
    ],
    validate: async v => {
      if (!v.ancien || !v.nouveau) return 'Tous les champs sont obligatoires';
      if (v.nouveau.length < 6) return 'Le nouveau mot de passe doit faire au moins 6 caractères';
      if (v.nouveau !== v.confirmation) return 'Les deux mots de passe ne correspondent pas';
      const r = await api('/api/change-password', { method: 'POST', body: { ancien: v.ancien, nouveau: v.nouveau } });
      if (!r || !r.ok) return (r && r.error) || 'Erreur';
      return null;
    }
  }) && toast('Mot de passe changé');
}

function exportCSV() {
  window.open(API + '/api/export/csv', '_blank');
}

// ─── Navigation (#/page ou #/client/12) ───────────────
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function showTab(name) { go('#/' + name); }
function openClient(id) { go(`#/client/${id}`); }

function route() {
  flushPendingDelete();
  const [, page = 'dashboard', id] = (location.hash || '#/dashboard').split('/');
  const name = document.getElementById('tab-' + page) ? page : 'dashboard';

  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const navName = name === 'client' ? 'clients' : name;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === navName));
  state.page = name;
  window.scrollTo({ top: 0 });

  if (name === 'dashboard') loadDashboard();
  if (name === 'clients')   loadClients();
  if (name === 'client')    loadClientPage(parseInt(id));
  if (name === 'ca')        loadCa();
  if (name === 'sites')     loadSitesGlobal();
  if (name === 'carte')     loadCarteClients();
}

// ─── API helper ───────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const r = await fetch(API + path, {
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
    });
    if (r.status === 401) { window.location.href = '/login.html'; return null; }
    return r.json().catch(() => null);
  } catch (e) {
    toast('Erreur de connexion au serveur', true);
    return null;
  }
}

// ─── THÈME CLAIR / SOMBRE ─────────────────────────────
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.add('theme-anim');
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('ab2s-theme', next); } catch (e) {}
  setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  updateThemeButton();
  renderVisibleCharts();
  updateMapTiles();
}

function updateThemeButton() {
  const dark = currentTheme() === 'dark';
  document.getElementById('theme-icon').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  document.getElementById('theme-label').textContent = dark ? 'Mode clair' : 'Mode sombre';
}

// ─── CLAVIER ──────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen('palette-overlay') ? closePalette() : openPalette();
      return;
    }
    if (e.key === 'Escape') {
      if (isOpen('dialog-overlay')) return; // géré par la boîte de dialogue
      if (isOpen('palette-overlay')) return closePalette();
      if (isOpen('modal-overlay')) return closeClientModal();
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !anyOverlayOpen()) { e.preventDefault(); openPalette(); }
  });
}
function isOpen(id) { return document.getElementById(id).classList.contains('open'); }
function anyOverlayOpen() { return ['dialog-overlay', 'palette-overlay', 'modal-overlay'].some(isOpen); }

// ═════════════════════════════════════════════════════
//  TABLEAU DE BORD
// ═════════════════════════════════════════════════════
async function loadDashboard() {
  ['dash-echeances', 'dash-recents'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.children.length) el.innerHTML = skeletonList(4);
  });
  ['chart-ca', 'chart-categories', 'chart-echeances'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.children.length) el.innerHTML = '<div class="skeleton skeleton-chart"></div>';
  });

  const [kpi, clients, stats] = await Promise.all([api('/api/kpi'), api('/api/clients'), api('/api/stats')]);
  if (kpi) {
    countUp('k-clients',   kpi.clients_actifs);
    countUp('k-sites',     kpi.sites);
    countUp('k-echeances', kpi.echeances_30j);
  }
  if (stats) {
    state.stats = stats;
    const caMap = Object.fromEntries(stats.ca.map(r => [r.mois, r.total]));
    const cur = monthKey(new Date()), prev = monthKey(addMonths(new Date(), -1));
    const now = caMap[cur] || 0, before = caMap[prev] || 0;
    countUp('k-ca', now, v => fmtEUR(v));
    const delta = document.getElementById('k-ca-delta');
    if (before > 0) {
      const pct = Math.round((now - before) / before * 100);
      delta.className = 'kpi-delta ' + (pct >= 0 ? 'up' : 'down');
      delta.textContent = `${pct >= 0 ? '+' : ''}${pct} % vs ${MOIS_COURTS[addMonths(new Date(), -1).getMonth()]}`;
    } else {
      delta.className = 'kpi-delta';
      delta.textContent = before === 0 && now === 0 ? 'Aucune saisie ce mois-ci' : '';
    }
    renderDashboardCharts();
  }
  if (clients) renderDashLists(clients);
}

function renderDashboardCharts() {
  const stats = state.stats;
  if (!stats || state.page !== 'dashboard') return;

  const caMap = Object.fromEntries(stats.ca.map(r => [r.mois, r.total]));
  const past = monthRange(addMonths(new Date(), -11), 12);
  barChart(document.getElementById('chart-ca'), past.map(m => ({
    label: monthShort(m), title: monthLong(m), value: caMap[m] || 0, current: m === monthKey(new Date())
  })), { format: v => fmtEUR(v), axisFormat: v => fmtEURCompact(v), empty: 'Aucun montant saisi sur les 12 derniers mois', emptyAction: `<a class="link" href="#/ca">Ouvrir le grand livre</a>` });

  const echMap = Object.fromEntries(stats.echeances.map(r => [r.mois, r.n]));
  const next = monthRange(new Date(), 12);
  barChart(document.getElementById('chart-echeances'), next.map(m => ({
    label: monthShort(m), title: monthLong(m), value: echMap[m] || 0
  })), { format: v => `${v} fin${v > 1 ? 's' : ''} de contrat`, axisFormat: v => String(v), integer: true, empty: 'Aucune fin de contrat prévue' });

  const counts = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  stats.categories.forEach(r => { counts[CATEGORIES.includes(r.categorie) ? r.categorie : 'Autres'] += r.n; });
  donutChart(document.getElementById('chart-categories'),
    CATEGORIES.map((c, i) => ({ label: c, value: counts[c], color: `var(--series-${i + 1})` })));
}

function renderVisibleCharts() {
  if (state.page === 'dashboard') renderDashboardCharts();
  if (state.page === 'client' && state.client) renderClientCaChart();
}

function countUp(id, target, format = v => String(v)) {
  const el = document.getElementById(id);
  const from = parseFloat(el.dataset.value) || 0;
  el.dataset.value = target;
  if (from === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(target); return; }
  const start = performance.now(), dur = 700;
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = format(Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDashLists(clients) {
  const echeances = clients
    .filter(c => c.date_fin_contrat && !c.tacite_reconduction && c.statut !== 'Terminé')
    .map(c => ({ ...c, jours: daysUntil(c.date_fin_contrat) }))
    .filter(c => c.jours >= 0 && c.jours <= 90)
    .sort((a, b) => a.jours - b.jours)
    .slice(0, 5);

  document.getElementById('dash-echeances').innerHTML = echeances.length ? echeances.map((c, i) => `
    <a class="list-row" style="animation-delay:${i * 40}ms" href="#/client/${c.id}">
      ${clientAvatar(c)}
      <div class="list-main">
        <div class="list-title">${esc(c.societe)}</div>
        <div class="list-meta">Fin le ${formatDateShort(c.date_fin_contrat)}</div>
      </div>
      ${joursPill(c.jours)}
    </a>
  `).join('') : emptyBlock('check', 'Aucune échéance dans les 90 jours');

  const recents = clients.slice(0, 5);
  document.getElementById('dash-recents').innerHTML = recents.length ? recents.map((c, i) => `
    <a class="list-row" style="animation-delay:${i * 40}ms" href="#/client/${c.id}">
      ${clientAvatar(c)}
      <div class="list-main">
        <div class="list-title">${esc(c.societe)}</div>
        <div class="list-meta">${[c.ville, c.type_prestation].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <span class="list-meta">${timeAgo(c.updated_at)}</span>
    </a>
  `).join('') : emptyBlock('building', 'Aucun client pour le moment');
}

// ═════════════════════════════════════════════════════
//  GRAPHIQUES (SVG maison, thémés par variables CSS)
// ═════════════════════════════════════════════════════
function barChart(el, data, opts = {}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    el.innerHTML = `<div class="chart-empty">${ic('trend', 'i-lg')}<p>${opts.empty || 'Aucune donnée'}</p>${opts.emptyAction || ''}</div>`;
    return;
  }
  const W = Math.max(el.clientWidth, 280), H = opts.height || 220;
  const m = { top: 14, right: 6, bottom: 28, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const max = Math.max(...data.map(d => d.value));
  const { step, top } = niceScale(max, opts.integer);
  const band = iw / data.length;
  const bw = Math.min(34, band * 0.62);
  const y = v => m.top + ih - (v / top) * ih;

  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid += `<line class="chart-grid${v === 0 ? ' base' : ''}" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>
             <text class="chart-axis" x="${m.left - 10}" y="${y(v) + 4}" text-anchor="end">${esc((opts.axisFormat || String)(v))}</text>`;
  }
  const labelEvery = band < 34 ? 2 : 1;
  const bars = data.map((d, i) => {
    const x = m.left + band * i + (band - bw) / 2;
    const h = Math.max(0, (d.value / top) * ih);
    const r = Math.min(4, h / 2, bw / 2);
    const y0 = m.top + ih;
    const path = h > 0
      ? `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z`
      : '';
    return `<g class="bar-g${d.current ? ' current' : ''}" data-i="${i}" style="--d:${i * 30}ms">
      ${path ? `<path class="bar" d="${path}"/>` : ''}
      <rect class="bar-hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}"/>
      ${i % labelEvery === 0 ? `<text class="chart-axis" x="${m.left + band * i + band / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : ''}
    </g>`;
  }).join('');

  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${grid}${bars}</svg>`;
  el.querySelectorAll('.bar-g').forEach(g => {
    const d = data[+g.dataset.i];
    g.addEventListener('mousemove', e => showTip(e, d.title || d.label, (opts.format || String)(d.value)));
    g.addEventListener('mouseenter', () => el.classList.add('hovering'));
    g.addEventListener('mouseleave', () => { el.classList.remove('hovering'); hideTip(); });
  });
}

function donutChart(el, data) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) { el.innerHTML = `<div class="chart-empty">${ic('building', 'i-lg')}<p>Aucun client pour le moment</p></div>`; return; }
  const S = 180, R = 84, r = 58, cx = S / 2, cy = S / 2;
  let a0 = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    if (!d.value) return '';
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const full = d.value === total;
    const path = full
      ? `M${cx},${cy - R} A${R},${R} 0 1 1 ${cx - 0.01},${cy - R} L${cx - 0.01},${cy - r} A${r},${r} 0 1 0 ${cx},${cy - r} Z`
      : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return `<path class="donut-seg" data-i="${i}" d="${path}" style="fill:${d.color}"/>`;
  }).join('');

  el.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Répartition par catégorie">
        ${arcs}
        <text class="donut-total" x="${cx}" y="${cy + 4}" text-anchor="middle">${total}</text>
        <text class="donut-sub" x="${cx}" y="${cy + 22}" text-anchor="middle">client${total > 1 ? 's' : ''}</text>
      </svg>
      <ul class="legend">
        ${data.map((d, i) => `
          <li data-i="${i}">
            <i style="background:${d.color}"></i>
            <span class="legend-label">${esc(d.label)}</span>
            <span class="legend-value">${d.value}</span>
            <span class="legend-pct">${Math.round(d.value / total * 100)} %</span>
          </li>`).join('')}
      </ul>
    </div>`;
  const setActive = i => {
    el.querySelectorAll('[data-i]').forEach(n => n.classList.toggle('dim', i !== null && +n.dataset.i !== i));
  };
  el.querySelectorAll('.donut-seg, .legend li').forEach(n => {
    const d = data[+n.dataset.i];
    n.addEventListener('mouseenter', () => setActive(+n.dataset.i));
    n.addEventListener('mousemove', e => n.tagName === 'path' && showTip(e, d.label, `${d.value} client${d.value > 1 ? 's' : ''} · ${Math.round(d.value / total * 100)} %`));
    n.addEventListener('mouseleave', () => { setActive(null); hideTip(); });
  });
}

function niceScale(max, integer) {
  if (max <= 0) return { step: 1, top: 1 };
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  return { step, top: Math.ceil(max / step) * step };
}

function showTip(e, title, value) {
  const tip = document.getElementById('chart-tip');
  tip.innerHTML = `<div class="tip-title">${esc(title)}</div><div class="tip-value">${esc(value)}</div>`;
  tip.classList.add('show');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, yy = e.clientY - h - 12;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (yy < 8) yy = e.clientY + 16;
  tip.style.transform = `translate(${x}px, ${yy}px)`;
}
function hideTip() { document.getElementById('chart-tip').classList.remove('show'); }

// ═════════════════════════════════════════════════════
//  LISTE DES CLIENTS
// ═════════════════════════════════════════════════════
function filterClientsType(type) {
  state.typeFilter = type;
  document.getElementById('client-type-tous').classList.toggle('active', type === '');
  document.getElementById('client-type-regulier').classList.toggle('active', type === 'Régulier');
  document.getElementById('client-type-occasionnel').classList.toggle('active', type === 'Occasionnel');
  loadClients();
}

const loadClientsDebounced = debounce(() => loadClients(), 200);

async function loadClients() {
  const params = new URLSearchParams();
  const s = document.getElementById('search-input').value.trim();
  if (s) params.set('search', s);
  if (state.typeFilter) params.set('type_client', state.typeFilter);

  const tbody = document.getElementById('clients-body');
  if (!tbody.children.length) tbody.innerHTML = skeletonRows(6, 8);

  const data = await api('/api/clients?' + params);
  if (!data) return;

  document.getElementById('clients-count').textContent = `${data.length} client${data.length > 1 ? 's' : ''}`;
  const empty = document.getElementById('clients-empty');

  if (!data.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = data.map((c, i) => `
    <tr onclick="openClient(${c.id})" style="animation-delay:${Math.min(i, 15) * 25}ms">
      <td>
        <div class="cell-client">
          ${clientAvatar(c, 'sm')}
          <div><strong>${esc(c.societe)}</strong>${c.code_client ? `<div class="cell-sub">${esc(c.code_client)}</div>` : ''}</div>
        </div>
      </td>
      <td>${typeClientPill(c.type_client)}</td>
      <td>${esc(c.categorie_client) || dash()}</td>
      <td>${esc(c.contact_nom) || dash()}</td>
      <td>${esc(c.ville) || dash()}</td>
      <td>${esc(c.type_prestation) || dash()}</td>
      <td>${statutPill(c.statut)}</td>
      <td>${c.tacite_reconduction
        ? `<span class="pill pill-info">${ic('refresh')}Tacite</span>`
        : (c.date_fin_contrat ? formatDateShort(c.date_fin_contrat) : dash())}</td>
    </tr>
  `).join('');
}

// ═════════════════════════════════════════════════════
//  PAGE FICHE CLIENT
// ═════════════════════════════════════════════════════
async function loadClientPage(id) {
  const page = document.getElementById('client-page');
  if (state.clientId !== id || !state.client) {
    state.client = null;
    page.innerHTML = clientPageSkeleton();
  }
  state.clientId = id;
  const data = await api(`/api/clients/${id}`);
  if (!data || data.error) {
    page.innerHTML = `<div class="card">${emptyBlock('building', 'Ce client est introuvable')}<div style="text-align:center;padding-bottom:24px"><a class="btn-ghost" href="#/clients">${ic('back')}Retour aux clients</a></div></div>`;
    return;
  }
  if (state.clientId !== id) return; // l'utilisateur a changé de page entre-temps
  const firstRender = !state.client;
  state.client = data;
  if (firstRender) page.innerHTML = clientPageLayout();
  renderClientView();
}

async function refreshClient() {
  if (!state.clientId) return;
  const data = await api(`/api/clients/${state.clientId}`);
  if (!data || data.error) return;
  state.client = data;
  if (state.page === 'client') renderClientView();
}

function clientPageLayout() {
  const moisCourant = monthKey(new Date());
  return `
    <a class="back-link" href="#/clients">${ic('back')}Clients</a>
    <div id="client-hero"></div>
    <div class="client-grid">
      <div class="client-col">
        ${block({ id: 'ca', icon: 'trend', title: "Chiffre d'affaires", addLabel: 'Saisir un montant', form: `
          <form class="inline-form" onsubmit="addCaEntry(event)">
            <div class="form-group"><label>Mois</label><input type="month" name="mois" value="${moisCourant}" required></div>
            <div class="form-group grow"><label>Libellé</label><input type="text" name="libelle" placeholder="Prestation réalisée…"></div>
            <div class="form-group"><label>Montant HT (€)</label><input type="number" name="montant" step="0.01" placeholder="0,00" required></div>
            <button class="btn-primary" type="submit">${ic('plus')}Ajouter</button>
          </form>` })}
        ${block({ id: 'historique', icon: 'history', title: 'Historique', addLabel: 'Ajouter une entrée', form: `
          <form class="inline-form" onsubmit="addHistorique(event)">
            <div class="form-group"><label>Type</label>
              <select name="type"><option>Échange</option><option>Incident</option><option>Renouvellement</option><option>Note</option></select>
            </div>
            <div class="form-group grow"><label>Description</label><input type="text" name="description" placeholder="Que s'est-il passé ?" required></div>
            <button class="btn-primary" type="submit">${ic('plus')}Ajouter</button>
          </form>` })}
      </div>
      <div class="client-col">
        ${block({ id: 'infos', icon: 'info', title: 'Informations', headAction: `<button class="btn-ghost btn-sm" onclick="openClientModal(state.clientId)">${ic('edit')}Modifier</button>` })}
        ${block({ id: 'contacts', icon: 'users', title: 'Contacts', addLabel: 'Ajouter', form: `
          <form class="inline-form wrap" onsubmit="addContact(event)">
            <div class="form-group grow"><label>Nom</label><input type="text" name="nom" placeholder="Nom Prénom" required></div>
            <div class="form-group grow"><label>Poste</label><input type="text" name="poste" placeholder="Poste"></div>
            <div class="form-group grow"><label>Téléphone</label><input type="tel" name="telephone" placeholder="06 00 00 00 00"></div>
            <div class="form-group grow"><label>Email</label><input type="email" name="email" placeholder="nom@societe.fr"></div>
            <button class="btn-primary" type="submit">${ic('plus')}Ajouter</button>
          </form>` })}
        ${block({ id: 'sites', icon: 'pin', title: 'Sites', addLabel: 'Ajouter', form: `
          <form class="inline-form wrap" onsubmit="addSite(event)">
            <div class="form-group grow"><label>Nom du site</label><input type="text" name="nom_site" placeholder="Entrepôt Nord" required></div>
            <div class="form-group"><label>Code</label><input type="text" name="code_site" placeholder="S-01" style="width:110px"></div>
            <div class="form-group grow full"><label>Adresse</label><input type="text" name="adresse_site" placeholder="Adresse complète (sert à la carte)"></div>
            <button class="btn-primary" type="submit">${ic('plus')}Ajouter</button>
          </form>` })}
        ${block({ id: 'tarifs', icon: 'euro', title: 'Tarifs horaires', addLabel: 'Ajouter', form: `
          <form class="inline-form wrap" onsubmit="addTarif(event)">
            <div class="form-group grow"><label>Qualification</label>
              <input type="text" name="qualification" list="qualifs-list" placeholder="ADS, SSIAP 1…" autocomplete="off" required>
              <datalist id="qualifs-list">${QUALIFICATIONS.map(q => `<option value="${q}">`).join('')}</datalist>
            </div>
            <div class="form-group"><label>Année</label><input type="number" name="annee" value="${new Date().getFullYear()}" style="width:90px" required></div>
            <div class="form-group"><label>Taux horaire (€)</label><input type="number" name="taux_horaire" step="0.01" min="0" placeholder="0,00" style="width:120px" required></div>
            <button class="btn-primary" type="submit">${ic('plus')}Ajouter</button>
          </form>` })}
        ${block({ id: 'documents', icon: 'file', title: 'Documents', form: null, headAction: `
          <select id="doc-type" class="filter-select select-sm" title="Type des prochains documents envoyés">
            <option value="devis">Devis</option><option value="contrat">Contrat</option>
            <option value="facture">Facture</option><option value="autre">Autre</option>
          </select>`, pre: `
          <label class="dropzone" id="dropzone"
                 ondragover="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
            <input type="file" multiple hidden onchange="uploadDocuments(this.files); this.value=''">
            <span class="dz-icon">${ic('upload', 'i-lg')}</span>
            <span class="dz-title">Glissez vos fichiers ici</span>
            <span class="dz-sub">ou cliquez pour parcourir</span>
          </label>` })}
      </div>
    </div>`;
}

function block({ id, icon, title, addLabel, form, headAction = '', pre = '' }) {
  return `
    <div class="card block" id="blk-${id}">
      <div class="block-head">
        <div class="block-title">
          <span class="block-icon">${ic(icon)}</span>
          <h3>${title}</h3>
          <span class="block-count" id="count-${id}"></span>
        </div>
        <div class="block-actions">
          ${headAction}
          ${addLabel ? `<button class="btn-ghost btn-sm" onclick="toggleAdd('${id}')" id="addbtn-${id}">${ic('plus')}${addLabel}</button>` : ''}
        </div>
      </div>
      ${form ? `<div class="block-add" id="add-${id}">${form}</div>` : ''}
      ${pre}
      <div class="block-body" id="body-${id}"></div>
    </div>`;
}

function toggleAdd(id) {
  const el = document.getElementById('add-' + id);
  const open = el.classList.toggle('open');
  document.getElementById('addbtn-' + id).classList.toggle('active', open);
  if (open) setTimeout(() => {
    const first = el.querySelector('input:not([type=month]):not([type=hidden]), select');
    first && first.focus();
  }, 60);
}

function renderClientView() {
  const c = state.client;
  document.title = `${c.societe} — AB2S Sécurité`;
  renderClientHero(c);
  renderInfos(c);
  renderClientCa();
  renderHistorique();
  renderContacts();
  renderSites();
  renderTarifs();
  renderDocuments();
}

function setCount(id, n) {
  document.getElementById('count-' + id).textContent = n ? n : '';
}

function renderClientHero(c) {
  const annee = new Date().getFullYear();
  const caAnnee = (c.ca || []).filter(e => e.mois.startsWith(String(annee)) && !isPending('ca', e.id))
    .reduce((s, e) => s + Number(e.montant), 0);
  const tarifs = (c.tarifs || []).filter(t => !isPending('tarifs', t.id));
  const derniereAnnee = tarifs.length ? Math.max(...tarifs.map(t => t.annee)) : null;
  const tarifsAnnee = tarifs.filter(t => t.annee === derniereAnnee).map(t => Number(t.taux_horaire));
  const tarifMin = Math.min(...tarifsAnnee), tarifMax = Math.max(...tarifsAnnee);
  const jours = c.date_fin_contrat ? daysUntil(c.date_fin_contrat) : null;
  const tel = c.contact_telephone || (c.contacts || []).find(k => k.telephone)?.telephone;
  const mail = c.contact_email || (c.contacts || []).find(k => k.email)?.email;

  document.getElementById('client-hero').innerHTML = `
    <div class="card client-hero">
      <div class="hero-main">
        ${clientAvatar(c, 'xl')}
        <div class="hero-id">
          <div class="hero-title">
            <h1>${esc(c.societe)}</h1>
            ${c.code_client ? `<span class="segment-badge">${esc(c.code_client)}</span>` : ''}
          </div>
          <div class="hero-pills">
            ${statutPill(c.statut)}
            ${typeClientPill(c.type_client)}
            ${c.categorie_client ? `<span class="pill pill-neutral">${esc(c.categorie_client)}</span>` : ''}
          </div>
          <div class="hero-meta">
            ${[c.type_prestation, c.ville].filter(Boolean).map(esc).join(' · ')}
          </div>
        </div>
        <div class="hero-actions">
          ${tel ? `<a class="btn-ghost" href="tel:${esc(tel)}" title="${esc(tel)}">${ic('phone')}Appeler</a>` : ''}
          ${mail ? `<a class="btn-ghost" href="mailto:${esc(mail)}" title="${esc(mail)}">${ic('mail')}Email</a>` : ''}
          <button class="btn-ghost" onclick="ouvrirFichePDF()">${ic('printer')}Fiche PDF</button>
          <button class="btn-primary" onclick="openClientModal(state.clientId)">${ic('edit')}Modifier</button>
          <button class="btn-ghost btn-icon danger-hover" onclick="deleteClient()" title="Supprimer le client">${ic('trash')}</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span class="hs-label">Début de contrat</span>
          <span class="hs-value">${c.date_debut_contrat ? formatDateShort(c.date_debut_contrat) : '—'}</span>
        </div>
        <div class="hero-stat">
          <span class="hs-label">Fin de contrat</span>
          <span class="hs-value">${c.tacite_reconduction ? 'Tacite reconduction'
            : c.date_fin_contrat ? `${formatDateShort(c.date_fin_contrat)} ${jours !== null && jours >= 0 && jours <= 90 ? joursPill(jours) : ''}` : '—'}</span>
        </div>
        <div class="hero-stat">
          <span class="hs-label">${derniereAnnee ? `Tarif${tarifsAnnee.length > 1 ? 's' : ''} horaire${tarifsAnnee.length > 1 ? 's' : ''} ${derniereAnnee}` : 'Tarif contractuel'}</span>
          <span class="hs-value">${derniereAnnee
            ? (tarifMin === tarifMax ? `${fmtEUR(tarifMin, 2)} <small>/ h</small>` : `${fmtEUR(tarifMin, 2)} à ${fmtEUR(tarifMax, 2)} <small>/ h · ${tarifsAnnee.length} qualifs</small>`)
            : Number(c.tarif) ? `${fmtEUR(c.tarif, 2)} <small>${esc(c.tarif_unite || '')}</small>` : '—'}</span>
        </div>
        <div class="hero-stat">
          <span class="hs-label">CA ${annee}</span>
          <span class="hs-value">${fmtEUR(caAnnee)}</span>
        </div>
      </div>
    </div>`;
}

function renderInfos(c) {
  const row = (label, value) => `<div class="info-row"><dt>${label}</dt><dd>${value || '<span class="muted">—</span>'}</dd></div>`;
  const web = c.site_web ? `<a href="${esc(/^https?:\/\//.test(c.site_web) ? c.site_web : 'https://' + c.site_web)}" target="_blank" rel="noopener">${esc(c.site_web)}</a>` : '';
  document.getElementById('body-infos').innerHTML = `
    <dl class="info-list">
      ${row('Adresse', [c.adresse, c.ville].filter(Boolean).map(esc).join(', '))}
      ${row('SIRET', esc(c.siret))}
      ${row('N° TVA', esc(c.tva))}
      ${row('Capital social', esc(c.capital_social))}
      ${row('Site web', web)}
      ${row('Contact principal', [c.contact_nom, c.contact_telephone, c.contact_email].filter(Boolean).map(esc).join(' · '))}
    </dl>
    ${c.notes ? `<div class="info-notes">${esc(c.notes)}</div>` : ''}`;
}

// ─── Chiffre d'affaires du client ─────────────────────
function renderClientCa() {
  const rows = (state.client.ca || []).filter(e => !isPending('ca', e.id));
  setCount('ca', rows.length);
  const el = document.getElementById('body-ca');
  if (!rows.length) {
    el.innerHTML = emptyBlock('trend', 'Aucun montant saisi pour ce client', `<button class="btn-ghost btn-sm mt12" onclick="toggleAdd('ca')">${ic('plus')}Saisir le premier montant</button>`);
    return;
  }
  const byYear = {};
  rows.forEach(e => (byYear[e.mois.slice(0, 4)] ||= []).push(e));
  const years = Object.keys(byYear).sort().reverse();
  el.innerHTML = `
    <div id="chart-client-ca" class="chart chart-sm"></div>
    <div class="ledger">
      ${years.map(y => {
        const tot = byYear[y].reduce((s, e) => s + Number(e.montant), 0);
        return `
        <div class="ledger-year">
          <div class="ledger-year-head"><span>${y}</span><span>${fmtEUR(tot, 2)}</span></div>
          ${byYear[y].map(e => `
            <div class="ledger-row">
              <span class="ledger-month">${monthLong(e.mois)}</span>
              <span class="ledger-label">${esc(e.libelle) || '<span class="muted">—</span>'}${e.auteur ? `<small> · ${esc(e.auteur)}</small>` : ''}</span>
              <span class="ledger-amount">${fmtEUR(e.montant, 2)}</span>
              ${delBtn(`deleteCaEntry(${e.id})`)}
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  renderClientCaChart();
}

function renderClientCaChart() {
  const el = document.getElementById('chart-client-ca');
  if (!el) return;
  const map = {};
  (state.client.ca || []).filter(e => !isPending('ca', e.id)).forEach(e => { map[e.mois] = (map[e.mois] || 0) + Number(e.montant); });
  const months = monthRange(addMonths(new Date(), -11), 12);
  barChart(el, months.map(m => ({ label: monthShort(m), title: monthLong(m), value: map[m] || 0, current: m === monthKey(new Date()) })),
    { height: 160, format: v => fmtEUR(v, 2), axisFormat: v => fmtEURCompact(v), empty: 'Aucun montant sur les 12 derniers mois' });
}

async function addCaEntry(e) {
  e.preventDefault();
  const f = formValues(e.target);
  if (!f.montant) return toast('Indiquez un montant', true);
  const r = await api(`/api/clients/${state.clientId}/ca`, { method: 'POST', body: f });
  if (!r || r.error) return toast((r && r.error) || 'Erreur', true);
  e.target.querySelector('[name=libelle]').value = '';
  e.target.querySelector('[name=montant]').value = '';
  e.target.querySelector('[name=libelle]').focus();
  toast(`${fmtEUR(f.montant, 2)} ajoutés pour ${monthLong(f.mois).toLowerCase()}`);
  refreshClient();
}

function deleteCaEntry(id) {
  const e = (state.client?.ca || state.caRows).find(x => x.id === id) || state.caRows.find(x => x.id === id);
  deleteWithUndo({
    key: `ca:${id}`, url: `/api/ca/${id}`,
    message: `Écriture de ${e ? fmtEUR(e.montant, 2) : ''} supprimée`,
    rerender: () => { if (state.page === 'client') { renderClientCa(); renderClientHero(state.client); } if (state.page === 'ca') renderCa(); },
    after: () => { if (state.page === 'client') refreshClient(); if (state.page === 'ca') loadCa(); }
  });
}

// ─── Historique (frise chronologique) ─────────────────
function renderHistorique() {
  const list = (state.client.historique || []).filter(h => !isPending('historique', h.id));
  setCount('historique', list.length);
  const el = document.getElementById('body-historique');
  if (!list.length) { el.innerHTML = emptyBlock('history', 'Aucun événement pour le moment'); return; }
  const icons = { 'Échange': 'message', 'Incident': 'alert', 'Renouvellement': 'refresh', 'Note': 'note' };
  const tones = { 'Échange': 'info', 'Incident': 'danger', 'Renouvellement': 'success', 'Note': 'neutral' };
  el.innerHTML = `<ol class="timeline">${list.map(h => `
    <li class="tl-item tone-${tones[h.type] || 'neutral'}">
      <span class="tl-dot">${ic(icons[h.type] || 'note')}</span>
      <div class="tl-content">
        <div class="tl-head">
          <span class="tl-type">${esc(h.type)}</span>
          <span class="tl-date">${formatDate(h.date)}${h.auteur ? ` · ${esc(h.auteur)}` : ''}</span>
          ${delBtn(`deleteHistorique(${h.id})`)}
        </div>
        <div class="tl-desc">${esc(h.description)}</div>
      </div>
    </li>`).join('')}</ol>`;
}

async function addHistorique(e) {
  e.preventDefault();
  const f = formValues(e.target);
  if (!f.description) return;
  await api('/api/historique', { method: 'POST', body: { client_id: state.clientId, ...f } });
  e.target.querySelector('[name=description]').value = '';
  toast('Événement ajouté');
  refreshClient();
}

function deleteHistorique(id) {
  deleteWithUndo({ key: `historique:${id}`, url: `/api/historique/${id}`, message: 'Événement supprimé',
    rerender: renderHistorique, after: refreshClient });
}

// ─── Contacts ─────────────────────────────────────────
function renderContacts() {
  const contacts = (state.client.contacts || []).filter(c => !isPending('contacts', c.id));
  setCount('contacts', contacts.length);
  const el = document.getElementById('body-contacts');
  if (!contacts.length) { el.innerHTML = emptyBlock('users', 'Aucun contact enregistré'); return; }
  el.innerHTML = contacts.map(c => `
    <div class="activite-item">
      <div class="avatar ${toneClass(c.nom)}">${initials(c.nom)}</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${esc(c.nom)}</span>
          ${c.poste ? `<span class="pill pill-neutral">${esc(c.poste)}</span>` : ''}
        </div>
        <div class="activite-desc">
          ${c.telephone ? `<a href="tel:${esc(c.telephone)}">${ic('phone')}${esc(c.telephone)}</a>` : ''}
          ${c.email ? `<a href="mailto:${esc(c.email)}">${ic('mail')}${esc(c.email)}</a>` : ''}
          ${!c.telephone && !c.email ? '—' : ''}
        </div>
      </div>
      ${delBtn(`deleteContact(${c.id})`)}
    </div>
  `).join('');
}

async function addContact(e) {
  e.preventDefault();
  const f = formValues(e.target);
  if (!f.nom) return toast('Nom du contact requis', true);
  await api(`/api/clients/${state.clientId}/contacts`, { method: 'POST', body: f });
  e.target.reset();
  toast('Contact ajouté');
  refreshClient();
}

function deleteContact(id) {
  const c = state.client.contacts.find(x => x.id === id);
  deleteWithUndo({ key: `contacts:${id}`, url: `/api/contacts/${id}`, message: `Contact ${c ? c.nom : ''} supprimé`,
    rerender: renderContacts, after: refreshClient });
}

// ─── Sites ────────────────────────────────────────────
function renderSites() {
  const sites = (state.client.sites || []).filter(s => !isPending('sites', s.id));
  setCount('sites', sites.length);
  const el = document.getElementById('body-sites');
  if (!sites.length) { el.innerHTML = emptyBlock('pin', 'Aucun site enregistré'); return; }
  el.innerHTML = sites.map(s => `
    <div class="activite-item">
      <div class="activite-icon">${ic('pin')}</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${esc(s.nom_site)}</span>
          ${s.code_site ? `<span class="segment-badge">${esc(s.code_site)}</span>` : ''}
        </div>
        <div class="activite-desc">${esc(s.adresse_site) || '—'}</div>
      </div>
      ${delBtn(`deleteSite(${s.id})`)}
    </div>
  `).join('');
}

async function addSite(e) {
  e.preventDefault();
  const f = formValues(e.target);
  if (!f.nom_site) return toast('Nom du site requis', true);
  await api(`/api/clients/${state.clientId}/sites`, { method: 'POST', body: f });
  e.target.reset();
  toast('Site ajouté');
  refreshClient();
}

function deleteSite(id) {
  const s = state.client.sites.find(x => x.id === id);
  deleteWithUndo({ key: `sites:${id}`, url: `/api/sites/${id}`, message: `Site ${s ? s.nom_site : ''} supprimé`,
    rerender: renderSites, after: refreshClient });
}

// ─── Tarifs ───────────────────────────────────────────
function renderTarifs() {
  const tarifs = (state.client.tarifs || []).filter(t => !isPending('tarifs', t.id));
  setCount('tarifs', tarifs.length);
  const el = document.getElementById('body-tarifs');
  if (!tarifs.length) { el.innerHTML = emptyBlock('euro', 'Aucun tarif enregistré'); return; }
  // Regroupé par année (la plus récente d'abord) ; évolution calculée par qualification
  const qualif = t => t.qualification || 'Général';
  const annees = [...new Set(tarifs.map(t => t.annee))].sort((a, b) => b - a);
  el.innerHTML = `<div class="tarif-list">${annees.map(annee => {
    const lignes = tarifs.filter(t => t.annee === annee).sort((a, b) => qualif(a).localeCompare(qualif(b), 'fr'));
    return `
    <div class="tarif-year-head">${esc(annee)}</div>
    ${lignes.map(t => {
      const prev = tarifs.filter(p => qualif(p) === qualif(t) && p.annee < t.annee).sort((a, b) => b.annee - a.annee)[0];
      const evo = prev && Number(prev.taux_horaire) ? (Number(t.taux_horaire) - Number(prev.taux_horaire)) / Number(prev.taux_horaire) * 100 : null;
      return `
      <div class="tarif-row">
        <span class="tarif-qualif">${esc(qualif(t))}</span>
        <span class="tarif-rate">${fmtEUR(t.taux_horaire, 2)} <small>/ h</small></span>
        ${evo !== null ? `<span class="kpi-delta ${evo >= 0 ? 'up' : 'down'}" title="par rapport à ${prev.annee}">${evo >= 0 ? '+' : ''}${evo.toFixed(1).replace('.', ',')} %</span>` : '<span></span>'}
        ${delBtn(`deleteTarif(${t.id})`)}
      </div>`;
    }).join('')}`;
  }).join('')}</div>`;
}

async function addTarif(e) {
  e.preventDefault();
  const f = formValues(e.target);
  if (!f.qualification || !f.annee || !f.taux_horaire) return toast('Qualification, année et taux horaire requis', true);
  await api(`/api/clients/${state.clientId}/tarifs`, { method: 'POST', body: f });
  e.target.querySelector('[name=qualification]').value = '';
  e.target.querySelector('[name=taux_horaire]').value = '';
  e.target.querySelector('[name=qualification]').focus();
  toast(`Tarif ${f.qualification} ajouté`);
  refreshClient();
}

function deleteTarif(id) {
  deleteWithUndo({ key: `tarifs:${id}`, url: `/api/tarifs/${id}`, message: 'Tarif supprimé',
    rerender: () => { renderTarifs(); renderClientHero(state.client); }, after: refreshClient });
}

// ─── Documents (glisser-déposer) ──────────────────────
function renderDocuments() {
  const docs = (state.client.documents || []).filter(d => !isPending('documents', d.id));
  setCount('documents', docs.length);
  const el = document.getElementById('body-documents');
  if (!docs.length) { el.innerHTML = ''; return; }
  const tones = { devis: 'pill-info', contrat: 'pill-success', facture: 'pill-accent', autre: 'pill-neutral' };
  el.innerHTML = docs.map(d => `
    <div class="activite-item">
      <div class="activite-icon">${ic('file')}</div>
      <div class="activite-body">
        <div class="activite-top">
          <a class="activite-type doc-link" href="/api/documents/${d.id}/download" target="_blank" rel="noopener">${esc(d.nom_fichier)}</a>
          <span class="pill ${tones[d.type] || 'pill-neutral'}">${esc(d.type)}</span>
        </div>
        <div class="activite-desc">${formatDate(d.uploaded_at)}${d.uploaded_by ? ` · ${esc(d.uploaded_by)}` : ''} · ${fmtSize(d.taille_octets)}</div>
      </div>
      <a class="activite-del" href="/api/documents/${d.id}/download" target="_blank" rel="noopener" title="Télécharger">${ic('download')}</a>
      ${delBtn(`deleteDocument(${d.id})`)}
    </div>
  `).join('');
}

function dzOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function dzLeave(e) { e.currentTarget.classList.remove('over'); }
function dzDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  if (e.dataTransfer.files.length) uploadDocuments(e.dataTransfer.files);
}

async function uploadDocuments(files) {
  if (!files || !files.length || !state.clientId) return;
  const type = document.getElementById('doc-type').value;
  const dz = document.getElementById('dropzone');
  dz.classList.add('busy');
  let ok = 0;
  for (const file of files) {
    dz.querySelector('.dz-title').textContent = `Envoi de ${file.name}…`;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    const r = await api(`/api/clients/${state.clientId}/documents`, { method: 'POST', body: fd });
    if (r && r.id) ok++;
  }
  dz.classList.remove('busy');
  dz.querySelector('.dz-title').textContent = 'Glissez vos fichiers ici';
  toast(ok === files.length ? `${ok} document${ok > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}` : `${ok} / ${files.length} documents envoyés`, ok !== files.length);
  refreshClient();
}

function deleteDocument(id) {
  const d = state.client.documents.find(x => x.id === id);
  deleteWithUndo({ key: `documents:${id}`, url: `/api/documents/${id}`, message: `${d ? d.nom_fichier : 'Document'} supprimé`,
    rerender: renderDocuments, after: refreshClient });
}

function ouvrirFichePDF() {
  if (state.clientId) window.open(`/fiche.html?id=${state.clientId}`, '_blank');
}

async function deleteClient() {
  const c = state.client;
  const ok = await uiConfirm({
    title: `Supprimer ${c.societe} ?`,
    message: 'Le client et toutes ses données (contacts, sites, tarifs, documents, historique et chiffre d\'affaires) seront définitivement supprimés.',
    okText: 'Supprimer définitivement', danger: true
  });
  if (!ok) return;
  await api(`/api/clients/${state.clientId}`, { method: 'DELETE' });
  toast(`${c.societe} supprimé`);
  state.client = null; state.clientId = null;
  go('#/clients');
}

// ═════════════════════════════════════════════════════
//  MODAL : CRÉATION / MODIFICATION D'UN CLIENT
// ═════════════════════════════════════════════════════
async function openClientModal(id = null) {
  state.editingClientId = id;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-title').textContent = id ? 'Modifier le client' : 'Nouveau client';
  document.getElementById('client-form').reset();
  document.getElementById('f-id').value = '';

  if (id) {
    const data = (state.client && state.client.id === id) ? state.client : await api(`/api/clients/${id}`);
    if (!data) return;
    const set = (fid, v) => { document.getElementById(fid).value = v ?? ''; };
    set('f-id', data.id);
    set('f-societe', data.societe);
    set('f-code-client', data.code_client);
    set('f-type-prestation', data.type_prestation || 'Gardiennage');
    set('f-type-client', data.type_client || 'Régulier');
    set('f-categorie-client', data.categorie_client || 'Autres');
    set('f-adresse', data.adresse);
    set('f-ville', data.ville);
    set('f-siret', data.siret);
    set('f-tva', data.tva);
    set('f-capital-social', data.capital_social);
    set('f-site-web', data.site_web);
    set('f-contact-nom', data.contact_nom);
    set('f-contact-telephone', data.contact_telephone);
    set('f-contact-email', data.contact_email);
    set('f-date-debut', data.date_debut_contrat ? data.date_debut_contrat.slice(0, 10) : '');
    set('f-date-fin', data.date_fin_contrat ? data.date_fin_contrat.slice(0, 10) : '');
    document.getElementById('f-tacite-reconduction').checked = !!data.tacite_reconduction;
    set('f-statut', data.statut || 'Actif');
    set('f-tarif', Number(data.tarif) || '');
    set('f-tarif-unite', data.tarif_unite || 'mensuel');
    set('f-notes', data.notes);
    showClientLogoPreview(data.logo_mime_type ? id : null);
  } else {
    document.getElementById('f-statut').value = 'Actif';
    document.getElementById('f-type-client').value = 'Régulier';
    document.getElementById('f-categorie-client').value = 'Autres';
    showClientLogoPreview(null);
  }
  toggleTaciteReconduction();
  setTimeout(() => document.getElementById('f-societe').focus(), 80);
}

function showClientLogoPreview(clientId) {
  const img = document.getElementById('client-logo-preview');
  if (clientId) {
    img.src = `/api/clients/${clientId}/logo?t=${Date.now()}`;
    img.style.display = '';
  } else {
    img.src = '';
    img.style.display = 'none';
  }
}

async function uploadClientLogoIfSelected() {
  const fileInput = document.getElementById('f-logo-file');
  if (!fileInput.files.length) return;
  if (!state.editingClientId) return; // envoyé automatiquement après la création
  await sendLogo(state.editingClientId, fileInput.files[0]);
  fileInput.value = '';
  showClientLogoPreview(state.editingClientId);
  toast('Logo mis à jour');
  if (state.page === 'client') refreshClient();
}

async function sendLogo(clientId, file) {
  const fd = new FormData();
  fd.append('file', file);
  await api(`/api/clients/${clientId}/logo`, { method: 'POST', body: fd });
}

async function removeClientLogo() {
  if (!state.editingClientId) { document.getElementById('f-logo-file').value = ''; showClientLogoPreview(null); return; }
  if (!await uiConfirm({ title: 'Retirer le logo ?', message: 'Le logo de ce client sera supprimé.', okText: 'Retirer', danger: true })) return;
  await api(`/api/clients/${state.editingClientId}/logo`, { method: 'DELETE' });
  showClientLogoPreview(null);
  toast('Logo supprimé');
  if (state.page === 'client') refreshClient();
}

function toggleTaciteReconduction() {
  const checked = document.getElementById('f-tacite-reconduction').checked;
  const dateFin = document.getElementById('f-date-fin');
  dateFin.disabled = checked;
  if (checked) dateFin.value = '';
}

function closeClientModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('open')) return;
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('open', 'closing'), 180);
  state.editingClientId = null;
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeClientModal();
}

async function saveClient() {
  const v = id => document.getElementById(id).value.trim();
  const body = {
    societe: v('f-societe'), code_client: v('f-code-client'),
    type_prestation: v('f-type-prestation'), categorie_client: v('f-categorie-client'), type_client: v('f-type-client'),
    adresse: v('f-adresse'), ville: v('f-ville'),
    siret: v('f-siret'), tva: v('f-tva'), capital_social: v('f-capital-social'), site_web: v('f-site-web'),
    contact_nom: v('f-contact-nom'), contact_telephone: v('f-contact-telephone'), contact_email: v('f-contact-email'),
    date_debut_contrat: v('f-date-debut') || null, date_fin_contrat: v('f-date-fin') || null,
    tacite_reconduction: document.getElementById('f-tacite-reconduction').checked,
    statut: v('f-statut'), tarif: parseFloat(v('f-tarif')) || 0, tarif_unite: v('f-tarif-unite'),
    notes: v('f-notes'),
  };
  if (!body.societe) { toast('Le nom de la société est obligatoire', true); document.getElementById('f-societe').focus(); return; }

  const id = state.editingClientId;
  const dup = await api(`/api/clients/check-doublon?societe=${encodeURIComponent(body.societe)}${id ? '&exclude_id=' + id : ''}`);
  if (dup && dup.existe) {
    const noms = dup.correspondances.map(c => c.societe).join(', ');
    const ok = await uiConfirm({ title: 'Doublon possible', icon: 'alert',
      message: `Une entreprise au nom proche existe déjà : ${noms}. Enregistrer quand même ?`, okText: 'Enregistrer quand même' });
    if (!ok) return;
  }

  const btn = document.getElementById('btn-save-client');
  btn.disabled = true;
  if (id) {
    await api(`/api/clients/${id}`, { method: 'PUT', body });
    btn.disabled = false;
    closeClientModal();
    toast('Client mis à jour');
    if (state.page === 'client' && state.clientId === id) refreshClient();
    else if (state.page === 'clients') loadClients();
  } else {
    const r = await api('/api/clients', { method: 'POST', body });
    btn.disabled = false;
    if (!r || !r.id) return toast('Erreur lors de la création', true);
    const logo = document.getElementById('f-logo-file').files[0];
    if (logo) await sendLogo(r.id, logo);
    closeClientModal();
    toast('Client créé');
    openClient(r.id);
  }
}

// ═════════════════════════════════════════════════════
//  CHIFFRE D'AFFAIRES — GRAND LIVRE
// ═════════════════════════════════════════════════════
function changeCaYear(delta) {
  state.caYear += delta;
  loadCa();
}

async function loadCa() {
  document.getElementById('ca-year').textContent = state.caYear;
  const matrix = document.getElementById('ca-matrix');
  if (!matrix.children.length) {
    matrix.innerHTML = `<table class="table">${skeletonRows(4, 8)}</table>`;
    document.getElementById('ca-kpis').innerHTML = [1, 2, 3, 4].map(() => '<div class="kpi-card"><div class="skeleton" style="height:84px"></div></div>').join('');
  }
  const rows = await api(`/api/ca?annee=${state.caYear}`);
  if (!rows) return;
  state.caRows = rows;
  renderCa();
}

function renderCa() {
  const rows = state.caRows.filter(r => !isPending('ca', r.id));
  const year = state.caYear;
  const total = rows.reduce((s, r) => s + Number(r.montant), 0);
  const parMois = Array(12).fill(0);
  const parClient = {};
  rows.forEach(r => {
    const m = parseInt(r.mois.slice(5, 7)) - 1;
    parMois[m] += Number(r.montant);
    const c = parClient[r.client_id] ||= { id: r.client_id, societe: r.societe, code_client: r.code_client, logo_mime_type: r.logo_mime_type, mois: Array(12).fill(0), total: 0 };
    c.mois[m] += Number(r.montant);
    c.total += Number(r.montant);
  });
  const now = new Date();
  const moisEcoules = year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0;
  const best = parMois.reduce((b, v, i) => v > b.v ? { v, i } : b, { v: 0, i: -1 });
  const kpi = (tone, icon, label, value, sub = '') => `
    <div class="kpi-card ${tone}">
      <div class="kpi-icon">${ic(icon, '')}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-delta">${sub}</div>` : ''}
    </div>`;
  document.getElementById('ca-kpis').innerHTML =
    kpi('blue', 'trend', `Total ${year}`, fmtEUR(total)) +
    kpi('teal', 'calendar', 'Moyenne mensuelle', moisEcoules ? fmtEUR(total / moisEcoules) : '—', moisEcoules ? `sur ${moisEcoules} mois` : '') +
    kpi('orange', 'check', 'Meilleur mois', best.i >= 0 ? fmtEUR(best.v) : '—', best.i >= 0 ? monthLong(`${year}-${String(best.i + 1).padStart(2, '0')}`) : '') +
    kpi('red', 'building', 'Clients facturés', Object.keys(parClient).length);

  const matrix = document.getElementById('ca-matrix');
  const clients = Object.values(parClient).sort((a, b) => b.total - a.total);
  if (!clients.length) {
    matrix.innerHTML = emptyBlock('book', `Aucune écriture en ${year}`,
      `<button class="btn-primary mt12" onclick="openCaEntryDialog()">${ic('plus')}Nouvelle écriture</button>`);
  } else {
    const maxCell = Math.max(...clients.flatMap(c => c.mois));
    const cell = v => v ? `<td class="num heat" style="--h:${Math.round(v / maxCell * 100)}%" title="${fmtEUR(v, 2)}">${fmtNum(v)}</td>` : '<td class="num empty-cell"></td>';
    matrix.innerHTML = `
      <table class="table ledger-table">
        <thead><tr><th>Client</th>${MOIS_COURTS.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>
          ${clients.map(c => `
            <tr onclick="openClient(${c.id})">
              <td><div class="cell-client">${clientAvatar(c, 'sm')}<div><strong>${esc(c.societe)}</strong>${c.code_client ? `<div class="cell-sub">${esc(c.code_client)}</div>` : ''}</div></div></td>
              ${c.mois.map(cell).join('')}
              <td class="num total">${fmtNum(c.total)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td>${parMois.map(v => `<td class="num">${v ? fmtNum(v) : ''}</td>`).join('')}<td class="num total">${fmtNum(total)}</td></tr></tfoot>
      </table>`;
  }

  const entries = document.getElementById('ca-entries');
  entries.innerHTML = rows.length ? `
    <div class="ledger">
      ${rows.map(r => `
        <div class="ledger-row wide">
          <span class="ledger-month">${monthLong(r.mois)}</span>
          <a class="ledger-client" href="#/client/${r.client_id}">${esc(r.societe)}</a>
          <span class="ledger-label">${esc(r.libelle) || '<span class="muted">—</span>'}${r.auteur ? `<small> · ${esc(r.auteur)}</small>` : ''}</span>
          <span class="ledger-amount">${fmtEUR(r.montant, 2)}</span>
          ${delBtn(`deleteCaEntry(${r.id})`)}
        </div>`).join('')}
    </div>` : emptyBlock('book', 'Aucune écriture sur cette année');
}

async function openCaEntryDialog(clientId = null) {
  const clients = (await api('/api/clients') || []).sort((a, b) => a.societe.localeCompare(b.societe, 'fr'));
  if (!clients.length) return toast("Créez d'abord un client", true);
  const values = await uiDialog({
    title: 'Nouvelle écriture',
    message: 'Montant HT des prestations réalisées pour un client sur un mois.',
    icon: 'book',
    okText: 'Enregistrer',
    fields: [
      { name: 'client_id', label: 'Client', type: 'select', value: clientId || '',
        options: clients.map(c => ({ value: c.id, label: c.code_client ? `${c.societe} (${c.code_client})` : c.societe })) },
      { name: 'mois', label: 'Mois', type: 'month', value: `${state.caYear}-${String(state.caYear === new Date().getFullYear() ? new Date().getMonth() + 1 : 12).padStart(2, '0')}` },
      { name: 'libelle', label: 'Libellé', placeholder: 'Prestation réalisée…' },
      { name: 'montant', label: 'Montant HT (€)', type: 'number', step: '0.01', placeholder: '0,00' },
    ],
    validate: async v => {
      if (!v.mois) return 'Choisissez un mois';
      if (!v.montant || isNaN(parseFloat(v.montant))) return 'Indiquez un montant';
      const r = await api(`/api/clients/${v.client_id}/ca`, { method: 'POST', body: v });
      if (!r || r.error) return (r && r.error) || 'Erreur';
      return null;
    }
  });
  if (!values) return;
  toast(`${fmtEUR(values.montant, 2)} enregistrés`);
  const annee = parseInt(values.mois.slice(0, 4));
  if (state.page === 'ca') { state.caYear = annee; loadCa(); }
  if (state.page === 'client') refreshClient();
}

function exportCaCSV() {
  window.open(`${API}/api/ca/export?annee=${state.caYear}`, '_blank');
}

// ═════════════════════════════════════════════════════
//  SITES (onglet global, accordéon par client)
// ═════════════════════════════════════════════════════
async function loadSitesGlobal() {
  const list = document.getElementById('sites-global-list');
  if (!list.children.length) list.innerHTML = [1, 2, 3].map(() => '<div class="card acc"><div class="acc-head"><div class="skeleton" style="height:30px;width:40%"></div></div></div>').join('');
  const clients = await api('/api/clients-sites') || [];
  const empty = document.getElementById('sites-global-empty');

  if (!clients.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = clients.map(c => {
    const isOpen = state.sitesOpen.has(c.id);
    return `
    <div class="card acc${isOpen ? ' open' : ''}">
      <div class="acc-head" onclick="toggleSitesGlobal(${c.id})">
        <span class="acc-chevron">${ic('chevron')}</span>
        ${clientAvatar(c, 'sm')}
        <span class="acc-title">${esc(c.societe)}</span>
        <span class="pill pill-neutral">${c.sites.length} site${c.sites.length > 1 ? 's' : ''}</span>
      </div>
      ${isOpen ? `
        <div class="acc-body"><table class="table">
          <thead><tr><th>Site</th><th>Code</th><th>Adresse</th></tr></thead>
          <tbody>
            ${c.sites.map(s => `
              <tr onclick="openClient(${c.id})">
                <td><strong>${esc(s.nom_site)}</strong></td>
                <td>${s.code_site ? `<span class="segment-badge">${esc(s.code_site)}</span>` : dash()}</td>
                <td>${esc(s.adresse_site) || dash()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      ` : ''}
    </div>
  `;
  }).join('');
}

function toggleSitesGlobal(clientId) {
  if (state.sitesOpen.has(clientId)) state.sitesOpen.delete(clientId);
  else state.sitesOpen.add(clientId);
  loadSitesGlobal();
}

// ═════════════════════════════════════════════════════
//  CARTE DES CLIENTS
// ═════════════════════════════════════════════════════
let carteClientsMap = null;
let carteTiles = null;
let carteClientsMarkers = [];

// ─── Région Occitanie : contour + voile léger sur le reste de la carte ───
let occitanieLayer = null;
let occitanieMask = null;

async function drawOccitanie() {
  const geo = await fetch('/assets/occitanie.geojson').then(r => r.json()).catch(() => null);
  if (!geo || !carteClientsMap) return;
  const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
  const holes = geo.features[0].geometry.coordinates.map(poly => poly[0].map(([lng, lat]) => [lat, lng]));
  occitanieMask = L.polygon([world, ...holes], { pane: 'region', stroke: false, interactive: false }).addTo(carteClientsMap);
  occitanieLayer = L.geoJSON(geo, { pane: 'region', interactive: false }).addTo(carteClientsMap);
  styleOccitanie();
  if (state.mapView !== 'france') carteClientsMap.fitBounds(occitanieLayer.getBounds(), { padding: [24, 24] });
}

function styleOccitanie() {
  if (!occitanieLayer) return;
  const dark = currentTheme() === 'dark';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  occitanieLayer.setStyle({ color: accent, weight: 2.5, opacity: .95, fillColor: accent, fillOpacity: dark ? .07 : .06 });
  occitanieMask.setStyle({ fillColor: dark ? '#000' : '#1B2233', fillOpacity: dark ? .35 : .10 });
}

function setMapView(view) {
  state.mapView = view;
  document.getElementById('map-view-occitanie').classList.toggle('active', view !== 'france');
  document.getElementById('map-view-france').classList.toggle('active', view === 'france');
  if (!carteClientsMap) return;
  if (view === 'france') carteClientsMap.flyTo([46.6, 2.5], 6, { duration: .8 });
  else if (occitanieLayer) carteClientsMap.flyToBounds(occitanieLayer.getBounds(), { padding: [24, 24], duration: .8 });
}

// Fond OpenStreetMap (sans clé) ; le mode sombre est obtenu par un filtre CSS sur les tuiles
function updateMapTiles() {
  if (!carteClientsMap) return;
  if (!carteTiles) {
    carteTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19
    }).addTo(carteClientsMap);
  }
  styleOccitanie();
  if (state.page === 'carte') loadCarteClients();
}

async function loadCarteClients() {
  if (typeof L === 'undefined') return;
  const clients = await api('/api/clients-map') || [];

  if (!carteClientsMap) {
    carteClientsMap = L.map('carte-clients-map').setView([43.7, 2.2], 7);
    carteClientsMap.createPane('region').style.zIndex = 350; // sous les marqueurs
    updateMapTiles();
    drawOccitanie();
  }

  carteClientsMarkers.forEach(m => carteClientsMap.removeLayer(m));
  carteClientsMarkers = [];
  const css = getComputedStyle(document.documentElement);
  const colors = { Régulier: css.getPropertyValue('--series-1').trim(), Occasionnel: css.getPropertyValue('--series-2').trim() };
  const ring = css.getPropertyValue('--card').trim();

  clients.forEach(c => {
    const color = colors[c.type_client] || colors.Régulier;
    const marker = L.circleMarker([c.latitude, c.longitude], {
      radius: 8, color: ring, fillColor: color, fillOpacity: 0.95, weight: 2.5
    }).addTo(carteClientsMap);
    marker.bindPopup(`
      <strong>${esc(c.societe)}</strong><br>
      ${c.code_client ? `Code : ${esc(c.code_client)}<br>` : ''}
      ${[c.adresse, c.ville].filter(Boolean).map(esc).join(', ')}<br>
      ${c.categorie_client ? `<em>${esc(c.categorie_client)}</em><br>` : ''}
      <em>${c.type_client === 'Occasionnel' ? 'Occasionnel' : 'Régulier'}</em><br>
      <a href="#/client/${c.id}">Ouvrir la fiche →</a>
    `);
    carteClientsMarkers.push(marker);
  });

  setTimeout(() => carteClientsMap.invalidateSize(), 100);
}

// ═════════════════════════════════════════════════════
//  RECHERCHE RAPIDE (Ctrl+K / ⌘K)
// ═════════════════════════════════════════════════════
const palette = { items: [], index: 0, seq: 0 };

function setupPalette() {
  const input = document.getElementById('palette-input');
  input.addEventListener('input', debounce(() => searchPalette(input.value.trim()), 120));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.index); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
}

function openPalette() {
  const overlay = document.getElementById('palette-overlay');
  overlay.classList.add('open');
  const input = document.getElementById('palette-input');
  input.value = '';
  renderPaletteItems(defaultPaletteItems(), '');
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  document.getElementById('palette-overlay').classList.remove('open');
}

function defaultPaletteItems() {
  const nav = (icon, title, hash) => ({ group: 'Aller à', icon, title, run: () => go(hash) });
  return [
    { group: 'Actions', icon: 'plus', title: 'Nouveau client', run: () => openClientModal() },
    { group: 'Actions', icon: 'book', title: "Saisir un chiffre d'affaires", run: () => openCaEntryDialog(state.page === 'client' ? state.clientId : null) },
    { group: 'Actions', icon: currentTheme() === 'dark' ? 'sun' : 'moon', title: currentTheme() === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre', run: toggleTheme },
    nav('dashboard', 'Tableau de bord', '#/dashboard'),
    nav('building', 'Clients', '#/clients'),
    nav('book', "Chiffre d'affaires", '#/ca'),
    nav('pin', 'Sites', '#/sites'),
    nav('map', 'Carte des clients', '#/carte'),
  ];
}

async function searchPalette(q) {
  if (!q) return renderPaletteItems(defaultPaletteItems(), '');
  const seq = ++palette.seq;
  const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (!r || seq !== palette.seq) return;
  const items = [
    ...r.clients.map(c => ({ group: 'Clients', avatar: clientAvatar(c, 'sm'), title: c.societe,
      sub: [c.code_client, c.ville].filter(Boolean).join(' · '), badge: c.code_client, run: () => openClient(c.id) })),
    ...r.sites.map(s => ({ group: 'Sites', icon: 'pin', title: s.nom_site + (s.code_site ? ` (${s.code_site})` : ''),
      sub: s.societe, run: () => openClient(s.client_id) })),
    ...r.contacts.map(k => ({ group: 'Contacts', icon: 'users', title: k.nom,
      sub: [k.poste, k.societe].filter(Boolean).join(' · '), run: () => openClient(k.client_id) })),
  ];
  renderPaletteItems(items, q);
}

function renderPaletteItems(items, q) {
  palette.items = items;
  palette.index = 0;
  const el = document.getElementById('palette-results');
  if (!items.length) {
    el.innerHTML = `<div class="palette-empty">Aucun résultat pour « ${esc(q)} »</div>`;
    return;
  }
  let lastGroup = null;
  el.innerHTML = items.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="palette-group">${it.group}</div>` : '';
    lastGroup = it.group;
    return `${head}
      <div class="palette-item${i === 0 ? ' active' : ''}" data-i="${i}" onmousemove="setPaletteIndex(${i})" onclick="runPaletteItem(${i})">
        ${it.avatar || `<span class="palette-icon">${ic(it.icon)}</span>`}
        <div class="palette-text">
          <div class="palette-title">${highlight(it.title, q)}</div>
          ${it.sub ? `<div class="palette-sub">${highlight(it.sub, q)}</div>` : ''}
        </div>
        <span class="palette-enter">${ic('enter')}</span>
      </div>`;
  }).join('');
}

function setPaletteIndex(i) {
  if (palette.index === i) return;
  palette.index = i;
  document.querySelectorAll('.palette-item').forEach(n => n.classList.toggle('active', +n.dataset.i === i));
}

function movePalette(d) {
  if (!palette.items.length) return;
  setPaletteIndex((palette.index + d + palette.items.length) % palette.items.length);
  document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  it.run();
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

// ═════════════════════════════════════════════════════
//  BOÎTES DE DIALOGUE (remplacent confirm / prompt)
// ═════════════════════════════════════════════════════
const dialog = { resolve: null, opts: null };

function setupDialog() {
  document.getElementById('dialog-cancel').addEventListener('click', () => closeDialog(null));
  document.getElementById('dialog-ok').addEventListener('click', submitDialog);
  document.getElementById('dialog-form').addEventListener('submit', e => { e.preventDefault(); submitDialog(); });
  document.getElementById('dialog-overlay').addEventListener('mousedown', e => { if (e.target.id === 'dialog-overlay') closeDialog(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen('dialog-overlay')) { e.stopPropagation(); closeDialog(null); } }, true);
}

function uiDialog(opts) {
  flushPendingDelete();
  dialog.opts = opts;
  const danger = !!opts.danger;
  document.getElementById('dialog-title').textContent = opts.title || '';
  document.getElementById('dialog-message').textContent = opts.message || '';
  document.getElementById('dialog-icon').className = 'dialog-icon' + (danger ? ' danger' : '');
  document.getElementById('dialog-icon').innerHTML = ic(opts.icon || (danger ? 'trash' : 'info'), '');
  document.getElementById('dialog-error').textContent = '';
  const ok = document.getElementById('dialog-ok');
  ok.textContent = opts.okText || 'Valider';
  ok.className = danger ? 'btn-danger solid' : 'btn-primary';
  ok.disabled = false;
  document.getElementById('dialog-cancel').textContent = opts.cancelText || 'Annuler';

  const form = document.getElementById('dialog-form');
  form.innerHTML = (opts.fields || []).map(f => {
    const attrs = `name="${f.name}" id="dlg-${f.name}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}`;
    const input = f.type === 'select'
      ? `<select ${attrs}>${f.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : `<input type="${f.type || 'text'}" ${attrs} value="${esc(f.value ?? '')}">`;
    return `<div class="form-group"><label for="dlg-${f.name}">${esc(f.label)}</label>${input}</div>`;
  }).join('') + '<button type="submit" hidden></button>';
  form.style.display = opts.fields && opts.fields.length ? '' : 'none';

  document.getElementById('dialog-overlay').classList.add('open');
  setTimeout(() => (form.querySelector('input, select') || ok).focus(), 50);
  return new Promise(resolve => { dialog.resolve = resolve; });
}

function uiConfirm(opts) {
  return uiDialog(opts).then(v => v !== null);
}

async function submitDialog() {
  const values = formValues(document.getElementById('dialog-form'));
  if (dialog.opts.validate) {
    const ok = document.getElementById('dialog-ok');
    ok.disabled = true;
    const err = await dialog.opts.validate(values);
    ok.disabled = false;
    if (err) {
      const el = document.getElementById('dialog-error');
      el.textContent = err;
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      return;
    }
  }
  closeDialog(values);
}

function closeDialog(values) {
  const overlay = document.getElementById('dialog-overlay');
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('open', 'closing'), 160);
  const r = dialog.resolve;
  dialog.resolve = null;
  r && r(values);
}

// ═════════════════════════════════════════════════════
//  SUPPRESSION AVEC « ANNULER »
// ═════════════════════════════════════════════════════
let pendingDelete = null;

function deleteWithUndo({ key, url, message, rerender, after }) {
  flushPendingDelete();
  state.pendingKeys.add(key);
  rerender && rerender();
  const p = { key, url, after };
  p.timer = setTimeout(() => commitDelete(p), 5000);
  pendingDelete = p;
  toast(message, {
    action: 'Annuler', duration: 5000,
    onAction: () => {
      clearTimeout(p.timer);
      if (pendingDelete === p) pendingDelete = null;
      state.pendingKeys.delete(key);
      rerender && rerender();
      toast('Suppression annulée');
    }
  });
}

async function commitDelete(p) {
  if (pendingDelete === p) pendingDelete = null;
  await api(p.url, { method: 'DELETE' });
  state.pendingKeys.delete(p.key);
  p.after && p.after();
}

function flushPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  commitDelete(pendingDelete);
}

function flushPendingDeleteOnExit() {
  if (!pendingDelete) return;
  fetch(API + pendingDelete.url, { method: 'DELETE', keepalive: true });
  pendingDelete = null;
}

function isPending(kind, id) { return state.pendingKeys.has(`${kind}:${id}`); }

// ═════════════════════════════════════════════════════
//  UTILITAIRES
// ═════════════════════════════════════════════════════
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function ic(name, cls = 'i-sm') {
  return `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
}

function dash() { return '<span class="muted">—</span>'; }

function delBtn(onclick) {
  return `<button type="button" class="activite-del" onclick="event.stopPropagation(); ${onclick}" title="Supprimer">${ic('trash')}</button>`;
}

function emptyBlock(icon, text, extra = '') {
  return `<div class="empty-state"><div class="empty-icon">${ic(icon, 'i-lg')}</div><p>${text}</p>${extra}</div>`;
}

function skeletonRows(n, cols) {
  return Array.from({ length: n }, () =>
    `<tr class="skeleton-row">${Array.from({ length: cols }, (_, i) =>
      `<td><div class="skeleton" style="width:${i === 0 ? 70 : 40 + Math.random() * 40}%"></div></td>`).join('')}</tr>`).join('');
}

function skeletonList(n) {
  return Array.from({ length: n }, () => `
    <div class="list-row skeleton-row">
      <div class="skeleton" style="width:36px;height:36px;border-radius:10px"></div>
      <div class="list-main"><div class="skeleton" style="width:60%"></div><div class="skeleton mt8" style="width:35%;height:10px"></div></div>
    </div>`).join('');
}

function clientPageSkeleton() {
  return `
    <div class="skeleton" style="width:80px;height:14px;margin-bottom:18px"></div>
    <div class="card client-hero">
      <div class="hero-main">
        <div class="skeleton" style="width:72px;height:72px;border-radius:18px"></div>
        <div class="hero-id" style="flex:1"><div class="skeleton" style="width:40%;height:26px"></div><div class="skeleton mt12" style="width:25%"></div></div>
      </div>
      <div class="hero-stats">${[1, 2, 3, 4].map(() => '<div class="hero-stat"><div class="skeleton" style="width:60%;height:10px"></div><div class="skeleton mt8" style="width:80%"></div></div>').join('')}</div>
    </div>
    <div class="client-grid">
      <div class="client-col"><div class="card"><div class="skeleton skeleton-chart"></div></div></div>
      <div class="client-col"><div class="card"><div class="skeleton" style="height:160px"></div></div></div>
    </div>`;
}

function formValues(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
  return out;
}

function initials(name) {
  return esc((name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase());
}

// Teinte douce, stable pour un même nom (6 teintes définies en CSS, claires et sombres)
function toneClass(name) {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `tone-${h % 6}`;
}

function clientAvatar(c, size = '') {
  if (c.logo_mime_type) {
    return `<span class="avatar logo ${size}"><img src="/api/clients/${c.id}/logo" alt="" loading="lazy"></span>`;
  }
  return `<span class="avatar ${size} ${toneClass(c.societe)}">${initials(c.societe)}</span>`;
}

function statutPill(statut) {
  const tone = { 'Actif': 'pill-success', 'Suspendu': 'pill-warning', 'Terminé': 'pill-neutral' }[statut] || 'pill-neutral';
  return `<span class="pill pill-dot ${tone}">${esc(statut) || '—'}</span>`;
}

function typeClientPill(type) {
  return type === 'Occasionnel'
    ? `<span class="pill pill-accent">${ic('clipboard')}Occasionnel</span>`
    : `<span class="pill pill-info">${ic('shield')}Régulier</span>`;
}

function joursPill(j) {
  return `<span class="pill ${j <= 30 ? 'pill-danger' : j <= 60 ? 'pill-warning' : 'pill-neutral'}">${j === 0 ? "Aujourd'hui" : `J-${j}`}</span>`;
}

function daysUntil(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fin = new Date(d.length === 10 ? d + 'T00:00:00' : d); fin.setHours(0, 0, 0, 0);
  return Math.round((fin - today) / 86400000);
}

function timeAgo(d) {
  if (!d) return '';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `il y a ${Math.floor(diff / 86400)} j`;
  return formatDateShort(String(d).slice(0, 10));
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(d) {
  if (!d) return '—';
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Mois au format 'YYYY-MM'
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
function monthRange(start, n) { return Array.from({ length: n }, (_, i) => monthKey(addMonths(start, i))); }
function monthShort(key) { return MOIS_COURTS[parseInt(key.slice(5, 7)) - 1]; }
function monthLong(key) {
  const s = new Date(parseInt(key.slice(0, 4)), parseInt(key.slice(5, 7)) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtEUR(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtEURCompact(v) {
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${v} €`;
}
function fmtNum(v) { return Math.round(v).toLocaleString('fr-FR'); }
function fmtSize(o) { return o > 1048576 ? `${(o / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`; }

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer;
function toast(msg, opts = false) {
  if (typeof opts === 'boolean') opts = { error: opts };
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  const btn = document.getElementById('toast-action');
  if (opts.action) {
    btn.textContent = opts.action;
    btn.style.display = '';
    btn.onclick = () => { btn.onclick = null; opts.onAction(); };
  } else {
    btn.style.display = 'none';
    btn.onclick = null;
  }
  el.className = 'toast' + (opts.error ? ' error' : '');
  void el.offsetWidth; // relance l'animation
  el.classList.add('show');
  el.style.setProperty('--toast-dur', `${opts.duration || 3200}ms`);
  el.classList.toggle('timed', !!opts.action);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.duration || 3200);
}
