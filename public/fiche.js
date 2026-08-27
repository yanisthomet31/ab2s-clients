(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) return showError('Aucun client indiqué (paramètre "id" manquant dans le lien).');

  let data;
  try {
    const r = await fetch(`/api/clients/${id}`);
    if (r.status === 401) { window.location.href = '/login.html'; return; }
    if (!r.ok) return showError('Client introuvable.');
    data = await r.json();
  } catch (e) {
    return showError('Erreur de connexion au serveur.');
  }

  document.getElementById('toolbar-sub').textContent = data.societe;
  document.title = `Fiche client — ${data.societe}`;

  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById('doc-ref').textContent = data.code_client ? `Réf. ${data.code_client}` : `Éditée le ${today}`;
  document.getElementById('doc-date').textContent = `Fiche générée le ${today}`;

  document.getElementById('f-societe').textContent = data.societe || '';
  document.getElementById('f-code-client').textContent = data.code_client ? `CODE CLIENT — ${data.code_client}` : '';

  // Logo client
  if (data.logo_mime_type) {
    document.getElementById('identity-logo').innerHTML =
      `<img src="/api/clients/${id}/logo" alt="Logo ${data.societe}">`;
  } else {
    const initiales = (data.societe || '??').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    document.getElementById('identity-logo-fallback').textContent = initiales;
  }

  // Badges
  const pillType = document.getElementById('pill-type');
  pillType.textContent = data.type_client === 'Occasionnel' ? '📋 Occasionnel' : '🔒 Régulier';
  pillType.className = 'pill ' + (data.type_client === 'Occasionnel' ? 'pill-occasionnel' : 'pill-regulier');

  const pillStatut = document.getElementById('pill-statut');
  pillStatut.textContent = data.statut || 'Actif';
  pillStatut.className = 'pill ' + (data.statut === 'Suspendu' ? 'pill-suspendu' : data.statut === 'Terminé' ? 'pill-termine' : 'pill-actif');

  // Contact
  document.getElementById('f-contact-nom').textContent = data.contact_nom || '—';
  document.getElementById('f-adresse').textContent = [data.adresse, data.ville].filter(Boolean).join(', ') || '—';
  document.getElementById('f-telephone').textContent = data.contact_telephone || '—';
  document.getElementById('f-email').textContent = data.contact_email || '—';

  // Contrat
  document.getElementById('f-type-prestation').textContent = data.type_prestation || '—';
  document.getElementById('f-date-debut').textContent = data.date_debut_contrat ? formatDate(data.date_debut_contrat) : '—';
  document.getElementById('f-date-fin').textContent = data.tacite_reconduction
    ? '🔄 Tacite reconduction'
    : (data.date_fin_contrat ? formatDate(data.date_fin_contrat) : '—');
  document.getElementById('f-tarif').innerHTML = data.tarif
    ? `${Number(data.tarif).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € <span style="font-family:'Public Sans',sans-serif;font-weight:400;color:var(--ink3)">/ ${data.tarif_unite || 'mensuel'}</span>`
    : '—';
  document.getElementById('f-statut').textContent = data.statut || 'Actif';
  document.getElementById('f-type-client').textContent = data.type_client === 'Occasionnel' ? 'Occasionnel — sur devis' : 'Régulier — contrat fixe';

  // Sites & agents
  const sites = data.sites || [];
  if (!sites.length) {
    document.getElementById('section-sites').style.display = 'none';
  } else {
    document.getElementById('sites-tbody').innerHTML = sites.map(s => `
      <tr>
        <td>
          <div class="site-name">${esc(s.nom_site)}</div>
          ${s.code_site ? `<span class="site-code">${esc(s.code_site)}</span>` : ''}
        </td>
        <td>${esc(s.adresse_site || '—')}</td>
        <td>${(s.agents || []).map(a => `<span class="agent-tag">${esc(a.nom)}</span>`).join('') || '—'}</td>
      </tr>
    `).join('');
  }

  // Notes
  if (!data.notes) {
    document.getElementById('section-notes').style.display = 'none';
  } else {
    document.getElementById('f-notes').textContent = data.notes;
  }

  document.getElementById('sheet').style.display = '';
})();

function formatDate(d) {
  return new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showError(msg) {
  document.getElementById('toolbar').style.display = 'none';
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = '';
}
