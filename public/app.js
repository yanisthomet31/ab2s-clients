/* ════════════════════════════════════════════════════════
   AB2S Sécurité — Base de données Clients — Frontend
════════════════════════════════════════════════════════ */

const API = window.location.origin;
let currentClientId = null;
let allAgents = [];

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/me');
  if (!me || !me.nom) { window.location.href = '/login.html'; return; }
  document.getElementById('connected-as').textContent = `Connecté : ${me.nom}`;

  loadAgents().then(() => {
    loadDashboard();
    loadClients();
  });
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
  if (r && r.ok) toast('Mot de passe changé ✔');
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
  if (name === 'agents')    renderAgentsTab();
  if (name === 'carte')     loadCarteSites();
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
  const kpi = await api('/api/kpi');
  if (!kpi) return;
  document.getElementById('k-clients').textContent   = kpi.clients_actifs;
  document.getElementById('k-sites').textContent      = kpi.sites;
  document.getElementById('k-agents').textContent     = kpi.agents;
  document.getElementById('k-documents').textContent  = kpi.documents;
  document.getElementById('k-echeances').textContent  = kpi.echeances_30j;
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
  tbody.innerHTML = data.map(c => `
    <tr onclick="openClientModal(${c.id})">
      <td><strong>${c.societe}</strong></td>
      <td><span class="segment-badge">${c.type_client === 'Occasionnel' ? '📋 Occasionnel' : '🔒 Régulier'}</span></td>
      <td>${c.contact_nom || '—'}</td>
      <td>${c.ville || '—'}</td>
      <td>${c.type_prestation || '—'}</td>
      <td><span class="etape-badge etape-${c.statut === 'Actif' ? 'Gagné' : c.statut === 'Suspendu' ? 'Négociation' : 'Perdu'}">${c.statut}</span></td>
      <td>${c.date_fin_contrat ? formatDateShort(c.date_fin_contrat) : '—'}</td>
    </tr>
  `).join('');
}

// ─── MODAL CLIENT ─────────────────────────────────────
async function openClientModal(id = null) {
  currentClientId = id;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('btn-delete').style.display = id ? '' : 'none';
  switchModalTab('infos', document.querySelector('.modal-tab'));

  if (id) {
    document.getElementById('modal-title').textContent = 'Fiche client';
    const data = await api(`/api/clients/${id}`);
    if (!data) return;

    document.getElementById('f-id').value               = data.id;
    document.getElementById('f-societe').value          = data.societe || '';
    document.getElementById('f-type-prestation').value   = data.type_prestation || 'Gardiennage';
    document.getElementById('f-type-client').value        = data.type_client || 'Régulier';
    document.getElementById('f-adresse').value           = data.adresse || '';
    document.getElementById('f-ville').value             = data.ville || '';
    document.getElementById('f-contact-nom').value       = data.contact_nom || '';
    document.getElementById('f-contact-telephone').value = data.contact_telephone || '';
    document.getElementById('f-contact-email').value     = data.contact_email || '';
    document.getElementById('f-date-debut').value        = data.date_debut_contrat ? data.date_debut_contrat.slice(0,10) : '';
    document.getElementById('f-date-fin').value          = data.date_fin_contrat ? data.date_fin_contrat.slice(0,10) : '';
    document.getElementById('f-statut').value            = data.statut || 'Actif';
    document.getElementById('f-tarif').value             = data.tarif || '';
    document.getElementById('f-tarif-unite').value       = data.tarif_unite || 'mensuel';
    document.getElementById('f-notes').value             = data.notes || '';

    renderSites(data.sites || []);
    renderDocuments(data.documents || []);
    renderHistorique(data.historique || []);
  } else {
    document.getElementById('modal-title').textContent = 'Nouveau client';
    document.getElementById('client-form').reset();
    document.getElementById('f-id').value = '';
    document.getElementById('f-statut').value = 'Actif';
    document.getElementById('f-type-client').value = 'Régulier';
    document.getElementById('sites-list').innerHTML = '<div class="empty-state">Enregistrez le client pour ajouter des sites</div>';
    document.getElementById('documents-list').innerHTML = '<div class="empty-state">Enregistrez le client pour ajouter des documents</div>';
    document.getElementById('historique-list').innerHTML = '<div class="empty-state">Enregistrez le client pour ajouter un historique</div>';
  }
}

function closeClientModal() {
  document.getElementById('modal-overlay').classList.remove('open');
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
    type_prestation:    document.getElementById('f-type-prestation').value,
    type_client:        document.getElementById('f-type-client').value,
    adresse:            document.getElementById('f-adresse').value.trim(),
    ville:              document.getElementById('f-ville').value.trim(),
    contact_nom:        document.getElementById('f-contact-nom').value.trim(),
    contact_telephone:  document.getElementById('f-contact-telephone').value.trim(),
    contact_email:      document.getElementById('f-contact-email').value.trim(),
    date_debut_contrat: document.getElementById('f-date-debut').value || null,
    date_fin_contrat:   document.getElementById('f-date-fin').value || null,
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
    toast('Client mis à jour ✔');
  } else {
    const r = await api('/api/clients', { method: 'POST', body });
    if (r) {
      currentClientId = r.id;
      document.getElementById('btn-delete').style.display = '';
      document.getElementById('sites-list').innerHTML = '';
      document.getElementById('documents-list').innerHTML = '';
      document.getElementById('historique-list').innerHTML = '';
      renderSites([]); renderDocuments([]); renderHistorique([]);
    }
    toast('Client créé ✔');
  }
  loadClients();
  loadDashboard();
}

async function deleteClient() {
  if (!confirm('Supprimer ce client et toutes ses données (sites, documents, historique) ?')) return;
  await api(`/api/clients/${currentClientId}`, { method: 'DELETE' });
  toast('Client supprimé');
  closeClientModal();
  loadClients();
  loadDashboard();
}

// ─── SITES & AGENTS (dans le modal) ───────────────────
function renderSites(sites) {
  const el = document.getElementById('sites-list');
  if (!sites.length) { el.innerHTML = '<div style="color:var(--text2);text-align:center;padding:24px">Aucun site enregistré</div>'; return; }

  const agentOptions = allAgents.map(a => `<option value="${a.id}">${a.nom}</option>`).join('');

  el.innerHTML = sites.map(s => `
    <div class="activite-item">
      <div class="activite-body" style="width:100%">
        <div class="activite-top">
          <span class="activite-type">${s.nom_site}</span>
          <span class="activite-auteur">${s.adresse_site || ''}</span>
        </div>
        <div class="activite-desc" style="margin-top:8px">
          ${(s.agents || []).map(a => `
            <span class="segment-badge" style="margin:2px 6px 2px 0">
              👤 ${a.nom} <span style="cursor:pointer" onclick="removeAgentFromSite(${s.id},${a.id})">✕</span>
            </span>
          `).join('') || '<span style="color:var(--text2);font-size:12px">Aucun agent affecté</span>'}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <select id="site-agent-${s.id}" class="filter-select" style="max-width:180px">${agentOptions}</select>
          <button class="btn-ghost btn-sm" onclick="assignAgentToSite(${s.id})">+ Affecter</button>
        </div>
      </div>
      <span class="activite-del" onclick="deleteSite(${s.id})">✕</span>
    </div>
  `).join('');
}

async function addSite() {
  if (!currentClientId) { toast('Enregistrez d\'abord le client', true); return; }
  const nom_site = document.getElementById('new-site-nom').value.trim();
  const adresse_site = document.getElementById('new-site-adresse').value.trim();
  if (!nom_site) { toast('Nom du site requis', true); return; }
  await api(`/api/clients/${currentClientId}/sites`, { method: 'POST', body: { nom_site, adresse_site } });
  document.getElementById('new-site-nom').value = '';
  document.getElementById('new-site-adresse').value = '';
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
  loadDashboard();
  toast('Site ajouté ✔');
}

async function deleteSite(id) {
  if (!confirm('Supprimer ce site ?')) return;
  await api(`/api/sites/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
  loadDashboard();
}

async function assignAgentToSite(siteId) {
  const agentId = document.getElementById(`site-agent-${siteId}`).value;
  if (!agentId) return;
  await api(`/api/sites/${siteId}/agents/${agentId}`, { method: 'POST', body: {} });
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
}

async function removeAgentFromSite(siteId, agentId) {
  await api(`/api/sites/${siteId}/agents/${agentId}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderSites(data.sites || []);
}

// ─── AGENTS (onglet global) ────────────────────────────
async function loadAgents() {
  allAgents = await api('/api/agents') || [];
}

function renderAgentsTab() {
  const el = document.getElementById('agents-list');
  if (!allAgents.length) { el.innerHTML = '<div class="empty-state">Aucun agent enregistré</div>'; return; }
  el.innerHTML = allAgents.map(a => `
    <div class="activite-item">
      <div class="activite-body"><span class="activite-type">${a.nom}</span></div>
      <span class="activite-del" onclick="removeAgent(${a.id})">✕</span>
    </div>
  `).join('');
}

async function addAgent() {
  const nom = document.getElementById('new-agent-nom').value.trim();
  if (!nom) { toast('Nom requis', true); return; }
  await api('/api/agents', { method: 'POST', body: { nom } });
  document.getElementById('new-agent-nom').value = '';
  await loadAgents();
  renderAgentsTab();
  toast('Agent ajouté ✔');
}

async function removeAgent(id) {
  if (!confirm('Retirer cet agent de la liste ?')) return;
  await api(`/api/agents/${id}`, { method: 'DELETE' });
  await loadAgents();
  renderAgentsTab();
}

// ─── DOCUMENTS (dans le modal) ─────────────────────────
function renderDocuments(docs) {
  const el = document.getElementById('documents-list');
  if (!docs.length) { el.innerHTML = '<div style="color:var(--text2);text-align:center;padding:24px">Aucun document</div>'; return; }
  const icons = { devis: '📃', contrat: '📑', facture: '🧾', autre: '📄' };
  el.innerHTML = docs.map(d => `
    <div class="activite-item">
      <div class="activite-icon">${icons[d.type] || '📄'}</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${d.nom_fichier}</span>
          <span class="activite-date">${formatDate(d.uploaded_at)}</span>
          ${d.uploaded_by ? `<span class="activite-auteur">— ${d.uploaded_by}</span>` : ''}
        </div>
        <div class="activite-desc">${d.type} · ${(d.taille_octets/1024).toFixed(0)} Ko</div>
      </div>
      <a class="btn-ghost btn-sm" href="/api/documents/${d.id}/download" target="_blank" rel="noopener">⬇</a>
      <span class="activite-del" onclick="deleteDocument(${d.id})">✕</span>
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
  toast('Document envoyé ✔');
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
  if (!list.length) { el.innerHTML = '<div style="color:var(--text2);text-align:center;padding:24px">Aucun historique</div>'; return; }
  el.innerHTML = list.map(h => `
    <div class="activite-item">
      <div class="activite-icon">📝</div>
      <div class="activite-body">
        <div class="activite-top">
          <span class="activite-type">${h.type}</span>
          <span class="activite-date">${formatDate(h.date)}</span>
          ${h.auteur ? `<span class="activite-auteur">— ${h.auteur}</span>` : ''}
        </div>
        <div class="activite-desc">${h.description || ''}</div>
      </div>
      <span class="activite-del" onclick="deleteHistorique(${h.id})">✕</span>
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
  toast('Historique ajouté ✔');
}

async function deleteHistorique(id) {
  await api(`/api/historique/${id}`, { method: 'DELETE' });
  const data = await api(`/api/clients/${currentClientId}`);
  renderHistorique(data.historique || []);
}

// ─── CARTE DES SITES ───────────────────────────────────
let carteSitesMap = null;
let carteSitesMarkers = [];
async function loadCarteSites() {
  if (typeof L === 'undefined') return;
  const sites = await api('/api/sites-map') || [];

  if (!carteSitesMap) {
    carteSitesMap = L.map('carte-sites-map').setView([46.6, 2.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18
    }).addTo(carteSitesMap);
  }

  carteSitesMarkers.forEach(m => carteSitesMap.removeLayer(m));
  carteSitesMarkers = [];

  sites.forEach(s => {
    const color = s.type_client === 'Occasionnel' ? '#F57C00' : '#1565C0';
    const marker = L.circleMarker([s.latitude, s.longitude], {
      radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 2
    }).addTo(carteSitesMap);
    marker.bindPopup(`
      <strong>${s.societe}</strong><br>
      ${s.nom_site}<br>
      ${s.adresse_site || ''}<br>
      <em>${s.type_client === 'Occasionnel' ? '📋 Occasionnel' : '🔒 Régulier'}</em><br>
      <a href="#" onclick="showTab('clients');openClientModal(${s.client_id});return false;">Ouvrir la fiche →</a>
    `);
    carteSitesMarkers.push(marker);
  });

  setTimeout(() => carteSitesMap.invalidateSize(), 100);
}

// ─── UTILS ────────────────────────────────────────────
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
