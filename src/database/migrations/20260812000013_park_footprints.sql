-- 0013  Park POI support, footprint geometry, restroom result reconciliation
--
-- ============================================================================
-- WHY THIS EXISTS
--
-- Parks and recreation centres were requested by Leona (email reply, [date TBD]),
-- alongside grocery stores, gas stations, libraries and trails. Only parks and
-- rec centres enter Phase 1; the rest are deferred under SD-001.
--
-- Rec centres are modelled as event_space. No new poi_type. They already fit the
-- existing machinery: core.event, point_of_interest_amenity, and the FR-14a
-- access_point_event_space association. Rec centres do host events, so event
-- capability is correct rather than incidental. Accepted cost: rec centres cannot
-- be counted or filtered separately from other event spaces, and they appear in
-- the event spaces layer alongside purpose-built venues. Decided by Maha,
-- 2026-08-12.
--
-- Parks get their own poi_type. The alternative considered and REJECTED was
-- folding parks into play_area. Detroit alone has roughly 309 parks and 11
-- recreation centres, and most of those parks have no play equipment. Folding
-- them in would label 309 records as play areas, which states something false,
-- and would discard the very SEMCOG restroom and play-area flags this work
-- exists to consume. A park CONTAINS a play area; modelling the container as the
-- contained thing loses information in both directions.
--
-- ----------------------------------------------------------------------------
-- FOOTPRINTS: WHY A SECOND GEOMETRY
--
-- SEMCOG parks are polygons. Confirmed from the layer 74 service metadata:
-- geometryType esriGeometryPolygon, maxRecordCount 2000, lastEditDate
-- 1762046593693 (roughly 2 November 2025).
--
-- core.point_of_interest.geom is a Point. A park reduced to a single interior
-- point can sit hundreds of metres from the trail while its boundary physically
-- touches it. Under the 30.000 m on_greenway rule, that rejects parks that
-- plainly qualify.
--
-- So the footprint is measured against the centreline, and geom remains the
-- display pin. A park's SIZE therefore stops affecting whether it qualifies.
--
-- ETL REQUIREMENT: derive geom with ST_PointOnSurface, NOT ST_Centroid. The
-- centroid of a concave or ring-shaped park can land outside the park, in the
-- street. ST_PointOnSurface is guaranteed to land inside the polygon.
--
-- MultiPolygon rather than Polygon: parks in the published data are multi-parcel.
-- The ETL must wrap single polygons with ST_Multi() or the insert is rejected.
--
-- ----------------------------------------------------------------------------
-- CONSEQUENCE FOR G4-OQ2. RECORDED, NOT REOPENED.
--
-- The 30.000 m value from migration 0011 STANDS and is not changed here.
--
-- But note precisely what justified it. The elbow analysis in 0011 measured 254
-- candidate restroom, play-area and event-space POINTS to the centreline, and
-- found coverage flat past 30 m. A footprint-to-centreline test is a DIFFERENT
-- measurement, and its coverage curve is unknown.
--
-- This matters for FR-12. Migration 0011 records that only about 1 of roughly
-- 170 candidate play areas qualifies at 30 m. That figure is point-based. A park
-- whose interior point sits 200 m away may have an edge 5 m from the trail, so
-- the shortfall may be materially smaller once parks carry footprints.
--
-- ACTION, owner [owner TBD]: re-run the 0011 elbow analysis using
-- footprint-to-centreline distance before drawing any conclusion about FR-12,
-- and before asking Leona for additional play-area sources (the open action in
-- 0011). If the elbow lands elsewhere for footprints, that is a finding to
-- record, NOT a reason to move the agreed tolerance.
-- ============================================================================

-- migrate:up

-- ----------------------------------------------------------------------------
-- 1. Footprint geometry
-- ----------------------------------------------------------------------------

ALTER TABLE core.point_of_interest
  ADD COLUMN footprint      geometry(MultiPolygon, 4326),
  ADD COLUMN footprint_proj geometry(MultiPolygon, 26917);

-- Mirrors the existing set_geom_proj pattern: EPSG:4326 is authored and served,
-- EPSG:26917 is derived by trigger and used for every measurement.
--
-- Differs from set_geom_proj in one way: footprint is NULLABLE, because only
-- parks have one. So the NULL branch is explicit rather than assumed.
--
-- VERIFY BEFORE APPLYING: this function was written from the naming convention
-- in the schema reference, not read from the live database. Compare it against
-- the actual core.set_geom_proj body and align the style if it differs.
CREATE FUNCTION core.set_footprint_proj() RETURNS trigger AS $$
BEGIN
  IF NEW.footprint IS NULL THEN
    NEW.footprint_proj := NULL;
  ELSE
    NEW.footprint_proj := ST_Transform(NEW.footprint, 26917);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER point_of_interest_set_footprint_proj
  BEFORE INSERT OR UPDATE OF footprint ON core.point_of_interest
  FOR EACH ROW EXECUTE FUNCTION core.set_footprint_proj();

-- Same shape as parking_distance_paired. Without this, a footprint could exist
-- with no projected copy, making it silently unmeasurable: the on-greenway test
-- would skip the row rather than fail, and the park would vanish from results
-- with no error anywhere.
ALTER TABLE core.point_of_interest
  ADD CONSTRAINT poi_footprint_paired
  CHECK ((footprint IS NULL) = (footprint_proj IS NULL));

-- Only parks carry footprints in Phase 1.
--
-- event_space is DELIBERATELY EXCLUDED even though rec centres are event spaces.
-- The Detroit RecCenters FeatureServer returns points, not polygons, so there is
-- no polygon to store. Widen this constraint if a building-footprint source for
-- rec centres appears later.
ALTER TABLE core.point_of_interest
  ADD CONSTRAINT poi_footprint_type_allowed
  CHECK (footprint IS NULL OR poi_type_code = 'park');

-- GIST on the projected copy only. Measurement happens in EPSG:26917; the 4326
-- copy is for serving to the browser and is never the subject of a spatial
-- predicate. Matches the existing pattern where both geom indexes exist because
-- both are queried, which is not the case here.
CREATE INDEX point_of_interest_footprint_proj_idx
  ON core.point_of_interest USING GIST (footprint_proj);

-- ----------------------------------------------------------------------------
-- 2. Widen amenities from event spaces to parks
-- ----------------------------------------------------------------------------

-- The old constraint name becomes a lie the moment parks carry amenities, so it
-- is renamed rather than left in place misleadingly.
--
-- NOTE FOR EITY: poi_amenity_event_space_only is named explicitly in the test
-- specification and will no longer exist after this migration.
ALTER TABLE core.point_of_interest_amenity
  DROP CONSTRAINT poi_amenity_event_space_only;

ALTER TABLE core.point_of_interest_amenity
  ADD CONSTRAINT poi_amenity_type_allowed
  CHECK (poi_type_code IN ('event_space', 'park'));

-- ----------------------------------------------------------------------------
-- 3. Restroom result reconciliation (FR-11)
-- ----------------------------------------------------------------------------

-- THE PROBLEM THIS SOLVES
--
-- After this migration there are two kinds of evidence that a restroom exists:
--
--   (a) A restroom POI with real coordinates, from the DetroitData seed dataset.
--   (b) A park carrying the has_restroom amenity flag, from SEMCOG.
--
-- These are NOT duplicate rows and no unique constraint can express the
-- relationship. One is a place with a location. The other is a boolean on a
-- polygon, with no coordinate at all.
--
-- Critically: (b) CANNOT be promoted into (a). A yes/no flag gives no location,
-- and inventing one would violate the no-fabricated-coordinates rule that FR-01,
-- FR-04 and FR-08a depend on. So the reconciliation happens at query time.
--
-- WHY A VIEW RATHER THAN A COLUMN
--
-- Following the same reasoning as schema section 3.7 (routing topology lives
-- outside the domain model): this is derived data, nobody authors it, and it
-- would drift if stored alongside authored data.
--
-- THE DEDUPE RULE
--
-- A restroom POI beats a park's has_restroom flag for the same location. The POI
-- can be drawn on a map; the flag cannot. Prefer the record that can be drawn.
--
-- location_is_exact is the honest signal to the display layer. A park flag and a
-- located restroom must not be presented as the same kind of fact, which is the
-- same principle FR-05b shall-8 applies to segment status currency.
--
-- OPEN ITEM G4-OQ3, PROVISIONAL VALUE.
--
-- The 30.0 m below is a CONTAINMENT tolerance: how close a located restroom must
-- be to a park boundary before we treat the park's flag as already represented.
-- It exists because geocoded restrooms can land just outside their park.
--
-- This is a DIFFERENT question from G4-OQ2, and the 0011 elbow analysis does NOT
-- justify it. The value reuses 30.0 m by decision of Maha, 2026-08-12, pending
-- validation against real data after first load.
--
-- Known failure mode: a restroom on a neighbouring property 30 m from a park
-- edge will suppress that park's genuine flag, hiding a real park restroom.
-- Re-check this value once both datasets are loaded. Do not inherit G4-OQ2's
-- justification for it.
--
-- COALESCE on the geometry is load-bearing: a park with no footprint yet falls
-- back to its display point, so the flag is still evaluated rather than silently
-- dropped through a NULL comparison.
CREATE VIEW core.restroom_result AS
  SELECT
    r.id,
    r.name,
    r.geom,
    'restroom_poi'::text AS result_kind,
    true                 AS location_is_exact,
    NULL::bigint         AS parent_park_id
  FROM core.point_of_interest r
  WHERE r.poi_type_code = 'restroom'

  UNION ALL

  SELECT
    p.id,
    p.name,
    p.geom,
    'park_flag'::text AS result_kind,
    false             AS location_is_exact,
    p.id              AS parent_park_id
  FROM core.point_of_interest p
  JOIN core.point_of_interest_amenity a
    ON a.poi_id        = p.id
   AND a.poi_type_code = p.poi_type_code
  WHERE p.poi_type_code = 'park'
    AND a.amenity_code  = 'has_restroom'
    AND NOT EXISTS (
      SELECT 1
      FROM core.point_of_interest r2
      WHERE r2.poi_type_code = 'restroom'
        AND ST_DWithin(
              r2.geom_proj,
              COALESCE(p.footprint_proj, p.geom_proj),
              30.0
            )
    );

COMMENT ON VIEW core.restroom_result IS
  'FR-11 restroom results, reconciling located restroom POIs with park has_restroom flags. A located POI suppresses a park flag within the G4-OQ3 containment tolerance. location_is_exact distinguishes the two kinds of evidence and must not be collapsed at the display layer.';

-- migrate:down

DROP VIEW core.restroom_result;

ALTER TABLE core.point_of_interest_amenity DROP CONSTRAINT poi_amenity_type_allowed;

-- WARNING: this will FAIL if any park amenity rows exist, which is correct
-- behaviour and matches the DELETE-not-TRUNCATE reasoning in migration 0011.
-- Remove park amenity rows before rolling back.
ALTER TABLE core.point_of_interest_amenity
  ADD CONSTRAINT poi_amenity_event_space_only
  CHECK (poi_type_code = 'event_space'::text);

DROP INDEX core.point_of_interest_footprint_proj_idx;

ALTER TABLE core.point_of_interest DROP CONSTRAINT poi_footprint_type_allowed;
ALTER TABLE core.point_of_interest DROP CONSTRAINT poi_footprint_paired;

DROP TRIGGER point_of_interest_set_footprint_proj ON core.point_of_interest;
DROP FUNCTION core.set_footprint_proj();

ALTER TABLE core.point_of_interest
  DROP COLUMN footprint_proj,
  DROP COLUMN footprint;
