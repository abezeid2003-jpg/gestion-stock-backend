const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_XLIYVkJr3v7e@ep-wandering-leaf-aptxudq5-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  SELECT table_name, column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name IN ('t_stock_initial', 't_stock_initial_clients')
  ORDER BY table_name, column_name
`)
  .then(r => { console.log(r.rows); process.exit(); })
  .catch(e => { console.log(e.message); process.exit(); });