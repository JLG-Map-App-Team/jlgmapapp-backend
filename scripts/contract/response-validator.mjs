/**
 * Runtime response validator, compiled from openapi.yaml.
 *
 * WHY THIS EXISTS ALONGSIDE THE GENERATED TYPES
 *
 *   The generated TypeScript types check the shape of a response WHERE IT IS
 *   CONSTRUCTED. That is genuinely valuable and it is not this. Types are erased
 *   before the program runs, so they cannot check:
 *
 *     - anything that arrives through JSON.parse, which is `any`. A controller
 *       doing `geometry: JSON.parse(row.geojson)` type-checks with any garbage
 *       inside the string.
 *     - values that come out of the database as text. status_code is a text
 *       column with a foreign key to a vocabulary table. Add a vocabulary row
 *       without updating the spec and the endpoint serves a value outside the
 *       enum, while every unit test passes.
 *     - a coordinate reference system. ST_AsGeoJSON on core.route_segment.geom_proj
 *       emits perfectly valid, well-typed GeoJSON in EPSG:26917. The types are
 *       satisfied and the greenway draws off the coast of Africa.
 *     - `as` casts. `await res.json() as SegmentFeatureCollection` is an
 *       assertion, not a check. The compiler simply believes it.
 *
 *   So this validates the actual bytes against the actual schema, at a point
 *   where failing is cheap.
 *
 * WHERE IT SHOULD RUN
 *
 *   In tests and in CI. NOT as production middleware — see roadmap item B-O4.
 *   NFR-AVL-02 requires the map to degrade rather than die; a validator that
 *   throws on a response the client would have rendered fine converts a cosmetic
 *   drift into an outage. CI is where a contract violation should stop the line.
 *
 * SINGLE SOURCE
 *   The schema is read from openapi.yaml at call time. There is no second copy to
 *   drift, and no generated artifact to regenerate.
 */

import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

const SPEC = 'openapi_B2.yaml';

let cache = null;

/** Compile every schema in components.schemas once, keyed by name. */
function compile() {
  if (cache) return cache;

  const spec = yaml.load(readFileSync(SPEC, 'utf8'));
  const schemas = spec?.components?.schemas;
  if (!schemas) throw new Error(`${SPEC} has no components.schemas`);

  // strict:false because an OpenAPI 3.0 schema is not quite JSON Schema:
  // `nullable: true` and `example` are OpenAPI keywords Ajv does not know.
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  // Register under the $ref path the spec uses, so internal $refs resolve.
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`);
  }

  const validators = {};
  for (const name of Object.keys(schemas)) {
    validators[name] = ajv.compile(schemas[name]);
  }

  cache = { validators, names: Object.keys(schemas) };
  return cache;
}

/**
 * Validate a payload against a named schema from the spec.
 * Returns { valid, errors: string[] }.
 */
export function validateAgainst(schemaName, payload) {
  const { validators, names } = compile();
  const validate = validators[schemaName];
  if (!validate) {
    throw new Error(`No schema "${schemaName}" in ${SPEC}. Available: ${names.join(', ')}`);
  }

  const valid = validate(payload);
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '(root)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`,
  );
  return { valid, errors };
}

/**
 * Assert a GET /api/v1/segments response conforms to the contract.
 *
 * Schema conformance is necessary but not sufficient: RFC 7946 mandates WGS 84,
 * and projected coordinates are still structurally valid GeoJSON. So this also
 * checks that every coordinate falls inside a Detroit-area bounding box, which is
 * the cheapest available proxy for "these are degrees, not metres". Plan task D2a
 * asserts ST_SRID at the database; this catches the same class of fault at the
 * boundary, where a client would actually see it.
 *
 * Throws on failure. Returns a small summary on success.
 */
export function assertSegmentsResponse(payload) {
  const { valid, errors } = validateAgainst('SegmentFeatureCollection', payload);
  if (!valid) {
    throw new Error(
      `Response does not conform to SegmentFeatureCollection:\n  ` + errors.slice(0, 12).join('\n  '),
    );
  }

  const BBOX = { minLon: -83.5, maxLon: -82.8, minLat: 42.0, maxLat: 42.6 };
  const offenders = [];
  for (const f of payload.features) {
    for (const [lon, lat] of f.geometry.coordinates) {
      if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) {
        offenders.push(`${f.properties.segment_id} @ ${lat},${lon}`);
        break;
      }
    }
  }
  if (offenders.length) {
    throw new Error(
      `Coordinates outside the Detroit bounding box — the response is probably ` +
      `serving a projected CRS rather than EPSG:4326 (RFC 7946 section 4). ` +
      `${offenders.length} of ${payload.features.length} features affected. ` +
      `First: ${offenders.slice(0, 3).join(', ')}`,
    );
  }

  return { features: payload.features.length, bytes: JSON.stringify(payload).length };
}
