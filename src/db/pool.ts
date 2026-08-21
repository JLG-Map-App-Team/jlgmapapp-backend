import { Pool } from 'pg';

const port = process.env.PGPORT ?? process.env.POSTGRES_PORT ?? '5432';

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://jlgmapapp:jlgmapapp_dev@localhost:${port}/jlgmapapp?sslmode=disable`;

const pool = new Pool({
  connectionString,
});

export default pool;
