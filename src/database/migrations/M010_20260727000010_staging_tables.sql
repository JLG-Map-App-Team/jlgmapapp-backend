-- 0010  Staging
--
-- Deliberately loose: everything nullable, geometry untyped, the whole record
-- kept as JSON alongside. That is the opposite of core and it is the point.
-- Staging is where dirty data lands INTACT so it can be inspected. Constraints
-- here would reject bad rows at the door and nobody could see what was wrong.
--
-- Only one source is confirmed (ADR-001 4.8: the City's JLG Route Segments
-- layer). Sources for access points, parking and the five POI types are not
-- settled, and BSEED was profiled and rejected as a food venue source. Tables
-- for unchosen datasets would mean inventing column names against files nobody
-- has opened. Deferred as 4-OQ2; this file is the pattern to copy.

-- migrate:up
CREATE TABLE staging.route_segment_raw (
  ingest_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id     bigint NOT NULL REFERENCES staging.etl_run(id),
  source_ref text,
  raw_record jsonb NOT NULL,
  geom       geometry(Geometry, 4326),
  load_error text
);

CREATE INDEX route_segment_raw_run_idx ON staging.route_segment_raw (run_id);

COMMENT ON COLUMN staging.route_segment_raw.geom IS
  'Untyped Geometry, not LineString. This is where a bundled multi-part segment gets caught: it lands here, and the transform step either splits it or writes to load_error and moves on. core.route_segment still rejects multi-part geometry; the difference is that here you can see which ones and why.';

-- migrate:down
DROP TABLE IF EXISTS staging.route_segment_raw;
