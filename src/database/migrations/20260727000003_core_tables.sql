-- 0003  Core entity tables
--
-- geom      : EPSG:4326 (lat/long). What MapLibre and GeoJSON consume.
-- geom_proj : EPSG:26917 (NAD83 / UTM zone 17N, metres). All measurement.
--             Maintained by trigger (see 0005), NOT NULL so that a disabled
--             trigger fails loudly instead of loading silent nulls.
-- Distances are metres, suffixed _m. Half a mile = 804.672 m exactly.

-- migrate:up

CREATE TABLE core.greenway (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.greenway IS
  'One row. Total length is deliberately not stored; it is summed from route_segment so the two can never disagree.';

CREATE TABLE core.route_segment (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  greenway_id          bigint      NOT NULL REFERENCES core.greenway(id),
  name                 text,
  geom                 geometry(LineString, 4326) NOT NULL,
  geom_proj            geometry(LineString, 26917) NOT NULL,
  status_code          text        REFERENCES core.segment_status(code),
  status_source        text        NOT NULL DEFAULT 'ingested'
                                   REFERENCES core.status_source(code),
  status_updated_by    text,
  status_updated_at    timestamptz,
  type_code            text        REFERENCES core.segment_type(code),
  bike_accessible      boolean,
  walk_accessible      boolean,
  source               text        NOT NULL,
  source_ref           text,
  source_snapshot_date date,
  last_verified        date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.route_segment.status_code IS
  'Nullable on purpose. FR-05 shall-8 requires unclassified segments to render neutrally and be excluded from routes, rather than be guessed at. An "unknown" vocabulary row would corrupt a controlled vocabulary to encode an absence.';
COMMENT ON COLUMN core.route_segment.status_source IS
  'Field-level survivorship. Geometry and type are authoritative from the City dataset; status is authoritative from staff. The ETL must skip this field where the value is "staff".';

CREATE TABLE core.access_point (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 text        NOT NULL,
  address              text,
  description          text,
  geom                 geometry(Point, 4326) NOT NULL,
  geom_proj            geometry(Point, 26917) NOT NULL,
  search_vector        tsvector    NOT NULL,
  subtype_code         text        REFERENCES core.access_point_subtype(code),
  connecting_street    text,
  cross_streets        text,
  is_featured          boolean     NOT NULL DEFAULT false,
  is_built             boolean     NOT NULL DEFAULT true,
  source               text        NOT NULL,
  source_ref           text,
  source_snapshot_date date,
  last_verified        date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.access_point.subtype_code IS
  'Nullable. FR-02 shall-7 requires an undifferentiated marker plus a data-review flag rather than a guess. The review flag needs no column: it is subtype_code IS NULL.';
COMMENT ON COLUMN core.access_point.is_featured IS
  'FR-03 via the FRD 4.4 data-driven emphasis pattern. AUTHORED, never ingested: the City has no opinion about which gateway is primary. The ETL must never write this column. FRD calls it primary_gateway; same field.';
COMMENT ON COLUMN core.access_point.is_built IS
  'Retained in data for exclusion, not for display (FRD section 7).';

CREATE TABLE core.parking (
  id                                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  access_point_id                   bigint      NOT NULL REFERENCES core.access_point(id),
  name                              text,
  geom                              geometry(Point, 4326) NOT NULL,
  geom_proj                         geometry(Point, 26917) NOT NULL,
  search_vector                     tsvector    NOT NULL,
  access_point_distance_m           numeric(9,2),
  access_point_distance_method      text        REFERENCES core.distance_method(code),
  access_point_distance_measured_on date,
  source                            text        NOT NULL,
  source_ref                        text,
  source_snapshot_date              date,
  last_verified                     date,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.parking.access_point_distance_m IS
  'NOT pgRouting-derived. Phase 1 stores a straight-line proxy (ADR-001 4.9); a person may override specific pairs. The method column records which. The ETL must not overwrite rows where the method is "authored".';

CREATE TABLE core.point_of_interest (
  id                                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poi_type_code                     text        NOT NULL REFERENCES core.poi_type(code),
  name                              text        NOT NULL,
  description                       text,
  geom                              geometry(Point, 4326) NOT NULL,
  geom_proj                         geometry(Point, 26917) NOT NULL,
  search_vector                     tsvector    NOT NULL,

  access_point_id                   bigint      REFERENCES core.access_point(id),
  access_point_link_method          text        REFERENCES core.link_method(code),
  access_point_distance_m           numeric(9,2),
  access_point_distance_method      text        REFERENCES core.distance_method(code),
  access_point_distance_measured_on date,

  distance_to_trail_m               numeric(9,2),
  distance_to_trail_method          text        REFERENCES core.distance_method(code),
  distance_to_trail_measured_on     date,

  location_guidance                 text,     -- restroom only
  hours_label                       text,     -- play_area only
  landmark_type_code                text      REFERENCES core.landmark_type(code),
  is_key                            boolean,  -- landmark only
  venue_description                 text,     -- event_space only

  source                            text        NOT NULL,
  source_ref                        text,
  source_snapshot_date              date,
  last_verified                     date,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT point_of_interest_id_type_key UNIQUE (id, poi_type_code)
);
COMMENT ON TABLE core.point_of_interest IS
  'Single-table inheritance. Five kinds share one table with poi_type_code as the discriminator. Disjointness is structural: one row, one type. Kind-specific rules are CHECK constraints in 0007.';
COMMENT ON CONSTRAINT point_of_interest_id_type_key ON core.point_of_interest IS
  'Looks redundant beside the primary key. It is the target of the composite foreign keys used by opening_hours, event, and two join tables. Side effect: a POI type cannot be changed while dependent rows exist.';
COMMENT ON COLUMN core.point_of_interest.access_point_id IS
  'Nullable (2b-OQ3). POIs load before links are authored. Links are auto-assigned to the nearest access point, marked "auto", then the longest are reviewed by a person and flipped to "authored".';

CREATE TABLE core.opening_hours (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poi_id        bigint      NOT NULL,
  poi_type_code text        NOT NULL,
  day_of_week   smallint    NOT NULL,
  opens_at      time        NOT NULL,
  closes_at     time        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (poi_id, poi_type_code)
    REFERENCES core.point_of_interest (id, poi_type_code) ON DELETE CASCADE
);
COMMENT ON TABLE core.opening_hours IS
  'One row per opening period. NO rows means hours unknown; never a stored "unknown" value. Weekly recurring only; seasonal and holiday exceptions are out of Phase 1 scope (2C).';
COMMENT ON COLUMN core.opening_hours.opens_at IS
  'Local wall-clock time, no zone. "Opens at 9am" is a recurring rule, not an instant. Storing it as an instant would shift it twice a year at DST boundaries.';
COMMENT ON COLUMN core.opening_hours.poi_type_code IS
  'Carried so a plain CHECK on this row can enforce the hours allowlist. A CHECK cannot see another table.';

CREATE TABLE core.event (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_space_id bigint      NOT NULL,
  poi_type_code  text        NOT NULL,
  title          text        NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  description    text,
  status_code    text        NOT NULL DEFAULT 'scheduled'
                             REFERENCES core.event_status(code),
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_space_id, poi_type_code)
    REFERENCES core.point_of_interest (id, poi_type_code)
);
COMMENT ON COLUMN core.event.created_by IS
  'Plain text, not a foreign key. There is no users table: identity lives in Firebase Auth per ADR-001. Holds whatever identifier Firebase issues. Deliberate.';
COMMENT ON COLUMN core.event.status_code IS
  'Soft delete. A cancelled event is hidden from the app but the row is retained, which is the audit trail NFR-SEC-01 expects.';

-- migrate:down
DROP TABLE IF EXISTS core.event;
DROP TABLE IF EXISTS core.opening_hours;
DROP TABLE IF EXISTS core.point_of_interest;
DROP TABLE IF EXISTS core.parking;
DROP TABLE IF EXISTS core.access_point;
DROP TABLE IF EXISTS core.route_segment;
DROP TABLE IF EXISTS core.greenway;
