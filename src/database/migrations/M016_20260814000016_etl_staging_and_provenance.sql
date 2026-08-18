-- 0016  ETL staging, source config, and record provenance
--
-- ============================================================================
-- Three things, all prerequisites for the first ETL run.
--
--   1. staging.access_point_raw and staging.poi_raw. The field mapping names
--      both; neither existed. Deliberately unconstrained, matching
--      staging.route_segment_raw: everything nullable, geometry untyped, the
--      whole source record kept as JSON alongside. That is the opposite of
--      core and it is the point. Dirty data must land intact so it can be
--      inspected. Constraints here would reject bad rows at the door and
--      nobody could see what was wrong.
--
--   2. staging.data_source. Source URLs currently live in a spreadsheet and a
--      Google Doc, which means no code can read them and nothing records which
--      URL produced which row. Seeded here so it is versioned with the schema,
--      queryable ("which sources have not synced in 90 days?"), and
--      referenceable from staging.etl_run.
--
--   3. Provenance columns on core.access_point and core.point_of_interest.
--      Decided 14 August 2026, Maha: columns on the existing tables rather
--      than a separate core.source_record_provenance table. There is one
--      source per record and one source per category, so a separate table
--      would add a join for no gain.
--
-- WHY THE PROVENANCE COLUMNS MATTER MORE THAN THEY LOOK
--
--   Without coordinate_confidence, every coordinate reads as equally
--   trustworthy the moment it lands. In the access point data they are not:
--   coordinates derived from the route's own topology nodes sit a median 0.0 m
--   from the centreline, while address geocodes reach 310 m and three Patton
--   Park records share one OSM park centroid 156 m out. That distinction
--   exists in the source and is lost at load unless a column carries it.
--
--   last_synced_at is NOT last_verified. One is a machine action, the other a
--   human judgement, and the existing last_verified column covers only the
--   second. A row pulled today can still be three years stale.
--
-- FILENAME NOTE, AND IT NEEDS RESOLVING
--
--   This follows the project's existing convention, M{NN}_{timestamp}_{name}.
--   dbmate expects the timestamp FIRST and orders by it, so this prefix will
--   not be parsed as a version. That is open item 3b-OQ1 and it is still open.
--   Run `dbmate up` against an empty database and confirm the ordering before
--   more files accumulate. If it needs changing, changing it now costs a
--   rename; changing it at twenty files costs a coordinated rename.
-- ============================================================================

-- migrate:up

-- ---------------------------------------------------------------- 1. staging

CREATE TABLE staging.access_point_raw (
  ingest_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        bigint NOT NULL REFERENCES staging.etl_run(id),
  source_ref    text,
  name          text,
  address       text,
  lat           double precision,
  lon           double precision,
  city          text,
  tier          text,
  built_status  text,
  coord_method  text,
  confidence    text,
  route_segment text,
  note          text,
  raw_record    jsonb NOT NULL,
  load_error    text,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_point_raw_run_idx ON staging.access_point_raw (run_id);

COMMENT ON TABLE staging.access_point_raw IS
  'Untransformed access point records. Every column nullable on purpose: a row that fails validation must still be storable so somebody can look at it. load_error records why a row did not progress to core, rather than the row being silently dropped.';

COMMENT ON COLUMN staging.access_point_raw.raw_record IS
  'The complete source record as delivered. Kept because a field nobody mapped this year is the field somebody needs next year, and re-fetching a superseded snapshot is not always possible.';

CREATE TABLE staging.poi_raw (
  ingest_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        bigint NOT NULL REFERENCES staging.etl_run(id),
  source_ref    text,
  name          text,
  description   text,
  poi_type      text,
  lat           double precision,
  lon           double precision,
  city          text,
  coord_method  text,
  confidence    text,
  source_page   text,
  map_number    text,
  note          text,
  raw_record    jsonb NOT NULL,
  load_error    text,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX poi_raw_run_idx ON staging.poi_raw (run_id);

COMMENT ON TABLE staging.poi_raw IS
  'Untransformed POI records for every poi_type. poi_type arrives as source text and is resolved against core.poi_type during validation, not here.';

-- ---------------------------------------------------------------- 2. sources

CREATE TABLE staging.data_source (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  refresh_class   text NOT NULL,
  metadata_url    text,
  count_url       text,
  data_url        text,
  licence         text,
  licence_status  text NOT NULL,
  coverage        text,
  publisher_vintage date,
  last_synced_at  timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_source_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT data_source_refresh_class_valid
    CHECK (refresh_class IN ('live_query', 'periodic_bulk', 'seed')),
  CONSTRAINT data_source_licence_status_valid
    CHECK (licence_status IN ('cleared', 'unverified', 'blocked', 'not_required'))
);

CREATE TRIGGER data_source_set_updated_at
  BEFORE UPDATE ON staging.data_source
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE staging.data_source IS
  'One row per external data source. Exists because the URLs previously lived only in a spreadsheet and a Google Doc: no code could read them, and no run recorded which URL produced which row.';

COMMENT ON COLUMN staging.data_source.metadata_url IS
  'Hit this BEFORE the data URL. A metadata URL and a data URL look alike and return different things: the DetroitData restroom link carried in an earlier register was CKAN''s package_show, which returns a description and a list of resources rather than rows. Code built against it would have received a clean success containing no data.';

COMMENT ON COLUMN staging.data_source.publisher_vintage IS
  'When the publisher last changed the data, which is a third fact distinct from last_synced_at and from a record''s last_verified. A source can respond perfectly and serve three-year-old content. Held here, once per source, rather than repeated on every row.';

COMMENT ON COLUMN staging.data_source.licence_status IS
  'The gate. No source may be loaded into core while this reads unverified or blocked. Licence and coverage are the two fields that force rework after the fact, which is why they gate rather than merely inform.';

INSERT INTO staging.data_source
  (code, label, refresh_class, metadata_url, count_url, data_url, licence, licence_status, coverage, notes) VALUES

  ('city_route_segments', 'City of Detroit — JLG Route Segments', 'seed',
   'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Joe_Louis_Greenway_Routes/FeatureServer/0?f=pjson',
   'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Joe_Louis_Greenway_Routes/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=pjson',
   'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Joe_Louis_Greenway_Routes/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
   'City open data', 'cleared', 'Detroit, Highland Park, Hamtramck, Dearborn',
   'FILE-BASED. Phase 1 loads from a committed GeoJSON export, not from the service: an ETL that fetches during a run cannot be replayed, and a build that depends on a live third-party endpoint fails when that endpoint does. The URLs above are provenance, and the optional path for a future refresh — fetch deliberately, commit the result, re-run the importer. 51 segments. Requires rebuild_topology after every load.'),

  ('framework_plan_vol1', 'JLG Framework Plan Vol. 1, The Vision', 'seed',
   NULL, NULL, NULL,
   'City publication; facts extracted with attribution', 'cleared',
   'Whole corridor',
   'Parks, destinations and access points read from map figures and numbered legends, then geocoded. Park inclusion is editorial: the figure shows the parks the City considers on the greenway, and no proximity test applies.'),

  ('jlg_curated', 'JLG / JLGP staff-curated records', 'seed',
   NULL, NULL, NULL,
   'Internally controlled', 'not_required', 'Whole corridor',
   'The Warren restroom, event spaces and events. No external licence applies.'),

  ('mdard_food', 'MDARD Restaurants and Commissaries', 'live_query',
   'https://gisagomdard.state.mi.us/arcgis/rest/services/MDARD/RestaurantsCommissariesOpenData/FeatureServer/0?f=pjson',
   'https://gisagomdard.state.mi.us/arcgis/rest/services/MDARD/RestaurantsCommissariesOpenData/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=pjson',
   'https://gisagomdard.state.mi.us/arcgis/rest/services/MDARD/RestaurantsCommissariesOpenData/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json',
   NULL, 'unverified', 'State-licensed establishments only; Detroit and Wayne County licence separately',
   'Licence unread. Coverage is a known gap, not a bug: city-licensed venues are absent by design.'),

  ('detroit_rec_centers', 'Detroit Open Data — Recreation Centers', 'live_query',
   NULL, NULL, NULL,
   'AS-IS disclaimer only; no grant located', 'blocked', 'Detroit only',
   'The portal publishes a liability disclaimer, not a licence. Modelled as event_space per migration 0013.'),

  ('overture_places', 'Overture Maps Places', 'periodic_bulk',
   'https://docs.overturemaps.org/guides/places/', NULL,
   'https://registry.opendata.aws/overture/',
   'CDLA Permissive 2.0', 'cleared', 'Global',
   'Cleanest licence found. GeoParquet bulk download, not REST. Use basic_category, not categories.');

-- ---------------------------------------------------------------- 3. provenance

-- Two vocabularies, following the project pattern: lookup table, code-format
-- CHECK, foreign key from the using table. Not enums, not free text.
--
-- NOTE FOR EITY: this takes the code-format test in the test plan from eleven
-- tables to thirteen.

CREATE TABLE core.coordinate_method (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordinate_method_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

CREATE TRIGGER coordinate_method_set_updated_at
  BEFORE UPDATE ON core.coordinate_method
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

INSERT INTO core.coordinate_method (code, label, description) VALUES
  ('route_topology',    'Route topology node',
   'A shared node between two route segments. On the route by construction; measured median 0.0 m from the centreline.'),
  ('route_intersection','Route centreline intersection',
   'Computed intersection of the centreline with a named street. On the route by construction.'),
  ('route_aligned',     'Aligned to a named segment',
   'Placed along the route segment the source names. On the route by construction.'),
  ('address_geocode',   'Geocoded from an address',
   'Looked up by address or name. Accuracy depends entirely on the match; measured up to 310 m from the centreline in the access point data.'),
  ('osm_feature',       'Matched to an OpenStreetMap feature',
   'Centroid of an OSM way or node. Note that a park centroid cannot distinguish two access points at the same park.'),
  ('third_party',       'Third-party reference',
   'A published address or coordinate from an outside source such as a venue directory.'),
  ('surveyed',          'Measured on site',
   'A person went there. No record currently uses this.');

COMMENT ON TABLE core.coordinate_method IS
  'How a coordinate was obtained. This is the column to read before trusting a position, and it is more informative than a confidence rating because it says WHY: a coordinate derived from the route is on the route by construction, while one looked up by address is only as good as the match.';

CREATE TABLE core.coordinate_confidence (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordinate_confidence_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

CREATE TRIGGER coordinate_confidence_set_updated_at
  BEFORE UPDATE ON core.coordinate_confidence
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

INSERT INTO core.coordinate_confidence (code, label, description) VALUES
  ('exact',  'Exact',  'Derived from the route itself, or surveyed on site.'),
  ('high',   'High',   'A confident match to a specific, correctly located feature.'),
  ('medium', 'Medium', 'A plausible match, but to a general area rather than a specific point.'),
  ('low',    'Low',    'A weak match. Verify before relying on it.'),
  ('merged', 'Merged', 'Shares a coordinate with another record because the source could not distinguish them. Three access points at Patton Park share one park centroid. This is not low confidence in the position; it is a known failure to separate distinct records, and it needs a person with the map rather than a better geocoder.');

COMMENT ON TABLE core.coordinate_confidence IS
  'How much to trust a coordinate. merged is deliberately a separate value rather than a shade of low: a merged coordinate may be perfectly accurate for the feature it names while being wrong for the record that carries it.';

-- No "unlocated" value exists in either vocabulary, and that is deliberate.
-- geom is NOT NULL on both tables, so a record without a coordinate cannot be
-- stored at all. The constraint decides it; the vocabulary does not need to.

ALTER TABLE core.access_point
  ADD COLUMN city                     text,
  ADD COLUMN coordinate_method        text REFERENCES core.coordinate_method(code),
  ADD COLUMN coordinate_confidence    text REFERENCES core.coordinate_confidence(code),
  ADD COLUMN source_url               text,
  ADD COLUMN last_synced_at           timestamptz,
  ADD COLUMN distance_to_trail_m      numeric(10,2),
  ADD COLUMN nearest_route_segment_id bigint REFERENCES core.route_segment(id) ON DELETE SET NULL;

ALTER TABLE core.point_of_interest
  ADD COLUMN coordinate_method        text REFERENCES core.coordinate_method(code),
  ADD COLUMN coordinate_confidence    text REFERENCES core.coordinate_confidence(code),
  ADD COLUMN source_url               text,
  ADD COLUMN last_synced_at           timestamptz,
  ADD COLUMN nearest_route_segment_id bigint REFERENCES core.route_segment(id) ON DELETE SET NULL;

CREATE INDEX access_point_nearest_segment_idx
  ON core.access_point (nearest_route_segment_id);
CREATE INDEX point_of_interest_nearest_segment_idx
  ON core.point_of_interest (nearest_route_segment_id);

-- ON DELETE SET NULL, not restrict, and the choice is considered. Every other
-- reference to core.route_segment restricts, which is correct: segment_edge and
-- topology_flag_segment point at segments whose removal would silently shrink
-- the network. These two columns are different. They are DERIVED pointers,
-- recomputed after every route load, so a dangling one is not a loss of
-- information. Restricting here would mean a segment could not be removed while
-- any POI happened to be nearest to it, which is an unrelated obstacle.

COMMENT ON COLUMN core.access_point.distance_to_trail_m IS
  'Straight-line metres to the greenway centreline, in EPSG:26917. Derived, not authored. Named to match distance_to_trail_m on core.point_of_interest rather than introducing a second name for the same measurement.';

COMMENT ON COLUMN core.access_point.nearest_route_segment_id IS
  'Derived in the spatial enrichment step, after the route load commits. STALE THE MOMENT THE ROUTE CHANGES: rebuild_topology splits segments, which changes which segment is nearest. Recompute on every route load, in the same sequence as the topology rebuild. Nothing in the database enforces that.';

COMMENT ON COLUMN core.access_point.last_synced_at IS
  'When the ETL last pulled this row from source. NOT last_verified, which records when a person last confirmed the information was correct. A row synced today can carry content from years ago; the publisher''s vintage is held once per source on staging.data_source.';

COMMENT ON COLUMN core.access_point.city IS
  'Which of the four municipalities the access point sits in. Added because nothing else in the schema carries it and the source file does.';

COMMENT ON COLUMN core.point_of_interest.nearest_route_segment_id IS
  'Derived in the spatial enrichment step. Same staleness caveat as core.access_point.nearest_route_segment_id: recompute after every route load.';

-- migrate:down

DROP INDEX IF EXISTS core.point_of_interest_nearest_segment_idx;
DROP INDEX IF EXISTS core.access_point_nearest_segment_idx;

ALTER TABLE core.point_of_interest
  DROP COLUMN IF EXISTS nearest_route_segment_id,
  DROP COLUMN IF EXISTS last_synced_at,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS coordinate_confidence,
  DROP COLUMN IF EXISTS coordinate_method;

ALTER TABLE core.access_point
  DROP COLUMN IF EXISTS nearest_route_segment_id,
  DROP COLUMN IF EXISTS distance_to_trail_m,
  DROP COLUMN IF EXISTS last_synced_at,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS coordinate_confidence,
  DROP COLUMN IF EXISTS coordinate_method,
  DROP COLUMN IF EXISTS city;

DROP TABLE IF EXISTS core.coordinate_confidence;
DROP TABLE IF EXISTS core.coordinate_method;
DROP TABLE IF EXISTS staging.data_source;
DROP TABLE IF EXISTS staging.poi_raw;
DROP TABLE IF EXISTS staging.access_point_raw;
