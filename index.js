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
        p.code_produit,
        p.designation,
        p.unite,
        COALESCE(SUM(bel.quantite), 0) AS total_entree,
        COALESCE(SUM(bsl.quantite), 0) AS total_sortie,
        COALESCE(SUM(bel.quantite), 0) - COALESCE(SUM(bsl.quantite), 0) AS stock_actuel
      FROM T_Produits p
      LEFT JOIN T_Bon_Entree_Lignes bel ON p.id_produit = bel.id_produit
      LEFT JOIN T_Bon_Sortie_Lignes bsl ON p.id_produit = bsl.id_produit
      GROUP BY p.code_produit, p.designation, p.unite
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
    
    // Insérer le bon
    const bonResult = await client.query(
      'INSERT INTO T_Bon_Entree (numero_bon, date_bon, id_fournisseur, observation) VALUES ($1, $2, $3, $4) RETURNING id_bon_entree',
      [numero_bon, date_bon, id_fournisseur, observation]
    );
    const id_bon_entree = bonResult.rows[0].id_bon_entree;

    // Insérer les lignes
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

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});