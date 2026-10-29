import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DETROIT_PMTILES_URL,
  OSM_ATTRIBUTION_HTML,
  OSM_ATTRIBUTION_TEXT,
  pmtilesSource,
} from './tiles/attribution.js'
import {
  bboxToExtractFlag,
  DETROIT_BBOX,
} from './tiles/detroitRegion.js'
import { parseArgs } from './tiles/run.mjs'
import { coversBbox, parseHeader } from './tiles/verify.mjs'

function fakeHeader({ version = 3, bounds = DETROIT_BBOX } = {}) {
  const buf = Buffer.alloc(127)
  buf.write('PMTiles', 0, 'ascii')
  buf[7] = version
  buf[100] = 0
  buf[101] = 15
  buf.writeInt32LE(Math.round(bounds.minLon * 1e7), 102)
  buf.writeInt32LE(Math.round(bounds.minLat * 1e7), 106)
  buf.writeInt32LE(Math.round(bounds.maxLon * 1e7), 110)
  buf.writeInt32LE(Math.round(bounds.maxLat * 1e7), 114)
  return buf
}

test('DETROIT_BBOX covers the committed greenway extent', async () => {
  const document = JSON.parse(
    await readFile(
      new URL('../seed/segments.seed.geojson', import.meta.url),
    ),
  )

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    } else {
      coords.forEach(walk)
    }
  }

  document.features.forEach((feature) => walk(feature.geometry.coordinates))

  assert.ok(minLon >= DETROIT_BBOX.minLon)
  assert.ok(maxLon <= DETROIT_BBOX.maxLon)
  assert.ok(minLat >= DETROIT_BBOX.minLat)
  assert.ok(maxLat <= DETROIT_BBOX.maxLat)
})

test('bboxToExtractFlag matches the pmtiles CLI syntax', () => {
  assert.equal(
    bboxToExtractFlag(DETROIT_BBOX),
    '--bbox=-83.5,42,-82.8,42.6',
  )
})

test('Detroit PMTiles URL points at the project GitHub Pages site', () => {
  assert.equal(
    DETROIT_PMTILES_URL,
    'https://wassupitzmaha.github.io/jlgmapapp-tiles/detroit.pmtiles',
  )
})

test('the attribution carries required OpenStreetMap credit', () => {
  assert.match(OSM_ATTRIBUTION_HTML, /openstreetmap\.org\/copyright/)
  assert.match(OSM_ATTRIBUTION_HTML, /OpenStreetMap/)
  assert.match(OSM_ATTRIBUTION_TEXT, /OpenStreetMap/)
})

test('pmtilesSource defaults to the project-hosted Detroit archive', () => {
  const source = pmtilesSource()

  assert.equal(source.type, 'vector')
  assert.equal(
    source.url,
    `pmtiles://${DETROIT_PMTILES_URL}`,
  )
  assert.equal(source.attribution, OSM_ATTRIBUTION_HTML)
})

test('pmtilesSource accepts an alternate PMTiles URL', () => {
  const source = pmtilesSource(
    'https://tiles.example.com/example.pmtiles',
  )

  assert.equal(
    source.url,
    'pmtiles://https://tiles.example.com/example.pmtiles',
  )
})

test('parseArgs reads source, output, maxzoom and dry-run', () => {
  const opts = parseArgs([
    '--source',
    'https://build.protomaps.com/20260821.pmtiles',
    '--output',
    'tmp/detroit.pmtiles',
    '--maxzoom',
    '14',
    '--dry-run',
  ])

  assert.deepEqual(opts, {
    source: 'https://build.protomaps.com/20260821.pmtiles',
    output: 'tmp/detroit.pmtiles',
    maxzoom: '14',
    dryRun: true,
  })
})

test('parseArgs defaults maxzoom to null and dryRun to false', () => {
  const opts = parseArgs([
    '--source',
    'src.pmtiles',
    '--output',
    'out.pmtiles',
  ])

  assert.equal(opts.maxzoom, null)
  assert.equal(opts.dryRun, false)
})

test('parseArgs rejects an unknown flag', () => {
  assert.throws(
    () => parseArgs(['--bogus']),
    /unknown argument --bogus/,
  )
})

test('parseArgs rejects a flag missing its value', () => {
  assert.throws(
    () => parseArgs(['--source']),
    /--source needs a value/,
  )
})

test('parseHeader reads version, zooms and bounds from a PMTiles v3 header', () => {
  const header = parseHeader(fakeHeader())

  assert.equal(header.version, 3)
  assert.equal(header.minZoom, 0)
  assert.equal(header.maxZoom, 15)
  assert.deepEqual(header.bounds, DETROIT_BBOX)
})

test('parseHeader rejects bytes that are not a PMTiles archive', () => {
  assert.throws(
    () => parseHeader(Buffer.alloc(127)),
    /missing PMTiles magic bytes/,
  )
})

test('parseHeader rejects a truncated header', () => {
  assert.throws(
    () => parseHeader(Buffer.from('PMTiles')),
    /expected 127/,
  )
})

test('coversBbox is false when the archive misses part of Detroit', () => {
  assert.equal(coversBbox(DETROIT_BBOX, DETROIT_BBOX), true)
  assert.equal(
    coversBbox({ ...DETROIT_BBOX, maxLat: 42.5 }, DETROIT_BBOX),
    false,
  )
})
