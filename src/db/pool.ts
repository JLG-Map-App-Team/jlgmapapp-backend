import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://jlgmapapp:jlgmapapp_dev@localhost:5432/jlgmapapp?sslmode=disable';

const pool = new Pool({
  connectionString,
});

export default pool;
