-- 0012  Rebuild procedure for the routing topology
--
-- Structure is 0008. This is the procedure, kept separate so it can be revised
-- without editing an applied migration.
--
-- Called by the ETL as its FINAL step, after the core load has committed.
-- Not called by dbmate, not scheduled.
--
-- WHY THE WORK HAPPENS IN TEMP TABLES
-- The old procedure was: TRUNCATE routing.segment_edge, reload, build topology.
-- FR-08c shall-4 requires an integrity failure to abort the rebuild and leave
-- the PREVIOUS topology in place, and a truncate makes that impossible: the
-- previous state is destroyed before any check can run. Every candidate edge
-- and vertex is therefore assembled in temp tables, and the live tables are
-- touched only after all checks pass. "Abort" means "do not apply", which needs
-- no rollback and no exception handling.
--
-- CONTRACT WITH THE CALLER
-- This function does NOT raise on an integrity failure. Raising would roll back
-- the topology_check row and its flags, losing the record of the abort, which is
-- the opposite of what FR-08c shall-4 asks for. The caller MUST inspect the
-- result: any returned row with severity = 'ABORT', or equivalently
-- topology_check.outcome = 'aborted', means the topology was NOT updated, and
-- the ETL must set staging.etl_run.status = 'failed' and exit non-zero. An ETL
-- that reports success because its own step worked, while the topology silently
-- did not update, is worse than either failure alone.

-- migrate:up

-- Deferred from 0008: staging.etl_run is created in 0009, which runs after 0008,
-- so this reference could not be declared inline there.
ALTER TABLE routing.topology_check
  ADD CONSTRAINT topology_check_etl_run_fkey
  FOREIGN KEY (etl_run_id) REFERENCES staging.etl_run(id);


-- ---------------------------------------------------------------------------
-- Position reference used by the flags (FR-08c shall-9)
-- ---------------------------------------------------------------------------
CREATE FUNCTION routing.describe_position(p_pt geometry)
RETURNS text
LANGUAGE sql STABLE
AS $fn$
  SELECT round(ST_Distance(p_pt, ap.geom_proj)::numeric, 0) || ' m from ' || ap.name
  FROM (SELECT name, geom_proj
        FROM core.access_point
        ORDER BY geom_proj <-> p_pt
        LIMIT 1) ap;
$fn$;

COMMENT ON FUNCTION routing.describe_position(geometry) IS
  'Turns a location into words a person can act on. Cross streets were considered and rejected: they need street centerline geometry the project does not hold. NEIGHBORHOOD is empty for every row in the published dataset, so it is not an alternative either. Distance from the nearest named access point uses only data the project owns and works for every location. Returns descriptive text for display on a flag, never a key. Returns NULL when no access point has been loaded yet, which is acceptable: a flag with no position is still a flag.';


-- ---------------------------------------------------------------------------
-- The rebuild
-- ---------------------------------------------------------------------------
CREATE FUNCTION routing.rebuild_topology(p_etl_run_id bigint DEFAULT NULL)
RETURNS TABLE (severity text, flag_type text, message text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- Tolerances. Changing one here changes it for the whole rebuild AND is
  -- recorded on the topology_check row, so historical flags stay readable.
  c_tol_contact    numeric := 0.5;   -- FR-08e shall-2: noding contact distance
  c_tol_join       numeric := 0.5;   -- FR-08e shall-4: endpoints treated as one node
  c_tol_review_max numeric := 2.0;   -- FR-08e shall-9: upper edge of the review band
  c_tol_detect     numeric := 10.0;  -- FR-08e shall-11: detection radius

  v_check_id        bigint;
  v_prev            routing.topology_check;

  v_edge_count      integer;
  v_node_count      integer;
  v_component_count integer;
  v_dead_end_count  integer;
  v_isolated_count  integer;
  v_largest_share   numeric(5,4);
  v_source_count    integer;
  v_split_count     integer;
  v_shortest        numeric;
  v_abort           text := NULL;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Split segments where they meet partway along  (FR-08e shall-1..3)
  ---------------------------------------------------------------------------
  -- Endpoint joining cannot fix a segment that ends beside another segment's
  -- INTERIOR: there is no endpoint there to join to. Analysis of the published
  -- dataset on 2026-08-01 found four such places, one a near miss of 0.230 m.
  -- Without this step those four connections are absent from the network and
  -- invisible on the map.
  --
  -- The contact point is the true intersection where segments cross, and the
  -- closest point on this segment where they merely come near. Exact
  -- intersection testing alone misses the near misses, which is how an earlier
  -- pass undercounted these by half.

  CREATE TEMP TABLE _contact ON COMMIT DROP AS
  SELECT a.id AS segment_id,
         b.id AS other_id,
         (ST_Dump(
            CASE WHEN ST_Intersects(a.geom_proj, b.geom_proj)
                 THEN ST_Intersection(a.geom_proj, b.geom_proj)
                 ELSE ST_ClosestPoint(a.geom_proj, b.geom_proj)
            END)).geom AS pt
  FROM core.route_segment a
  JOIN core.route_segment b
    ON b.id <> a.id
   AND ST_DWithin(a.geom_proj, b.geom_proj, c_tol_contact);

  -- Keep only contacts in this segment's interior. A contact at its own end is
  -- an ordinary end-to-end junction, handled by step 2 rather than by splitting.
  CREATE TEMP TABLE _split_point ON COMMIT DROP AS
  SELECT DISTINCT c.segment_id, c.other_id, c.pt
  FROM _contact c
  JOIN core.route_segment s ON s.id = c.segment_id
  WHERE ST_GeometryType(c.pt) = 'ST_Point'
    AND ST_Distance(c.pt, ST_StartPoint(s.geom_proj)) > c_tol_join
    AND ST_Distance(c.pt, ST_EndPoint(s.geom_proj))   > c_tol_join;

  -- Split by MEASURE along the line rather than with a geometric blade.
  -- ST_Split needs the blade to intersect exactly and fails on sub-millimetre
  -- misses; the usual workaround is ST_Snap, which MOVES coordinates. Locating
  -- each cut as a fraction along the line and taking substrings between
  -- consecutive fractions avoids both problems and moves nothing.
  CREATE TEMP TABLE _cut ON COMMIT DROP AS
  SELECT s.id AS segment_id, f.frac
  FROM core.route_segment s
  CROSS JOIN LATERAL (
      SELECT 0::numeric AS frac
      UNION SELECT 1::numeric
      UNION SELECT round(ST_LineLocatePoint(s.geom_proj, sp.pt)::numeric, 9)
            FROM _split_point sp WHERE sp.segment_id = s.id
  ) f;

  CREATE TEMP TABLE _edge ON COMMIT DROP AS
  SELECT row_number() OVER ()                                AS edge_key,
         w.segment_id                                        AS source_segment_id,
         (row_number() OVER (PARTITION BY w.segment_id
                             ORDER BY w.frac_from))::smallint AS split_ordinal,
         ST_LineSubstring(s.geom_proj, w.frac_from, w.frac_to) AS geom,
         NULL::bigint                                        AS source,
         NULL::bigint                                        AS target
  FROM (
      SELECT segment_id,
             frac AS frac_from,
             lead(frac) OVER (PARTITION BY segment_id ORDER BY frac) AS frac_to
      FROM (SELECT DISTINCT segment_id, frac FROM _cut) d
  ) w
  JOIN core.route_segment s ON s.id = w.segment_id
  WHERE w.frac_to IS NOT NULL
    AND w.frac_to > w.frac_from;

  ---------------------------------------------------------------------------
  -- 2. Join endpoints within tolerance  (FR-08e shall-4..5, shall-7)
  ---------------------------------------------------------------------------
  -- Endpoints within c_tol_join get a SHARED NODE ID. No coordinate is moved,
  -- which is what FR-08e shall-7 requires and what a snapping implementation
  -- cannot promise. Two endpoints 0.4 m apart therefore share a node while
  -- remaining 0.4 m apart on the map: invisible at any realistic zoom, and
  -- honest about the source geometry.
  --
  -- ST_ClusterDBSCAN with minpoints = 1 groups purely by distance. It chains:
  -- if A is 0.4 m from B and B is 0.4 m from C, all three share a node even
  -- though A and C are 0.8 m apart. That is usually right for a junction where
  -- several trails meet. On the published dataset it is moot, since all 48
  -- intended connections sit at exactly 0.000 m.

  CREATE TEMP TABLE _endpoint ON COMMIT DROP AS
  -- direction_pt is the next vertex inward from this end, used for the angle
  -- between two dangling ends. For a start it is the second point; for an end it
  -- is the second-to-last. Using the second point for both would report the
  -- wrong bearing for every 'end'.
  SELECT edge_key, 'start'::text AS which,
         ST_StartPoint(geom) AS pt,
         ST_PointN(geom, 2)  AS direction_pt
  FROM _edge
  UNION ALL
  SELECT edge_key, 'end'::text,
         ST_EndPoint(geom),
         ST_PointN(geom, GREATEST(ST_NPoints(geom) - 1, 1))
  FROM _edge;

  CREATE TEMP TABLE _clustered ON COMMIT DROP AS
  SELECT edge_key, which, pt, direction_pt,
         ST_ClusterDBSCAN(pt, eps => c_tol_join, minpoints => 1) OVER () AS cid
  FROM _endpoint;

  CREATE TEMP TABLE _vertex ON COMMIT DROP AS
  SELECT (cid + 1)::bigint           AS id,
         ST_Centroid(ST_Collect(pt)) AS geom,
         count(*)::integer           AS degree
  FROM _clustered
  GROUP BY cid;

  UPDATE _edge e
     SET source = c.cid + 1
    FROM _clustered c
   WHERE c.edge_key = e.edge_key AND c.which = 'start';

  UPDATE _edge e
     SET target = c.cid + 1
    FROM _clustered c
   WHERE c.edge_key = e.edge_key AND c.which = 'end';

  ---------------------------------------------------------------------------
  -- 3. Measure  (FR-08c shall-1)
  ---------------------------------------------------------------------------
  -- pgr_connectedComponents is an official function and was NOT among those
  -- deprecated in 3.8.0. It takes a query string, so it can read a temp table.
  -- Materialised once; calling it twice for the count and the share would run
  -- the whole graph traversal twice.
  CREATE TEMP TABLE _component ON COMMIT DROP AS
  SELECT component, node
  FROM pgr_connectedComponents(
    'SELECT edge_key AS id, source, target,
            ST_Length(geom) AS cost, ST_Length(geom) AS reverse_cost
     FROM _edge'
  );

  SELECT count(*)                      INTO v_edge_count     FROM _edge;
  SELECT count(*)                      INTO v_node_count     FROM _vertex;
  SELECT count(*)                      INTO v_dead_end_count FROM _vertex WHERE degree = 1;
  -- Orphan segments: components made of exactly one edge, disconnected from
  -- everything else. An earlier version counted vertices with degree = 0, which
  -- cannot happen: _vertex is built by GROUP BY over endpoint rows with
  -- count(*) AS degree, so every vertex has at least one edge by construction.
  -- The count was therefore permanently zero and the abort below unreachable.
  -- A component holding a single edge is the condition that was actually meant,
  -- and it is reachable: a stray segment digitised away from the network
  -- produces exactly this.
  SELECT count(*)::integer INTO v_isolated_count
  FROM (
    SELECT c.component
    FROM _component c
    JOIN _edge e ON e.source = c.node
    GROUP BY c.component
    HAVING count(DISTINCT e.edge_key) = 1
  ) orphan;
  SELECT count(*)                      INTO v_source_count   FROM core.route_segment;
  SELECT min(ST_Length(geom))::numeric  INTO v_shortest      FROM _edge;
  SELECT count(DISTINCT component)      INTO v_component_count FROM _component;

  -- Counted independently, from the edges that noding actually produced. An
  -- earlier version assigned v_split_count := v_edge_count - v_source_count,
  -- which made the class 2 reconciliation check below read
  -- edge_count <> edge_count: always false, so the flag could never fire and
  -- its test could never fail. Counting the extra edges directly is what gives
  -- the reconciliation something to disagree with.
  SELECT count(*)::integer INTO v_split_count FROM _edge WHERE split_ordinal > 1;

  -- Share of network LENGTH in the largest component. Catches the main network
  -- shrinking while the component COUNT stays the same, which the count alone
  -- hides.
  --
  -- Measured by length, not by node or edge count, for one reason: noding
  -- changes node and edge counts without changing the network's physical
  -- extent. Split one segment into two and the edge count rises by one while
  -- not a metre of trail has been added or lost, so a share computed from
  -- counts moves when nothing real has. Length is invariant to splitting,
  -- which is what makes it comparable across rebuilds.
  --
  -- Two earlier definitions disagreed with each other and with the recorded
  -- baseline: the 0008 column comment said edges, this function computed
  -- nodes, and the baseline of 0.8450 was measured by length. On the published
  -- dataset the three give 0.8679, 0.8519 and 0.8452 respectively. Length is
  -- now authoritative in both places.
  SELECT round(
           sum(CASE WHEN c.component = lc.component THEN ST_Length(e.geom) ELSE 0 END)
           / NULLIF(sum(ST_Length(e.geom)), 0), 4)
    INTO v_largest_share
  FROM _edge e
  JOIN _component c ON c.node = e.source
  CROSS JOIN (
    SELECT c2.component
    FROM _component c2
    JOIN _edge e2 ON e2.source = c2.node
    GROUP BY c2.component
    ORDER BY sum(ST_Length(e2.geom)) DESC
    LIMIT 1
  ) lc;

  ---------------------------------------------------------------------------
  -- 4. Class 1 integrity checks  (FR-08c shall-4)
  ---------------------------------------------------------------------------
  -- No human judgment is needed to know these are wrong, so blocking needs
  -- nobody's permission. Anything requiring judgment is class 2 or 3 below and
  -- publishes with a flag, because Phase 1 has no review workflow (D3).

  SELECT * INTO v_prev
  FROM routing.topology_check
  WHERE outcome = 'published'
  ORDER BY checked_at DESC
  LIMIT 1;

  IF v_edge_count = 0 OR v_node_count = 0 THEN
    v_abort := 'empty network: ' || v_edge_count || ' edges, ' || v_node_count || ' nodes';
  ELSIF v_shortest <= 0 THEN
    v_abort := 'an edge has non-positive length and is not routable';
  ELSIF v_shortest <= c_tol_join THEN
    v_abort := 'shortest edge ' || round(v_shortest, 3)
               || ' m is at or below the joining tolerance ' || c_tol_join
               || ' m and would collapse into a loop going nowhere';
  ELSIF EXISTS (SELECT 1 FROM _edge WHERE source = target) THEN
    v_abort := 'an edge starts and ends at the same node';
  ELSIF v_prev.id IS NOT NULL
        AND v_edge_count < v_prev.edge_count
        AND v_source_count >= v_prev.source_segment_count THEN
    v_abort := 'edges fell from ' || v_prev.edge_count || ' to ' || v_edge_count
               || ' while source segments did not fall: rows lost in the pipeline,'
               || ' not in the source';
  END IF;

  -- isolated_count is deliberately NOT in the chain above. An orphan segment is
  -- exactly the case D3 says the computer cannot judge: a stray digitising error
  -- and a deliberately separate planned section produce the same count. Aborting
  -- on it would block a legitimate future segment from loading, which is the
  -- behaviour D3 was written to avoid. It is recorded on the run and raised as a
  -- class 3 judgment flag in step 6 instead.

  ---------------------------------------------------------------------------
  -- 5. Record the run  (FR-08c shall-2, FR-08e shall-13)
  ---------------------------------------------------------------------------
  INSERT INTO routing.topology_check (
      etl_run_id, outcome, abort_reason,
      edge_count, node_count, component_count, dead_end_count, isolated_count,
      largest_component_share, source_segment_count, split_count,
      tol_contact_m, tol_join_m, tol_review_max_m, tol_detect_radius_m)
  VALUES (
      p_etl_run_id,
      CASE WHEN v_abort IS NULL THEN 'published' ELSE 'aborted' END,
      v_abort,
      v_edge_count, v_node_count, v_component_count, v_dead_end_count,
      v_isolated_count, v_largest_share, v_source_count, v_split_count,
      c_tol_contact, c_tol_join, c_tol_review_max, c_tol_detect)
  RETURNING id INTO v_check_id;

  ---------------------------------------------------------------------------
  -- 6. Flags
  ---------------------------------------------------------------------------

  -- Class 1, if any.
  IF v_abort IS NOT NULL THEN
    INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type, detail)
    VALUES (v_check_id, 1,
            CASE
              WHEN v_abort LIKE 'empty network%'    THEN 'empty_network'
              WHEN v_abort LIKE '%orphan%'          THEN 'isolated_node'
              WHEN v_abort LIKE '%non-positive%'    THEN 'cost_invalid'
              WHEN v_abort LIKE 'shortest edge%'    THEN 'segment_shorter_than_tolerance'
              WHEN v_abort LIKE '%same node%'       THEN 'self_loop'
              ELSE 'edges_lost'
            END,
            v_abort);
  END IF;

  -- Class 2, reconciliation. edge_count should equal source_segment_count plus
  -- the splits noding performed; any residual is unexplained. This is what makes
  -- a delta comparison meaningful: the question is never "did a number rise" but
  -- "did it rise by more than the input change accounts for".
  IF v_edge_count <> v_source_count + v_split_count THEN
    INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type,
                                       measure_name, previous_value, current_value, detail)
    VALUES (v_check_id, 2, 'reconciliation_residual', 'edge_count',
            v_source_count + v_split_count, v_edge_count,
            'edge count does not equal source segments plus splits');
  END IF;

  -- Class 3, judgment. Published with the flag attached.
  IF v_prev.id IS NOT NULL THEN

    IF v_component_count > v_prev.component_count THEN
      INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type,
                                         measure_name, previous_value, current_value, detail)
      VALUES (v_check_id, 3, 'component_increase', 'component_count',
              v_prev.component_count, v_component_count,
              'the network broke into more separate pieces than before');
    END IF;
  END IF;

  -- Orphan segments. Raised whether or not a previous run exists, because a
  -- single stray edge is worth a human look on a first load as much as on a
  -- hundredth. Class 3, not class 1: D3 holds that the computer cannot tell a
  -- digitising error from a deliberately separate planned section, and both
  -- produce one isolated edge.
  IF v_isolated_count > 0 THEN
    INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type,
                                       measure_name, previous_value, current_value, detail)
    VALUES (v_check_id, 3, 'isolated_node', 'isolated_count',
            v_prev.isolated_count, v_isolated_count,
            v_isolated_count || ' component(s) hold a single edge and connect to'
            || ' nothing else: either a stray segment or an intentionally'
            || ' separate planned section');
  END IF;

  IF v_prev.id IS NOT NULL THEN

    -- FR-08c shall-5. Adding a segment at the network edge is ALLOWED to add one
    -- dead end for free; only the excess is flagged. A connection that silently
    -- comes apart adds dead ends with no edge change, so this catches it while
    -- staying silent on every legitimate extension.
    IF (v_dead_end_count - v_prev.dead_end_count)
       > GREATEST(0, v_edge_count - v_prev.edge_count) THEN
      INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type,
                                         measure_name, previous_value, current_value, detail)
      VALUES (v_check_id, 3, 'dead_end_excess', 'dead_end_count',
              v_prev.dead_end_count, v_dead_end_count,
              'dead ends grew by more than the change in edges accounts for');
    END IF;

    IF v_prev.largest_component_share IS NOT NULL
       AND v_largest_share < v_prev.largest_component_share THEN
      INSERT INTO routing.topology_flag (topology_check_id, flag_class, flag_type,
                                         measure_name, previous_value, current_value, detail)
      VALUES (v_check_id, 3, 'largest_component_shrank', 'largest_component_share',
              v_prev.largest_component_share, v_largest_share,
              'the main network shrank as a share of the whole');
    END IF;
  END IF;

  -- Noding record (FR-08e shall-3). Every split is flagged for human confirmation
  -- because splitting where two trails do NOT physically meet creates a junction
  -- the router will use, which FR-08a shall-4's hard boundary forbids.
  --
  -- The four contacts present in the published dataset were verified as genuine
  -- physical connections on 2026-08-03 (FR-08e-OQ4): Littlefield x Conrail,
  -- West Grand Boulevard x West Lafayette, Southwest Greenway x West Jefferson,
  -- and Springwells x Woodmere. No grade separation was found and the dataset
  -- contains no X-crossings, so no exception mechanism is needed. Do not re-check
  -- those four. The flag remains because a future dataset can introduce a crossing
  -- that IS a bridge or a tunnel.
  --
  -- Flag ids are drawn from the sequence up
  -- front so each flag can be linked to the two segments it concerns. Inserting
  -- from a plain SELECT and joining afterwards would cross-join every flag
  -- against every split point.
  CREATE TEMP TABLE _split_flag ON COMMIT DROP AS
  SELECT nextval(pg_get_serial_sequence('routing.topology_flag', 'id')) AS flag_id,
         sp.segment_id, sp.other_id, sp.pt
  FROM _split_point sp;

  INSERT INTO routing.topology_flag (id, topology_check_id, flag_class, flag_type,
                                     position_reference, detail)
  OVERRIDING SYSTEM VALUE
  SELECT sf.flag_id, v_check_id, 3, 'segment_split',
         routing.describe_position(sf.pt),
         'segment split where another meets it partway along; confirm the trails'
         || ' physically connect rather than one passing over or under'
  FROM _split_flag sf;

  INSERT INTO routing.topology_flag_segment (topology_flag_id, route_segment_id, segment_name)
  SELECT sf.flag_id, s.id, s.name
  FROM _split_flag sf
  JOIN core.route_segment s ON s.id IN (sf.segment_id, sf.other_id)
  ON CONFLICT DO NOTHING;

  -- Endpoint gap bands (FR-08e shall-8..12, shall-14).
  -- Only DANGLING ends are compared. An end already lying on another segment is
  -- joined, and comparing it anyway reports properly connected segments as
  -- separations: on the published dataset that produced three false flags, all
  -- from one 2.391 m connector joining two longer segments at both ends.
  -- shall-14 falls out of the ST_DWithin: a lone terminus with no neighbour
  -- inside the radius produces no pair and therefore no flag.
  CREATE TEMP TABLE _gap_flag ON COMMIT DROP AS
  SELECT nextval(pg_get_serial_sequence('routing.topology_flag', 'id')) AS flag_id,
         g.edge_a, g.edge_b, g.pt_a, g.gap,
         -- Fold the bearing difference into 0..180. Without it, two ends
         -- pointing at each other can read as 350 degrees rather than 10.
         CASE WHEN g.raw_angle > 180 THEN 360 - g.raw_angle ELSE g.raw_angle END AS angle
  FROM (
      SELECT a.edge_key AS edge_a,
             b.edge_key AS edge_b,
             a.pt       AS pt_a,
             ST_Distance(a.pt, b.pt) AS gap,
             degrees(abs(ST_Azimuth(a.pt, a.direction_pt)
                       - ST_Azimuth(b.pt, b.direction_pt))) AS raw_angle
      FROM (SELECT c.* FROM _clustered c
             JOIN _vertex v ON v.id = c.cid + 1 WHERE v.degree = 1) a
      JOIN (SELECT c.* FROM _clustered c
             JOIN _vertex v ON v.id = c.cid + 1 WHERE v.degree = 1) b
        ON b.edge_key > a.edge_key
      WHERE ST_DWithin(a.pt, b.pt, c_tol_detect)
        AND ST_Distance(a.pt, b.pt) > c_tol_join
  ) g;

  INSERT INTO routing.topology_flag (id, topology_check_id, flag_class, flag_type,
                                     gap_m, angle_deg, position_reference, detail)
  OVERRIDING SYSTEM VALUE
  SELECT gf.flag_id, v_check_id, 3,
         CASE WHEN gf.gap <= c_tol_review_max THEN 'gis_review'
              ELSE 'likely_separation' END,
         round(gf.gap::numeric, 2),
         round(gf.angle::numeric, 1),
         routing.describe_position(gf.pt_a),
         'two unjoined trail ends within ' || c_tol_detect || ' m of each other; '
         || CASE WHEN gf.angle > 150 THEN 'they point at each other, likely one trail'
                 WHEN gf.angle < 30  THEN 'they point the same way, possibly parallel'
                 ELSE 'they meet at an angle, possibly different trails' END
  FROM _gap_flag gf;

  INSERT INTO routing.topology_flag_segment (topology_flag_id, route_segment_id, segment_name)
  SELECT gf.flag_id, s.id, s.name
  FROM _gap_flag gf
  JOIN _edge e ON e.edge_key IN (gf.edge_a, gf.edge_b)
  JOIN core.route_segment s ON s.id = e.source_segment_id
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 7. Apply, or do not
  ---------------------------------------------------------------------------
  -- Nothing above touched a live topology table, so an abort needs no rollback.
  -- DELETE rather than TRUNCATE: at this table size the cost is the same, and
  -- DELETE does not take the ACCESS EXCLUSIVE lock that would block readers
  -- until commit.
  IF v_abort IS NULL THEN
    DELETE FROM routing.segment_edge;
    DELETE FROM routing.segment_vertex;

    INSERT INTO routing.segment_vertex (id, geom, degree)
    SELECT id, geom, degree FROM _vertex;

    INSERT INTO routing.segment_edge
        (source_segment_id, split_ordinal, source, target, cost, reverse_cost, geom)
    SELECT source_segment_id, split_ordinal, source, target,
           ST_Length(geom), ST_Length(geom), geom
    FROM _edge;
  END IF;

  ---------------------------------------------------------------------------
  -- 8. Return everything to the caller  (FR-08c shall-10)
  ---------------------------------------------------------------------------
  -- Flags are surfaced in the rebuild's own output, not only written to a table,
  -- so the operator running the load sees them at the moment of the load. A flag
  -- nobody must act on is easy to ignore; one that prints is harder.
  RETURN QUERY
  SELECT CASE WHEN f.flag_class = 1 THEN 'ABORT' ELSE 'REVIEW' END,
         f.flag_type,
         coalesce(f.detail, '')
           || coalesce(' [' || f.position_reference || ']', '')
           || coalesce(' (' || f.previous_value || ' -> ' || f.current_value || ')', '')
           || coalesce(' gap ' || f.gap_m || ' m', '')
  FROM routing.topology_flag f
  WHERE f.topology_check_id = v_check_id
  ORDER BY f.flag_class, f.flag_type;

  IF v_abort IS NULL AND NOT EXISTS (
       SELECT 1 FROM routing.topology_flag WHERE topology_check_id = v_check_id) THEN
    RETURN QUERY SELECT 'OK'::text, 'none'::text,
      ('published: ' || v_edge_count || ' edges, ' || v_node_count || ' nodes, '
       || v_component_count || ' components, ' || v_dead_end_count || ' dead ends,'
       || ' shortest edge ' || round(v_shortest, 3) || ' m')::text;
  END IF;
END
$fn$;

COMMENT ON FUNCTION routing.rebuild_topology(bigint) IS
  'Rebuilds routing.segment_edge and routing.segment_vertex from core.route_segment. Called by the ETL as its final step, after the core load has committed. Does NOT raise on an integrity failure, because raising would roll back the record of that failure; the caller must inspect the returned severity or topology_check.outcome and report ETL failure accordingly. Implements FR-08c and FR-08e.';

-- migrate:down
DROP FUNCTION IF EXISTS routing.rebuild_topology(bigint);
DROP FUNCTION IF EXISTS routing.describe_position(geometry);
ALTER TABLE routing.topology_check DROP CONSTRAINT IF EXISTS topology_check_etl_run_fkey;
