const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3739;
const upload = multer({ storage: multer.memoryStorage() });

app.set('trust proxy', 1); // Render (et tout proxy inverse) termine le HTTPS en amont — sans ça, cookie.secure ne voit jamais la requête comme sécurisée et le cookie de session n'est jamais envoyé.
app.use(cors());
app.use(express.json());

// ─── Base de données PostgreSQL ───────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000 // échoue vite plutôt que de bloquer indéfiniment si la base ne répond pas
});
pool.on('error', (err) => console.error('❌ Erreur inattendue du pool PostgreSQL:', err.message));

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// Géocodage gratuit (API officielle française, pas de clé nécessaire)
async function geocodeAdresse(adresse) {
  if (!adresse) return { latitude: null, longitude: null };
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    if (!r.ok) return { latitude: null, longitude: null };
    const data = await r.json();
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (!coords) return { latitude: null, longitude: null };
    return { latitude: coords[1], longitude: coords[0] };
  } catch (e) {
    console.error('❌ Erreur géocodage:', e.message);
    return { latitude: null, longitude: null };
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      societe TEXT NOT NULL,
      code_client TEXT,
      contact_nom TEXT, contact_telephone TEXT, contact_email TEXT,
      adresse TEXT, ville TEXT,
      type_prestation TEXT,
      type_client TEXT DEFAULT 'Régulier',
      date_debut_contrat DATE, date_fin_contrat DATE,
      tacite_reconduction BOOLEAN DEFAULT FALSE,
      tarif NUMERIC DEFAULT 0, tarif_unite TEXT DEFAULT 'mensuel',
      statut TEXT DEFAULT 'Actif',
      notes TEXT,
      logo_contenu BYTEA, logo_mime_type TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS type_client TEXT DEFAULT 'Régulier';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS tacite_reconduction BOOLEAN DEFAULT FALSE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS code_client TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_contenu BYTEA;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_mime_type TEXT;
    CREATE TABLE IF NOT EXISTS client_sites (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      nom_site TEXT NOT NULL,
      adresse_site TEXT,
      code_site TEXT,
      latitude NUMERIC, longitude NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS latitude NUMERIC;
    ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS longitude NUMERIC;
    ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS code_site TEXT;
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      actif BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS site_agents (
      site_id INTEGER REFERENCES client_sites(id) ON DELETE CASCADE,
      agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (site_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS client_documents (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      nom_fichier TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      contenu BYTEA NOT NULL,
      taille_octets INTEGER,
      uploaded_by TEXT,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS client_historique (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT, description TEXT, auteur TEXT,
      date TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
    INSERT INTO users (nom, username, password_hash) VALUES
      ('Adber', 'adber', '$2b$10$KKfOWgjkRW34yAgqeEbzouqq9y/TR1TsfpuWJNkmAmNRj5l/NAkTC'),
      ('Yanis', 'yanis', '$2b$10$m.mFTfPhAT4zQjHKvwsMgOtkDofJuPp03JJpdGJSV9G1Up1AfcfA2'),
      ('Samar', 'samar', '$2b$10$PnYV/obNFYaptJVhd95g7Og4acwvWMq1irLHDjnncKgdD28x21WdK')
    ON CONFLICT (username) DO NOTHING;
  `);
  console.log('✅ Base de données initialisée');
}

// ─── Session ───────────────────────────────────────────
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

// ─── Pages/assets accessibles sans session (page de connexion) ──
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.js')));

// ─── Auth ──────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE username=$1', [(username || '').toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  req.session.userId = user.id;
  req.session.nom = user.nom;
  res.json({ ok: true, nom: user.nom });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non authentifié' });
  return res.redirect('/login.html');
}
app.use(requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ nom: req.session.nom });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/change-password', async (req, res) => {
  const { ancien, nouveau } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(ancien || '', user.password_hash)) {
    return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
  }
  if (!nouveau || nouveau.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 6 caractères' });
  }
  const hash = bcrypt.hashSync(nouveau, 10);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
  res.json({ ok: true });
});

// ─── Static (protégé — servi après requireAuth) ───────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes Clients ────────────────────────────────────
// Colonnes sans le logo (BYTEA) — évite de le charger inutilement dans les listes
const CLIENT_COLUMNS = `id, societe, code_client, contact_nom, contact_telephone, contact_email,
  adresse, ville, type_prestation, type_client, date_debut_contrat, date_fin_contrat,
  tacite_reconduction, tarif, tarif_unite, statut, notes, logo_mime_type, created_at, updated_at`;

app.get('/api/clients', async (req, res) => {
  const { search, type_client } = req.query;
  let text = `SELECT ${CLIENT_COLUMNS} FROM clients WHERE 1=1`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    text += ` AND (societe ILIKE $${params.length} OR contact_nom ILIKE $${params.length} OR ville ILIKE $${params.length})`;
  }
  if (type_client) { params.push(type_client); text += ` AND type_client = $${params.length}`; }
  text += ' ORDER BY updated_at DESC';
  const { rows } = await query(text, params);
  res.json(rows);
});

app.get('/api/clients/check-doublon', async (req, res) => {
  const societe = (req.query.societe || '').trim();
  if (!societe) return res.json({ existe: false });
  const { rows } = await query(
    'SELECT id, societe FROM clients WHERE societe ILIKE $1 AND id != COALESCE($2::int, -1)',
    [`%${societe}%`, req.query.exclude_id || null]);
  res.json({ existe: rows.length > 0, correspondances: rows });
});

app.get('/api/clients/:id', async (req, res) => {
  const id = req.params.id;
  const [clientR, sitesR, docsR, histR] = await Promise.all([
    query(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id=$1`, [id]),
    query('SELECT * FROM client_sites WHERE client_id=$1 ORDER BY created_at', [id]),
    query('SELECT id, client_id, type, nom_fichier, mime_type, taille_octets, uploaded_by, uploaded_at FROM client_documents WHERE client_id=$1 ORDER BY uploaded_at DESC', [id]),
    query('SELECT * FROM client_historique WHERE client_id=$1 ORDER BY date DESC', [id])
  ]);
  if (!clientR.rows[0]) return res.status(404).json({ error: 'Introuvable' });

  const sites = sitesR.rows;
  for (const site of sites) {
    const { rows } = await query(
      `SELECT a.* FROM agents a JOIN site_agents sa ON sa.agent_id=a.id WHERE sa.site_id=$1 ORDER BY a.nom`,
      [site.id]);
    site.agents = rows;
  }

  res.json({ ...clientR.rows[0], sites, documents: docsR.rows, historique: histR.rows });
});

app.post('/api/clients', async (req, res) => {
  const f = req.body;
  const { rows } = await query(
    `INSERT INTO clients (societe,code_client,contact_nom,contact_telephone,contact_email,adresse,ville,type_prestation,
       type_client,date_debut_contrat,date_fin_contrat,tacite_reconduction,tarif,tarif_unite,statut,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [f.societe, f.code_client, f.contact_nom, f.contact_telephone, f.contact_email, f.adresse, f.ville, f.type_prestation,
     f.type_client || 'Régulier', f.date_debut_contrat || null, f.tacite_reconduction ? null : (f.date_fin_contrat || null),
     !!f.tacite_reconduction, parseFloat(f.tarif) || 0, f.tarif_unite || 'mensuel', f.statut || 'Actif', f.notes]);
  res.json({ id: rows[0].id });
});

app.put('/api/clients/:id', async (req, res) => {
  const f = req.body;
  await query(
    `UPDATE clients SET societe=$1,code_client=$2,contact_nom=$3,contact_telephone=$4,contact_email=$5,adresse=$6,ville=$7,
       type_prestation=$8,type_client=$9,date_debut_contrat=$10,date_fin_contrat=$11,tacite_reconduction=$12,
       tarif=$13,tarif_unite=$14,statut=$15,notes=$16,updated_at=NOW() WHERE id=$17`,
    [f.societe, f.code_client, f.contact_nom, f.contact_telephone, f.contact_email, f.adresse, f.ville, f.type_prestation,
     f.type_client || 'Régulier', f.date_debut_contrat || null, f.tacite_reconduction ? null : (f.date_fin_contrat || null),
     !!f.tacite_reconduction, parseFloat(f.tarif) || 0, f.tarif_unite, f.statut, f.notes, req.params.id]);
  res.json({ ok: true });
});

app.post('/api/clients/:id/logo', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  await query('UPDATE clients SET logo_contenu=$1, logo_mime_type=$2 WHERE id=$3',
    [req.file.buffer, req.file.mimetype, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/clients/:id/logo', async (req, res) => {
  const { rows } = await query('SELECT logo_contenu, logo_mime_type FROM clients WHERE id=$1', [req.params.id]);
  const c = rows[0];
  if (!c || !c.logo_contenu) return res.status(404).end();
  res.setHeader('Content-Type', c.logo_mime_type);
  res.send(c.logo_contenu);
});

app.delete('/api/clients/:id/logo', async (req, res) => {
  await query('UPDATE clients SET logo_contenu=NULL, logo_mime_type=NULL WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', async (req, res) => {
  await query('DELETE FROM clients WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── Routes Sites ───────────────────────────────────────
app.get('/api/clients/:clientId/sites', async (req, res) => {
  const { rows } = await query('SELECT * FROM client_sites WHERE client_id=$1 ORDER BY created_at', [req.params.clientId]);
  res.json(rows);
});

app.post('/api/clients/:clientId/sites', async (req, res) => {
  const { nom_site, adresse_site, code_site } = req.body;
  const { latitude, longitude } = await geocodeAdresse(adresse_site);
  const { rows } = await query(
    'INSERT INTO client_sites (client_id,nom_site,adresse_site,code_site,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.params.clientId, nom_site, adresse_site, code_site, latitude, longitude]);
  res.json({ id: rows[0].id });
});

app.put('/api/sites/:id', async (req, res) => {
  const { nom_site, adresse_site, code_site } = req.body;
  const { latitude, longitude } = await geocodeAdresse(adresse_site);
  await query('UPDATE client_sites SET nom_site=$1, adresse_site=$2, code_site=$3, latitude=$4, longitude=$5 WHERE id=$6',
    [nom_site, adresse_site, code_site, latitude, longitude, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/sites-map', async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.nom_site, s.adresse_site, s.latitude, s.longitude, c.id AS client_id, c.societe, c.type_client
    FROM client_sites s JOIN clients c ON c.id = s.client_id
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL`);
  res.json(rows);
});

app.delete('/api/sites/:id', async (req, res) => {
  await query('DELETE FROM client_sites WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── Routes Agents ──────────────────────────────────────
app.get('/api/agents', async (req, res) => {
  const { rows } = await query('SELECT * FROM agents WHERE actif=true ORDER BY nom');
  res.json(rows);
});

app.post('/api/agents', async (req, res) => {
  const { rows } = await query(
    'INSERT INTO agents (nom) VALUES ($1) ON CONFLICT (nom) DO NOTHING RETURNING id',
    [req.body.nom]);
  res.json({ id: rows[0]?.id });
});

app.delete('/api/agents/:id', async (req, res) => {
  await query('UPDATE agents SET actif=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/sites/:siteId/agents/:agentId', async (req, res) => {
  await query(
    'INSERT INTO site_agents (site_id,agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.siteId, req.params.agentId]);
  res.json({ ok: true });
});

app.delete('/api/sites/:siteId/agents/:agentId', async (req, res) => {
  await query('DELETE FROM site_agents WHERE site_id=$1 AND agent_id=$2', [req.params.siteId, req.params.agentId]);
  res.json({ ok: true });
});

// ─── Routes Documents ───────────────────────────────────
app.post('/api/clients/:clientId/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  const { type } = req.body;
  const { rows } = await query(
    `INSERT INTO client_documents (client_id,type,nom_fichier,mime_type,contenu,taille_octets,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.params.clientId, type || 'autre', req.file.originalname, req.file.mimetype,
     req.file.buffer, req.file.size, req.session.nom]);
  res.json({ id: rows[0].id });
});

app.get('/api/clients/:clientId/documents', async (req, res) => {
  const { rows } = await query(
    `SELECT id, client_id, type, nom_fichier, mime_type, taille_octets, uploaded_by, uploaded_at
     FROM client_documents WHERE client_id=$1 ORDER BY uploaded_at DESC`,
    [req.params.clientId]);
  res.json(rows);
});

app.get('/api/documents/:id/download', async (req, res) => {
  const { rows } = await query('SELECT nom_fichier, mime_type, contenu FROM client_documents WHERE id=$1', [req.params.id]);
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'Introuvable' });
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.nom_fichier.replace(/"/g, '')}"`);
  res.send(doc.contenu);
});

app.delete('/api/documents/:id', async (req, res) => {
  await query('DELETE FROM client_documents WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── Routes Historique ──────────────────────────────────
app.get('/api/clients/:clientId/historique', async (req, res) => {
  const { rows } = await query('SELECT * FROM client_historique WHERE client_id=$1 ORDER BY date DESC', [req.params.clientId]);
  res.json(rows);
});

app.post('/api/historique', async (req, res) => {
  const { client_id, type, description } = req.body;
  const { rows } = await query(
    'INSERT INTO client_historique (client_id,type,description,auteur) VALUES ($1,$2,$3,$4) RETURNING id',
    [client_id, type, description, req.session.nom]);
  await query('UPDATE clients SET updated_at=NOW() WHERE id=$1', [client_id]);
  res.json({ id: rows[0].id });
});

app.delete('/api/historique/:id', async (req, res) => {
  await query('DELETE FROM client_historique WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── KPI ────────────────────────────────────────────────
app.get('/api/kpi', async (req, res) => {
  const [actifsR, sitesR, agentsR, docsR, echeanceR] = await Promise.all([
    query("SELECT COUNT(*) n FROM clients WHERE statut='Actif'"),
    query('SELECT COUNT(*) n FROM client_sites'),
    query('SELECT COUNT(*) n FROM agents WHERE actif=true'),
    query('SELECT COUNT(*) n FROM client_documents'),
    query("SELECT COUNT(*) n FROM clients WHERE date_fin_contrat BETWEEN NOW() AND NOW() + INTERVAL '30 days'")
  ]);
  res.json({
    clients_actifs: parseInt(actifsR.rows[0].n),
    sites: parseInt(sitesR.rows[0].n),
    agents: parseInt(agentsR.rows[0].n),
    documents: parseInt(docsR.rows[0].n),
    echeances_30j: parseInt(echeanceR.rows[0].n)
  });
});

// ─── Export CSV ───────────────────────────────────────
app.get('/api/export/csv', async (req, res) => {
  const { rows } = await query(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY societe`);
  const headers = ['ID','Code client','Société','Type de client','Contact','Téléphone','Email','Adresse','Ville',
    'Type de prestation','Début contrat','Fin contrat','Tarif','Unité','Statut','Notes','Créé le','Modifié le'];
  const csv = [
    headers.join(';'),
    ...rows.map(r => [r.id, r.code_client, r.societe, r.type_client, r.contact_nom, r.contact_telephone, r.contact_email,
      r.adresse, r.ville, r.type_prestation, r.date_debut_contrat, r.date_fin_contrat, r.tarif, r.tarif_unite,
      r.statut, `"${(r.notes||'').replace(/"/g,'""')}"`, r.created_at, r.updated_at].join(';'))
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename="clients_ab2s.csv"');
  res.send('﻿' + csv);
});

// ─── Démarrage ──────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║     AB2S Sécurité — Base de données Clients ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n✅ Serveur démarré sur le port ${PORT}`);
    if (!process.env.DATABASE_URL) {
      console.log('\n⚠️  Aucune base de données configurée (DATABASE_URL manquant)');
    }
  });
}).catch(err => {
  console.error('❌ Erreur de connexion à la base de données:', err.message);
  process.exit(1);
});
