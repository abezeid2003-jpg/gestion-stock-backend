const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XLIYVkJr3v7e@ep-wandering-leaf-aptxudq5-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

app.get('/', async (req, res) => {
  res.json({ message: 'API Gestion Stock fonctionne !' });
});

app.get('/produits', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Produits ORDER BY code_produit');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/clients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Clients ORDER BY code_client');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/fournisseurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM T_Fournisseurs ORDER BY code_fournisseur');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stock', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id_produit,
        p.code_produit,
        p.designation,
        p.unite,
        p.stock_minimum,
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;

// Ajouter un bon d'entrée
app.post('/bon-entree', async (req, res) => {
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
  } finally {
    client.release();
  }
});

// Ajouter un bon de sortie
app.post('/bon-sortie', async (req, res) => {
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
  } finally {
    client.release();
  }
});

// Ajouter un produit
app.post('/produits', async (req, res) => {
  const { code_produit, designation, unite, prix_achat, prix_vente, stock_minimum } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Produits (code_produit, designation, unite, prix_achat, prix_vente, stock_minimum) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code_produit, designation, unite, prix_achat, prix_vente, stock_minimum]
    );
    res.json({ success: true, produit: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifier un produit
app.put('/produits/:id', async (req, res) => {
  const { id } = req.params;
  const { code_produit, designation, unite, prix_achat, prix_vente, stock_minimum } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Produits 
       SET code_produit = $1, designation = $2, unite = $3, prix_achat = $4, prix_vente = $5, stock_minimum = $6
       WHERE id_produit = $7 RETURNING *`,
      [code_produit, designation, unite, prix_achat, prix_vente, stock_minimum, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Produit non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un produit
app.delete('/produits/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Produits WHERE id_produit = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajouter un client
app.post('/clients', async (req, res) => {
  const { code_client, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Clients (code_client, nom, telephone, adresse) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [code_client, nom, telephone, adresse]
    );
    res.json({ success: true, client: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifier un client
app.put('/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { code_client, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Clients 
       SET code_client = $1, nom = $2, telephone = $3, adresse = $4
       WHERE id_client = $5 RETURNING *`,
      [code_client, nom, telephone, adresse, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Client non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un client
app.delete('/clients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Clients WHERE id_client = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajouter un fournisseur
app.post('/fournisseurs', async (req, res) => {
  const { code_fournisseur, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO T_Fournisseurs (code_fournisseur, nom, telephone, adresse) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [code_fournisseur, nom, telephone, adresse]
    );
    res.json({ success: true, fournisseur: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifier un fournisseur
app.put('/fournisseurs/:id', async (req, res) => {
  const { id } = req.params;
  const { code_fournisseur, nom, telephone, adresse } = req.body;
  try {
    const result = await pool.query(
      `UPDATE T_Fournisseurs 
       SET code_fournisseur = $1, nom = $2, telephone = $3, adresse = $4
       WHERE id_fournisseur = $5 RETURNING *`,
      [code_fournisseur, nom, telephone, adresse, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Fournisseur non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un fournisseur
app.delete('/fournisseurs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM T_Fournisseurs WHERE id_fournisseur = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recuperer tous les bons d'entree
app.get('/bons-entree', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT be.*, f.nom AS nom_fournisseur
      FROM T_Bon_Entree be
      LEFT JOIN T_Fournisseurs f ON be.id_fournisseur = f.id_fournisseur
      ORDER BY be.date_bon DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recuperer les lignes d'un bon d'entree
app.get('/bons-entree/:id/lignes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bel.*, p.designation, p.code_produit
      FROM T_Bon_Entree_Lignes bel
      LEFT JOIN T_Produits p ON bel.id_produit = p.id_produit
      WHERE bel.id_bon_entree = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un bon d'entree
app.delete('/bons-entree/:id', async (req, res) => {
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
  } finally {
    client.release();
  }
});

// Recuperer tous les bons de sortie
app.get('/bons-sortie', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bs.*, c.nom AS nom_client
      FROM T_Bon_Sortie bs
      LEFT JOIN T_Clients c ON bs.id_client = c.id_client
      ORDER BY bs.date_bon DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recuperer les lignes d'un bon de sortie
app.get('/bons-sortie/:id/lignes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bsl.*, p.designation, p.code_produit
      FROM T_Bon_Sortie_Lignes bsl
      LEFT JOIN T_Produits p ON bsl.id_produit = p.id_produit
      WHERE bsl.id_bon_sortie = $1
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un bon de sortie
app.delete('/bons-sortie/:id', async (req, res) => {
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
  } finally {
    client.release();
  }
});

// Modifier un bon d'entree
app.put('/bons-entree/:id', async (req, res) => {
  const { id } = req.params;
  const { numero_bon, date_bon, id_fournisseur, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE T_Bon_Entree 
       SET numero_bon = $1, date_bon = $2, id_fournisseur = $3, observation = $4
       WHERE id_bon_entree = $5`,
      [numero_bon, date_bon, id_fournisseur, observation, id]
    );
    await client.query('DELETE FROM T_Bon_Entree_Lignes WHERE id_bon_entree = $1', [id]);
    for (const ligne of lignes) {
      await client.query(
        'INSERT INTO T_Bon_Entree_Lignes (id_bon_entree, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)',
        [id, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Modifier un bon de sortie
app.put('/bons-sortie/:id', async (req, res) => {
  const { id } = req.params;
  const { numero_bon, date_bon, id_client, observation, lignes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE T_Bon_Sortie 
       SET numero_bon = $1, date_bon = $2, id_client = $3, observation = $4
       WHERE id_bon_sortie = $5`,
      [numero_bon, date_bon, id_client, observation, id]
    );
    await client.query('DELETE FROM T_Bon_Sortie_Lignes WHERE id_bon_sortie = $1', [id]);
    for (const ligne of lignes) {
      await client.query(
        'INSERT INTO T_Bon_Sortie_Lignes (id_bon_sortie, id_produit, quantite, prix_unitaire) VALUES ($1, $2, $3, $4)',
        [id, ligne.id_produit, ligne.quantite, ligne.prix_unitaire]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 📋 FICHE MOUVEMENTS D'UN PRODUIT
app.get('/mouvements/:id_produit', async (req, res) => {
  const { id_produit } = req.params;
  try {
    // Info produit
    const produit = await pool.query(
      `SELECT * FROM T_Produits WHERE id_produit = $1`,
      [id_produit]
    );

    // Stock initial (colonnes reelles : quantite, prix_unitaire, date_saisie)
    const stockInitial = await pool.query(
      `SELECT quantite, prix_unitaire, date_saisie
       FROM T_Stock_Initial
       WHERE id_produit = $1`,
      [id_produit]
    );

    // Entrees
    const entrees = await pool.query(
      `SELECT be.numero_bon, be.date_bon, f.nom AS nom_fournisseur,
              bel.quantite, bel.prix_unitaire,
              bel.quantite * bel.prix_unitaire AS montant
       FROM T_Bon_Entree_Lignes bel
       JOIN T_Bon_Entree be ON bel.id_bon_entree = be.id_bon_entree
       JOIN T_Fournisseurs f ON be.id_fournisseur = f.id_fournisseur
       WHERE bel.id_produit = $1
       ORDER BY be.date_bon ASC, be.numero_bon ASC`,
      [id_produit]
    );

    // Sorties
    const sorties = await pool.query(
      `SELECT bs.numero_bon, bs.date_bon, c.nom AS nom_client,
              bsl.quantite, bsl.prix_unitaire,
              bsl.quantite * bsl.prix_unitaire AS montant
       FROM T_Bon_Sortie_Lignes bsl
       JOIN T_Bon_Sortie bs ON bsl.id_bon_sortie = bs.id_bon_sortie
       JOIN T_Clients c ON bs.id_client = c.id_client
       WHERE bsl.id_produit = $1
       ORDER BY bs.date_bon ASC, bs.numero_bon ASC`,
      [id_produit]
    );

    const qteInitiale = stockInitial.rows[0] ? Number(stockInitial.rows[0].quantite) : 0;
    const totalEntrees = entrees.rows.reduce((sum, e) => sum + Number(e.quantite), 0);
    const totalSorties = sorties.rows.reduce((sum, s) => sum + Number(s.quantite), 0);
    const stockFinal = qteInitiale + totalEntrees - totalSorties;

    res.json({
      produit: produit.rows[0],
      stock_initial: stockInitial.rows[0] || { quantite: 0, prix_unitaire: 0, date_saisie: null },
      entrees: entrees.rows,
      sorties: sorties.rows,
      totaux: {
        qte_initiale: qteInitiale,
        total_entrees: totalEntrees,
        total_sorties: totalSorties,
        stock_final: stockFinal,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});