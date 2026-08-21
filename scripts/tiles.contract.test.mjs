import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { OSM_ATTRIBUTION_HTML, OSM_ATTRIBUTION_TEXT, pmtilesSource } from './tiles/attribution.js'
import { bboxToExtractFlag, DETROIT_BBOX } from './tiles/detroitRegion.js'
import { buildCreateBucketArgs, buildPutObjectArgs } from './tiles/wrangler.js'
import { parseArgs } from './tiles/run.mjs'

test('DETROIT_BBOX covers the committed greenway extent', async () => {
  const document = JSON.parse(await readFile(new URL('../seed/segments.seed.geojson', import.meta.url)))

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
    } else {
      coords.forEach(walk)
    }
  }
  document.features.forEach((f) => walk(f.geometry.coordinates))

  // A bbox tight enough to miss the greenway itself would silently produce a
  // basemap with holes in it — this is the same failure shape D2 exists to
  // catch for the API, one layer down in the stack.
  assert.ok(minLon >= DETROIT_BBOX.minLon && maxLon <= DETROIT_BBOX.maxLon)
  assert.ok(minLat >= DETROIT_BBOX.minLat && maxLat <= DETROIT_BBOX.maxLat)
})

test('bboxToExtractFlag matches the pmtiles CLI --bbox syntax', () => {
  assert.equal(bboxToExtractFlag(DETROIT_BBOX), '--bbox=-83.5,42,-82.8,42.6')
})

test('the attribution carries required OpenStreetMap ODbL credit', () => {
  assert.match(OSM_ATTRIBUTION_HTML, /openstreetmap\.org\/copyright/)
  assert.match(OSM_ATTRIBUTION_HTML, /OpenStreetMap/)
  assert.match(OSM_ATTRIBUTION_TEXT, /OpenStreetMap/)
})

test('pmtilesSource carries the attribution on the source object itself', () => {
  const source = pmtilesSource('https://tiles.example.com/detroit.pmtiles')

  assert.equal(source.type, 'vector')
  assert.equal(source.url, 'pmtiles://https://tiles.example.com/detroit.pmtiles')
  assert.equal(source.attribution, OSM_ATTRIBUTION_HTML)
})

test('buildCreateBucketArgs matches the wrangler r2 bucket create syntax', () => {
  assert.deepEqual(buildCreateBucketArgs('jlgmapapp-tiles'), ['r2', 'bucket', 'create', 'jlgmapapp-tiles'])
})

test('buildPutObjectArgs matches the wrangler r2 object put syntax and forces --remote', () => {
  const args = buildPutObjectArgs({
    bucket: 'jlgmapapp-tiles',
    key: 'basemaps/detroit.pmtiles',
    filePath: 'tmp/detroit.pmtiles',
    contentType: 'application/octet-stream',
  })

  assert.deepEqual(args, [
    'r2', 'object', 'put', 'jlgmapapp-tiles/basemaps/detroit.pmtiles',
    '--file', 'tmp/detroit.pmtiles',
    '--content-type', 'application/octet-stream',
    '--remote',
  ])
})

test('parseArgs reads source, output, key, maxzoom and dry-run', () => {
  const opts = parseArgs([
    '--source', 'https://build.protomaps.com/20260820.pmtiles',
    '--output', 'tmp/detroit.pmtiles',
    '--key', 'basemaps/detroit.pmtiles',
    '--maxzoom', '14',
    '--dry-run',
  ])

  assert.deepEqual(opts, {
    source: 'https://build.protomaps.com/20260820.pmtiles',
    output: 'tmp/detroit.pmtiles',
    key: 'basemaps/detroit.pmtiles',
    maxzoom: '14',
    dryRun: true,
  })
})

test('parseArgs defaults key to basemaps/detroit.pmtiles and dryRun to false', () => {
  const opts = parseArgs(['--source', 'src.pmtiles', '--output', 'out.pmtiles'])

  assert.equal(opts.key, 'basemaps/detroit.pmtiles')
  assert.equal(opts.dryRun, false)
  assert.equal(opts.maxzoom, null)
})

test('parseArgs rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown argument --bogus/)
})

test('parseArgs rejects a flag missing its value', () => {
  assert.throws(() => parseArgs(['--source']), /--source needs a value/)
})
