-- 0011  Vocabulary seed data
--
-- ============================================================================
-- G4-OQ2 IS RESOLVED. This migration is no longer blocked.
--
-- On-greenway tolerance: 30.000 m. Resolved 2026-08-03, Maha.
--
-- How the number was reached, from two directions that agree:
--
--   Framework anchor. JLG Framework Plan Vol 2 records a 30-foot easement on
--   the narrower off-street sections, about 4.5 m centreline to edge. That is
--   the NARROW case, not the typical one: Lonyo is 66' R.O.W. plus a 30'
--   easement, and the Dearborn section notes 96' of available space, roughly
--   14.5 m centreline to edge. POI coordinates land on building centroids
--   rather than doorways, so the working tolerance has to absorb that offset
--   on top of the half-width. Doubling the widest documented half-width gives
--   about 30 m.
--
--   Measured against the published data. Distance from 254 candidate
--   restroom, play-area and event-space points to the centreline, EPSG:26917.
--   Coverage rises to 12 points at 30 m, then goes flat: 35 m adds one, and
--   40, 45 and 50 m add nothing at all. 30 m sits on the elbow. Past it you
--   pay reach without buying records.
--
-- FR-12 cannot currently be fully delivered using the available dataset. Under
-- Leona's approved 30-metre requirement, only one of approximately 170
-- candidate play areas qualifies. This is recorded as a data-sourcing
-- limitation, not as a reason to reconsider the approved tolerance. Open
-- action: ask Leona whether additional play-area data sources exist.
--
-- Seed data is deliberately the LAST migration, so a blocked value here could
-- never stop the schema from building. That property is worth keeping.
--
-- COLOURS AND ICONS BELOW ARE DEVELOPMENT PLACEHOLDERS (3b-OQ2, 3b-OQ3,
-- Lawrence). They exist so the map, legend and styling fields can be built and
-- tested now. They are not branding and not an accessibility decision. Hex
-- values are unverified against the published Okabe-Ito palette; icon values
-- are semantic keys, not sprite names, and no icon set has been chosen.
--
-- Two swatch families, no reuse across them. An earlier draft gave poi_type and
-- segment_status the same four hues, which made an event-space marker and an
-- open segment the same green on a map that draws both at once.
--
-- POI markers keep the exact Okabe-Ito hues. Segment statuses use darker,
-- desaturated variants of the same hues, so the semantic mapping survives
-- (green reads open, amber reads under construction) while the swatches stay
-- apart. The status four are therefore no longer exact Okabe-Ito members. That
-- is an acceptable trade for placeholders and is Lawrence's to finalise: the
-- palette carries eight colours and this schema needs eleven distinct swatches,
-- so exact membership cannot survive contact with the vocabulary either way.
--
-- All eleven in use, confirmed mutually distinct:
--   POI      #0072B2 #E69F00 #CC79A7 #D55E00 #009E73
--   status   #2A5D8F #B57A1F #8C6B85 #1B7A5A
--   other    #1A1A1A #5A5A5A (access points)   #767676 (cancelled)
-- ============================================================================

-- migrate:up

-- footprint_distance_m is NOT NULL and CHECK (> 0), so there is no legal way to
-- write "unset" in this column. Every row carries a real value or the insert
-- fails. The three on_greenway rows use the G4-OQ2 value of 30.000; the two
-- buffer rows use 804.672, the exact metre conversion of Leona's half-mile.
INSERT INTO core.poi_type (code, label, display_order, color, icon, footprint_rule, footprint_distance_m) VALUES
  ('restroom',    'Restroom',    1, '#0072B2', 'restroom',   'on_greenway',  30.000),
  ('play_area',   'Play area',   2, '#E69F00', 'playground', 'on_greenway',  30.000),
  ('landmark',    'Landmark',    3, '#CC79A7', 'landmark',   'buffer',      804.672),
  ('food_venue',  'Food venue',  4, '#D55E00', 'food',       'buffer',      804.672),
  ('event_space', 'Event space', 5, '#009E73', 'event',      'on_greenway',  30.000);

-- Two tiers. Framework Vol 1, printed p65: "Access points will be provided in
-- two primary levels: major and minor." The trailhead tier was retired; the
-- framework uses "trailhead" only as a place label on design drawings.
-- Neutral tones so access points read as infrastructure, not as another POI
-- category. Major vs minor carries on marker size and weight, not hue.
-- The two greys are outside the Okabe-Ito palette on purpose; both are
-- placeholders and neither has been contrast-checked.
INSERT INTO core.access_point_subtype (code, label, display_order, color, icon) VALUES
  ('major_access', 'Major access point', 1, '#1A1A1A', 'access_major'),
  ('minor_access', 'Minor access point', 2, '#5A5A5A', 'access_minor');

-- All four values below appear in the published dataset's PHASE_DESCRIPTION
-- field and every published row maps to one of them: Open 19, Funded 10,
-- Unfunded 14, Under Construction 8, totalling all 51 segments.
-- Darker, desaturated counterparts to the POI hues. Same semantic reading,
-- no swatch shared with a marker. Lines carry weight and length that markers
-- do not, so the lower saturation costs nothing in legibility.
INSERT INTO core.segment_status (code, label, display_order, color, icon) VALUES
  ('open',               'Open',               1, '#1B7A5A', NULL),
  ('under_construction', 'Under construction', 2, '#B57A1F', NULL),
  ('funded',             'Funded',             3, '#2A5D8F', NULL),
  ('unfunded',           'Unfunded',           4, '#8C6B85', NULL);

-- Colours NULL on purpose: colour is reserved for status. Type is carried by
-- line pattern, ordered by separation from traffic so the line becomes
-- progressively more broken as the route gets less protected. This also
-- satisfies WCAG 2.2 AA 1.4.1, since colour is not the sole carrier of meaning.
--
-- Six rows, not four. The published dataset carries six distinct TYPOLOGY
-- values and the earlier four-row vocabulary had no home for two of them,
-- which would have left 11 of 51 segments with a null type_code. Because
-- type_code is nullable, those rows would have loaded silently and rendered
-- as an unpatterned solid line, visually identical to an off-street trail.
--
-- ETL mapping, source string on the left. Note the lowercase "s" in
-- "Shared street" and the hyphens; these are the exact published values.
--     'Off-Street'     -> off_street_trail      19 segments
--     'Bridge'         -> bridge                 2
--     'Adjacent'       -> adjacent               9
--     'On-Street'      -> on_street_greenway    17
--     'Alley'          -> alley                  2
--     'Shared street'  -> shared_street          2
--
-- Bridge sits second rather than first: it is as separated from traffic as an
-- off-street trail, but it is a distinct structure with its own user-relevant
-- properties (no mid-span exits, railings, closes as a unit), so it earns its
-- own pattern instead of sharing the solid line. Adjacent runs alongside a
-- roadway but remains separated from it, placing it between bridge and
-- on-street. Labels are display strings and may be revised with 3b-OQ2.
INSERT INTO core.segment_type (code, label, display_order, color, icon, line_pattern) VALUES
  ('off_street_trail',   'Off-street trail',   1, NULL, NULL, NULL),
  ('bridge',             'Bridge',             2, NULL, NULL, '16,4'),
  ('adjacent',           'Adjacent path',      3, NULL, NULL, '12,4'),
  ('on_street_greenway', 'On-street greenway', 4, NULL, NULL, '8,4'),
  ('alley',              'Alley',              5, NULL, NULL, '4,3'),
  ('shared_street',      'Shared street',      6, NULL, NULL, '2,3');

INSERT INTO core.landmark_type (code, label, display_order, color, icon) VALUES
  ('art_installation', 'Art installation', 1, NULL, 'art_installation'),
  ('statue',           'Statue',           2, NULL, 'statue'),
  ('other',            'Other',            3, NULL, 'landmark_other');

INSERT INTO core.travel_mode (code, label, display_order, color, icon) VALUES
  ('walk', 'Walk', 1, NULL, 'walk'),
  ('bike', 'Bike', 2, NULL, 'bike');

-- Framework Vol 2, printed p275. Eight of eleven; restrooms, vehicle parking
-- and gathering/event spaces are modelled as entities instead.
INSERT INTO core.amenity (code, label, display_order, color, icon) VALUES
  ('wayfinding_signage',  'Wayfinding and interpretive signage', 1, NULL, 'signage'),
  ('seating_area',        'Seating areas',                       2, NULL, 'seating'),
  ('bike_parking',        'Bike parking',                        3, NULL, 'bike_parking'),
  ('bike_repair_station', 'Bike repair stations',                4, NULL, 'bike_repair'),
  ('litter_receptacle',   'Litter receptacles',                  5, NULL, 'litter'),
  ('drinking_fountain',   'Drinking fountains',                  6, NULL, 'drinking_fountain'),
  ('shade_structure',     'Shade structures or pavilions',       7, NULL, 'shade'),
  ('seating_dining_area', 'Seating and dining areas',            8, NULL, 'dining');

INSERT INTO core.event_status (code, label, display_order, color, icon) VALUES
  ('scheduled', 'Scheduled', 1, NULL,      NULL),
  ('cancelled', 'Cancelled', 2, '#767676', NULL);

-- Two distinct ideas, not a conflict. AUTHORED means a value was entered into
-- the system manually rather than derived by the system. REVIEWED means a staff
-- member later checked and verified it. A value moves through both in sequence:
-- entered by hand, then confirmed by staff. Neither implies the other.
INSERT INTO core.distance_method (code, label, display_order, color, icon) VALUES
  ('straight_line', 'Straight-line estimate', 1, NULL, NULL),
  ('authored',      'Measured on site',       2, NULL, NULL),
  ('routed',        'Walking route',          3, NULL, NULL);

-- Same 'authored' code, same meaning: assigned by hand rather than by the
-- automatic matcher, and then checked by staff.
INSERT INTO core.link_method (code, label, display_order) VALUES
  ('auto',     'Automatically assigned', 1),
  ('authored', 'Reviewed by staff',      2);

-- Labels match the public strings agreed for FR-05b shall-8, which append
-- ", not yet confirmed" and ", [date]" respectively at the display layer.
-- This is where review, as distinct from authorship, is recorded for status.
INSERT INTO core.status_source (code, label, display_order) VALUES
  ('ingested', 'From planning data',     1),
  ('staff',    'Confirmed by JLG staff', 2);

-- Trail root. FR-08a. Length is derived from segments, never stored.
INSERT INTO core.greenway (name) VALUES ('Joe Louis Greenway');

-- migrate:down
-- DELETE, not TRUNCATE. TRUNCATE refuses on any table referenced by a foreign
-- key even when no referencing rows exist. DELETE fails only if data actually
-- references a vocabulary, which is the correct behaviour.
DELETE FROM core.greenway WHERE name = 'Joe Louis Greenway';
DELETE FROM core.status_source;
DELETE FROM core.link_method;
DELETE FROM core.distance_method;
DELETE FROM core.event_status;
DELETE FROM core.amenity;
DELETE FROM core.travel_mode;
DELETE FROM core.landmark_type;
DELETE FROM core.segment_type;
DELETE FROM core.segment_status;
DELETE FROM core.access_point_subtype;
DELETE FROM core.poi_type;
