(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) return showError('Aucun client indiqué (paramètre "id" manquant dans le lien).');
  document.getElementById('btn-back').href = `/#/client/${encodeURIComponent(id)}`;

  let data;
  try {
    const r = await fetch(`/api/clients/${id}`);
    if (r.status === 401) { window.location.href = '/login.html'; return; }
    if (!r.ok) return showError('Client introuvable.');
    data = await r.json();
  } catch (e) {
    return showError('Erreur de connexion au serveur.');
  }

  const set = (elId, v) => { document.getElementById(elId).textContent = v || '—'; };

  document.getElementById('toolbar-sub').textContent = data.societe;
  document.title = `Fiche client — ${data.societe}`;

  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById('doc-ref').textContent = data.code_client ? `Réf. ${data.code_client}` : `Éditée le ${today}`;
  document.getElementById('doc-date').textContent = `Fiche générée le ${today}`;

  document.getElementById('f-societe').textContent = data.societe || '';
  document.getElementById('f-code-client').textContent = data.code_client || '';

  // Logo client
  if (data.logo_mime_type) {
    document.getElementById('identity-logo').innerHTML = `<img src="/api/clients/${id}/logo" alt="Logo ${esc(data.societe)}">`;
  } else {
    const initiales = (data.societe || '??').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    document.getElementById('identity-logo-fallback').textContent = initiales;
  }

  // Pastilles
  const pillStatut = document.getElementById('pill-statut');
  pillStatut.textContent = data.statut || 'Actif';
  pillStatut.classList.add(data.statut === 'Suspendu' ? 'pill-suspendu' : data.statut === 'Terminé' ? 'pill-termine' : 'pill-actif');
  const pillType = document.getElementById('pill-type');
  pillType.textContent = data.type_client === 'Occasionnel' ? 'Occasionnel' : 'Régulier';
  pillType.classList.add(data.type_client === 'Occasionnel' ? 'pill-occasionnel' : 'pill-regulier');
  const pillCat = document.getElementById('pill-categorie');
  if (data.categorie_client) pillCat.textContent = data.categorie_client; else pillCat.remove();

  // Bandeau de synthèse
  const annee = new Date().getFullYear();
  const tarifs = [...(data.tarifs || [])].sort((a, b) => b.annee - a.annee);
  const ca = data.ca || [];
  set('s-debut', data.date_debut_contrat ? formatDate(data.date_debut_contrat) : '');
  set('s-fin', data.tacite_reconduction ? 'Tacite reconduction' : (data.date_fin_contrat ? formatDate(data.date_fin_contrat) : ''));
  if (tarifs.length) {
    document.getElementById('s-tarif-label').textContent = `Tarif horaire ${tarifs[0].annee}`;
    document.getElementById('s-tarif').innerHTML = `${eur(tarifs[0].taux_horaire, 2)} <small>/ h</small>`;
  } else if (Number(data.tarif)) {
    document.getElementById('s-tarif').innerHTML = `${eur(data.tarif)} <small>${esc(data.tarif_unite || '')}</small>`;
  } else set('s-tarif', '');
  document.getElementById('s-ca-label').textContent = `CA ${annee}`;
  set('s-ca', eur(ca.filter(e => e.mois.startsWith(String(annee))).reduce((s, e) => s + Number(e.montant), 0)));

  // Coordonnées
  set('f-contact-nom', data.contact_nom);
  set('f-adresse', [data.adresse, data.ville].filter(Boolean).join(', '));
  set('f-telephone', data.contact_telephone);
  set('f-email', data.contact_email);

  // Informations légales et contrat
  set('f-siret', data.siret);
  set('f-tva', data.tva);
  set('f-capital-social', data.capital_social);
  set('f-site-web', data.site_web);
  set('f-type-prestation', data.type_prestation);
  set('f-type-client', data.type_client === 'Occasionnel' ? 'Occasionnel — sur devis' : 'Régulier — contrat fixe');

  // Contacts
  const contacts = data.contacts || [];
  if (!contacts.length) {
    document.getElementById('section-contacts').style.display = 'none';
  } else {
    document.getElementById('contacts-tbody').innerHTML = contacts.map(c => `
      <tr>
        <td class="strong">${esc(c.nom)}</td>
        <td>${esc(c.poste) || '—'}</td>
        <td>${esc(c.telephone) || '—'}</td>
        <td>${esc(c.email) || '—'}</td>
      </tr>`).join('');
  }

  // Sites
  const sites = data.sites || [];
  if (!sites.length) {
    document.getElementById('section-sites').style.display = 'none';
  } else {
    document.getElementById('sites-tbody').innerHTML = sites.map(s => `
      <tr>
        <td><span class="strong">${esc(s.nom_site)}</span>${s.code_site ? `<span class="site-code">${esc(s.code_site)}</span>` : ''}</td>
        <td>${esc(s.adresse_site) || '—'}</td>
      </tr>`).join('');
  }

  // Tarifs (avec évolution) et CA par année
  if (tarifs.length) {
    document.getElementById('tarifs-tbody').innerHTML = tarifs.map((t, i) => {
      const prev = tarifs[i + 1];
      const evo = prev && Number(prev.taux_horaire) ? (t.taux_horaire - prev.taux_horaire) / prev.taux_horaire * 100 : null;
      return `<tr><td class="strong">${esc(t.annee)}</td><td class="num">${eur(t.taux_horaire, 2)} / h${evo !== null
        ? `<span class="evo ${evo >= 0 ? 'up' : 'down'}">${evo >= 0 ? '+' : ''}${evo.toFixed(1).replace('.', ',')} %</span>` : ''}</td></tr>`;
    }).join('');
  } else {
    document.getElementById('table-tarifs').style.display = 'none';
  }
  const parAnnee = {};
  ca.forEach(e => { const y = e.mois.slice(0, 4); parAnnee[y] = (parAnnee[y] || 0) + Number(e.montant); });
  const annees = Object.keys(parAnnee).sort().reverse().slice(0, 5);
  if (annees.length) {
    document.getElementById('ca-tbody').innerHTML = annees.map(y =>
      `<tr><td class="strong">${y}${y === String(annee) ? ' <span style="color:var(--ink3);font-weight:450">(en cours)</span>' : ''}</td><td class="num">${eur(parAnnee[y], 2)}</td></tr>`).join('');
  } else {
    document.getElementById('table-ca').style.display = 'none';
  }
  if (!tarifs.length && !annees.length) document.getElementById('section-finances').style.display = 'none';

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

function eur(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showError(msg) {
  document.getElementById('toolbar').style.display = 'none';
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = '';
}
