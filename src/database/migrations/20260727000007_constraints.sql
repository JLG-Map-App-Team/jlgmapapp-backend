-- 0007  Constraints
--
-- 22 rules. More than a five-table layout would need; that is the cost of
-- single-table inheritance, paid in the open. In exchange they are
-- declarative, visible in the schema, individually testable, and cannot be
-- bypassed by application code.

-- migrate:up

-- Kind-specific columns. Each is permitted only on its own POI type.
ALTER TABLE core.point_of_interest
  ADD CONSTRAINT poi_location_guidance_restroom_only
    CHECK (location_guidance IS NULL OR poi_type_code = 'restroom'),
  ADD CONSTRAINT poi_hours_label_play_area_only
    CHECK (hours_label IS NULL OR poi_type_code = 'play_area'),
  ADD CONSTRAINT poi_landmark_type_required
    CHECK ((poi_type_code = 'landmark') = (landmark_type_code IS NOT NULL)),
  ADD CONSTRAINT poi_is_key_landmark_only
    CHECK (is_key IS NULL OR poi_type_code = 'landmark'),
  ADD CONSTRAINT poi_venue_description_event_space_only
    CHECK (venue_description IS NULL OR poi_type_code = 'event_space'),
  -- Provenance pairing: a number may not exist without a record of its origin.
  ADD CONSTRAINT poi_ap_distance_paired
    CHECK ((access_point_distance_m IS NULL) = (access_point_distance_method IS NULL)),
  ADD CONSTRAINT poi_trail_distance_paired
    CHECK ((distance_to_trail_m IS NULL) = (distance_to_trail_method IS NULL)),
  ADD CONSTRAINT poi_link_method_paired
    CHECK ((access_point_id IS NULL) = (access_point_link_method IS NULL)),
  ADD CONSTRAINT poi_distances_non_negative
    CHECK (coalesce(access_point_distance_m, 0) >= 0
       AND coalesce(distance_to_trail_m, 0) >= 0),
  ADD CONSTRAINT poi_source_ref_unique UNIQUE (source, source_ref);

COMMENT ON CONSTRAINT poi_landmark_type_required ON core.point_of_interest IS
  'Equality between two boolean tests: landmark and has-a-type must be true together or false together. Required for landmarks, forbidden for everything else, in one line. Fails in BOTH directions, so both need a test.';

ALTER TABLE core.parking
  ADD CONSTRAINT parking_distance_paired
    CHECK ((access_point_distance_m IS NULL) = (access_point_distance_method IS NULL)),
  ADD CONSTRAINT parking_distance_non_negative
    CHECK (coalesce(access_point_distance_m, 0) >= 0),
  ADD CONSTRAINT parking_source_ref_unique UNIQUE (source, source_ref);

ALTER TABLE core.route_segment
  ADD CONSTRAINT route_segment_staff_status_attributed
    CHECK (status_source <> 'staff'
           OR (status_updated_by IS NOT NULL AND status_updated_at IS NOT NULL)),
  ADD CONSTRAINT route_segment_source_ref_unique UNIQUE (source, source_ref);

COMMENT ON CONSTRAINT route_segment_staff_status_attributed ON core.route_segment IS
  'FR-05b shall-2. A staff-set status cannot exist without a name and a time against it. Without this the audit trail could fail silently.';

ALTER TABLE core.access_point
  ADD CONSTRAINT access_point_source_ref_unique UNIQUE (source, source_ref);

ALTER TABLE core.opening_hours
  ADD CONSTRAINT opening_hours_allowlist
    CHECK (poi_type_code IN ('restroom', 'play_area')),
  ADD CONSTRAINT opening_hours_ordered   CHECK (closes_at > opens_at),
  ADD CONSTRAINT opening_hours_dow_valid CHECK (day_of_week BETWEEN 1 AND 7),
  ADD CONSTRAINT opening_hours_unique    UNIQUE (poi_id, day_of_week, opens_at);

COMMENT ON CONSTRAINT opening_hours_allowlist ON core.opening_hours IS
  'Allowlist, not denylist, so it fails closed: a sixth POI kind added in Phase 2 is refused hours until someone deliberately permits it. Food venue hours were retired by decision; landmark and event space hours are out of Phase 1 scope.';
COMMENT ON CONSTRAINT opening_hours_ordered ON core.opening_hours IS
  'Strict. A facility open past midnight is stored as two rows split at midnight (2b-OQ2), handled in the ETL, so this rule never needs relaxing.';

ALTER TABLE core.event
  ADD CONSTRAINT event_type_is_event_space CHECK (poi_type_code = 'event_space'),
  ADD CONSTRAINT event_ordered             CHECK (ends_at > starts_at);

COMMENT ON CONSTRAINT event_ordered ON core.event IS
  'Strict: equal start and end is rejected. The admin form currently says "on or after start" (3b-OQ8); the two must be reconciled.';

-- migrate:down
ALTER TABLE core.event
  DROP CONSTRAINT IF EXISTS event_ordered,
  DROP CONSTRAINT IF EXISTS event_type_is_event_space;
ALTER TABLE core.opening_hours
  DROP CONSTRAINT IF EXISTS opening_hours_unique,
  DROP CONSTRAINT IF EXISTS opening_hours_dow_valid,
  DROP CONSTRAINT IF EXISTS opening_hours_ordered,
  DROP CONSTRAINT IF EXISTS opening_hours_allowlist;
ALTER TABLE core.access_point
  DROP CONSTRAINT IF EXISTS access_point_source_ref_unique;
ALTER TABLE core.route_segment
  DROP CONSTRAINT IF EXISTS route_segment_source_ref_unique,
  DROP CONSTRAINT IF EXISTS route_segment_staff_status_attributed;
ALTER TABLE core.parking
  DROP CONSTRAINT IF EXISTS parking_source_ref_unique,
  DROP CONSTRAINT IF EXISTS parking_distance_non_negative,
  DROP CONSTRAINT IF EXISTS parking_distance_paired;
ALTER TABLE core.point_of_interest
  DROP CONSTRAINT IF EXISTS poi_source_ref_unique,
  DROP CONSTRAINT IF EXISTS poi_distances_non_negative,
  DROP CONSTRAINT IF EXISTS poi_link_method_paired,
  DROP CONSTRAINT IF EXISTS poi_trail_distance_paired,
  DROP CONSTRAINT IF EXISTS poi_ap_distance_paired,
  DROP CONSTRAINT IF EXISTS poi_venue_description_event_space_only,
  DROP CONSTRAINT IF EXISTS poi_is_key_landmark_only,
  DROP CONSTRAINT IF EXISTS poi_landmark_type_required,
  DROP CONSTRAINT IF EXISTS poi_hours_label_play_area_only,
  DROP CONSTRAINT IF EXISTS poi_location_guidance_restroom_only;
