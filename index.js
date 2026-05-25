const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'gestion_stock_secret_2026';

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XLIYVkJr3v7e@ep-wandering-leaf-aptxudq5-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

// MIDDLEWARE VERIFICATION TOKEN
const verifierToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.utilisateur = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalide' });
  }
};

// MIDDLEWARE ADMIN SEULEMENT
const adminSeulement = (req, res, next) => {
  if (req.utilisateur.role !== 'admin') {
    return res.status(403).json({ error: 'Acces refuse - Admin requis' });
  }
  next();
};

app.get('/', async (req, res) => {
  res.json({ message: 'API Gestion Stock fonctionne !' });
});

// LOGIN
app.post('/login', async (req, res) => {
  const { login, mot_de_passe } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM T_Utilisateurs WHERE login = $1 AND actif = true', [login]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Login ou mot de passe incorrect' });
    const utilisateur = result.rows[0];
    const valide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!valide) return res.status(401).json({ error: 'Login ou mot de passe incorrect' });
    const token = jwt.sign(
      { id: utilisateur.id_utilisateur, login: utilisateur.login, nom: utilisateur.nom, role: utilisateur.role },
      JWT_SECRET, { expiresIn: '8h' }
    );
    res.json({ success: true, token, utilisateur: { id: utilisateur.id_utilisateur, login: utilisateur.login, nom: utilisateur.nom, role: utilisateur.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GESTION UTILISATEURS (admin seulement)
app.get('/utilisateurs', verifierToken, adminSeulement, async (req, res) => {
  try {
    const result = await pool.query('SELECT id_utilisateur, login, nom, role, actif FROM T_Utilisateurs ORDER BY nom');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/utilisateurs', verifierToken, adminSeulement, async (req, res) => {
  const { login, mot_de_passe, nom, role } = req.body;
  try {
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const result = await pool.query(
      'INSERT INTO T_Utilisateurs (login, mot_de_passe, nom, role) VALUES ($1, $2, $3, $4) RETURNING id_utilisateur, login, nom, role',
      [login, hash, nom, role || 'utilisateur']
    );
    res.json({ success: true, utilisateur: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/utilisateurs/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { login, nom, role, actif, mot_de_passe } = req.body;
  try {
    let query, params;
    if (mot_de_passe) {
      const hash = await bcrypt.hash(mot_de_passe, 10);
      query = 'UPDATE T_Utilisateurs SET login=$1, nom=$2, role=$3, actif=$4, mot_de_passe=$5 WHERE id_utilisateur=$6 RETURNING id_utilisateur, login, nom, role, actif';
      params = [login, nom, role, actif, hash, id];
    } else {
      query = 'UPDATE T_Utilisateurs SET login=$1, nom=$2, role=$3, actif=$4 WHERE id_utilisateur=$5 RETURNING id_utilisateur, login, nom, role, actif';
      params = [login, nom, role, actif, id];
    }
    const result = await pool.query(query, params);
    res.json({ success: true, utilisateur: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/utilisateurs/:id', verifierToken, adminSeulement, async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Utilisateurs WHERE id_utilisateur = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ROUTES PROTEGEES
app.get('/produits', verifierToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Produits ORDER BY code_produit');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/clients', verifierToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Clients ORDER BY code_client');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/fournisseurs', verifierToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Fournisseurs ORDER BY code_fournisseur');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/stock', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id_produit, p.code_produit, p.designation, p.unite, p.stock_minimum,
        COALESCE(si.quantite, 0) AS stock_initial,
        COALESCE(SUM(bel.quantite), 0) AS total_entree,
        COALESCE(SUM(bsl.quantite), 0) AS total_sortie,
        COALESCE(si.quantite, 0) + COALESCE(SUM(bel.quantite), 0) - COALESCE(SUM(bsl.quantite), 0) AS stock_actuel
      FROM T_Produits p
      LEFT JOIN T_Stock_Initial si ON p.id_produit = si.id_produit
      LEFT JOIN T_Bon_Entree_Lignes bel ON p.id_produit = bel.id_produit
      LEFT JOIN T_Bon_Sortie_Lignes bsl ON p.id_produit = bsl.id_produit
      GROUP BY p.id_produit, p.code_produit, p.designation, p.unite, p.stock_minimum, si.quantite
      ORDER BY p.code_produit
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/bon-entree', verifierToken, async (req, res) => {
  const { numero_bon, date_bon, id_fournisseur, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bonResult = await client.query(
      'INSERT INTO T_Bon_Entree (numero_bon, date_bon, id_fournisseur, observation) VALUES ($1, $2, $3, $4) RETURNING id_bon_entree',
      [numero_bon, date_bon, id_fournisseur, observation]
    );
    const id_bon_entree = bonResult.rows[0].id_bon_entree;
    for (const ligne of lignes) {
      await client.query(
        'INSERT INTO T_Bon_Entree_Lignes (id_bon_entree, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)',
        [id_bon_entree, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, id_bon_entree });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/bon-sortie', verifierToken, async (req, res) => {
  const { numero_bon, date_bon, id_client, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bonResult = await client.query(
      'INSERT INTO T_Bon_Sortie (numero_bon, date_bon, id_client, observation) VALUES ($1, $2, $3, $4) RETURNING id_bon_sortie',
      [numero_bon, date_bon, id_client, observation]
    );
    const id_bon_sortie = bonResult.rows[0].id_bon_sortie;
    for (const ligne of lignes) {
      await client.query(
        'INSERT INTO T_Bon_Sortie_Lignes (id_bon_sortie, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)',
        [id_bon_sortie, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, id_bon_sortie });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/produits', verifierToken, async (req, res) => {
  const { code_produit, designation, unite, prix_achat, prix_vente, stock_minimum } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Produits (code_produit, designation, unite, prix_achat, prix_vente, stock_minimum) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code_produit, designation, unite, prix_achat || null, prix_vente || null, stock_minimum || null]
    );
    res.json({ success: true, produit: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/produits/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { code_produit, designation, unite, prix_achat, prix_vente, stock_minimum } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Produits SET code_produit=$1, designation=$2, unite=$3, prix_achat=$4, prix_vente=$5, stock_minimum=$6 WHERE id_produit=$7 RETURNING *`,
      [code_produit, designation, unite, prix_achat || null, prix_vente || null, stock_minimum || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Produit non trouve' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/produits/:id', verifierToken, adminSeulement, async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Produits WHERE id_produit = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/clients', verifierToken, async (req, res) => {
  const { code_client, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Clients (code_client, nom, telephone, adresse) VALUES ($1, $2, $3, $4) RETURNING *`,
      [code_client, nom, telephone, adresse]
    );
    res.json({ success: true, client: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/clients/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { code_client, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Clients SET code_client=$1, nom=$2, telephone=$3, adresse=$4 WHERE id_client=$5 RETURNING *`,
      [code_client, nom, telephone, adresse, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/clients/:id', verifierToken, adminSeulement, async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Clients WHERE id_client = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/fournisseurs', verifierToken, async (req, res) => {
  const { code_fournisseur, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Fournisseurs (code_fournisseur, nom, telephone, adresse) VALUES ($1, $2, $3, $4) RETURNING *`,
      [code_fournisseur, nom, telephone, adresse]
    );
    res.json({ success: true, fournisseur: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/fournisseurs/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { code_fournisseur, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Fournisseurs SET code_fournisseur=$1, nom=$2, telephone=$3, adresse=$4 WHERE id_fournisseur=$5 RETURNING *`,
      [code_fournisseur, nom, telephone, adresse, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Fournisseur non trouve' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/fournisseurs/:id', verifierToken, adminSeulement, async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Fournisseurs WHERE id_fournisseur = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bons-entree', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT be.*, f.nom AS nom_fournisseur FROM T_Bon_Entree be
      LEFT JOIN T_Fournisseurs f ON be.id_fournisseur = f.id_fournisseur ORDER BY be.date_bon DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bons-entree/:id/lignes', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bel.*, p.designation, p.code_produit FROM T_Bon_Entree_Lignes bel
      LEFT JOIN T_Produits p ON bel.id_produit = p.id_produit WHERE bel.id_bon_entree = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/bons-entree/:id', verifierToken, adminSeulement, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM T_Bon_Entree_Lignes WHERE id_bon_entree = $1', [req.params.id]);
    await client.query('DELETE FROM T_Bon_Entree WHERE id_bon_entree = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.get('/bons-sortie', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bs.*, c.nom AS nom_client FROM T_Bon_Sortie bs
      LEFT JOIN T_Clients c ON bs.id_client = c.id_client ORDER BY bs.date_bon DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/bons-sortie/:id/lignes', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bsl.*, p.designation, p.code_produit FROM T_Bon_Sortie_Lignes bsl
      LEFT JOIN T_Produits p ON bsl.id_produit = p.id_produit WHERE bsl.id_bon_sortie = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/bons-sortie/:id', verifierToken, adminSeulement, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM T_Bon_Sortie_Lignes WHERE id_bon_sortie = $1', [req.params.id]);
    await client.query('DELETE FROM T_Bon_Sortie WHERE id_bon_sortie = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put('/bons-entree/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { numero_bon, date_bon, id_fournisseur, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE T_Bon_Entree SET numero_bon=$1, date_bon=$2, id_fournisseur=$3, observation=$4 WHERE id_bon_entree=$5`, [numero_bon, date_bon, id_fournisseur, observation, id]);
    await client.query('DELETE FROM T_Bon_Entree_Lignes WHERE id_bon_entree = $1', [id]);
    for (const ligne of lignes) {
      await client.query('INSERT INTO T_Bon_Entree_Lignes (id_bon_entree, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)', [id, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.put('/bons-sortie/:id', verifierToken, adminSeulement, async (req, res) => {
  const { id } = req.params;
  const { numero_bon, date_bon, id_client, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE T_Bon_Sortie SET numero_bon=$1, date_bon=$2, id_client=$3, observation=$4 WHERE id_bon_sortie=$5`, [numero_bon, date_bon, id_client, observation, id]);
    await client.query('DELETE FROM T_Bon_Sortie_Lignes WHERE id_bon_sortie = $1', [id]);
    for (const ligne of lignes) {
      await client.query('INSERT INTO T_Bon_Sortie_Lignes (id_bon_sortie, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)', [id, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.get('/mouvements/:id_produit', verifierToken, async (req, res) => {
  const { id_produit } = req.params;
  try {
    const produit = await pool.query(`SELECT * FROM T_Produits WHERE id_produit = $1`, [id_produit]);
    const stockInitial = await pool.query(`SELECT quantite, prix_unitaire, date_saisie FROM T_Stock_Initial WHERE id_produit = $1`, [id_produit]);
    const entrees = await pool.query(
      `SELECT be.numero_bon, be.date_bon, f.nom AS nom_fournisseur, bel.quantite, bel.prix_unitaire, bel.quantite * bel.prix_unitaire AS montant
       FROM T_Bon_Entree_Lignes bel JOIN T_Bon_Entree be ON bel.id_bon_entree = be.id_bon_entree
       JOIN T_Fournisseurs f ON be.id_fournisseur = f.id_fournisseur WHERE bel.id_produit = $1 ORDER BY be.date_bon ASC`, [id_produit]
    );
    const sorties = await pool.query(
      `SELECT bs.numero_bon, bs.date_bon, c.nom AS nom_client, bsl.quantite, bsl.prix_unitaire, bsl.quantite * bsl.prix_unitaire AS montant
       FROM T_Bon_Sortie_Lignes bsl JOIN T_Bon_Sortie bs ON bsl.id_bon_sortie = bs.id_bon_sortie
       JOIN T_Clients c ON bs.id_client = c.id_client WHERE bsl.id_produit = $1 ORDER BY bs.date_bon ASC`, [id_produit]
    );
    const qteInitiale = stockInitial.rows[0] ? Number(stockInitial.rows[0].quantite) : 0;
    const totalEntrees = entrees.rows.reduce((sum, e) => sum + Number(e.quantite), 0);
    const totalSorties = sorties.rows.reduce((sum, s) => sum + Number(s.quantite), 0);
    res.json({
      produit: produit.rows[0],
      stock_initial: stockInitial.rows[0] || { quantite: 0, prix_unitaire: 0, date_saisie: null },
      entrees: entrees.rows, sorties: sorties.rows,
      totaux: { qte_initiale: qteInitiale, total_entrees: totalEntrees, total_sorties: totalSorties, stock_final: qteInitiale + totalEntrees - totalSorties }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/fiche-stock', verifierToken, async (req, res) => {
  const { date_debut, date_fin } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.code_produit, p.designation, p.unite,
        COALESCE(si.quantite, 0) AS stock_initial,
        COALESCE(SUM(CASE WHEN be.date_bon >= $1 AND be.date_bon <= $2 THEN bel.quantite ELSE 0 END), 0) AS total_entrees,
        COALESCE(SUM(CASE WHEN bs.date_bon >= $1 AND bs.date_bon <= $2 THEN bsl.quantite ELSE 0 END), 0) AS total_sorties,
        COALESCE(si.quantite, 0) +
        COALESCE(SUM(CASE WHEN be.date_bon >= $1 AND be.date_bon <= $2 THEN bel.quantite ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN bs.date_bon >= $1 AND bs.date_bon <= $2 THEN bsl.quantite ELSE 0 END), 0) AS stock_disponible
      FROM T_Produits p
      LEFT JOIN T_Stock_Initial si ON p.id_produit = si.id_produit
      LEFT JOIN T_Bon_Entree_Lignes bel ON p.id_produit = bel.id_produit
      LEFT JOIN T_Bon_Entree be ON bel.id_bon_entree = be.id_bon_entree
      LEFT JOIN T_Bon_Sortie_Lignes bsl ON p.id_produit = bsl.id_produit
      LEFT JOIN T_Bon_Sortie bs ON bsl.id_bon_sortie = bs.id_bon_sortie
      GROUP BY p.id_produit, p.code_produit, p.designation, p.unite, si.quantite
      ORDER BY p.code_produit
    `, [date_debut, date_fin]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/stock-initial', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id_produit, p.code_produit, p.designation, p.unite,
             COALESCE(si.quantite, 0) AS quantite, COALESCE(si.prix_unitaire, 0) AS prix_unitaire, si.date_saisie
      FROM T_Produits p LEFT JOIN T_Stock_Initial si ON p.id_produit = si.id_produit ORDER BY p.code_produit
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/stock-initial', verifierToken, async (req, res) => {
  const { id_produit, quantite, prix_unitaire, date_saisie } = req.body;
  try {
    await pool.query(`
      INSERT INTO T_Stock_Initial (id_produit, quantite, prix_unitaire, date_saisie)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id_produit) DO UPDATE SET quantite=$2, prix_unitaire=$3, date_saisie=$4
    `, [id_produit, quantite, prix_unitaire, date_saisie]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 3000;
app.listen(PORT, () => { console.log(`Serveur démarré sur le port ${PORT}`); });