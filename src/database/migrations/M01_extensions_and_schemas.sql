-- JLG Map App - Phase 1 schema
-- 0001  Extensions and schemas
--
-- postgis   : geometry types, spatial indexes, coordinate transforms
-- pgrouting : shortest-path over the segment network (FR-08a)
-- pg_trgm   : fuzzy / partial text matching (FR-01, ADR-001 4.1)
-- unaccent  : accent-insensitive search
-- pg_stat_statements : query timing, feeds the monitoring queries
--
-- NOTE: pg_stat_statements also requires 'shared_preload_libraries' in
-- postgresql.conf and a server restart. CREATE EXTENSION alone will succeed
-- but collect no data until that is done.

-- migrate:up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA IF NOT EXISTS core;      -- served entities
CREATE SCHEMA IF NOT EXISTS staging;   -- raw ETL landing, dirty by design
CREATE SCHEMA IF NOT EXISTS routing;   -- pgRouting topology, derived only

-- Extensions install into public; our tables live in core. Without this,
-- every PostGIS call needs writing out as public.ST_Distance(...).
-- Takes effect on NEW connections only.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO core, public', current_database());
END
$$;

-- migrate:down
-- Extensions are deliberately NOT dropped. DROP EXTENSION postgis cascades to
-- every geometry column in the database. A routine rollback must not do that.
DROP SCHEMA IF EXISTS routing CASCADE;
DROP SCHEMA IF EXISTS staging CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
