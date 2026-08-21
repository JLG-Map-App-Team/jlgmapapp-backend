import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp'}:` +
  `${process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev'}@` +
  `${process.env.PGHOST ?? 'localhost'}:${process.env.PGPORT ?? process.env.POSTGRES_PORT ?? '5432'}/` +
  `${process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp'}?sslmode=disable`;

const pool = new Pool({
  connectionString,
});

export default pool;
