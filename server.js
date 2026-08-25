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
      contact_nom TEXT, contact_telephone TEXT, contact_email TEXT,
      adresse TEXT, ville TEXT,
      type_prestation TEXT,
      date_debut_contrat DATE, date_fin_contrat DATE,
      tarif NUMERIC DEFAULT 0, tarif_unite TEXT DEFAULT 'mensuel',
      statut TEXT DEFAULT 'Actif',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS client_sites (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      nom_site TEXT NOT NULL,
      adresse_site TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
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
app.get('/api/clients', async (req, res) => {
  const { search } = req.query;
  let text = 'SELECT * FROM clients WHERE 1=1';
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    text += ` AND (societe ILIKE $${params.length} OR contact_nom ILIKE $${params.length} OR ville ILIKE $${params.length})`;
  }
  text += ' ORDER BY updated_at DESC';
  const { rows } = await query(text, params);
  res.json(rows);
});

app.get('/api/clients/:id', async (req, res) => {
  const id = req.params.id;
  const [clientR, sitesR, docsR, histR] = await Promise.all([
    query('SELECT * FROM clients WHERE id=$1', [id]),
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
    `INSERT INTO clients (societe,contact_nom,contact_telephone,contact_email,adresse,ville,type_prestation,
       date_debut_contrat,date_fin_contrat,tarif,tarif_unite,statut,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [f.societe, f.contact_nom, f.contact_telephone, f.contact_email, f.adresse, f.ville, f.type_prestation,
     f.date_debut_contrat || null, f.date_fin_contrat || null, parseFloat(f.tarif) || 0,
     f.tarif_unite || 'mensuel', f.statut || 'Actif', f.notes]);
  res.json({ id: rows[0].id });
});

app.put('/api/clients/:id', async (req, res) => {
  const f = req.body;
  await query(
    `UPDATE clients SET societe=$1,contact_nom=$2,contact_telephone=$3,contact_email=$4,adresse=$5,ville=$6,
       type_prestation=$7,date_debut_contrat=$8,date_fin_contrat=$9,tarif=$10,tarif_unite=$11,statut=$12,
       notes=$13,updated_at=NOW() WHERE id=$14`,
    [f.societe, f.contact_nom, f.contact_telephone, f.contact_email, f.adresse, f.ville, f.type_prestation,
     f.date_debut_contrat || null, f.date_fin_contrat || null, parseFloat(f.tarif) || 0,
     f.tarif_unite, f.statut, f.notes, req.params.id]);
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
  const { nom_site, adresse_site } = req.body;
  const { rows } = await query(
    'INSERT INTO client_sites (client_id,nom_site,adresse_site) VALUES ($1,$2,$3) RETURNING id',
    [req.params.clientId, nom_site, adresse_site]);
  res.json({ id: rows[0].id });
});

app.put('/api/sites/:id', async (req, res) => {
  const { nom_site, adresse_site } = req.body;
  await query('UPDATE client_sites SET nom_site=$1, adresse_site=$2 WHERE id=$3', [nom_site, adresse_site, req.params.id]);
  res.json({ ok: true });
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
