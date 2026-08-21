import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

const { Client } = pg
const repositoryRoot = resolve(import.meta.dirname, '..')
const seedPath = resolve(repositoryRoot, 'seed/segments.seed.geojson')
const source = 'city_route_segments'
const expectedFeatureCount = 51
const databaseConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
}

export function validateDocument(document) {
  if (document.type !== 'FeatureCollection' || !Array.isArray(document.features)) {
    throw new Error('Seed file must be a GeoJSON FeatureCollection')
  }
  if (document.features.length !== expectedFeatureCount) {
    throw new Error(`Expected ${expectedFeatureCount} seed features, found ${document.features.length}`)
  }

  return document.features.map((feature, index) => {
    const properties = feature.properties ?? {}
    if (feature.type !== 'Feature' || feature.geometry?.type !== 'LineString') {
      throw new Error(`Seed feature ${index} must contain a LineString geometry`)
    }
    if (!properties.source_ref || !properties.status_code || !properties.type_code) {
      throw new Error(`Seed feature ${index} has incomplete segment properties`)
    }
    return {
      sourceRef: properties.source_ref,
      name: properties.name,
      geometry: feature.geometry,
      phase: properties.status_code,
      type: properties.type_code,
    }
  })
}

export async function loadSeed({ client = new Client(databaseConfig) } = {}) {
  const document = JSON.parse(await readFile(seedPath, 'utf8'))
  const rows = validateDocument(document)
  const ownsClient = !client._connected

  if (ownsClient) await client.connect()
  try {
    await client.query('BEGIN')
    for (const row of rows) {
      await client.query(
        `INSERT INTO core.route_segment
           (greenway_id, name, geom, status_code, type_code, source, source_ref)
         SELECT g.id, $1, ST_SetSRID(ST_GeomFromGeoJSON($2::jsonb), 4326), $3, $4, $5, $6
           FROM core.greenway AS g
          WHERE g.name = 'Joe Louis Greenway'
         ON CONFLICT (source, source_ref) DO UPDATE SET
           name = EXCLUDED.name,
           geom = EXCLUDED.geom,
           status_code = EXCLUDED.status_code,
           type_code = EXCLUDED.type_code`,
        [row.name, JSON.stringify(row.geometry), row.phase, row.type, source, row.sourceRef],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    if (ownsClient) await client.end()
  }

  return rows.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = await loadSeed()
  console.log(`Loaded ${count} route segments from ${seedPath}`)
}