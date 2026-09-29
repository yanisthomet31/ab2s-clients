/* ════════════════════════════════════════════════════════
   AB2S Sécurité — Base de données Clients — Frontend
════════════════════════════════════════════════════════ */

const API = window.location.origin;
let currentClientId = null;

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/me');
  if (!me || !me.nom) { window.location.href = '/login.html'; return; }
  document.getElementById('connected-as').textContent = me.nom;
  document.getElementById('user-avatar').textContent = me.nom.trim().charAt(0);
  const h = new Date().getHours();
  document.getElementById('dash-greeting').textContent = `${h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'} ${me.nom}`;
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) closeClientModal();
  });

  loadDashboard();
  loadClients();
});

async function logout() {
  await api('/api/logout', { method: 'POST', body: {} });
  window.location.href = '/login.html';
}

async function changePassword() {
  const ancien = prompt('Ancien mot de passe :');
  if (!ancien) return;
  const nouveau = prompt('Nouveau mot de passe (6 caractères minimum) :');
  if (!nouveau) return;
  const confirmation = prompt('Confirmez le nouveau mot de passe :');
  if (nouveau !== confirmation) { toast('Les mots de passe ne correspondent pas', true); return; }
  const r = await api('/api/change-password', { method: 'POST', body: { ancien, nouveau } });
  if (r && r.ok) toast('Mot de passe changé');
  else toast((r && r.error) || 'Erreur', true);
}

function exportCSV() {
  window.open(API + '/api/export/csv', '_blank');
}

// ─── Navigation ───────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');

  if (name === 'dashboard') loadDashboard();
  if (name === 'clients')   loadClients();
  if (name === 'sites')     loadSitesGlobal();
  if (name === 'carte')     loadCarteClients();
}

// ─── API helper ───────────────────────────────────────
async function api(path, opts = {}) {
  try {
    const r = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
    });
    if (r.status === 401) { window.location.href = '/login.html'; return null; }
    return r.json();
  } catch (e) {
    toast('Erreur de connexion au serveur', true);
    return null;
  }
}

// ─── DASHBOARD ────────────────────────────────────────
async function loadDashboard() {
  const [kpi, clients] = await Promise.all([api('/api/kpi'), api('/api/clients')]);
  if (kpi) {
    countUp('k-clients',   kpi.clients_actifs);
    countUp('k-sites',     kpi.sites);
    countUp('k-documents', kpi.documents);
    countUp('k-echeances', kpi.echeances_30j);
  }
  if (clients) renderDashLists(clients);
}

function countUp(id, target) {
  const el = document.getElementById(id);
  const from = parseInt(el.textContent) || 0;
  if (from === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }
  const start = performance.now(), dur = 700;
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDashLists(clients) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const echeances = clients
    .filter(c => c.date_fin_contrat && !c.tacite_reconduction && c.statut !== 'Terminé')
    .map(c => {
      const fin = new Date(c.date_fin_contrat); fin.setHours(0, 0, 0, 0);
      return { ...c, jours: Math.round((fin - today) / 86400000) };
    })
    .filter(c => c.jours >= 0 && c.jours <= 90)
    .sort((a, b) => a.jours - b.jours)
    .slice(0, 6);

  const elE = document.getElementById('dash-echeances');
  elE.innerHTML = echeances.length ? echeances.map((c, i) => `
    <div class="list-row" style="animation-delay:${i * 40}ms" onclick="openClientModal(${c.id})">
      ${clientAvatar(c)}
      <div class="list-main">
        <div class="list-title">${esc(c.societe)}</div>
        <div class="list-meta">Fin le ${formatDateShort(c.date_fin_contrat)}</div>
      </div>
      <span class="pill ${c.jours <= 30 ? 'pill-danger' : c.jours <= 60 ? 'pill-warning' : 'pill-neutral'}">
        ${c.jours === 0 ? "Aujourd'hui" : `J-${c.jours}`}
      </span>
    </div>
  `).join('') : emptyBlock('check', 'Aucune échéance dans les 90 jours');

  const elR = document.getElementById('dash-recents');
  const recents = clients.slice(0, 6);
  elR.innerHTML = recents.length ? recents.map((c, i) => `
    <div class="list-row" style="animation-delay:${i * 40}ms" onclick="openClientModal(${c.id})">
      ${clientAvatar(c)}
      <div class="list-main">
        <div class="list-title">${esc(c.societe)}</div>
        <div class="list-meta">${[c.ville, c.type_prestation].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <span class="list-meta">${timeAgo(c.updated_at)}</span>
      <span class="row-arrow"><svg class="i i-sm"><use href="#i-chevron"/></svg></span>
    </div>
  `).join('') : emptyBlock('building', 'Aucun client pour le moment');
}

// ─── CLIENTS ──────────────────────────────────────────
let currentTypeClientFilter = '';
function filterClientsType(type) {
  currentTypeClientFilter = type;
  document.getElementById('client-type-tous').classList.toggle('active', type === '');
  document.getElementById('client-type-regulier').classList.toggle('active', type === 'Régulier');
  document.getElementById('client-type-occasionnel').classList.toggle('active', type === 'Occasionnel');
  loadClients();
}

async function loadClients() {
  const params = new URLSearchParams();
  const s = document.getElementById('search-input').value;
  if (s) params.set('search', s);
  if (currentTypeClientFilter) params.set('type_client', currentTypeClientFilter);

  const data = await api('/api/clients?' + params);
  if (!data) return;

  document.getElementById('clients-count').textContent = `${data.length} client${data.length > 1 ? 's' : ''}`;
  const tbody = document.getElementById('clients-body');
  const empty = document.getElementById('clients-empty');

  if (!data.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = data.map((c, i) => `
    <tr onclick="openClientModal(${c.id})" style="animation-delay:${Math.min(i, 15) * 25}ms">
      <td>
        <div class="cell-client">
          ${clientAvatar(c, 'sm')}
          <div><strong>${esc(c.societe)}</strong>${c.code_client ? `<div class="cell-sub">${esc(c.code_client)}</div>` : ''}</div>
        </div>
      </td>
      <td>${typeClientPill(c.type_client)}</td>
      <td>${esc(c.categorie_client) || '<span class="muted">—</span>'}</td>
      <td>${esc(c.contact_nom) || '<span class="muted">—</span>'}</td>
      <td>${esc(c.ville) || '<span class="muted">—</span>'}</td>
      <td>${esc(c.type_prestation) || '<span class="muted">—</span>'}</td>
      <td>${statutPill(c.statut)}</td>
      <td>${c.tacite_reconduction
        ? `<span class="pill pill-info">${ic('refresh')}Tacite</span>`
        : (c.date_fin_contrat ? formatDateShort(c.date_fin_contrat) : '<span class="muted">—</span>')}</td>
    </tr>
  `).join('');
}

// ─── MODAL CLIENT ─────────────────────────────────────
async function openClientModal(id = null) {
  currentClientId = id;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('btn-delete').style.display = id ? '' : 'none';
  document.getElementById('btn-fiche-pdf').style.display = id ? '' : 'none';
  switchModalTab('infos', document.querySelector('.modal-tab'));

  if (id) {
    document.getElementById('modal-title').textContent = 'Fiche client';
    const data = await api(`/api/clients/${id}`);
    if (!data) return;

    document.getElementById('f-id').value               = data.id;
    document.getElementById('f-societe').value          = data.societe || '';
    document.getElementById('f-code-client').value       = data.code_client || '';
    document.getElementById('f-type-prestation').value   = data.type_prestation || 'Gardiennage';
    document.getElementById('f-type-client').value        = data.type_client || 'Régulier';
    document.getElementById('f-categorie-client').value   = data.categorie_client || 'Autres';
    document.getElementById('f-adresse').value           = data.adresse || '';
    document.getElementById('f-ville').value             = data.ville || '';
    document.getElementById('f-siret').value             = data.siret || '';
    document.getElementById('f-tva').value               = data.tva || '';
    document.getElementById('f-capital-social').value    = data.capital_social || '';
    document.getElementById('f-site-web').value          = data.site_web || '';
    document.getElementById('f-contact-nom').value       = data.contact_nom || '';
    document.getElementById('f-contact-telephone').value = data.contact_telephone || '';
    document.getElementById('f-contact-email').value     = data.contact_email || '';
    document.getElementById('f-date-debut').value        = data.date_debut_contrat ? data.date_debut_contrat.slice(0,10) : '';
    document.getElementById('f-date-fin').value          = data.date_fin_contrat ? data.date_fin_contrat.slice(0,10) : '';
    document.getElementById('f-tacite-reconduction').checked = !!data.tacite_reconduction;
    toggleTaciteReconduction();
    document.getElementById('f-statut').value            = data.statut || 'Actif';
    document.getElementById('f-tarif').value             = data.tarif || '';
    document.getElementById('f-tarif-unite').value       = data.tarif_unite || 'mensuel';
    document.getElementById('f-notes').value             = data.notes || '';

    renderSites(data.sites || []);
    renderDocuments(data.documents || []);
    renderHistorique(data.historique || []);
    renderContacts(data.contacts || []);
    renderTarifs(data.tarifs || []);
    showClientLogoPreview(data.logo_mime_type ? id : null);
  } else {
    document.getElementById('modal-title').textContent = 'Nouveau client';
    document.getElementById('client-form').reset();
    document.getElementById('f-id').value = '';
    document.getElementById('f-statut').value = 'Actif';
    document.getElementById('f-type-client').value = 'Régulier';
    document.getElementById('f-categorie-client').value = 'Autres';
    toggleTaciteReconduction();
    showClientLogoPreview(null);
    document.getElementById('sites-list').innerHTML = emptyBlock('pin', 'Enregistrez le client pour ajouter des sites');
    document.getElementById('documents-list').innerHTML = emptyBlock('file', 'Enregistrez le client pour ajouter des documents');
    document.getElementById('historique-list').innerHTML = emptyBlock('history', 'Enregistrez le client pour ajouter un historique');
    document.getElementById('contacts-list').innerHTML = emptyBlock('users', 'Enregistrez le client pour ajouter des contacts');
    document.getElementById('tarifs-list').innerHTML = emptyBlock('euro', 'Enregistrez le client pour ajouter des tarifs');
  }
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
  if (!currentClientId) { toast('Enregistrez d\'abord le client avant d\'ajouter un logo', true); return; }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const r = await fetch(`${API}/api/clients/${currentClientId}/logo`, { method: 'POST', body: formData });
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  fileInput.value = '';
  showClientLogoPreview(currentClientId);
  toast('Logo mis à jour');
}

async function removeClientLogo() {
  if (!currentClientId) { document.getElementById('f-logo-file').value = ''; showClientLogoPreview(null); return; }
  if (!confirm('Supprimer le logo de ce client ?')) return;
  await api(`/api/clients/${currentClientId}/logo`, { method: 'DELETE' });
  showClientLogoPreview(null);
  toast('Logo supprimé');
}

function toggleTaciteReconduction() {
  const checked = document.getElementById('f-tacite-reconduction').checked;
  const dateFin = document.getElementById('f-date-fin');
  dateFin.disabled = checked;
  if (checked) dateFin.value = '';
}

function closeClientModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('open', 'closing'), 180);
  currentClientId = null;
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeClientModal();
}

function switchModalTab(name, btn) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-tab-content').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelector('.modal-tab').classList.add('active');
  document.getElementById('mtab-' + name).classList.add('active');
}

async function saveClient() {
  const body = {
    societe:            document.getElementById('f-societe').value.trim(),
    code_client:        document.getElementById('f-code-client').value.trim(),
    type_prestation:    document.getElementById('f-type-prestation').value,
    categorie_client:   document.getElementById('f-categorie-client').value,
    type_client:        document.getElementById('f-type-client').value,
    adresse:            document.getElementById('f-adresse').value.trim(),
    ville:              document.getElementById('f-ville').value.trim(),
    siret:              document.getElementById('f-siret').value.trim(),
    tva:                document.getElementById('f-tva').value.trim(),
    capital_social:     document.getElementById('f-capital-social').value.trim(),
    site_web:           document.getElementById('f-site-web').value.trim(),
    contact_nom:        document.getElementById('f-contact-nom').value.trim(),
    contact_telephone:  document.getElementById('f-contact-telephone').value.trim(),
    contact_email:      document.getElementById('f-contact-email').value.trim(),
    date_debut_contrat: document.getElementById('f-date-debut').value || null,
    date_fin_contrat:   document.getElementById('f-date-fin').value || null,
    tacite_reconduction: document.getElementById('f-tacite-reconduction').checked,
    statut:             document.getElementById('f-statut').value,
    tarif:              parseFloat(document.getElementById('f-tarif').value) || 0,
    tarif_unite:        document.getElementById('f-tarif-unite').value,
    notes:              document.getElementById('f-notes').value.trim(),
  };
  if (!body.societe) { toast('Le nom de la société est obligatoire', true); return; }

  const dup = await api(`/api/clients/check-doublon?societe=${encodeURIComponent(body.societe)}${currentClientId ? '&exclude_id=' + currentClientId : ''}`);
  if (dup && dup.existe) {
    const noms = dup.correspondances.map(c => c.societe).join(', ');
    if (!confirm(`Une entreprise similaire existe déjà (${noms}). Créer/enregistrer quand même ?`)) return;
  }

  if (currentClientId) {
    await api(`/api/clients/${currentClientId}`, { method: 'PUT', body });
    toast('Client mis à jour');
  } else {
    const r = await api('/api/clients', { method: 'POST', body });
    if (r) {
      currentClientId = r.id;
      document.getElementById('btn-delete').style.display = '';
      document.getElementById('btn-fiche-pdf').style.display = '';
      document.getElementById('sites-list').innerHTML = '';
      document.getElementById('documents-list').innerHTML = '';
      document.getElementById('historique-list').innerHTML = '';
      renderSites([]); renderDocuments([]); renderHistorique([]);
    }
    toast('Client créé');
  }
  loadClients();
  loadDashboard();
}

function ouvrirFichePDF() {
  if (!currentClientId) return;
  window.open(`/fiche.html?id=${currentClientId}`, '_blank');
}

async function deleteClient() {
  if (!confirm('Supprimer ce client et toutes ses données (sites, documents, historique) ?')) return;
  await api(`/api/clients/${currentClientId}`, { method: 'DELETE' });
  toast('Client supprimé');
  closeClientModal();
  loadClients();
  loadDashboard();
}

// ─── CONTACTS (dans le modal) ──────────────────────────
function renderContacts(contacts) {
  const el = document.getElementById('contacts-list');
  if (!contacts.length) { el.innerHTML = emptyBlock('users', 'Aucun contact enregistré'); return; }
  el.innerHTML = contacts.map(c => `
    <div class="activite-item">
      <div class="avatar">${initials(c.nom)}</div>
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
      <span class="activite-del" onclick="deleteContact(${c.id})" title="Supprimer">${ic('trash')}</span>
    </div>
  `).join('');
}

async function addContact() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const nom = document.getElementById('new-contact-nom').value.trim();
  const poste = document.getElementById('new-contact-poste').value.trim();
  const telephone = document.getElementById('new-contact-telephone').value.trim();
  const email = document.getElementById('new-contact-email').value.trim();
  if (!nom) { toast('Nom du contact requis', true); return; }
  await api(`/api/clients/${currentClientId}/contacts`, { method: 'POST', body: { nom, poste, telephone, email } });
  document.getElementById('new-contact-nom').value = '';
  document.getElementById('new-contact-poste').value = '';
  document.getElementById('new-contact-telephone').value = '';
  document.getElementById('new-contact-email').value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderContacts(data.contacts || []);
  toast('Contact ajouté');
}

async function deleteContact(id) {
  if (!confirm('Supprimer ce contact ?')) return;
  await api(`/api/contacts/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderContacts(data.contacts || []);
}

// ─── SITES (dans le modal) ─────────────────────────────
function renderSites(sites) {
  const el = document.getElementById('sites-list');
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
      <span class="activite-del" onclick="deleteSite(${s.id})" title="Supprimer">${ic('trash')}</span>
    </div>
  `).join('');
}

async function addSite() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const nom_site = document.getElementById('new-site-nom').value.trim();
  const code_site = document.getElementById('new-site-code').value.trim();
  const adresse_site = document.getElementById('new-site-adresse').value.trim();
  if (!nom_site) { toast('Nom du site requis', true); return; }
  await api(`/api/clients/${currentClientId}/sites`, { method: 'POST', body: { nom_site, code_site, adresse_site } });
  document.getElementById('new-site-nom').value = '';
  document.getElementById('new-site-code').value = '';
  document.getElementById('new-site-adresse').value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
  loadDashboard();
  toast('Site ajouté');
}

async function deleteSite(id) {
  if (!confirm('Supprimer ce site ?')) return;
  await api(`/api/sites/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
  loadDashboard();
}

// ─── SITES (onglet global, accordéon par client) ──────
let sitesGlobalOpen = new Set();
async function loadSitesGlobal() {
  const clients = await api('/api/clients-sites') || [];
  const list = document.getElementById('sites-global-list');
  const empty = document.getElementById('sites-global-empty');

  if (!clients.length) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = clients.map(c => {
    const isOpen = sitesGlobalOpen.has(c.id);
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
              <tr onclick="openClientModal(${c.id})">
                <td><strong>${esc(s.nom_site)}</strong></td>
                <td>${s.code_site ? `<span class="segment-badge">${esc(s.code_site)}</span>` : '<span class="muted">—</span>'}</td>
                <td>${esc(s.adresse_site) || '<span class="muted">—</span>'}</td>
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
  if (sitesGlobalOpen.has(clientId)) sitesGlobalOpen.delete(clientId);
  else sitesGlobalOpen.add(clientId);
  loadSitesGlobal();
}

// ─── TARIFS (dans le modal) ────────────────────────────
function renderTarifs(tarifs) {
  const el = document.getElementById('tarifs-list');
  if (!tarifs.length) { el.innerHTML = emptyBlock('euro', 'Aucun tarif enregistré'); return; }
  el.innerHTML = tarifs.map(t => `
    <div class="activite-item">
      <div class="activite-icon">${ic('euro')}</div>
      <div class="activite-body">
        <div class="activite-type">${esc(t.annee)}</div>
        <div class="activite-desc">${Number(t.taux_horaire).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € / heure</div>
      </div>
      <span class="activite-del" onclick="deleteTarif(${t.id})" title="Supprimer">${ic('trash')}</span>
    </div>
  `).join('');
}

async function addTarif() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const annee = document.getElementById('new-tarif-annee').value.trim();
  const taux_horaire = document.getElementById('new-tarif-taux').value.trim();
  if (!annee || !taux_horaire) { toast('Année et taux horaire requis', true); return; }
  await api(`/api/clients/${currentClientId}/tarifs`, { method: 'POST', body: { annee, taux_horaire } });
  document.getElementById('new-tarif-annee').value = '';
  document.getElementById('new-tarif-taux').value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderTarifs(data.tarifs || []);
  toast('Tarif ajouté');
}

async function deleteTarif(id) {
  if (!confirm('Supprimer ce tarif ?')) return;
  await api(`/api/tarifs/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderTarifs(data.tarifs || []);
}

// ─── DOCUMENTS (dans le modal) ─────────────────────────
function renderDocuments(docs) {
  const el = document.getElementById('documents-list');
  if (!docs.length) { el.innerHTML = emptyBlock('file', 'Aucun document'); return; }
  const tones = { devis: 'pill-info', contrat: 'pill-success', facture: 'pill-accent', autre: 'pill-neutral' };
  el.innerHTML = docs.map(d => `
    <div class="activite-item">
      <div class="activite-icon">${ic('file')}</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${esc(d.nom_fichier)}</span>
          <span class="pill ${tones[d.type] || 'pill-neutral'}">${esc(d.type)}</span>
        </div>
        <div class="activite-desc">${formatDate(d.uploaded_at)}${d.uploaded_by ? ` · ${esc(d.uploaded_by)}` : ''} · ${(d.taille_octets/1024).toFixed(0)} Ko</div>
      </div>
      <a class="btn-ghost btn-sm" href="/api/documents/${d.id}/download" target="_blank" rel="noopener" title="Télécharger">${ic('download')}</a>
      <span class="activite-del" onclick="deleteDocument(${d.id})" title="Supprimer">${ic('trash')}</span>
    </div>
  `).join('');
}

async function uploadDocument() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const fileInput = document.getElementById('new-doc-file');
  const type = document.getElementById('new-doc-type').value;
  if (!fileInput.files.length) { toast('Choisissez un fichier', true); return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('type', type);

  const r = await fetch(`${API}/api/clients/${currentClientId}/documents`, { method: 'POST', body: formData });
  if (r.status === 401) { window.location.href = '/login.html'; return; }
  fileInput.value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderDocuments(data.documents || []);
  loadDashboard();
  toast('Document envoyé');
}

async function deleteDocument(id) {
  if (!confirm('Supprimer ce document ?')) return;
  await api(`/api/documents/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderDocuments(data.documents || []);
  loadDashboard();
}

// ─── HISTORIQUE (dans le modal) ────────────────────────
function renderHistorique(list) {
  const el = document.getElementById('historique-list');
  if (!list.length) { el.innerHTML = emptyBlock('history', 'Aucun historique'); return; }
  const histIcons = { 'Échange': 'message', 'Incident': 'alert', 'Renouvellement': 'refresh', 'Note': 'note' };
  el.innerHTML = list.map(h => `
    <div class="activite-item">
      <div class="activite-icon">${ic(histIcons[h.type] || 'note')}</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${esc(h.type)}</span>
          <span class="activite-date">${formatDate(h.date)}${h.auteur ? ` · ${esc(h.auteur)}` : ''}</span>
        </div>
        <div class="activite-desc">${esc(h.description)}</div>
      </div>
      <span class="activite-del" onclick="deleteHistorique(${h.id})" title="Supprimer">${ic('trash')}</span>
    </div>
  `).join('');
}

async function addHistorique() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const type = document.getElementById('new-hist-type').value;
  const description = document.getElementById('new-hist-desc').value.trim();
  if (!description) { toast('Décrivez l\'entrée', true); return; }
  await api('/api/historique', { method: 'POST', body: { client_id: currentClientId, type, description } });
  document.getElementById('new-hist-desc').value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderHistorique(data.historique || []);
  toast('Historique ajouté');
}

async function deleteHistorique(id) {
  await api(`/api/historique/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderHistorique(data.historique || []);
}

// ─── CARTE DES CLIENTS ──────────────────────────────────
let carteClientsMap = null;
let carteClientsMarkers = [];
async function loadCarteClients() {
  if (typeof L === 'undefined') return;
  const clients = await api('/api/clients-map') || [];

  if (!carteClientsMap) {
    carteClientsMap = L.map('carte-clients-map').setView([46.6, 2.5], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 18
    }).addTo(carteClientsMap);
  }

  carteClientsMarkers.forEach(m => carteClientsMap.removeLayer(m));
  carteClientsMarkers = [];

  clients.forEach(c => {
    const color = c.type_client === 'Occasionnel' ? '#E0915E' : '#3A4C96';
    const marker = L.circleMarker([c.latitude, c.longitude], {
      radius: 8, color: '#fff', fillColor: color, fillOpacity: 0.95, weight: 2.5
    }).addTo(carteClientsMap);
    marker.bindPopup(`
      <strong>${c.societe}</strong><br>
      ${c.code_client ? `Code : ${c.code_client}<br>` : ''}
      ${[c.adresse, c.ville].filter(Boolean).join(', ') || ''}<br>
      ${c.categorie_client ? `<em>${c.categorie_client}</em><br>` : ''}
      <em>${c.type_client === 'Occasionnel' ? 'Occasionnel' : 'Régulier'}</em><br>
      <a href="#" onclick="openClientModal(${c.id});return false;">Ouvrir la fiche →</a>
    `);
    carteClientsMarkers.push(marker);
  });

  setTimeout(() => carteClientsMap.invalidateSize(), 100);
}

// ─── UTILS ────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function ic(name, cls = 'i-sm') {
  return `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;
}

function emptyBlock(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${ic(icon, 'i-lg')}</div><p>${text}</p></div>`;
}

function initials(name) {
  return esc((name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase());
}

// Teintes douces, stables pour un même nom
const AVATAR_TONES = [
  ['#EEF1FA', '#3A4C96'], ['#FCF1E9', '#B96A3A'], ['#E7F1EF', '#4C7A73'],
  ['#F3EEF8', '#6E5A96'], ['#EAF0F8', '#4A6FA5'], ['#F6F0E4', '#8C6D2E']
];
function clientAvatar(c, size = '') {
  if (c.logo_mime_type) {
    return `<span class="avatar ${size}"><img src="/api/clients/${c.id}/logo" alt="" loading="lazy"></span>`;
  }
  const name = c.societe || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  return `<span class="avatar ${size}" style="background:${bg};color:${fg}">${initials(name)}</span>`;
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

let toastTimer;
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (err ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast', 3200);
}
