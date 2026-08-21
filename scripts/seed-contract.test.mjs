import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateDocument } from './seed.mjs'

test('the committed extract is a complete consumer-side segment contract', async () => {
  const document = JSON.parse(await readFile(new URL('../seed/segments.seed.geojson', import.meta.url)))
  const rows = validateDocument(document)

  assert.equal(rows.length, 51)
  assert.ok(rows.every((row) => row.geometry.type === 'LineString'))
  assert.ok(rows.every((row) => row.phase && row.type && row.sourceRef))
})