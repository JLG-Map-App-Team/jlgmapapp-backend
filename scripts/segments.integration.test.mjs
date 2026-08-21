import assert from 'node:assert/strict'
import test from 'node:test'

import app from '../dist/app.js'
import pool from '../dist/db/pool.js'

test('GET /api/v1/segments returns real PostGIS segments as GeoJSON', async (t) => {
  const server = app.listen(0)

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await pool.end()
  })

  await new Promise((resolve) => server.once('listening', resolve))

  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/segments`,
  )

  assert.equal(response.status, 200)
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/geo\+json/,
  )

  const body = await response.json()

  assert.equal(body.type, 'FeatureCollection')
  assert.equal(body.features.length, 51)
  assert.ok(body.features.every((feature) => feature.type === 'Feature'))
  assert.ok(
    body.features.every((feature) => feature.geometry.type === 'LineString'),
  )
  assert.ok(
    body.features.every(
      (feature) =>
        typeof feature.properties.segment_id === 'string' &&
        'phase' in feature.properties &&
        'phase_label' in feature.properties &&
        'type' in feature.properties &&
        'type_label' in feature.properties,
    ),
  )
})
