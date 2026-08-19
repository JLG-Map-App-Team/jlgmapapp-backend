-- 0015  Retire the SEMCOG-dependent objects
--
-- ============================================================================
-- SEMCOG is removed from the project. Decided 12 August 2026, Maha.
--
-- Migrations 0013 and 0014 are applied and shared, so they are not rewritten.
-- This migration removes what they created that no longer has a data source.
--
-- WHAT CHANGED UPSTREAM
--
--   Parks now come only from the JLG Framework Plan Vol. 1, as geocoded points.
--   Restrooms are reduced to the single restroom at the Warren access point.
--   Neither the SEMCOG polygon layer nor its amenity flags will be loaded.
--
-- WHAT THAT ORPHANS
--
--   0013 added footprint geometry because SEMCOG supplied polygons and a park
--   reduced to one interior point can sit hundreds of metres from the trail
--   while its boundary touches it. Framework Plan parks are points. The
--   footprint columns, their constraints, their index, and the trigger that
--   derives the projected form would sit over permanently NULL values.
--
--   0014 added has_restroom and has_play_area as amenity flags because SEMCOG
--   carried those attributes for parks. Nothing else supplies them.
--
--   core.restroom_result exists to reconcile located restroom POIs against
--   park restroom flags. With no flags and one restroom, the union has nothing
--   to union and the suppression rule has nothing to suppress. G4-OQ3, the
--   30 m containment tolerance, is retired with it.
--
-- WHAT IS KEPT, AND WHY
--
--   poi_type 'park' stays. Parks are still in scope; only their source changed.
--
--   poi_amenity_type_allowed stays as 0013 wrote it, permitting amenities on
--   both event_space and park. The two SEMCOG-derived amenity codes go, but a
--   park may still legitimately carry an amenity from another source, and
--   reverting to the old event-space-only rule would forbid that.
--
-- ONE DESIGN DECISION BEYOND THE INSTRUCTION, FLAGGED FOR REVIEW
--
--   Park inclusion is now editorial. The Framework Plan's map figure shows
--   parks the City's planners judged to be on the greenway; the ETL trusts
--   that selection rather than measuring distance. But 0014 seeded park with
--   footprint_rule 'on_greenway' at 30.000 m, and if the loader ignores a rule
--   the vocabulary states, the vocabulary is lying -- which is the exact class
--   of silent divergence this project keeps finding.
--
--   So footprint_rule gains a third value, 'editorial', and
--   footprint_distance_m becomes nullable for it. A rule with no distance is
--   now expressible instead of being encoded as a number nobody applies.
--
--   This changes two constraints the test specification names explicitly.
--   NOTE FOR EITY: poi_type_footprint_rule_valid and
--   poi_type_footprint_distance_positive both change shape here.
-- ============================================================================

-- migrate:up

-- Order matters: the view reads the columns, the trigger writes one of them,
-- and the constraints and index depend on them.

DROP VIEW IF EXISTS core.restroom_result;

DROP TRIGGER IF EXISTS point_of_interest_set_footprint_proj ON core.point_of_interest;
DROP FUNCTION IF EXISTS core.set_footprint_proj();

ALTER TABLE core.point_of_interest
  DROP CONSTRAINT IF EXISTS poi_footprint_paired,
  DROP CONSTRAINT IF EXISTS poi_footprint_type_allowed;

DROP INDEX IF EXISTS core.point_of_interest_footprint_proj_idx;

ALTER TABLE core.point_of_interest
  DROP COLUMN IF EXISTS footprint_proj,
  DROP COLUMN IF EXISTS footprint;

-- The two SEMCOG-derived amenity codes. DELETE rather than TRUNCATE so the
-- statement fails loudly if anything already references them, which would mean
-- data was loaded that this migration has not accounted for.
DELETE FROM core.amenity WHERE code IN ('has_restroom', 'has_play_area');

-- Park inclusion becomes editorial. See the header.
ALTER TABLE core.poi_type
  DROP CONSTRAINT IF EXISTS poi_type_footprint_rule_valid,
  DROP CONSTRAINT IF EXISTS poi_type_footprint_distance_positive;

ALTER TABLE core.poi_type
  ALTER COLUMN footprint_distance_m DROP NOT NULL;

ALTER TABLE core.poi_type
  ADD CONSTRAINT poi_type_footprint_rule_valid
    CHECK (footprint_rule IN ('on_greenway', 'buffer', 'editorial')),
  ADD CONSTRAINT poi_type_footprint_distance_positive
    CHECK (
      (footprint_rule = 'editorial' AND footprint_distance_m IS NULL)
      OR footprint_distance_m > 0
    );

UPDATE core.poi_type
   SET footprint_rule = 'editorial',
       footprint_distance_m = NULL
 WHERE code = 'park';

COMMENT ON COLUMN core.poi_type.footprint_rule IS
  'How a POI of this type is judged in or out of scope. on_greenway measures distance to the centreline against footprint_distance_m. buffer measures the same way at a wider distance. editorial means inclusion is decided by a named source document rather than computed, and footprint_distance_m is NULL because no distance is applied. Added 2026-08-12 for park, whose members come from the JLG Framework Plan Vol. 1 map figure: the City''s planners selected the parks they consider to be on the greenway, and the ETL trusts that selection. Recorded here rather than left implicit, because a rule the loader silently ignores is worse than no rule.';

COMMENT ON COLUMN core.poi_type.footprint_distance_m IS
  'Metres from the trail centreline. NULL only where footprint_rule is editorial. Previously NOT NULL with CHECK (> 0), which meant "no distance applies" had no legal representation -- the same problem an earlier seed hit when it used 0.000 as a placeholder for an undecided value.';

-- migrate:down

ALTER TABLE core.poi_type
  DROP CONSTRAINT IF EXISTS poi_type_footprint_rule_valid,
  DROP CONSTRAINT IF EXISTS poi_type_footprint_distance_positive;

UPDATE core.poi_type
   SET footprint_rule = 'on_greenway',
       footprint_distance_m = 30.000
 WHERE code = 'park';

ALTER TABLE core.poi_type
  ALTER COLUMN footprint_distance_m SET NOT NULL;

ALTER TABLE core.poi_type
  ADD CONSTRAINT poi_type_footprint_rule_valid
    CHECK (footprint_rule IN ('on_greenway', 'buffer')),
  ADD CONSTRAINT poi_type_footprint_distance_positive
    CHECK (footprint_distance_m > 0);

INSERT INTO core.amenity (code, label, display_order, color, icon) VALUES
  ('has_restroom',  'Restroom',  9, NULL, 'restroom'),
  ('has_play_area', 'Play area', 10, NULL, 'playground');

ALTER TABLE core.point_of_interest
  ADD COLUMN footprint      geometry(MultiPolygon, 4326),
  ADD COLUMN footprint_proj geometry(MultiPolygon, 26917);

CREATE INDEX point_of_interest_footprint_proj_idx
  ON core.point_of_interest USING GIST (footprint_proj);

ALTER TABLE core.point_of_interest
  ADD CONSTRAINT poi_footprint_paired
    CHECK ((footprint IS NULL) = (footprint_proj IS NULL)),
  ADD CONSTRAINT poi_footprint_type_allowed
    CHECK (footprint IS NULL OR poi_type_code = 'park');

CREATE FUNCTION core.set_footprint_proj() RETURNS trigger AS $$
BEGIN
  NEW.footprint_proj := CASE
    WHEN NEW.footprint IS NULL THEN NULL
    ELSE ST_Transform(NEW.footprint, 26917)
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER point_of_interest_set_footprint_proj
  BEFORE INSERT OR UPDATE OF footprint ON core.point_of_interest
  FOR EACH ROW EXECUTE FUNCTION core.set_footprint_proj();

CREATE VIEW core.restroom_result AS
  SELECT p.id, p.name, p.geom, 'located'::text AS result_kind, true AS location_is_exact
    FROM core.point_of_interest p
   WHERE p.poi_type_code = 'restroom'
  UNION ALL
  SELECT k.id, k.name, k.geom, 'park_flag'::text AS result_kind, false AS location_is_exact
    FROM core.point_of_interest k
    JOIN core.point_of_interest_amenity a ON a.poi_id = k.id
   WHERE k.poi_type_code = 'park'
     AND a.amenity_code = 'has_restroom'
     AND NOT EXISTS (
       SELECT 1 FROM core.point_of_interest r
        WHERE r.poi_type_code = 'restroom'
          AND ST_DWithin(r.geom_proj, k.footprint_proj, 30.0)
     );
