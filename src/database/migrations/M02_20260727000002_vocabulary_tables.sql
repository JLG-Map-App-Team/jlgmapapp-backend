-- 0002  Controlled vocabularies (Pass 0 item 4)
--
-- Lookup tables, not native ENUM. Native ENUM cannot carry display metadata
-- and altering one requires a migration; a lookup table is editable as data.
-- Nine carry display columns; link_method and status_source do not, because
-- they never reach a screen.

-- migrate:up

CREATE TABLE core.poi_type (
  code                 text         PRIMARY KEY,
  label                text         NOT NULL,
  display_order        smallint     NOT NULL UNIQUE,
  color                text,
  icon                 text,
  footprint_rule       text         NOT NULL,
  footprint_distance_m numeric(9,3) NOT NULL,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT poi_type_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT poi_type_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT poi_type_footprint_rule_valid
    CHECK (footprint_rule IN ('on_greenway', 'buffer')),
  CONSTRAINT poi_type_footprint_distance_positive
    CHECK (footprint_distance_m > 0)
);
COMMENT ON COLUMN core.poi_type.footprint_distance_m IS
  'Metres from the trail centreline. Both rules measure the same way; the rule label records intent so on_greenway can move to polygon containment later without a remodel.';

CREATE TABLE core.access_point_subtype (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_point_subtype_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT access_point_subtype_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE core.segment_status (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT segment_status_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT segment_status_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
COMMENT ON TABLE core.segment_status IS
  'Grey is deliberately absent. FR-05 shall-8 reserves neutral styling for unclassified segments, so grey always means "no information" and never a real status.';

CREATE TABLE core.segment_type (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  line_pattern  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT segment_type_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT segment_type_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT segment_type_line_pattern_format
    CHECK (line_pattern IS NULL OR line_pattern ~ '^[0-9]+(,[0-9]+)*$')
);
COMMENT ON COLUMN core.segment_type.line_pattern IS
  'Dash array, e.g. "8,4". Colour is reserved for status (FR-05), so type uses pattern. Also satisfies WCAG 2.2 AA 1.4.1: colour is not the sole carrier of meaning.';

CREATE TABLE core.landmark_type (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landmark_type_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT landmark_type_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE core.travel_mode (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_mode_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT travel_mode_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
COMMENT ON TABLE core.travel_mode IS
  'No column anywhere references this. NFR-PRV-03 makes mode selection session-only, never persisted. Exists to hold display labels and icons for the selector.';

CREATE TABLE core.amenity (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amenity_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT amenity_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
COMMENT ON TABLE core.amenity IS
  'From JLG Framework Plan Vol 2, printed p275. Eight of the framework''s eleven items. Restrooms, vehicle parking, and gathering/event spaces are excluded because they are modelled as first-class entities, following the precedent FR-14a set. Documented exception to FRD 4.5.';

CREATE TABLE core.event_status (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_status_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT event_status_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE core.distance_method (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  color         text,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distance_method_code_format  CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT distance_method_color_format CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
COMMENT ON TABLE core.distance_method IS
  'Lets the interface word distances honestly (NFR-USA-04): "about 400 m away" for a straight line, "a 4 minute walk" for a routed one.';

CREATE TABLE core.link_method (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT link_method_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);
COMMENT ON TABLE core.link_method IS
  'Whether a POI-to-access-point link was auto-assigned or chosen by a person (2b-OQ3). Internal bookkeeping, never displayed, so no colour or icon.';

CREATE TABLE core.status_source (
  code          text        PRIMARY KEY,
  label         text        NOT NULL,
  display_order smallint    NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT status_source_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);
COMMENT ON TABLE core.status_source IS
  'FR-05b shall-3. Whether a segment status came from the framework mapping or from staff. The ETL must not overwrite a staff-set status.';

-- migrate:down
DROP TABLE IF EXISTS core.status_source;
DROP TABLE IF EXISTS core.link_method;
DROP TABLE IF EXISTS core.distance_method;
DROP TABLE IF EXISTS core.event_status;
DROP TABLE IF EXISTS core.amenity;
DROP TABLE IF EXISTS core.travel_mode;
DROP TABLE IF EXISTS core.landmark_type;
DROP TABLE IF EXISTS core.segment_type;
DROP TABLE IF EXISTS core.segment_status;
DROP TABLE IF EXISTS core.access_point_subtype;
DROP TABLE IF EXISTS core.poi_type;
