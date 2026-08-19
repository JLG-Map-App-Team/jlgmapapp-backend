-- 0014  Park vocabulary seed
--
-- ============================================================================
-- WHY THIS IS A SEPARATE FILE FROM 0013
--
-- Migration 0011 states: "Seed data is deliberately the LAST migration, so a
-- blocked value here could never stop the schema from building. That property is
-- worth keeping."
--
-- So structure and content stay apart. 0013 is DDL only and will build even if
-- every value below turns out to be wrong. 0014 is content only.
--
-- Note that the ordering property was already softened once: migration 0012
-- (20260803000012) lands after the 0011 seed. Splitting here preserves the
-- intent rather than compounding the drift.
--
-- ----------------------------------------------------------------------------
-- RETIREMENT OF A PRIOR DECISION. RECORDED EXPLICITLY, NOT OVERWRITTEN.
--
-- Migration 0011 says of the amenity vocabulary:
--
--   "Framework Vol 2, printed p275. Eight of eleven; restrooms, vehicle parking
--    and gathering/event spaces are modelled as entities instead."
--
-- has_restroom below PARTIALLY RETIRES that decision, for one specific case.
--
-- What still stands: a restroom with a known location remains an entity, a
-- point_of_interest row with poi_type_code 'restroom'. That is unchanged.
--
-- What changes: SEMCOG parks supply a yes/no restroom flag with NO coordinate.
-- It cannot become an entity without inventing a location, which the
-- no-fabricated-coordinates rule forbids. So the flag is modelled as an amenity,
-- which is what an amenity is for: a property of a place rather than a place.
--
-- The two are reconciled at query time by core.restroom_result in 0013, not in
-- the schema. FR-11 requires a corresponding amendment; without it, the restroom
-- filter queries poi_type_code = 'restroom' and will not find park restrooms at
-- all. Owner: Maha.
--
-- Note this retirement does NOT extend to the other two exclusions. Vehicle
-- parking and event spaces remain entities, with no flag equivalent, because
-- both have real coordinates in their sources.
--
-- ----------------------------------------------------------------------------
-- WHY THE has_ PREFIX
--
-- Without it, core.amenity.code 'restroom' would sit alongside
-- core.poi_type.code 'restroom'. Legal, different tables, and permanently
-- confusing: a reader scanning a query or a report cannot tell which is meant.
--
-- The prefix makes a feature-of-a-place always distinguishable from a place.
-- Applied to both new codes for consistency, not just the ambiguous one.
--
-- ----------------------------------------------------------------------------
-- COLOURS AND ICONS ARE DEVELOPMENT PLACEHOLDERS (3b-OQ2, 3b-OQ3, Lawrence).
--
-- Same status as every colour in 0011. Not branding, not an accessibility
-- decision, unverified against the published Okabe-Ito palette.
--
-- #56B4E9 is the one Okabe-Ito member not already in use. Confirmed absent from
-- the eleven swatches 0011 lists as mutually distinct.
--
-- FLAG FOR LAWRENCE: this puts two blues in the POI family, alongside restroom's
-- #0072B2. On a map drawing both at once, a park and a restroom marker may read
-- as related when they are not. #F0E442 (yellow) is the only other unused member
-- and has its own contrast problems on a light basemap. This is Lawrence's call,
-- and 0011 already notes the palette carries eight colours while the schema needs
-- more than that, so exact membership cannot survive the vocabulary either way.
--
-- ----------------------------------------------------------------------------
-- footprint_distance_m for park is 30.000: the G4-OQ2 value from 0011, resolved
-- 2026-08-03 by Maha. UNCHANGED here.
--
-- But for park it is measured against the FOOTPRINT rather than the display
-- point. See the G4-OQ2 consequence note in 0013, and the required re-run of the
-- elbow analysis before any FR-12 conclusion.
--
-- footprint_rule is 'on_greenway' rather than 'buffer' because a park is a place
-- on or immediately beside the trail, like a restroom or play area, not a
-- destination within half a mile like a landmark or food venue.
-- ============================================================================

-- migrate:up

-- display_order 6 continues from event_space at 5. The column is UNIQUE, so this
-- insert fails loudly rather than silently reordering if 5 is not the current
-- maximum.
INSERT INTO core.poi_type (code, label, display_order, color, icon, footprint_rule, footprint_distance_m) VALUES
  ('park', 'Park', 6, '#56B4E9', 'park', 'on_greenway', 30.000);

-- display_order 9 and 10 continue from seating_dining_area at 8, which is the
-- current maximum in the eight rows seeded by 0011. Also UNIQUE.
--
-- Colours NULL, matching every other amenity row in 0011: amenities are carried
-- by icon and label in a detail panel, never by a map marker colour.
INSERT INTO core.amenity (code, label, display_order, color, icon) VALUES
  ('has_restroom',  'Restroom on site',  9, NULL, 'restroom'),
  ('has_play_area', 'Play area on site', 10, NULL, 'playground');

-- migrate:down
-- DELETE with an explicit WHERE, following 0011's reasoning. A bare DELETE would
-- empty the vocabulary; these statements remove only what this migration added,
-- and fail if park POIs or park amenity rows still reference them, which is the
-- correct behaviour.
DELETE FROM core.amenity WHERE code IN ('has_restroom', 'has_play_area');
DELETE FROM core.poi_type WHERE code = 'park';
