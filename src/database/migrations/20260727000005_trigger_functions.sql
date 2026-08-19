-- 0005  Trigger functions and triggers
--
-- Three jobs: stamp updated_at, maintain the projected geometry, maintain the
-- search vector. All BEFORE triggers, so the target columns can be NOT NULL:
-- if a trigger is ever disabled during a bulk load, the insert fails loudly
-- instead of loading silent nulls.

-- migrate:up

CREATE FUNCTION core.set_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE FUNCTION core.set_geom_proj() RETURNS trigger AS $fn$
BEGIN
  NEW.geom_proj := ST_Transform(NEW.geom, 26917);
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- coalesce() is load-bearing. In SQL, anything concatenated with NULL becomes
-- NULL, so a POI with no description would get an empty vector and become
-- invisible to search, silently. setweight ranks name matches above description.
CREATE FUNCTION core.set_poi_search() RETURNS trigger AS $fn$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE FUNCTION core.set_access_point_search() RETURNS trigger AS $fn$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.address, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE FUNCTION core.set_parking_search() RETURNS trigger AS $fn$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.name, ''));
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- updated_at on all 18 tables that have it (11 vocabularies + 7 core).
-- Join tables are excluded: they hold nothing updatable.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'poi_type','access_point_subtype','segment_status','segment_type',
    'landmark_type','travel_mode','amenity','event_status',
    'distance_method','link_method','status_source',
    'greenway','route_segment','access_point','parking',
    'point_of_interest','opening_hours','event'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON core.%I
         FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END
$do$;

-- Projected geometry on the four tables that carry it.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['route_segment','access_point','parking','point_of_interest'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF geom ON core.%I
         FOR EACH ROW EXECUTE FUNCTION core.set_geom_proj()',
      t || '_set_geom_proj', t);
  END LOOP;
END
$do$;

CREATE TRIGGER point_of_interest_set_search
  BEFORE INSERT OR UPDATE OF name, description ON core.point_of_interest
  FOR EACH ROW EXECUTE FUNCTION core.set_poi_search();

CREATE TRIGGER access_point_set_search
  BEFORE INSERT OR UPDATE OF name, address, description ON core.access_point
  FOR EACH ROW EXECUTE FUNCTION core.set_access_point_search();

CREATE TRIGGER parking_set_search
  BEFORE INSERT OR UPDATE OF name ON core.parking
  FOR EACH ROW EXECUTE FUNCTION core.set_parking_search();

-- migrate:down
DROP TRIGGER IF EXISTS parking_set_search ON core.parking;
DROP TRIGGER IF EXISTS access_point_set_search ON core.access_point;
DROP TRIGGER IF EXISTS point_of_interest_set_search ON core.point_of_interest;
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['route_segment','access_point','parking','point_of_interest'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON core.%I', t || '_set_geom_proj', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'poi_type','access_point_subtype','segment_status','segment_type',
    'landmark_type','travel_mode','amenity','event_status',
    'distance_method','link_method','status_source',
    'greenway','route_segment','access_point','parking',
    'point_of_interest','opening_hours','event'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON core.%I', t || '_set_updated_at', t);
  END LOOP;
END
$do$;
DROP FUNCTION IF EXISTS core.set_parking_search();
DROP FUNCTION IF EXISTS core.set_access_point_search();
DROP FUNCTION IF EXISTS core.set_poi_search();
DROP FUNCTION IF EXISTS core.set_geom_proj();
DROP FUNCTION IF EXISTS core.set_updated_at();
