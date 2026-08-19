-- 0008  Routing topology (G1, Option B)
--
-- Topology stays in the routing schema. It is derived from segment geometry,
-- never authored, and never served to the client. Standard pgRouting practice
-- is to add source/target columns to your own table; that would put topology
-- in the domain model, so routing keeps its own copy.
--
-- STRUCTURE ONLY. The rebuild procedure is migration 0012
-- (routing.rebuild_topology). Structure is created once; the rebuild runs after
-- every segment load. Keeping them apart means the rebuild can be revised
-- without touching an applied migration.

-- migrate:up

-- ---------------------------------------------------------------------------
-- Edges
-- ---------------------------------------------------------------------------
-- One row per EDGE, not per source segment. Those were the same thing until
-- noding was introduced (FR-08e shall-1): a segment that crosses another is
-- split at the crossing, so one core.route_segment can produce several edges.
-- Analysis of the published dataset on 2026-08-01 found four such crossings,
-- turning 51 source segments into 53 edges.

CREATE TABLE routing.segment_edge (
  edge_id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_segment_id bigint      NOT NULL REFERENCES core.route_segment(id),
  split_ordinal     smallint    NOT NULL DEFAULT 1,
  source            bigint,     -- routing.segment_vertex.id, set by 0012
  target            bigint,     -- routing.segment_vertex.id, set by 0012
  cost              double precision NOT NULL,
  reverse_cost      double precision NOT NULL,
  geom              geometry(LineString, 26917) NOT NULL,
  built_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT segment_edge_source_split_key
    UNIQUE (source_segment_id, split_ordinal),

  CONSTRAINT segment_edge_cost_bidirectional
    CHECK (cost > 0 AND reverse_cost > 0 AND cost = reverse_cost),

  CONSTRAINT segment_edge_no_self_loop
    CHECK (source IS NULL OR target IS NULL OR source <> target)
);

CREATE INDEX segment_edge_source_idx         ON routing.segment_edge (source);
CREATE INDEX segment_edge_target_idx         ON routing.segment_edge (target);
CREATE INDEX segment_edge_geom_idx           ON routing.segment_edge USING GIST (geom);
CREATE INDEX segment_edge_source_segment_idx ON routing.segment_edge (source_segment_id);

COMMENT ON TABLE routing.segment_edge IS
  'Holds EVERY segment regardless of status. This looks wrong and is deliberate: FR-08a shall-4 forbids substituting the longer arc when the shorter one is interrupted. Filtering closed segments out of the graph produces exactly the forbidden behaviour. Route across the full network, then inspect the returned segments'' status and flag any that are not open.';

COMMENT ON COLUMN routing.segment_edge.source_segment_id IS
  'This table previously used core.route_segment.id AS ITS OWN primary key, one edge per segment. Noding (FR-08e shall-1) made that impossible: a segment split at a crossing yields two edges and they cannot share one key. The relationship is now an explicit foreign key rather than a shared identifier. Anyone who learned the old rule should note the change.';

COMMENT ON COLUMN routing.segment_edge.source IS
  'Deliberately NOT a foreign key to routing.segment_vertex, matching pgRouting convention. The rebuild inserts edge geometry first, derives vertices from those endpoints second, and assigns source and target third; a non-deferrable foreign key would block that order. Referential integrity is instead guaranteed by 0012 building both from the same statement set inside one transaction.';

COMMENT ON COLUMN routing.segment_edge.split_ordinal IS
  '1 for a segment that was not split. 2, 3 ... for the pieces of one that was, ordered along the original line. Unsplit segments therefore keep a stable (source_segment_id, 1) identity across rebuilds.';

COMMENT ON COLUMN routing.segment_edge.reverse_cost IS
  'Equals cost. Phase 1 contains no one-way pedestrian route segments and no mechanism for declaring one; see FRD section 4.9 and FR-08a shall-10. Changing this column alone would NOT introduce a one-way section, it would violate segment_edge_cost_bidirectional. A one-way segment is a scope change requiring a new requirement, not a data edit. (D1, 2026-07-29, superseding a comment that pointed here as the place to make that change.)';

COMMENT ON CONSTRAINT segment_edge_cost_bidirectional ON routing.segment_edge IS
  'FR-08a shall-10 as a constraint rather than a runtime check, so violation is impossible instead of merely detectable. The > 0 half also catches degenerate geometry: a zero-length line or a failed ST_Length gives a cost of 0, which passes equality but is not routable. Valid only while cost is direction-independent; a grade-aware cost would legitimately differ by direction and would need this rule revisited.';

COMMENT ON CONSTRAINT segment_edge_no_self_loop ON routing.segment_edge IS
  'An edge starting and ending at the same node is the signature of a segment shorter than the joining tolerance having both its endpoints clustered together. The shortest real segment is 2.391 m (Woodward Bridge, measured 2026-08-01) against a 0.5 m tolerance, so this should never fire. It fires loudly if the tolerance is ever raised past the shortest segment. Nulls are permitted because 0012 inserts geometry first and assigns nodes second.';

-- ---------------------------------------------------------------------------
-- Vertices
-- ---------------------------------------------------------------------------
-- Previously routing.segment_edge_vertices_pgr, created as a side effect of
-- pgr_createTopology. Now owned outright, for two reasons.
--
-- pgr_createTopology, pgr_createVerticesTable, pgr_nodeNetwork,
-- pgr_analyzeGraph and pgr_analyzeOneWay were all deprecated in pgRouting
-- 3.8.0; the stated reason is that they create tables under predefined names
-- and require elevated permissions.
--
-- More importantly, pgr_extractVertices is NOT a drop-in replacement:
-- pgr_createTopology snapped endpoints within a tolerance, and
-- pgr_extractVertices has no tolerance parameter at all. Swapping one for the
-- other would silently make every near-coincident endpoint a separate node.
-- 0012 therefore clusters endpoints explicitly with ST_ClusterDBSCAN. That
-- also satisfies FR-08e shall-7: endpoints receive a shared node id WITHOUT
-- any coordinate being moved, which a snapping implementation cannot promise.

CREATE TABLE routing.segment_vertex (
  id       bigint      PRIMARY KEY,
  geom     geometry(Point, 26917) NOT NULL,
  degree   integer     NOT NULL DEFAULT 0,
  built_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT segment_vertex_degree_non_negative CHECK (degree >= 0)
);

CREATE INDEX segment_vertex_geom_idx   ON routing.segment_vertex USING GIST (geom);
CREATE INDEX segment_vertex_degree_idx ON routing.segment_vertex (degree);

COMMENT ON COLUMN routing.segment_vertex.id IS
  'Plain bigint, deliberately NOT an identity column. The rebuild in 0012 derives vertices by clustering edge endpoints and must assign these ids itself, because it needs them to populate segment_edge.source and segment_edge.target in the same pass. An identity column would force OVERRIDING SYSTEM VALUE on every insert to no benefit. Ids are not stable across rebuilds and nothing outside routing should store one.';

COMMENT ON COLUMN routing.segment_vertex.geom IS
  'A representative point for the cluster of endpoints sharing this node, not a position any edge was moved to. Edge geometry is never altered (FR-08e shall-7), so two endpoints 0.4 m apart share a node while remaining 0.4 m apart on the map. Invisible at any realistic zoom and harmless.';

COMMENT ON COLUMN routing.segment_vertex.degree IS
  'Number of edges attached. Populated by 0012, not maintained incrementally. degree = 0 is an isolated node and never legitimate. degree = 1 is a dangling end, which IS legitimate: the greenway has real termini. See FR-08c shall-5, which flags dead-end growth only beyond what the edge change accounts for.';

-- ---------------------------------------------------------------------------
-- Rebuild record
-- ---------------------------------------------------------------------------

CREATE TABLE routing.topology_check (
  id                      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at              timestamptz NOT NULL DEFAULT now(),
  etl_run_id              bigint,     -- FK added in 0012; see comment below
  outcome                 text        NOT NULL,
  abort_reason            text,

  -- Structural measures (FR-08c shall-1)
  edge_count              integer     NOT NULL,
  node_count              integer     NOT NULL,
  component_count         integer     NOT NULL,
  dead_end_count          integer     NOT NULL,
  isolated_count          integer     NOT NULL,
  largest_component_share numeric(5,4),

  -- Reconciliation inputs (FR-08c shall-6)
  source_segment_count    integer     NOT NULL,
  split_count             integer     NOT NULL DEFAULT 0,

  -- Tolerances in force at this rebuild (FR-08e shall-13)
  tol_contact_m           numeric(6,3) NOT NULL,
  tol_join_m              numeric(6,3) NOT NULL,
  tol_review_max_m        numeric(6,3) NOT NULL,
  tol_detect_radius_m     numeric(6,3) NOT NULL,

  CONSTRAINT topology_check_outcome_valid
    CHECK (outcome IN ('published','aborted')),

  CONSTRAINT topology_check_abort_reason_paired
    CHECK ((outcome = 'aborted') = (abort_reason IS NOT NULL))
);

CREATE INDEX topology_check_checked_at_idx ON routing.topology_check (checked_at DESC);
CREATE INDEX topology_check_etl_run_idx    ON routing.topology_check (etl_run_id);

COMMENT ON TABLE routing.topology_check IS
  'One row per rebuild. Turns a one-time visual inspection in QGIS into recorded, comparable numbers. Health is judged by comparing a rebuild against the one before it, NOT against fixed expected counts: the greenway is expected to grow, and any permanent count would fail the first time it legitimately changed (D2, 2026-07-29, superseding the pass/fail rule formerly recorded here as 4-OQ1). A QGIS visual check does not validate topology and never did.';

COMMENT ON COLUMN routing.topology_check.etl_run_id IS
  'Which segment load this topology was built from. Satisfies FR-08c shall-12 without a duplicate snapshot table: staging.route_segment_raw already retains the raw source records per run, so FR-08d''s Phase 2 rollback replays from staging rather than from a copy. Nullable for a rebuild triggered by hand rather than by a load. The foreign key to staging.etl_run is added in 0012, not here: staging.etl_run is created in 0009, which runs AFTER this migration, so an inline reference would fail on a fresh dbmate up.';

COMMENT ON COLUMN routing.topology_check.component_count IS
  'The most consequential measure here, and the one previously missing. Two disconnected pieces mean the router correctly finds no route between them, which FR-08a shall-13 must then report honestly. Baseline measured 2026-08-01: 2 components, the main one 41.7 km and a separate 7.6 km section in southwest Detroit. That split is unbuilt trail, scheduled as Framework Plan phases 2 and 4, not a data defect.';

COMMENT ON COLUMN routing.topology_check.largest_component_share IS
  'Network LENGTH in the largest component as a fraction of total length. Catches a case the raw component count hides: the main network shrinking while the count stays the same. Measured by length rather than by edge or node count because noding changes those counts without changing the network''s physical extent -- split one segment and the edge count rises while not a metre of trail is added or lost. Length is invariant to splitting, which is what makes the figure comparable across rebuilds. Corrected 2026-08-03: this comment previously said edges, 0012 computed nodes, and the baseline was measured by length; on the published dataset those give 0.8679, 0.8519 and 0.8452. Length is now authoritative in both places. Baseline 2026-08-01: 0.8450.';

COMMENT ON COLUMN routing.topology_check.isolated_count IS
  'Components holding exactly one edge and connecting to nothing else -- orphan segments. Corrected 2026-08-03: 0012 previously counted vertices of degree zero, which cannot occur, because the vertex table is built by grouping endpoint rows and taking count(*) as degree, so every vertex has at least one edge by construction. The count was permanently zero and the abort that depended on it unreachable. An orphan component is the condition that was meant, and it is reachable. Recorded and raised as a class 3 judgment flag, never an abort: per D3 the computer cannot distinguish a stray digitising error from a deliberately separate planned section, and aborting would block a legitimate future segment from loading.';

COMMENT ON COLUMN routing.topology_check.split_count IS
  'Edges created by noding beyond the source segment count, counted directly as the number of edges with split_ordinal > 1. edge_count should equal source_segment_count + split_count; any residual is unexplained and flagged (FR-08c shall-6). Corrected 2026-08-03: 0012 previously derived this value as edge_count - source_segment_count, which made the reconciliation check read edge_count <> edge_count. Always false, so the flag could never fire and its test could never fail. Counting the split edges independently is what gives the reconciliation something to disagree with. This is the reconciliation that makes a delta comparison meaningful: the question is never "did a number rise" but "did it rise by more than the input change accounts for".';

COMMENT ON COLUMN routing.topology_check.tol_join_m IS
  'Recorded per rebuild so flags stay interpretable after the value changes (FR-08e shall-13). Without it, altering the tolerance would make every historical flag unreadable, because nobody could tell whether it would still be a flag today. 0.5 m as of D5, 2026-07-29; the previous 0.001 m was superseded.';

COMMENT ON CONSTRAINT topology_check_outcome_valid ON routing.topology_check IS
  'Replaces a boolean "passed" column. A delta comparison has no single pass or fail: an integrity failure aborts the rebuild, while a judgment case publishes and leaves a flag (D3, 2026-07-29). Two outcomes, and the flags carry the detail.';

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------

CREATE TABLE routing.topology_flag (
  id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topology_check_id  bigint       NOT NULL
                                  REFERENCES routing.topology_check(id) ON DELETE CASCADE,
  flag_class         smallint     NOT NULL,
  flag_type          text         NOT NULL,
  measure_name       text,
  previous_value     numeric,
  current_value      numeric,
  gap_m              numeric(9,2),
  angle_deg          numeric(5,1),
  position_reference text,
  detail             text,

  CONSTRAINT topology_flag_class_valid CHECK (flag_class IN (1,2,3)),

  CONSTRAINT topology_flag_type_valid CHECK (flag_type IN (
    -- Class 1, integrity. The rebuild aborts.
    'edges_lost', 'empty_network', 'isolated_node', 'self_loop',
    'cost_invalid', 'segment_shorter_than_tolerance',
    -- Class 2, reconciliation residual.
    'reconciliation_residual',
    -- Class 3, judgment. Publishes with the flag attached.
    'component_increase', 'dead_end_excess',
    'largest_component_shrank',
    -- FR-08e endpoint gap bands.
    'gis_review', 'likely_separation',
    -- FR-08e noding.
    'segment_split'
  )),

  CONSTRAINT topology_flag_measure_paired
    CHECK ((previous_value IS NULL AND current_value IS NULL)
           OR measure_name IS NOT NULL)
);

CREATE INDEX topology_flag_check_idx ON routing.topology_flag (topology_check_id);
CREATE INDEX topology_flag_type_idx  ON routing.topology_flag (flag_type);

COMMENT ON TABLE routing.topology_flag IS
  'Flags live in a table rather than a log file because FR-08d must list UNRESOLVED flags, and unresolved is a state. A log file is append-only text: you cannot mark a line resolved or query for the ones that are not. Phase 1 requires no human decision on a flag (FR-08c shall-11); the review columns arrive with FR-08d in Phase 2 and are deliberately absent here.';

COMMENT ON COLUMN routing.topology_flag.flag_class IS
  '1 integrity, 2 reconciliation, 3 judgment. The class decides what happens, not the severity of the number: class 1 aborts the rebuild because no human judgment is needed to know an empty network is wrong, while classes 2 and 3 publish because judging them needs a person and Phase 1 has no review workflow (D3, 2026-07-29).';

COMMENT ON COLUMN routing.topology_flag.angle_deg IS
  'Angle between the two endpoints'' directions of travel, 0 to 180. Two ends pointing at each other are probably one trail with a drawing gap; two meeting at a right angle are probably unrelated. The strongest available discriminator, and it needs no stored attribute because it is computed from geometry. Recorded on the flag for a human to read, never acted on automatically (D7a, 2026-08-01).';

COMMENT ON COLUMN routing.topology_flag.position_reference IS
  'Where this is, in words a person can act on: a distance range along the greenway anchored to the nearest named access point. Descriptive text, computed when the flag is raised, and NEVER a key or a stored segment attribute (FR-08c shall-9). Cross streets were considered and rejected: they need street centerline geometry the project does not hold. NEIGHBORHOOD is empty for every row in the published dataset, so it is not an alternative.';

CREATE TABLE routing.topology_flag_segment (
  topology_flag_id bigint NOT NULL
                          REFERENCES routing.topology_flag(id) ON DELETE CASCADE,
  route_segment_id bigint NOT NULL REFERENCES core.route_segment(id),
  segment_name     text,
  PRIMARY KEY (topology_flag_id, route_segment_id)
);

CREATE INDEX topology_flag_segment_segment_idx
  ON routing.topology_flag_segment (route_segment_id);

COMMENT ON TABLE routing.topology_flag_segment IS
  'A flag can involve several segments, so this cannot be a column on topology_flag.';

COMMENT ON COLUMN routing.topology_flag_segment.route_segment_id IS
  'References core.route_segment, NOT routing.segment_edge. After noding an edge may be the second piece of a split segment, and "edge 47" means nothing to a reviewer. Flags must name what a person recognises.';

COMMENT ON COLUMN routing.topology_flag_segment.segment_name IS
  'Copied at flag time rather than joined at read time, so a flag still reads correctly if the segment is later renamed or removed from the source. ROUTE_SEGMENT_NAME is populated in the published dataset; where it is absent, position_reference on the flag carries the location instead.';

-- migrate:down
DROP TABLE IF EXISTS routing.topology_flag_segment;
DROP TABLE IF EXISTS routing.topology_flag;
DROP TABLE IF EXISTS routing.topology_check;
DROP TABLE IF EXISTS routing.segment_vertex;
DROP TABLE IF EXISTS routing.segment_edge;
