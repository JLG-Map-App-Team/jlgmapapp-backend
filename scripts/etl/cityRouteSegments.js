/**
 * Route segment importer — file-based.
 *
 * Reads a committed GeoJSON export of the City's JLG Route Segments layer and
 * loads it through staging into core, then rebuilds the routing topology.
 *
 * WHY IT READS A FILE RATHER THAN THE FEATURESERVER
 *
 *   An ETL that fetches during a run cannot be replayed. Re-running it next
 *   month against a changed service gives a different database from the same
 *   command, which makes "reproduce the bug" impossible. A committed export is
 *   a fixed input: the same file always produces the same result.
 *
 *   It also removes a third-party endpoint from the build path. The service is
 *   recorded in staging.data_source as provenance and as the optional refresh
 *   route: fetch deliberately, commit the new file, re-run this importer. The
 *   fetch is a human decision, not a step inside an automated load.
 *
 * ORDER
 *
 *   This must run before access points and POIs. Both carry
 *   nearest_route_segment_id and distance_to_trail_m, derived by measuring
 *   against the centreline — so the centreline has to exist first.
 *
 * ASSUMPTIONS TO CHECK AGAINST THE REPO
 *
 *   ESM, node-postgres, and a pool exported from ../../dist/db/pool.js (the
 *   compiled output of src/db/pool.ts — run `npm run build` first). If the
 *   backend is CommonJS or uses a different client, the three imports below are
 *   the only lines that change. Nothing else here depends on either choice.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pool from '../../dist/db/pool.js';

const SOURCE_CODE = 'city_route_segments';
const EXPECTED_FEATURE_COUNT = 51;

// Detroit-area bounding box. Not a precision check — it catches a swapped
// lat/lon pair or an unprojected file, which are the failures that otherwise
// load cleanly and put the greenway in the Indian Ocean.
const BBOX = { minLon: -83.5, maxLon: -82.8, minLat: 42.0, maxLat: 42.6 };

const TYPOLOGY_MAP = {
  'Off-Street': 'off_street_trail',
  'Bridge': 'bridge',
  'Adjacent': 'adjacent',
  'On-Street': 'on_street_greenway',
  'Alley': 'alley',
  'Shared street': 'shared_street',   // lowercase "s" is the published spelling
};

const PHASE_MAP = {
  'Open': 'open',
  'Under Construction': 'under_construction',
  'Funded': 'funded',
  'Unfunded': 'unfunded',
};

/* ------------------------------------------------------------------ extract */

async function extract(path) {
  const text = await readFile(path, 'utf8');
  const doc = JSON.parse(text);

  // Hash the file, not the parsed object. Two exports with identical content
  // and different key ordering are the same data, but the hash is what proves
  // which file a run used, so it must match the artifact on disk.
  const sha256 = createHash('sha256').update(text).digest('hex');

  const declaredCrs = doc.crs?.properties?.name ?? null;
  if (declaredCrs && !/4326|CRS84/i.test(declaredCrs)) {
    throw new Error(
      `File declares CRS ${declaredCrs}. This importer expects EPSG:4326; ` +
      `core.route_segment.geom is typed 4326 and the trigger derives geom_proj.`
    );
  }

  return { features: doc.features ?? [], sha256, declaredCrs, bytes: text.length };
}

/* ----------------------------------------------------------------- validate */

/**
 * Returns { ok, fatal[], rows[] } where each row carries its own loadError.
 *
 * Two kinds of problem, deliberately handled differently. A fatal is wrong
 * about the file as a whole and aborts before anything is written. A row error
 * is wrong about one segment: that row still lands in staging carrying its
 * error, because a row you cannot see is a row nobody fixes.
 */
function validate(features) {
  const fatal = [];
  const rows = [];
  const seenRefs = new Map();

  if (features.length !== EXPECTED_FEATURE_COUNT) {
    // Not a warning. A partial export looks exactly like a complete one, and
    // the count is the only cheap way to tell them apart.
    fatal.push(
      `Expected ${EXPECTED_FEATURE_COUNT} features, found ${features.length}. ` +
      `If the City has genuinely published a different number, update ` +
      `EXPECTED_FEATURE_COUNT deliberately and record why — do not loosen this check.`
    );
  }

  for (const [i, f] of features.entries()) {
    const p = f.properties ?? {};
    const ref = p.OBJECT_ID == null ? null : String(p.OBJECT_ID).trim();
    const errs = [];

    if (!ref) {
      errs.push('OBJECT_ID missing');
    } else if (seenRefs.has(ref)) {
      errs.push(`OBJECT_ID ${ref} duplicated (also at index ${seenRefs.get(ref)})`);
    } else {
      seenRefs.set(ref, i);
    }

    const g = f.geometry;
    if (!g) {
      errs.push('geometry missing');
    } else if (g.type !== 'LineString') {
      // core.route_segment is typed LineString. staging.route_segment_raw is
      // typed Geometry precisely so a multi-part segment can land here and be
      // looked at rather than rejected at the door.
      errs.push(`geometry is ${g.type}, expected LineString — split it or fix the source`);
    } else if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) {
      errs.push('geometry has fewer than two positions');
    } else {
      for (const [lon, lat] of g.coordinates) {
        if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) {
          errs.push(`coordinate ${lat},${lon} outside the Detroit bounding box — ` +
                    `check for swapped lat/lon or a projected file`);
          break;
        }
      }
    }

    const typology = p.TYPOLOGY;
    if (!typology) errs.push('TYPOLOGY missing');
    else if (!(typology in TYPOLOGY_MAP)) {
      // type_code is nullable, so an unmapped typology would load silently and
      // render as an unpatterned solid line, indistinguishable from an
      // off-street trail. Catch it here or not at all.
      errs.push(`TYPOLOGY "${typology}" has no vocabulary mapping`);
    }

    const phase = p.PHASE_DESCRIPTION;
    if (phase && !(phase in PHASE_MAP)) {
      errs.push(`PHASE_DESCRIPTION "${phase}" has no vocabulary mapping`);
    }

    rows.push({
      sourceRef: ref,
      name: p.ROUTE_SEGMENT_NAME ?? null,
      typeCode: typology ? TYPOLOGY_MAP[typology] ?? null : null,
      statusCode: phase ? PHASE_MAP[phase] ?? null : null,
      geometry: g ?? null,
      raw: f,
      loadError: errs.length ? errs.join('; ') : null,
    });
  }

  return { ok: fatal.length === 0, fatal, rows };
}

/* --------------------------------------------------------------------- load */

async function stage(client, runId, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO staging.route_segment_raw (run_id, source_ref, raw_record, geom, load_error)
       VALUES ($1, $2, $3::jsonb,
               CASE WHEN $4::jsonb IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_GeomFromGeoJSON($4::jsonb), 4326) END,
               $5)`,
      [runId, r.sourceRef, JSON.stringify(r.raw),
       r.geometry ? JSON.stringify(r.geometry) : null, r.loadError]
    );
  }
}

async function upsert(client, runId) {
  // Counted BEFORE the upsert, because afterwards the evidence is gone.
  // The City owns geometry, name and type. Staff own status. This is the
  // number that proves the protection is working; if it reads zero after staff
  // have been setting statuses, nothing else will tell you it broke.
  const { rows: [skipped] } = await client.query(
    `SELECT count(*)::int AS n
       FROM core.route_segment rs
       JOIN staging.route_segment_raw r
         ON r.source_ref = rs.source_ref AND rs.source = $1
      WHERE r.run_id = $2 AND r.load_error IS NULL
        AND rs.status_source = 'staff'`,
    [SOURCE_CODE, runId]
  );

  const { rows: [counts] } = await client.query(
    `WITH src AS (
       SELECT r.source_ref,
              r.raw_record->'properties'->>'ROUTE_SEGMENT_NAME' AS name,
              r.raw_record->'properties'->>'TYPOLOGY'           AS typology,
              r.raw_record->'properties'->>'PHASE_DESCRIPTION'  AS phase,
              ST_Force2D(r.geom) AS geom
         FROM staging.route_segment_raw r
        WHERE r.run_id = $2 AND r.load_error IS NULL
     ),
     ins AS (
       INSERT INTO core.route_segment
         (greenway_id, name, geom, type_code, status_code, status_source, source, source_ref)
       SELECT g.id, s.name, s.geom::geometry(LineString,4326), tm.code, sm.code, 'ingested', $1, s.source_ref
         FROM src s
         CROSS JOIN (SELECT id FROM core.greenway WHERE name = 'Joe Louis Greenway') g
         LEFT JOIN core.segment_type   tm ON tm.code = $3::jsonb->>s.typology
         LEFT JOIN core.segment_status sm ON sm.code = $4::jsonb->>s.phase
       ON CONFLICT (source, source_ref) DO UPDATE SET
         name      = EXCLUDED.name,
         geom      = EXCLUDED.geom,
         type_code = EXCLUDED.type_code,
         -- field-level survivorship: a staff-set status is never overwritten
         status_code = CASE WHEN core.route_segment.status_source = 'staff'
                            THEN core.route_segment.status_code
                            ELSE EXCLUDED.status_code END,
         status_source = CASE WHEN core.route_segment.status_source = 'staff'
                              THEN 'staff' ELSE 'ingested' END
       RETURNING (xmax = 0) AS inserted
     )
     SELECT count(*) FILTER (WHERE inserted)::int     AS inserted,
            count(*) FILTER (WHERE NOT inserted)::int AS updated
       FROM ins`,
    [SOURCE_CODE, runId, JSON.stringify(TYPOLOGY_MAP), JSON.stringify(PHASE_MAP)]
  );

  return { ...counts, skippedAuthored: skipped.n };
}

/* ---------------------------------------------------------------- topology */

async function rebuildTopology(client, runId) {
  const { rows } = await client.query(
    'SELECT severity, flag_type, message FROM routing.rebuild_topology($1)',
    [runId]
  );
  // The function deliberately does not raise: raising would roll back the
  // topology_check row and lose the record of the abort. So the caller has to
  // look. An importer that reports success because its own load worked, while
  // the topology silently did not update, is worse than either failure alone.
  const aborted = rows.filter(r => r.severity === 'ABORT');
  return { flags: rows, aborted };
}

/* ------------------------------------------------------------------ runner */

export default {
  name: SOURCE_CODE,
  refreshClass: 'seed',

  async run({ path, dryRun = false }) {
    const file = await extract(path);
    const { ok, fatal, rows } = validate(file.features);

    console.log(`read ${file.features.length} features from ${path}`);
    console.log(`sha256 ${file.sha256}`);

    if (!ok) {
      console.error('FATAL — nothing written:');
      fatal.forEach(m => console.error('  ' + m));
      return { status: 'failed', fatal };
    }

    const bad = rows.filter(r => r.loadError);
    if (bad.length) {
      console.warn(`${bad.length} row(s) will stage with an error and will not reach core:`);
      bad.forEach(r => console.warn(`  OBJECT_ID ${r.sourceRef}: ${r.loadError}`));
    }

    if (dryRun) {
      console.log('dry run — no database writes');
      return { status: 'dry_run', rows: rows.length, rowErrors: bad.length };
    }

    const client = await pool.connect();
    let runId;
    try {
      await client.query('BEGIN');
      const { rows: [run] } = await client.query(
        `INSERT INTO staging.etl_run (source, status, source_feature_count)
         VALUES ($1, 'running', $2) RETURNING id`,
        [SOURCE_CODE, file.features.length]
      );
      runId = run.id;

      await stage(client, runId, rows);
      const counts = await upsert(client, runId);

      // Commit BEFORE the topology rebuild. rebuild_topology reads committed
      // core data and manages its own temp tables; holding this transaction
      // open across it would make an abort ambiguous — did the load fail, or
      // the rebuild?
      await client.query(
        `UPDATE staging.etl_run
            SET rows_inserted = $2, rows_updated = $3,
                fields_skipped_authored = $4, source_snapshot_date = current_date
          WHERE id = $1`,
        [runId, counts.inserted, counts.updated, counts.skippedAuthored]
      );
      await client.query('COMMIT');
      console.log(`staged and upserted: ${counts.inserted} inserted, ${counts.updated} updated, ` +
                  `${counts.skippedAuthored} authored field(s) preserved`);

      const { flags, aborted } = await rebuildTopology(client, runId);
      flags.forEach(f => console.log(`  [${f.severity}] ${f.flag_type}: ${f.message}`));

      if (aborted.length) {
        await client.query(
          `UPDATE staging.etl_run SET status='failed', finished_at=now(),
                  error_message=$2 WHERE id=$1`,
          [runId, `topology rebuild aborted: ${aborted.map(a => a.flag_type).join(', ')}`]
        );
        console.error('TOPOLOGY ABORTED — core data is loaded, routing topology is UNCHANGED.');
        console.error('The previous topology is still live. Fix the geometry and re-run.');
        return { status: 'failed', runId, reason: 'topology_abort', flags };
      }

      await client.query(
        `UPDATE staging.etl_run SET status='succeeded', finished_at=now() WHERE id=$1`,
        [runId]
      );

      // Both tables carry derived pointers to route segments, and noding
      // changes which segment is nearest. They are stale the moment this
      // finishes. Nothing in the database enforces the recompute.
      console.log('NEXT: re-run spatial enrichment. nearest_route_segment_id and ' +
                  'distance_to_trail_m on core.access_point and core.point_of_interest ' +
                  'are now stale.');

      return { status: 'succeeded', runId, ...counts, rowErrors: bad.length };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (runId) {
        await client.query(
          `UPDATE staging.etl_run SET status='failed', finished_at=now(), error_message=$2 WHERE id=$1`,
          [runId, String(err.message).slice(0, 1000)]
        ).catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  },
};
