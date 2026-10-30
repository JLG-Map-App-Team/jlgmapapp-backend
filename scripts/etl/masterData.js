/**
 * Master Data importer — access points, the Warren restroom, Framework Plan
 * destinations and Framework Plan parks.
 *
 * INPUT
 *   docs/etl/master_data/*.csv — one file per sheet of the Phase 1 Master Data
 *   Collection workbook (rev 2, 12 Aug 2026), exported verbatim. Committed, so a
 *   teammate who clones the repo loads exactly what everyone else loads, with no
 *   Google Drive access and no network. Re-export the CSVs when the workbook
 *   changes; the loader refuses a file whose header or row count drifts.
 *
 * PIPELINE (Data Loading Plan §4, per sheet)
 *   open etl_run -> stage raw rows -> validate + translate -> upsert core ->
 *   close run. Then spatial enrichment for every loaded row.
 *
 * VOCABULARY
 *   Every categorical value goes through scripts/etl/translations.js, which
 *   reads scripts/data-validation/code_translations.csv. Nothing here maps a
 *   raw value to a code by itself. An untranslatable value quarantines the
 *   record (staged with load_error, never reaches core) instead of guessing.
 *
 * IDEMPOTENCY
 *   Upsert on (source, source_ref). A second run updates the same rows and
 *   inserts nothing. source_ref is the stable key from the ETL field mapping:
 *     access points   AP-01 ... (the sheet's Unique ID)
 *     restroom        jlg_restroom_<slug(name)>
 *     destinations    framework_destination_<map # padded to 2>
 *     parks           framework_park_<slug(name)>
 *
 * DECISIONS THIS ENCODES (each also recorded in code_translations.csv or here)
 *   * Landmarks: core.point_of_interest requires landmark_type_code for every
 *     landmark, and the Framework Plan destinations carry no type. All 19 load
 *     as 'other'. Data Loading Plan §6.2 flags this for Maha.
 *   * POI confidence: the Destinations and Parks sheets have no confidence
 *     column. A coordinate "Matched to AP-xx" inherits that access point's
 *     confidence; any other takes the Geocoding_Audit confidence for the same
 *     record. The restroom inherits AP-25's.
 *   * The restroom is linked to AP-25 (access_point_link_method 'authored'),
 *     because the source says it is there. No other POI is linked: borrowing an
 *     access point's coordinate is not the same as being served by it.
 *   * Distances are straight-line from geom_proj (EPSG:26917) to the nearest
 *     route segment. No proximity rejection: parks are editorial (migration
 *     0015) and the field mapping applies none to destinations.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pool from '../../src/db/pool.js';
import { loadTranslations, readCsvObjects } from './translations.js';

const SNAPSHOT_DATE = '2026-08-12'; // Master Data Collection rev 2
const BOUNDS = { minLat: 42.2, maxLat: 42.5, minLon: -83.3, maxLon: -82.9 }; // Detroit region

const SHEETS = {
  accessPoints: {
    file: 'access_points.csv', source: 'jlg_curated', expected: 55,
    header: ['Unique ID', 'Group', 'Name', 'Lat', 'Lon', 'City', 'Tier', 'Built status', 'Coordinate method',
      'Source confidence', 'Route segment (source)', 'Metres to centreline', 'Nearest segment (computed)',
      'Typology', 'Phase', 'Needs review?'],
  },
  restroom: {
    file: 'restroom.csv', source: 'jlg_curated', expected: 1,
    header: ['Name', 'poi_type_code', 'Lat', 'Lon', 'Metres to centreline', 'Nearest segment',
      'Coordinate method', 'Source', 'Note'],
  },
  destinations: {
    file: 'destinations.csv', source: 'framework_plan_vol1', expected: 19,
    header: ['Map #', 'Name', 'poi_type_code', 'Lat', 'Lon', 'Metres to centreline', 'Nearest segment',
      'Coordinate source', 'Status'],
  },
  parks: {
    file: 'parks.csv', source: 'framework_plan_vol1', expected: 33,
    header: ['Name', 'poi_type_code', 'Lat', 'Lon', 'Metres to centreline', 'Nearest segment',
      'Coordinate source', 'Status'],
  },
  audit: {
    file: 'geocoding_audit.csv', source: null, expected: 32,
    header: ['Record group', 'Name', 'Latitude', 'Longitude', 'Confidence', 'Method / source', 'Source URL',
      'Review note'],
  },
};

export const slug = (text) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function readSheets(dir) {
  const out = {};
  const fatal = [];
  const hash = createHash('sha256');
  for (const [key, cfg] of Object.entries(SHEETS)) {
    const path = join(dir, cfg.file);
    hash.update(readFileSync(path));
    const { header, records } = readCsvObjects(path);
    if (JSON.stringify(header) !== JSON.stringify(cfg.header)) {
      fatal.push(`${cfg.file}: header changed — expected ${cfg.header.join(' | ')}`);
    }
    if (records.length !== cfg.expected) {
      fatal.push(`${cfg.file}: expected ${cfg.expected} rows, found ${records.length}`);
    }
    out[key] = records;
  }
  return { sheets: out, fatal, sha256: hash.digest('hex') };
}

function coordinate(latRaw, lonRaw) {
  if (latRaw === '' || lonRaw === '') return { error: 'no coordinate' };
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: `coordinate not numeric (${latRaw}, ${lonRaw})` };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLon || lon > BOUNDS.maxLon) {
    return { error: `coordinate outside the Detroit region (${lat}, ${lon})` };
  }
  return { lat, lon };
}

/** Translate or record why not. Returns the code (possibly null) or undefined on failure. */
function tr(t, errors, domain, raw, field) {
  const result = t.translate(domain, raw);
  if (result.ok) return result.code;
  errors.push(`${field} "${raw}" ${result.reason === 'quarantine' ? 'is quarantined by rule' : 'has no translation'}`);
  return undefined;
}

export function prepare(sheets, t) {
  const audit = new Map(sheets.audit.map((a) => [`${a['Record group']}|${a.Name}`, a]));

  // ---- access points --------------------------------------------------------
  const accessPoints = sheets.accessPoints.map((r) => {
    const errors = [];
    const c = coordinate(r.Lat, r.Lon);
    if (c.error) errors.push(c.error);
    const builtRaw = tr(t, errors, 'built_status', r['Built status'], 'Built status');
    const row = {
      sourceRef: r['Unique ID'].trim().toUpperCase(),
      name: r.Name.trim(),
      lat: c.lat, lon: c.lon,
      city: r.City.trim() || null,
      subtypeCode: tr(t, errors, 'access_tier', r.Tier, 'Tier'),
      isBuilt: builtRaw === 'true',
      coordinateMethod: tr(t, errors, 'coordinate_method', r['Coordinate method'], 'Coordinate method'),
      coordinateConfidence: tr(t, errors, 'coordinate_confidence', r['Source confidence'], 'Source confidence'),
      raw: r,
    };
    if (!row.sourceRef) errors.push('missing Unique ID');
    if (!row.name) errors.push('missing Name');
    if (builtRaw !== undefined && builtRaw !== 'true' && builtRaw !== 'false') errors.push(`Built status translated to "${builtRaw}", not true/false`);
    row.loadError = errors.length ? errors.join('; ') : null;
    return row;
  });
  const apConfidence = new Map(accessPoints.map((a) => [a.sourceRef, a.coordinateConfidence]));

  // ---- POIs -----------------------------------------------------------------
  function poi(r, { sourceRef, group, methodField, gate }) {
    const errors = [];
    if (gate !== undefined) {
      const status = tr(t, errors, 'load_status', gate, 'Status');
      if (status !== undefined && status !== 'eligible') errors.push(`Status "${gate}" is not eligible`);
    }
    const c = coordinate(r.Lat, r.Lon);
    if (c.error) errors.push(c.error);
    const poiType = tr(t, errors, 'poi_type', r.poi_type_code.trim().toLowerCase(), 'poi_type_code');
    const methodRaw = r[methodField];
    const coordinateMethod = tr(t, errors, 'coordinate_method', methodRaw, methodField);

    // Confidence: from the matched access point, else from the geocoding audit.
    const apRef = (methodRaw.match(/AP-[0-9A-Z-]+?(?= \(|$)/) || [])[0]
      ?? ((r.Source || '').match(/AP-\d+/) || [])[0];
    const auditRow = group ? audit.get(`${group}|${r.Name}`) : undefined;
    let coordinateConfidence = null;
    if (apRef && apConfidence.has(apRef)) coordinateConfidence = apConfidence.get(apRef);
    else if (auditRow) coordinateConfidence = tr(t, errors, 'coordinate_confidence', auditRow.Confidence, 'audit Confidence');
    else errors.push('no confidence: neither a matched access point nor a Geocoding_Audit row');

    const row = {
      sourceRef, name: r.Name.trim(), poiType, lat: c.lat, lon: c.lon,
      coordinateMethod, coordinateConfidence,
      sourceUrl: auditRow?.['Source URL'] || null,
      landmarkType: poiType === 'landmark' ? 'other' : null,
      apRef, raw: r,
    };
    if (!row.name) errors.push('missing Name');
    row.loadError = errors.length ? errors.join('; ') : null;
    return row;
  }

  const restroom = sheets.restroom.map((r) =>
    poi(r, { sourceRef: `jlg_restroom_${slug(r.Name)}`, group: null, methodField: 'Coordinate method' }));
  const destinations = sheets.destinations.map((r) =>
    poi(r, { sourceRef: `framework_destination_${String(r['Map #']).padStart(2, '0')}`, group: 'Destination',
      methodField: 'Coordinate source', gate: r.Status }));
  const parks = sheets.parks.map((r) =>
    poi(r, { sourceRef: `framework_park_${slug(r.Name)}`, group: 'Park', methodField: 'Coordinate source', gate: r.Status }));

  // Duplicate keys within one source would make the upsert silently merge records.
  for (const [label, rows] of [['access points', accessPoints], ['POIs (jlg_curated)', restroom],
    ['POIs (framework_plan_vol1)', [...destinations, ...parks]]]) {
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.sourceRef)) throw new Error(`duplicate source_ref ${row.sourceRef} in ${label}`);
      seen.add(row.sourceRef);
    }
  }

  return { accessPoints, restroom, destinations, parks };
}

async function openRun(client, source, count) {
  const { rows: [run] } = await client.query(
    `INSERT INTO staging.etl_run (source, source_snapshot_date, status, source_feature_count)
     VALUES ($1, $2, 'running', $3) RETURNING id`, [source, SNAPSHOT_DATE, count]);
  return run.id;
}

async function closeRun(client, runId, counts) {
  await client.query(
    `UPDATE staging.etl_run SET status = 'succeeded', finished_at = now(),
            rows_inserted = $2, rows_updated = $3, rows_rejected = $4
      WHERE id = $1`, [runId, counts.inserted, counts.updated, counts.rejected]);
}

const tally = (results) => results.reduce((acc, r) => {
  if (r === null) acc.rejected += 1; else if (r) acc.inserted += 1; else acc.updated += 1;
  return acc;
}, { inserted: 0, updated: 0, rejected: 0 });

async function loadAccessPoints(client, rows) {
  const runId = await openRun(client, 'jlg_curated', rows.length);
  const results = [];
  for (const r of rows) {
    await client.query(
      `INSERT INTO staging.access_point_raw
         (run_id, source_ref, name, lat, lon, city, tier, built_status, coord_method, confidence, route_segment, raw_record, load_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [runId, r.sourceRef, r.name, r.lat ?? null, r.lon ?? null, r.city, r.raw.Tier, r.raw['Built status'],
        r.raw['Coordinate method'], r.raw['Source confidence'], r.raw['Route segment (source)'], r.raw, r.loadError]);
    if (r.loadError) { results.push(null); continue; }
    const { rows: [res] } = await client.query(
      `INSERT INTO core.access_point
         (name, geom, subtype_code, is_built, city, coordinate_method, coordinate_confidence,
          source, source_ref, source_snapshot_date, last_synced_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, $8, 'jlg_curated', $9, $10, now())
       ON CONFLICT (source, source_ref) DO UPDATE SET
         name = EXCLUDED.name, geom = EXCLUDED.geom, subtype_code = EXCLUDED.subtype_code,
         is_built = EXCLUDED.is_built, city = EXCLUDED.city,
         coordinate_method = EXCLUDED.coordinate_method, coordinate_confidence = EXCLUDED.coordinate_confidence,
         source_snapshot_date = EXCLUDED.source_snapshot_date, last_synced_at = EXCLUDED.last_synced_at
       RETURNING (xmax = 0) AS inserted`,
      [r.name, r.lon, r.lat, r.subtypeCode, r.isBuilt, r.city, r.coordinateMethod, r.coordinateConfidence,
        r.sourceRef, SNAPSHOT_DATE]);
    results.push(res.inserted);
  }
  const counts = tally(results);
  await closeRun(client, runId, counts);
  return { runId, ...counts };
}

async function loadPois(client, source, rows) {
  const runId = await openRun(client, source, rows.length);
  const results = [];
  for (const r of rows) {
    await client.query(
      `INSERT INTO staging.poi_raw
         (run_id, source_ref, name, poi_type, lat, lon, coord_method, confidence, map_number, note, raw_record, load_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [runId, r.sourceRef, r.name, r.raw.poi_type_code, r.lat ?? null, r.lon ?? null,
        r.raw['Coordinate source'] ?? r.raw['Coordinate method'], r.coordinateConfidence ?? null,
        r.raw['Map #'] ?? null, r.raw.Note ?? null, r.raw, r.loadError]);
    if (r.loadError) { results.push(null); continue; }
    const { rows: [res] } = await client.query(
      `INSERT INTO core.point_of_interest
         (poi_type_code, name, geom, landmark_type_code, coordinate_method, coordinate_confidence, source_url,
          access_point_id, access_point_link_method, source, source_ref, source_snapshot_date, last_synced_at)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8,
               (SELECT id FROM core.access_point WHERE source = 'jlg_curated' AND source_ref = $9),
               CASE WHEN $9::text IS NULL THEN NULL ELSE 'authored' END,
               $10, $11, $12, now())
       ON CONFLICT (source, source_ref) DO UPDATE SET
         poi_type_code = EXCLUDED.poi_type_code, name = EXCLUDED.name, geom = EXCLUDED.geom,
         landmark_type_code = EXCLUDED.landmark_type_code, coordinate_method = EXCLUDED.coordinate_method,
         coordinate_confidence = EXCLUDED.coordinate_confidence, source_url = EXCLUDED.source_url,
         access_point_id = EXCLUDED.access_point_id, access_point_link_method = EXCLUDED.access_point_link_method,
         source_snapshot_date = EXCLUDED.source_snapshot_date, last_synced_at = EXCLUDED.last_synced_at
       RETURNING (xmax = 0) AS inserted`,
      [r.poiType, r.name, r.lon, r.lat, r.landmarkType, r.coordinateMethod, r.coordinateConfidence, r.sourceUrl,
        r.poiType === 'restroom' ? r.apRef : null, source, r.sourceRef, SNAPSHOT_DATE]);
    results.push(res.inserted);
  }
  const counts = tally(results);
  await closeRun(client, runId, counts);
  return { runId, ...counts };
}

/** Load step 8: nearest route segment and straight-line distance, from projected geometry. */
async function enrich(client) {
  await client.query(`
    UPDATE core.access_point AS a
       SET nearest_route_segment_id = n.id, distance_to_trail_m = round(n.d::numeric, 2)
      FROM core.access_point AS x
      CROSS JOIN LATERAL (
        SELECT s.id, ST_Distance(x.geom_proj, s.geom_proj) AS d
          FROM core.route_segment AS s
         ORDER BY x.geom_proj <-> s.geom_proj LIMIT 1) AS n
     WHERE a.id = x.id AND a.source = 'jlg_curated'`);
  await client.query(`
    UPDATE core.point_of_interest AS p
       SET nearest_route_segment_id = n.id, distance_to_trail_m = round(n.d::numeric, 2),
           distance_to_trail_method = 'straight_line', distance_to_trail_measured_on = current_date
      FROM core.point_of_interest AS x
      CROSS JOIN LATERAL (
        SELECT s.id, ST_Distance(x.geom_proj, s.geom_proj) AS d
          FROM core.route_segment AS s
         ORDER BY x.geom_proj <-> s.geom_proj LIMIT 1) AS n
     WHERE p.id = x.id AND p.source IN ('jlg_curated', 'framework_plan_vol1')`);
}

export default {
  name: 'master_data',
  refreshClass: 'seed',

  async run({ path, dryRun = false }) {
    const { sheets, fatal, sha256 } = readSheets(path);
    console.log(`read Master Data CSVs from ${path}`);
    console.log(`sha256 ${sha256}`);
    if (fatal.length) {
      console.error('FATAL — nothing written:');
      fatal.forEach((m) => console.error('  ' + m));
      return { status: 'failed', fatal };
    }

    const prepared = prepare(sheets, loadTranslations());
    const all = Object.entries(prepared).flatMap(([sheet, rows]) => rows.map((r) => ({ sheet, ...r })));
    const rejected = all.filter((r) => r.loadError);
    if (rejected.length) {
      console.warn(`${rejected.length} record(s) quarantined — staged with load_error, not loaded to core:`);
      rejected.forEach((r) => console.warn(`  ${r.sheet} ${r.sourceRef}: ${r.loadError}`));
    }
    if (dryRun) {
      console.log('dry run — no database writes');
      return { status: 'dry_run', records: all.length, quarantined: rejected.length };
    }

    const client = await pool.connect();
    try {
      const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM core.route_segment');
      if (n === 0) {
        console.error('No route segments in core.route_segment. Load them first (npm run seed or npm run etl:segments).');
        return { status: 'failed', reason: 'no_route_segments' };
      }

      await client.query('BEGIN');
      const ap = await loadAccessPoints(client, prepared.accessPoints);
      const rr = await loadPois(client, 'jlg_curated', prepared.restroom);
      const fw = await loadPois(client, 'framework_plan_vol1', [...prepared.destinations, ...prepared.parks]);
      await enrich(client);
      await client.query('COMMIT');

      for (const [label, c] of [['access points', ap], ['restroom', rr], ['destinations + parks', fw]]) {
        console.log(`${label.padEnd(22)} ${c.inserted} inserted, ${c.updated} updated, ${c.rejected} quarantined (etl_run ${c.runId})`);
      }
      console.log('spatial enrichment: nearest_route_segment_id and distance_to_trail_m recomputed');
      return { status: 'succeeded', runId: fw.runId, accessPoints: ap, restroom: rr, frameworkPlan: fw };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
};
