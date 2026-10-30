// Master Data load: what the committed CSVs must produce, and that loading twice
// changes nothing. Needs DATABASE_URL and the 51 route segments already loaded
// (npm run seed, or npm run etl:segments in CI).

import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import pg from 'pg'
import masterData, { prepare } from './etl/masterData.js'
import { loadTranslations, readCsvObjects } from './etl/translations.js'

const DIR = resolve(import.meta.dirname, '../docs/etl/master_data')
const read = (f) => readCsvObjects(resolve(DIR, f)).records

test('every Master Data record translates, and only Park East is quarantined', () => {
  const prepared = prepare({
    accessPoints: read('access_points.csv'),
    restroom: read('restroom.csv'),
    destinations: read('destinations.csv'),
    parks: read('parks.csv'),
    audit: read('geocoding_audit.csv'),
  }, loadTranslations())

  const all = Object.values(prepared).flat()
  const quarantined = all.filter((r) => r.loadError).map((r) => r.sourceRef)
  assert.deepEqual(quarantined, ['framework_park_park-east'])
  assert.equal(prepared.accessPoints.length, 55)
  assert.equal(prepared.restroom.length, 1)
  assert.equal(prepared.destinations.length, 19)
  assert.equal(prepared.parks.length, 33)
})

test('loading twice leaves 55 access points and 52 POIs with no duplicates', async () => {
  const first = await masterData.run({ path: DIR })
  const second = await masterData.run({ path: DIR })
  assert.equal(first.status, 'succeeded')
  assert.equal(second.status, 'succeeded')
  assert.equal(second.accessPoints.inserted, 0, 'second run must not insert access points')
  assert.equal(second.restroom.inserted + second.frameworkPlan.inserted, 0, 'second run must not insert POIs')

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows: [ap] } = await client.query(
      `SELECT count(*)::int AS n, count(DISTINCT source_ref)::int AS distinct_refs,
              count(*) FILTER (WHERE nearest_route_segment_id IS NULL)::int AS unenriched
         FROM core.access_point WHERE source = 'jlg_curated'`)
    assert.deepEqual(ap, { n: 55, distinct_refs: 55, unenriched: 0 })

    const { rows } = await client.query(
      `SELECT poi_type_code AS type, count(*)::int AS n
         FROM core.point_of_interest
        WHERE source IN ('jlg_curated', 'framework_plan_vol1')
        GROUP BY 1 ORDER BY 1`)
    assert.deepEqual(rows, [{ type: 'landmark', n: 19 }, { type: 'park', n: 32 }, { type: 'restroom', n: 1 }])

    const { rows: [restroom] } = await client.query(
      `SELECT a.source_ref FROM core.point_of_interest p JOIN core.access_point a ON a.id = p.access_point_id
        WHERE p.poi_type_code = 'restroom'`)
    assert.equal(restroom.source_ref, 'AP-25')
  } finally {
    await client.end()
  }
})

test.after(async () => {
  const { closePool } = await import('../src/db/pool.js')
  await closePool?.()
})
