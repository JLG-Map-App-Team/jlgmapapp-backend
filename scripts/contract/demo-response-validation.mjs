#!/usr/bin/env node
/**
 * Demonstrates what runtime response validation catches that the generated
 * TypeScript types cannot. Evidence for roadmap item B-O4.
 *
 * Every payload below is built the way a real controller would build it, from a
 * real PostGIS query. Each one would satisfy the generated types at the point of
 * construction — the mapper returns an object the compiler accepts.
 *
 * Usage:  npm run contract:demo      (requires a loaded database)
 */

import pool, { closePool } from '../../src/db/pool.js';
import { assertSegmentsResponse } from './response-validator.mjs';

const BASE = `
  SELECT rs.source_ref AS segment_id,
         rs.status_code AS phase,
         ss.label       AS phase_label,
         rs.type_code   AS type,
         st.label       AS type_label,
         ST_AsGeoJSON(%GEOM%, 7) AS geojson
    FROM core.route_segment rs
    LEFT JOIN core.segment_status ss ON ss.code = rs.status_code
    LEFT JOIN core.segment_type   st ON st.code = rs.type_code
   WHERE rs.source = 'city_route_segments'
   ORDER BY rs.id
`;

// This is the mapper. Note `JSON.parse` — its return type is `any`, so whatever
// comes out of the database passes straight through the type system untouched.
// This is the hole. It is not a mistake in the mapper; it is what JSON.parse is.
function toFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: JSON.parse(r.geojson),
      properties: {
        segment_id: String(r.segment_id),
        phase: r.phase,
        phase_label: r.phase_label,
        type: r.type,
        type_label: r.type_label,
      },
    })),
  };
}

async function scenario(label, sql, mutate) {
  const { rows } = await pool.query(sql);
  let payload = toFeatureCollection(rows);
  if (mutate) payload = mutate(payload);

  process.stdout.write(`\n${label}\n`);
  try {
    const ok = assertSegmentsResponse(payload);
    process.stdout.write(`  PASS  ${ok.features} features, ${ok.bytes} bytes\n`);
    return true;
  } catch (err) {
    const [first, ...rest] = String(err.message).split('\n');
    process.stdout.write(`  CAUGHT  ${first}\n`);
    rest.slice(0, 3).forEach((l) => process.stdout.write(`          ${l.trim()}\n`));
    return false;
  }
}

const results = [];

results.push(['1. correct response (geom, EPSG:4326)',
  await scenario('1. correct response — ST_AsGeoJSON(geom), EPSG:4326',
    BASE.replace('%GEOM%', 'rs.geom'))]);

results.push(['2. projected CRS leak (geom_proj, EPSG:26917)',
  await scenario('2. THE D2 FAULT — ST_AsGeoJSON(geom_proj), EPSG:26917\n   Structurally valid GeoJSON. Compiles. Draws in the Gulf of Guinea.',
    BASE.replace('%GEOM%', 'rs.geom_proj'))]);

results.push(['3. vocabulary drift (code not in the enum)',
  await scenario('3. VOCABULARY DRIFT — a status code that exists in the database but not in the spec enum\n   Simulates someone adding a vocabulary row without amending openapi.yaml.',
    BASE.replace('%GEOM%', 'rs.geom'),
    (p) => { p.features[0].properties.phase = 'partially_open'; return p; })]);

results.push(['4. elevation in a position (3 ordinates)',
  await scenario('4. THREE-ORDINATE POSITION — a Z value introduced upstream\n   The contract forbids elevation; Position is maxItems 2.',
    BASE.replace('%GEOM%', 'rs.geom'),
    (p) => { p.features[0].geometry.coordinates[0] = [...p.features[0].geometry.coordinates[0], 180.5]; return p; })]);

results.push(['5. missing required field',
  await scenario('5. MISSING REQUIRED FIELD — phase_label dropped by a refactor',
    BASE.replace('%GEOM%', 'rs.geom'),
    (p) => { delete p.features[0].properties.phase_label; return p; })]);



process.stdout.write('\n' + '-'.repeat(72) + '\n');
process.stdout.write('SUMMARY — every payload above satisfies the generated TypeScript types\n');
process.stdout.write('at the point of construction, because JSON.parse returns `any` and the\n');
process.stdout.write('database columns are text.\n\n');
for (const [label, passed] of results) {
  process.stdout.write(`  ${passed ? 'passed validation' : 'CAUGHT by validation'}   ${label}\n`);
}
const caught = results.filter(([, p]) => !p).length;
process.stdout.write(`\n  ${caught} of ${results.length} faults caught at runtime that the compiler could not see.\n`);

await closePool();
