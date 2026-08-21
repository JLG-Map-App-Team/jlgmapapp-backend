// Builds the expected GET /api/v1/segments response fixture from the committed
// City export.
//
// WHAT HAPPENED TO segments.seed.geojson
//
//   It has been deleted, and this script no longer produces it. Two reasons.
//
//   1. Nothing consumed it. scripts/etl/cityRouteSegments.js loads the full
//      committed export straight through staging into core, so the ETL importer
//      IS Stage C3's seed step. A second load path added no capability.
//
//   2. It was keyed wrongly, and the failure mode was silent. It set
//      source_ref from OBJECTID. field_mapping.csv MAP-013 specifies OBJECT_ID
//      ("Stable source key"), and the importer implements that. These are
//      different fields: OBJECTID is a dense 1-51 ArcGIS row id; OBJECT_ID is a
//      sparse City identifier running to 233. Twenty values exist in both key
//      spaces and every one of the twenty refers to a DIFFERENT segment, so an
//      upsert on (source, source_ref) would have overwritten twenty rows with
//      the wrong geometry and inserted the remaining thirty-one as duplicates -
//      with no error and no change in row count.
//
// WHY segment_id IS THE source_ref HERE
//
//   The contract types segment_id as core.route_segment.id, which is
//   GENERATED ALWAYS AS IDENTITY and unknowable outside the database. Measured
//   against a real load, using OBJECTID as a stand-in matched the assigned id
//   for only 32 of 51 features - the importer's `src` CTE has no ORDER BY, so
//   insert order is a property of the query plan, not of the file.
//
//   So this fixture carries source_ref (OBJECT_ID) as segment_id. That value is
//   stable, traceable to the source, and joinable against
//   core.route_segment.source_ref. Use the fixture for SHAPE and ATTRIBUTE
//   assertions and join on source_ref. Never assert that segment_id equals a
//   database identity value: it does not.
//
// SOURCE OF TRUTH
//   docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson - 51 features.
//   M016 records this dataset as file-based: "Phase 1 loads from a committed
//   GeoJSON export, not from the service ... 51 segments." Do not re-query the
//   live FeatureServer.
//
// Usage:  npm run fixture:build

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson';
const FIXTURE_OUT = 'seed/segments.response.fixture.geojson';

const EXPECTED_FEATURES = 51;      // M016: "51 segments". Assert, do not assume.
const EXPECTED_COMBINATIONS = 15;  // distinct PHASE_DESCRIPTION x TYPOLOGY

// These MUST match scripts/etl/cityRouteSegments.js and the codes seeded by
// migration 20260727000011. scripts/data-validation/code_translations.csv is
// stale and disagrees with both - do not use it as a reference (item B-O5).
const PHASE_MAP = {
  'Open': 'open',
  'Under Construction': 'under_construction',
  'Funded': 'funded',
  'Unfunded': 'unfunded',
};
const TYPOLOGY_MAP = {
  'Off-Street': 'off_street_trail',
  'On-Street': 'on_street_greenway',
  'Bridge': 'bridge',
  'Adjacent': 'adjacent',
  'Alley': 'alley',
  'Shared street': 'shared_street',
};
// core.segment_status.label / core.segment_type.label. Display strings only -
// never branch on these.
const PHASE_LABEL = {
  open: 'Open',
  under_construction: 'Under construction',
  funded: 'Funded',
  unfunded: 'Unfunded',
};
const TYPE_LABEL = {
  off_street_trail: 'Off-street trail',
  bridge: 'Bridge',
  adjacent: 'Adjacent path',
  on_street_greenway: 'On-street greenway',
  alley: 'Alley',
  shared_street: 'Shared street',
};

const src = JSON.parse(readFileSync(SOURCE, 'utf8'));

// ---- assertions: fail loudly rather than emit a subtly wrong fixture -------
const errors = [];

if (src.crs && src.crs.properties?.name !== 'EPSG:4326') {
  errors.push(`source declares CRS ${src.crs.properties?.name}, expected EPSG:4326`);
}
if (src.features.length !== EXPECTED_FEATURES) {
  errors.push(
    `source has ${src.features.length} features, expected ${EXPECTED_FEATURES}. ` +
    `If the City republished the layer this is a real change: update ` +
    `EXPECTED_FEATURES here and EXPECTED_FEATURE_COUNT in the importer, update ` +
    `the count recorded in M016, and re-run the topology analysis. ` +
    `Do not silently accept it.`,
  );
}

const seenRef = new Set();
for (const f of src.features) {
  const p = f.properties;
  // OBJECT_ID, not OBJECTID. See the header. This is the identifier the
  // importer writes to core.route_segment.source_ref, per MAP-013.
  const ref = p.OBJECT_ID == null ? null : String(p.OBJECT_ID).trim();
  const where = `OBJECT_ID ${ref ?? '(missing)'}`;

  if (!ref) errors.push(`a feature has no OBJECT_ID`);
  else if (seenRef.has(ref)) errors.push(`${where}: duplicated`);
  else seenRef.add(ref);

  if (f.geometry?.type !== 'LineString') {
    errors.push(`${where}: geometry is ${f.geometry?.type}, expected LineString`);
  }
  if (f.geometry?.coordinates?.length < 2) {
    errors.push(`${where}: LineString has fewer than 2 positions`);
  }
  if (f.geometry?.coordinates?.some((c) => c.length !== 2)) {
    errors.push(`${where}: a position does not have exactly 2 ordinates; the contract forbids elevation`);
  }
  if (!(p.PHASE_DESCRIPTION in PHASE_MAP)) {
    errors.push(`${where}: PHASE_DESCRIPTION "${p.PHASE_DESCRIPTION}" has no vocabulary mapping`);
  }
  if (!(p.TYPOLOGY in TYPOLOGY_MAP)) {
    errors.push(`${where}: TYPOLOGY "${p.TYPOLOGY}" has no vocabulary mapping`);
  }
}

const combos = new Set(
  src.features.map((f) => `${f.properties.PHASE_DESCRIPTION} ${f.properties.TYPOLOGY}`),
);
if (combos.size !== EXPECTED_COMBINATIONS) {
  errors.push(
    `source has ${combos.size} distinct phase x type combinations, expected ` +
    `${EXPECTED_COMBINATIONS}. A new combination means the vocabulary seeded by ` +
    `migration 20260727000011 may be incomplete.`,
  );
}

if (errors.length) {
  console.error('Source validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// Sorted numerically by source_ref so the output is stable and diffs readable.
const ordered = [...src.features].sort(
  (a, b) => Number(a.properties.OBJECT_ID) - Number(b.properties.OBJECT_ID),
);

const fixture = {
  type: 'FeatureCollection',
  features: ordered.map((f) => {
    const phase = PHASE_MAP[f.properties.PHASE_DESCRIPTION];
    const type = TYPOLOGY_MAP[f.properties.TYPOLOGY];
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        // = core.route_segment.source_ref, NOT core.route_segment.id.
        segment_id: String(f.properties.OBJECT_ID).trim(),
        phase,
        phase_label: PHASE_LABEL[phase],
        type,
        type_label: TYPE_LABEL[type],
      },
    };
  }),
};

writeFileSync(FIXTURE_OUT, JSON.stringify(fixture, null, 1) + '\n');

const vertices = ordered.reduce((n, f) => n + f.geometry.coordinates.length, 0);
const minified = JSON.stringify(fixture).length;
console.log(`source          ${src.features.length} features, ${vertices} vertices`);
console.log(`combinations    ${combos.size} distinct phase x type (all retained)`);
console.log(`segment_id      = source_ref (OBJECT_ID), range ${ordered[0].properties.OBJECT_ID}-${ordered.at(-1).properties.OBJECT_ID}`);
console.log(`wrote           ${FIXTURE_OUT}  (${minified} bytes minified)`);