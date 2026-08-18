-- 0004  Join tables
-- ON DELETE CASCADE applies to the links only. Deleting an access point
-- removes its amenity links, never the amenity vocabulary.

-- migrate:up

CREATE TABLE core.access_point_amenity (
  access_point_id bigint      NOT NULL REFERENCES core.access_point(id) ON DELETE CASCADE,
  amenity_code    text        NOT NULL REFERENCES core.amenity(code),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (access_point_id, amenity_code)
);

CREATE TABLE core.point_of_interest_amenity (
  poi_id        bigint      NOT NULL,
  poi_type_code text        NOT NULL,
  amenity_code  text        NOT NULL REFERENCES core.amenity(code),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poi_id, amenity_code),
  FOREIGN KEY (poi_id, poi_type_code)
    REFERENCES core.point_of_interest (id, poi_type_code) ON DELETE CASCADE,
  CONSTRAINT poi_amenity_event_space_only CHECK (poi_type_code = 'event_space')
);
COMMENT ON TABLE core.point_of_interest_amenity IS
  'Named for the POI table because single-table inheritance means event spaces are rows in point_of_interest. Restricted to event spaces: no other POI kind has amenities in any FR card.';

CREATE TABLE core.access_point_event_space (
  access_point_id bigint      NOT NULL REFERENCES core.access_point(id) ON DELETE CASCADE,
  poi_id          bigint      NOT NULL,
  poi_type_code   text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (access_point_id, poi_id),
  FOREIGN KEY (poi_id, poi_type_code)
    REFERENCES core.point_of_interest (id, poi_type_code) ON DELETE CASCADE,
  CONSTRAINT ap_event_space_type CHECK (poi_type_code = 'event_space')
);
COMMENT ON TABLE core.access_point_event_space IS
  'FR-14a: a MajorAccessPoint-to-EventSpace association, explicitly NOT an embedded amenity. "Major only" is enforced at display, not here: access_point.subtype_code is nullable by FR-02 shall-7, so a composite FK on it would break on exactly the records FR-02 permits.';

-- migrate:down
DROP TABLE IF EXISTS core.access_point_event_space;
DROP TABLE IF EXISTS core.point_of_interest_amenity;
DROP TABLE IF EXISTS core.access_point_amenity;
