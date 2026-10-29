import pg from 'pg'
import { loadSeed } from './seed.mjs'

const { Client } = pg
const databaseConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
}

const client = new Client(databaseConfig)
await client.connect()
try {
  const { rows: [run] } = await client.query(`
    INSERT INTO staging.etl_run (source, source_feature_count)
    VALUES ('city_route_segments', 51)
    RETURNING id`)

  await loadSeed({ client })
  const { rows: flags } = await client.query(
    'SELECT severity, flag_type, message FROM routing.rebuild_topology($1)',
    [run.id],
  )
  const { rows: [metrics] } = await client.query(`
    SELECT outcome, edge_count, node_count, component_count, dead_end_count,
           isolated_count, largest_component_share, source_segment_count,
           split_count, tol_contact_m, tol_join_m, tol_review_max_m,
           tol_detect_radius_m
      FROM routing.topology_check
     WHERE etl_run_id = $1
     ORDER BY checked_at DESC
     LIMIT 1`, [run.id])

  await client.query(
    `UPDATE staging.etl_run
        SET status = CASE WHEN $2 = 'published' THEN 'succeeded' ELSE 'failed' END,
            finished_at = now(),
            rows_inserted = $1
      WHERE id = $3`,
    [metrics.source_segment_count, metrics.outcome, run.id],
  )

  console.log(JSON.stringify({ runId: run.id, metrics, flags }, null, 2))
} finally {
  await client.end()
}