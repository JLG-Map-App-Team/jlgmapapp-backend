/**
 * Stage C4 database test — the ETL load, against a real containerised PostGIS.
 *
 * WHAT THIS REPLACES, AND WHY
 *
 *   scripts/seed.test.mjs called loadSeed() from scripts/seed.mjs, which read
 *   the deleted seed/segments.seed.geojson. It could not import. Its assertions
 *   were worth keeping, though: it was the only test in the repository that
 *   touched a database, and the only one asserting that geom is EPSG:4326 while
 *   geom_proj is EPSG:26917. Those assertions are preserved here and pointed at
 *   the load path that actually exists — the ETL importer, which seed/README.md
 *   records as Stage C3's seed step.
 *
 *   This test does NOT load anything. It asserts the state the ETL leaves
 *   behind. Loading and verifying in the same file is how a test ends up
 *   passing because the loader it calls is the loader it is meant to be
 *   checking. Run `npm run etl:segments` first; CI does exactly that.
 *
 * CONNECTION CONFIGURATION
 *
 *   Via src/db/pool.js, deliberately. The previous version assembled its own
 *   config from PGHOST/PGPORT/PGDATABASE with localhost and port 5432 defaults —
 *   a second source of connection truth, and the precise failure pool.js's
 *   header warns about: "a fallback connection string is how a script gets
 *   pointed at the wrong database." pool.js requires DATABASE_URL and refuses a
 *   default, so an unset variable fails loudly here instead of silently testing
 *   whatever happens to be listening on 5432.
 */

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import pool, { closePool } from '../src/db/pool.js'

// M016 records this dataset as 51 segments; scripts/etl/cityRouteSegments.js
// treats any other count as fatal. Asserted, not assumed.
const EXPECTED_SEGMENTS = 51
const SOURCE = 'city_route_segments'

after(async () => {
  await closePool()
})

test('the ETL load leaves 51 segments in both coordinate systems', async () => {
  const { rows } = await pool.query(
    `SELECT count(*)::int                                          AS total,
            count(*) FILTER (WHERE ST_SRID(geom) = 4326)::int       AS wgs84,
            count(*) FILTER (WHERE ST_SRID(geom_proj) = 26917)::int AS projected,
            count(*) FILTER (WHERE geom_proj IS NULL)::int          AS unprojected
       FROM core.route_segment
      WHERE source = $1`,
    [SOURCE],
  )

  // geom is authored in EPSG:4326 and served as GeoJSON per RFC 7946 section 4.
  // geom_proj is derived by the core.set_geom_proj trigger (M05) as
  // ST_Transform(geom, 26917) and is what every measurement uses. Both must
  // hold for all 51 rows: a null geom_proj means the trigger did not fire, and
  // the routing tables in M008 are typed 26917, so the rebuild would then
  // silently see nothing.
  assert.deepEqual(rows[0], {
    total: EXPECTED_SEGMENTS,
    wgs84: EXPECTED_SEGMENTS,
    projected: EXPECTED_SEGMENTS,
    unprojected: 0,
  })
})

test('every segment carries a source_ref, and no two share one', async () => {
  const { rows } = await pool.query(
    `SELECT count(*)::int                    AS total,
            count(DISTINCT source_ref)::int  AS distinct_refs,
            count(*) FILTER (WHERE source_ref IS NULL)::int AS missing
       FROM core.route_segment
      WHERE source = $1`,
    [SOURCE],
  )

  // route_segment_source_ref_unique (M07) already forbids a duplicate, so this
  // cannot fail by insertion. It can fail by absence: source_ref is nullable,
  // and a null does not violate a unique constraint. openapi.yaml states that
  // segment_id is stable, and roadmap item B-O2 records that the claim depends
  // on the upsert key being present on every row.
  assert.equal(rows[0].total, EXPECTED_SEGMENTS)
  assert.equal(rows[0].distinct_refs, EXPECTED_SEGMENTS)
  assert.equal(rows[0].missing, 0)
})

test('the ETL run recorded itself as succeeded', async () => {
  const { rows } = await pool.query(
    `SELECT status, rows_inserted, rows_updated, source_feature_count
       FROM staging.etl_run
      WHERE source = $1
      ORDER BY id DESC
      LIMIT 1`,
    [SOURCE],
  )

  // The importer commits the core load BEFORE rebuilding the topology, and
  // routing.rebuild_topology deliberately does not raise on an integrity
  // failure — it returns severity 'ABORT' and the caller sets status 'failed'.
  // So a load can leave 51 correct segments behind while the routing topology
  // did not update at all. Reading the run status is the only way this test can
  // tell those two outcomes apart.
  assert.equal(rows.length, 1, 'no ETL run was recorded for this source')
  assert.equal(rows[0].status, 'succeeded')
  assert.equal(rows[0].source_feature_count, EXPECTED_SEGMENTS)
})
