import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import app from '../dist/app.js'
import pool from '../dist/db/pool.js'

// PROVISIONAL: replace this value when NFR-PRF-01 is ratified.
const PROVISIONAL_SEGMENTS_RESPONSE_BUDGET_BYTES = 32 * 1024

let server
let baseUrl

before(async () => {
  server = app.listen(0)

  await new Promise((resolve) => server.once('listening', resolve))

  const address = server.address()
  assert.ok(address && typeof address === 'object')

  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  await pool.end()
})

test('GET /api/v1/segments emits only EPSG:4326 source geometry', async () => {
  const response = await fetch(`${baseUrl}/api/v1/segments`)
  assert.equal(response.status, 200)

  const body = await response.json()

  const result = await pool.query(`
    SELECT
      id::text AS segment_id,
      ST_SRID(geom) AS srid,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM core.route_segment
    ORDER BY id
  `)

  const featuresById = new Map(
    body.features.map((feature) => [
      feature.properties.segment_id,
      feature,
    ]),
  )

  assert.equal(featuresById.size, result.rows.length)

  for (const row of result.rows) {
    assert.equal(row.srid, 4326, `segment ${row.segment_id} has wrong SRID`)

    const feature = featuresById.get(row.segment_id)
    assert.ok(feature, `segment ${row.segment_id} missing from API response`)

    assert.deepEqual(
      feature.geometry,
      row.geometry,
      `segment ${row.segment_id} did not emit the EPSG:4326 geom column`,
    )
  }
})

test('GET /api/v1/segments stays within the provisional response-size budget', async () => {
  const response = await fetch(`${baseUrl}/api/v1/segments`)
  assert.equal(response.status, 200)

  const text = await response.text()
  const responseBytes = Buffer.byteLength(text, 'utf8')

  assert.ok(
    responseBytes <= PROVISIONAL_SEGMENTS_RESPONSE_BUDGET_BYTES,
    `response is ${responseBytes} bytes; provisional budget is ${PROVISIONAL_SEGMENTS_RESPONSE_BUDGET_BYTES} bytes`,
  )
})
