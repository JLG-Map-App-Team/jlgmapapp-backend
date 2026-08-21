import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and load it ' +
    '(node --env-file=.env …), or export DATABASE_URL in your shell. ' +
    'There is deliberately no default: a fallback connection string is how a ' +
    'script gets pointed at the wrong database.',
  );
}

const pool = new Pool({
  connectionString,
});

// An idle client can be killed by the server, a restart, or a network blip.
// Without a handler, node-postgres emits an unhandled 'error' event and takes
// the process down. Log and continue: the pool replaces the client itself.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Close the pool. Call once, at process shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}

export default pool;
