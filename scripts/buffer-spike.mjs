// L3.2 buffer spike. Throwaway (walking skeleton plan §7): everything it builds
// lives in TEMP tables and disappears with the session. It reads the loaded
// core.route_segment network and the QGIS rehearsal output in
// docs/lane3/qgis_reference.json, and prints its measurements as JSON.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Client } = pg
const repositoryRoot = resolve(import.meta.dirname, '..')
const referencePath = resolve(repositoryRoot, 'docs/lane3/qgis_reference.json')
const databaseConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
}

const halfMileM = 804.672 // migration 0011, ADR-001 §4.9
const syntheticSizes = [1_000, 10_000, 100_000]
const runs = 7

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = (x, places = 3) => Number(x.toFixed(places))

// Execution time and the scan nodes the planner chose, from EXPLAIN ANALYZE.
async function explain(client, sql, params = []) {
  const { rows: [row] } = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params)
  const [plan] = row['QUERY PLAN']
  const scans = new Set()
  const walk = (node) => {
    if (/Scan/.test(node['Node Type'])) {
      scans.add(`${node['Node Type']}${node['Index Name'] ? ` (${node['Index Name']})` : ''}`)
    }
    for (const child of node.Plans ?? []) walk(child)
  }
  walk(plan.Plan)
  return { ms: plan['Execution Time'], scans: [...scans] }
}

async function time(client, sql, params = []) {
  await explain(client, sql, params) // warm the cache; the first run is not reported
  const samples = []
  let scans
  for (let i = 0; i < runs; i++) {
    const result = await explain(client, sql, params)
    samples.push(result.ms)
    scans = result.scans
  }
  return { median_ms: round(median(samples)), max_ms: round(Math.max(...samples)), runs, scans }
}

// Same query with index scans switched off, to show what the GiST index buys.
async function timeWithoutIndex(client, sql, params = []) {
  await client.query('SET enable_indexscan = off; SET enable_bitmapscan = off')
  try {
    return await time(client, sql, params)
  } finally {
    await client.query('RESET enable_indexscan; RESET enable_bitmapscan')
  }
}

const reference = JSON.parse(await readFile(referencePath, 'utf8'))
const client = new Client(databaseConfig)
await client.connect()
try {
  const { rows: [versions] } = await client.query(
    `SELECT current_setting('server_version') AS postgres, postgis_lib_version() AS postgis,
            postgis_geos_version() AS geos`)
  const { rows: [{ segments }] } = await client.query(
    'SELECT count(*)::int AS segments FROM core.route_segment')
  if (segments === 0) throw new Error('core.route_segment is empty; run npm run bootstrap first')

  // 1. QGIS rehearsal output, as loaded from the GeoPackage export.
  await client.query(`
    CREATE TEMP TABLE qgis_buffer AS
    SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 26917) AS geom`,
  [JSON.stringify(reference.buffer.geometry)])
  await client.query(`
    CREATE TEMP TABLE spike_access_point AS
    SELECT f->'properties'->>'id' AS id,
           f->'properties'->>'name' AS name,
           ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326), 26917) AS geom_proj
      FROM jsonb_array_elements($1::jsonb) AS f`,
  [JSON.stringify(reference.access_points.features)])
  await client.query('CREATE INDEX ON spike_access_point USING GIST (geom_proj)')
  await client.query('ANALYZE spike_access_point')

  // 2. Automate the buffer in PostGIS: dissolve the centreline, then buffer it.
  // quad_segs is segments per quarter circle: QGIS's Buffer tool defaults to 5,
  // PostGIS to 8. 16 is the setting that reproduces the QGIS output.
  const buildSql = `SELECT ST_Buffer(ST_Union(geom_proj), $1, $2) FROM core.route_segment`
  const build = {}
  for (const quadSegs of [5, 8, 16]) {
    build[`quad_segs_${quadSegs}`] = await time(client, buildSql, [halfMileM, `quad_segs=${quadSegs}`])
  }
  await client.query(`
    CREATE TEMP TABLE postgis_buffer AS
    SELECT q AS quad_segs, ST_Buffer(ST_Union(geom_proj), $1, 'quad_segs=' || q) AS geom
      FROM core.route_segment, (VALUES (5), (8), (16)) AS v(q)
     GROUP BY q`, [halfMileM])

  const { rows: comparison } = await client.query(`
    SELECT p.quad_segs,
           ST_NumGeometries(p.geom) AS parts,
           round((ST_Area(p.geom) / 1e6)::numeric, 4) AS postgis_area_km2,
           round((ST_Area(q.geom) / 1e6)::numeric, 4) AS qgis_area_km2,
           round((ST_Area(ST_SymDifference(p.geom, q.geom)) / 1e6)::numeric, 5) AS symdiff_km2,
           round(ST_HausdorffDistance(ST_Boundary(p.geom), ST_Boundary(q.geom))::numeric, 2) AS hausdorff_m
      FROM postgis_buffer p CROSS JOIN qgis_buffer q
     ORDER BY p.quad_segs`)

  // 3. Corridor inclusion and distance to the trail for the 54 access points.
  // ST_DWithin against the segments is the method of record; point-in-buffer
  // against both polygons is the cross-check.
  const { rows: accessPoints } = await client.query(`
    SELECT a.id, a.name,
           round(d.distance_m::numeric, 1) AS distance_to_trail_m,
           EXISTS (SELECT 1 FROM core.route_segment s
                    WHERE ST_DWithin(s.geom_proj, a.geom_proj, $1)) AS dwithin,
           ST_Intersects(p.geom, a.geom_proj) AS in_postgis_buffer,
           ST_Intersects(q.geom, a.geom_proj) AS in_qgis_buffer
      FROM spike_access_point a
     CROSS JOIN qgis_buffer q
      JOIN postgis_buffer p ON p.quad_segs = 16
     CROSS JOIN LATERAL (
           SELECT ST_Distance(s.geom_proj, a.geom_proj) AS distance_m
             FROM core.route_segment s
            ORDER BY s.geom_proj <-> a.geom_proj
            LIMIT 1) d
     ORDER BY d.distance_m DESC`, [halfMileM])
  const inclusion = {
    total: accessPoints.length,
    inside_dwithin: accessPoints.filter((a) => a.dwithin).length,
    inside_postgis_buffer: accessPoints.filter((a) => a.in_postgis_buffer).length,
    inside_qgis_buffer: accessPoints.filter((a) => a.in_qgis_buffer).length,
    disagreements: accessPoints.filter(
      (a) => a.dwithin !== a.in_postgis_buffer || a.dwithin !== a.in_qgis_buffer),
    outside: accessPoints.filter((a) => !a.dwithin),
    farthest_inside: accessPoints.filter((a) => a.dwithin).slice(0, 5),
  }

  // 4. Timing baseline for NFR-PRF-03. Real volume first, then synthetic
  // points scattered over the corridor's surroundings to see how it scales.
  const corridorSql = (table) => `
    SELECT count(*) FROM ${table} a
     WHERE EXISTS (SELECT 1 FROM core.route_segment s
                    WHERE ST_DWithin(s.geom_proj, a.geom_proj, $1))`
  const nearestSql = (table) => `
    SELECT a.ctid, d.distance_m FROM ${table} a
     CROSS JOIN LATERAL (
           SELECT ST_Distance(s.geom_proj, a.geom_proj) AS distance_m
             FROM core.route_segment s
            ORDER BY s.geom_proj <-> a.geom_proj
            LIMIT 1) d`
  const timing = {
    access_points: {
      rows: accessPoints.length,
      corridor_dwithin: await time(client, corridorSql('spike_access_point'), [halfMileM]),
      distance_to_trail: await time(client, nearestSql('spike_access_point')),
    },
  }

  await client.query('SELECT setseed(0.32)')
  for (const size of syntheticSizes) {
    const table = `spike_points_${size}`
    await client.query(`
      CREATE TEMP TABLE ${table} AS
      SELECT ST_SetSRID(ST_MakePoint(
               ST_XMin(e) + random() * (ST_XMax(e) - ST_XMin(e)),
               ST_YMin(e) + random() * (ST_YMax(e) - ST_YMin(e))), 26917) AS geom_proj
        FROM (SELECT ST_Expand(ST_Extent(geom_proj)::geometry, 2000) AS e
                FROM core.route_segment) x,
             generate_series(1, $1)`, [size])
    await client.query(`CREATE INDEX ON ${table} USING GIST (geom_proj)`)
    await client.query(`ANALYZE ${table}`)
    timing[`synthetic_${size}`] = {
      rows: size,
      corridor_dwithin: await time(client, corridorSql(table), [halfMileM]),
      corridor_dwithin_no_index: await timeWithoutIndex(client, corridorSql(table), [halfMileM]),
      corridor_point_in_buffer: await time(client, `
        SELECT count(*) FROM ${table} a JOIN postgis_buffer p
          ON p.quad_segs = 16 AND ST_Intersects(p.geom, a.geom_proj)`),
      distance_to_trail: await time(client, nearestSql(table)),
    }
  }

  console.log(JSON.stringify({
    versions,
    segments,
    buffer_distance_m: halfMileM,
    build,
    comparison,
    inclusion,
    timing,
  }, null, 2))
} finally {
  await client.end()
}
