// Deterministic builder for the Stage C3 seed extract.
//
// SCOPE DECISION: the seed is the FULL 51-segment network, not a 20-segment
// sample. Plan task C3 says "roughly 20 route segments ... not the full dataset -
// the skeleton must start fast and work offline". Measured, that rationale does
// not hold and the sample costs more than it saves:
//
//   * Size is not a constraint. Minified, 51 features is 29,155 bytes against
//     11,220 for 20. Both are trivial to load and both work offline.
//   * A sample destroys the network. Exact-endpoint analysis gives 10 connected
//     components for a 20-segment sample and 3 for the full 51. Lane 2's
//     pgRouting spike depends on C3 and would be measuring an artefact of the
//     sampling rather than the greenway.
//   * A sample makes the Stage D visual check ambiguous. Stage D's DoD is "the
//     greenway is visible". With 20 of 51 segments a reader cannot tell a
//     rendering bug from absent seed data.
//   * M016 already records this dataset as the Phase 1 load path in full
//     ("Phase 1 loads from a committed GeoJSON export ... 51 segments"). A
//     separate 20-segment path is a second source of truth.
//
// This requires amending C3's wording. Tracked as roadmap item B-O1.
//
// WHY THIS SCRIPT EXISTS
// The previous seed/segments.seed.geojson could not be reproduced from anything
// in this repository. 19 of its 20 features matched the committed export
// exactly. The twentieth, labelled segment_id "52", was the final two vertices
// of OBJECTID 23 extracted as a standalone LineString, carrying an identifier
// that matches no OBJECTID in the layer. A "fixed seed extract" that cannot be
// rebuilt is not fixed - it is a snapshot of a lost state.
//
// SOURCE OF TRUTH
// docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson - 51 features,
// OBJECTID 1-51 with no gaps. Do not re-query the live FeatureServer: M016
// records this dataset as file-based precisely because "an ETL that fetches
// during a run cannot be replayed".
//
// OUTPUTS
//   seed/segments.seed.geojson              database seed input (authoritative)
//   seed/segments.response.fixture.geojson  expected API response for that seed
//
// Usage:  npm run seed:build

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson';
const SEED_OUT = 'seed/segments.seed.geojson';
const FIXTURE_OUT = 'seed/segments.response.fixture.geojson';

const EXPECTED_FEATURES = 51;      // M016: "51 segments". Assert, do not assume.
const EXPECTED_COMBINATIONS = 15;  // distinct PHASE_DESCRIPTION x TYPOLOGY

// staging.data_source.code - M016
const SOURCE_CODE = 'city_route_segments';
// core.status_source.code - M011. 'staff' is reserved for human confirmation.
const STATUS_SOURCE = 'ingested';

// Vocabulary maps. These MUST match scripts/etl/cityRouteSegments.js,
// scripts/data-validation/code_translations.csv, and the codes seeded by M011.
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
// core.segment_status.label / core.segment_type.label - M011.
// Display strings only. Never branch on these.
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

// ---- assertions: fail loudly rather than emit a subtly wrong seed ----------
const errors = [];

if (src.crs && src.crs.properties?.name !== 'EPSG:4326') {
  errors.push(`source declares CRS ${src.crs.properties?.name}, expected EPSG:4326`);
}
if (src.features.length !== EXPECTED_FEATURES) {
  errors.push(
    `source has ${src.features.length} features, expected ${EXPECTED_FEATURES}. ` +
    `If the City republished the layer this is a real change: update EXPECTED_FEATURES, ` +
    `update the count in M016, and re-run the topology analysis. Do not silently accept it.`,
  );
}

const seen = new Set();
for (const f of src.features) {
  const p = f.properties;
  const id = p.OBJECTID;
  if (seen.has(id)) errors.push(`duplicate OBJECTID ${id}`);
  seen.add(id);
  if (f.geometry?.type !== 'LineString') {
    errors.push(`OBJECTID ${id}: geometry is ${f.geometry?.type}, expected LineString`);
  }
  if (f.geometry?.coordinates?.length < 2) {
    errors.push(`OBJECTID ${id}: LineString has fewer than 2 positions`);
  }
  if (f.geometry?.coordinates?.some((c) => c.length !== 2)) {
    errors.push(`OBJECTID ${id}: a position does not have exactly 2 ordinates; the contract forbids elevation`);
  }
  if (!(p.PHASE_DESCRIPTION in PHASE_MAP)) {
    errors.push(`OBJECTID ${id}: PHASE_DESCRIPTION "${p.PHASE_DESCRIPTION}" has no vocabulary mapping`);
  }
  if (!(p.TYPOLOGY in TYPOLOGY_MAP)) {
    errors.push(`OBJECTID ${id}: TYPOLOGY "${p.TYPOLOGY}" has no vocabulary mapping`);
  }
}

const combos = new Set(
  src.features.map((f) => `${f.properties.PHASE_DESCRIPTION} ${f.properties.TYPOLOGY}`),
);
if (combos.size !== EXPECTED_COMBINATIONS) {
  errors.push(
    `source has ${combos.size} distinct phase x type combinations, expected ${EXPECTED_COMBINATIONS}. ` +
    `A new combination means the vocabulary in M011 may be incomplete.`,
  );
}

if (errors.length) {
  console.error('Source validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// Sorted by OBJECTID so the output is stable and diffs are readable.
const ordered = [...src.features].sort(
  (a, b) => Number(a.properties.OBJECTID) - Number(b.properties.OBJECTID),
);

// ---- output 1: database seed input --------------------------------------
// Shaped for the loader, NOT for the API. Property names are database columns.
// Deliberately absent:
//   segment_id   core.route_segment.id is GENERATED ALWAYS AS IDENTITY and is
//                assigned on insert; a seed file cannot know it. This is the
//                field the previous version of this file wrongly carried.
//   geom_proj    derived by the core.set_geom_proj trigger (M05) as
//                ST_Transform(geom, 26917). Supplying it would be ignored.
//   greenway_id  resolved by the seed step from core.greenway (M011).
const seed = {
  type: 'FeatureCollection',
  features: ordered.map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      source: SOURCE_CODE,
      source_ref: String(f.properties.OBJECTID),
      name: f.properties.ROUTE_SEGMENT_NAME ?? null,
      status_code: PHASE_MAP[f.properties.PHASE_DESCRIPTION],
      status_source: STATUS_SOURCE,
      type_code: TYPOLOGY_MAP[f.properties.TYPOLOGY],
      // NOT SET DELIBERATELY. The date the source layer was queried is not
      // recorded anywhere verifiable in this repository. The seed step must
      // set it. Do not guess it.
      source_snapshot_date: null,
    },
  })),
};

// ---- output 2: expected API response fixture ----------------------------
// Matches SegmentFeatureCollection in openapi.yaml: what GET /api/v1/segments
// should return once this seed is loaded.
//
// segment_id here is the source_ref, NOT a real core.route_segment.id - the two
// coincide only if the loader happens to assign identities in source order. Use
// this fixture for shape and attribute assertions, never for identity
// assertions.
const fixture = {
  type: 'FeatureCollection',
  features: ordered.map((f) => {
    const phase = PHASE_MAP[f.properties.PHASE_DESCRIPTION];
    const type = TYPOLOGY_MAP[f.properties.TYPOLOGY];
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        segment_id: String(f.properties.OBJECTID),
        phase,
        phase_label: PHASE_LABEL[phase],
        type,
        type_label: TYPE_LABEL[type],
      },
    };
  }),
};

writeFileSync(SEED_OUT, JSON.stringify(seed, null, 1) + '\n');
writeFileSync(FIXTURE_OUT, JSON.stringify(fixture, null, 1) + '\n');

const vertices = ordered.reduce((n, f) => n + f.geometry.coordinates.length, 0);
console.log(`source          ${src.features.length} features, ${vertices} vertices`);
console.log(`combinations    ${combos.size} distinct phase x type (all retained)`);
console.log(`wrote           ${SEED_OUT}`);
console.log(`wrote           ${FIXTURE_OUT}`);
