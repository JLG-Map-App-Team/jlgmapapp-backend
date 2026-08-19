-- 0006  Indexes
--
-- PostgreSQL does NOT index foreign key columns automatically. It indexes the
-- primary key being pointed at, not the column doing the pointing, and the
-- pointing direction is the one this app searches.
--
-- At Phase 1 volumes the planner may ignore several of these and read the
-- table instead, which is correct and faster on small tables. They document
-- the access patterns the FRD requires and are there as data grows.

-- migrate:up

-- Spatial, measurement (EPSG:26917). Buffers, distances, nearest-neighbour.
CREATE INDEX route_segment_geom_proj_idx     ON core.route_segment     USING GIST (geom_proj);
CREATE INDEX access_point_geom_proj_idx      ON core.access_point      USING GIST (geom_proj);
CREATE INDEX parking_geom_proj_idx           ON core.parking           USING GIST (geom_proj);
CREATE INDEX point_of_interest_geom_proj_idx ON core.point_of_interest USING GIST (geom_proj);

-- Spatial, viewport (EPSG:4326). Map bounding-box fetches.
CREATE INDEX route_segment_geom_idx          ON core.route_segment     USING GIST (geom);
CREATE INDEX access_point_geom_idx           ON core.access_point      USING GIST (geom);
CREATE INDEX parking_geom_idx                ON core.parking           USING GIST (geom);
CREATE INDEX point_of_interest_geom_idx      ON core.point_of_interest USING GIST (geom);

-- Full text: matches words, stems them, ignores filler.
CREATE INDEX point_of_interest_search_idx    ON core.point_of_interest USING GIN (search_vector);
CREATE INDEX access_point_search_idx         ON core.access_point      USING GIN (search_vector);
CREATE INDEX parking_search_idx              ON core.parking           USING GIN (search_vector);

-- Trigram: survives typos and half-typed words. Not a substitute for the above.
CREATE INDEX point_of_interest_name_trgm_idx ON core.point_of_interest USING GIN (name gin_trgm_ops);
CREATE INDEX access_point_name_trgm_idx      ON core.access_point      USING GIN (name gin_trgm_ops);
CREATE INDEX parking_name_trgm_idx           ON core.parking           USING GIN (name gin_trgm_ops);

-- Foreign keys and common filters.
CREATE INDEX route_segment_greenway_idx      ON core.route_segment (greenway_id);
CREATE INDEX route_segment_status_idx        ON core.route_segment (status_code);
CREATE INDEX route_segment_type_idx          ON core.route_segment (type_code);
CREATE INDEX parking_access_point_idx        ON core.parking (access_point_id);
CREATE INDEX point_of_interest_type_idx      ON core.point_of_interest (poi_type_code);
CREATE INDEX point_of_interest_ap_idx        ON core.point_of_interest (access_point_id);
CREATE INDEX opening_hours_poi_idx           ON core.opening_hours (poi_id);
CREATE INDEX event_space_idx                 ON core.event (event_space_id);
CREATE INDEX event_starts_at_idx             ON core.event (starts_at);

COMMENT ON INDEX core.point_of_interest_type_idx IS
  'Required by the single-table inheritance decision. Every subtype query filters on this column. If filtered POI queries later miss NFR-PRF-03 at NFR-PRF-05 volume, the remedy is partial GiST indexes per type, NOT splitting the table.';

-- migrate:down
DROP INDEX IF EXISTS core.event_starts_at_idx;
DROP INDEX IF EXISTS core.event_space_idx;
DROP INDEX IF EXISTS core.opening_hours_poi_idx;
DROP INDEX IF EXISTS core.point_of_interest_ap_idx;
DROP INDEX IF EXISTS core.point_of_interest_type_idx;
DROP INDEX IF EXISTS core.parking_access_point_idx;
DROP INDEX IF EXISTS core.route_segment_type_idx;
DROP INDEX IF EXISTS core.route_segment_status_idx;
DROP INDEX IF EXISTS core.route_segment_greenway_idx;
DROP INDEX IF EXISTS core.parking_name_trgm_idx;
DROP INDEX IF EXISTS core.access_point_name_trgm_idx;
DROP INDEX IF EXISTS core.point_of_interest_name_trgm_idx;
DROP INDEX IF EXISTS core.parking_search_idx;
DROP INDEX IF EXISTS core.access_point_search_idx;
DROP INDEX IF EXISTS core.point_of_interest_search_idx;
DROP INDEX IF EXISTS core.point_of_interest_geom_idx;
DROP INDEX IF EXISTS core.parking_geom_idx;
DROP INDEX IF EXISTS core.access_point_geom_idx;
DROP INDEX IF EXISTS core.route_segment_geom_idx;
DROP INDEX IF EXISTS core.point_of_interest_geom_proj_idx;
DROP INDEX IF EXISTS core.parking_geom_proj_idx;
DROP INDEX IF EXISTS core.access_point_geom_proj_idx;
DROP INDEX IF EXISTS core.route_segment_geom_proj_idx;
