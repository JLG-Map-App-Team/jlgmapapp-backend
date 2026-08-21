import assert from 'node:assert/strict'
import test from 'node:test'
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

test('the fixed seed loads real PostGIS route segments', async () => {
  const client = new Client(databaseConfig)
  await client.connect()
  try {
    await loadSeed({ client })
    const { rows } = await client.query(`
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE ST_SRID(geom) = 4326)::int AS wgs84_count,
             count(*) FILTER (WHERE ST_SRID(geom_proj) = 26917)::int AS projected_count
        FROM core.route_segment
       WHERE source = 'city_route_segments'
            AND source_ref IS NOT NULL`)

          assert.deepEqual(rows[0], { count: 51, wgs84_count: 51, projected_count: 51 })
  } finally {
    await client.end()
  }
})