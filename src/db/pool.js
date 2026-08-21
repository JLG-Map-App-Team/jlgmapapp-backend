/**
 * Shared node-postgres connection pool.
 *
 * One pool per process. Every module that touches the database imports this
 * rather than constructing its own client, so connection limits are governed in
 * one place and a runaway import cannot exhaust the server.
 *
 * CONFIGURATION
 *   DATABASE_URL is required and deliberately has no fallback. A default of
 *   localhost is how a script intended for a development database ends up
 *   pointed at whatever happens to be listening — including production, if the
 *   variable is unset on the wrong host. Fail loudly instead.
 *
 *   Format:  postgres://user:password@host:port/database?sslmode=disable
 *   See .env.example, and docker-compose.yml for the development credentials.
 *
 * SEARCH PATH
 *   Migration 20260727000001 sets a database-level search_path of `core, public`.
 *   Every query in this codebase schema-qualifies its tables anyway
 *   (core.route_segment, staging.etl_run), which is the behaviour to keep: an
 *   unqualified name resolves against whatever the search_path happens to be at
 *   the time, and that is how a tool ends up creating a second, empty copy of a
 *   table it depends on. Do not rely on the search_path here.
 */

import pg from 'pg';

const { Pool, types } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and load it ' +
    '(node --env-file=.env …), or export DATABASE_URL in your shell. ' +
    'There is deliberately no default: a fallback connection string is how a ' +
    'script gets pointed at the wrong database.',
  );
}

// node-postgres returns bigint (OID 20) as a string, because a Postgres bigint
// can exceed Number.MAX_SAFE_INTEGER. Keep that default — silently losing
// precision on an identifier is worse than handling a string. core.route_segment.id
// is a bigint, and the API contract types segment_id as a string for this reason.
// Left explicit so nobody "fixes" it later.
types.setTypeParser(20, (v) => v);

const pool = new Pool({
  connectionString,

  // Small on purpose. The ETL is a single-connection batch job and the API is
  // read-mostly; a large pool against a container database buys nothing and
  // makes connection exhaustion harder to spot. Raise it with evidence.
  max: Number(process.env.PGPOOL_MAX ?? 10),

  // Release idle connections so a long-lived process does not hold slots it is
  // not using.
  idleTimeoutMillis: 30_000,

  // Fail fast when the database is unreachable rather than hanging a request.
  // NFR-AVL-02 requires the API to degrade visibly when the database is down;
  // an unbounded connect wait degrades invisibly instead.
  connectionTimeoutMillis: 10_000,

  application_name: process.env.PGAPPNAME ?? 'jlgmapapp-backend',
});

// An idle client can be killed by the server, a restart, or a network blip.
// Without a handler, node-postgres emits an unhandled 'error' event and takes
// the process down. Log and continue: the pool replaces the client itself.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Close the pool. Call once, at process shutdown. */
export async function closePool() {
  await pool.end();
}

export default pool;
