# L2.1 pgRouting topology spike

## Question

Can the real City of Detroit Route Segments network be loaded, noded, and
turned into a routable graph without silently losing the connections that
matter to routing?

## Evidence

- Input: the committed City Route Segments export, regenerated into the fixed
  seed by `npm run seed:build`.
- Network: 51 `LineString` source segments in EPSG:4326, with projected copies
  in EPSG:26917 for metre-based tolerance and length calculations.
- Noding: `routing.rebuild_topology` finds contacts within 0.5 m, splits a
  segment where another meets its interior, and joins endpoints within 0.5 m
  without moving source coordinates.
- Graph measurement uses pgRouting `pgr_connectedComponents` on the candidate
  edges. The rebuild records edge count, node count, components, dead ends,
  isolated single-edge components, split count, largest-component length share,
  and all tolerances in `routing.topology_check`.
- The 2026-08-01 analysis found two components: approximately 41.7 km and
  7.6 km; four dead ends; junctions; and four mid-line meeting points.
- The reproducible run on 2026-08-21 against the pinned container and current
  full seed published **55 edges, 54 nodes, 1 connected component, 2 dead ends,
  0 isolated components, 4 splits, and a 1.0000 largest-component share**.
  Four `segment_split` review flags were emitted. The older two-component,
  four-dead-end figures are retained above as the pre-noding baseline; they are
  not the result of the current noded graph.
- The four mid-line contacts were verified on 2026-08-03 as physical
  connections: Littlefield/Conrail, West Grand Boulevard/West Lafayette,
  Southwest Greenway/West Jefferson, and Springwells/Woodmere.

Run the reproducible spike against the pinned database with migrations applied:

```bash
npm run topology:spike
```

The command prints the measured topology row and review flags as JSON. A
containerised run is the authoritative current measurement; the figures above
are the recorded baseline from the analysis that motivated this spike.

## Answer

Yes. pgRouting is suitable for Phase 1, but only after a topology-build step
that explicitly handles interior contacts and endpoint tolerance. The network
must be treated as a graph, not as one arithmetic loop. The raw analysis showed
disconnected pieces; the current noding and tolerance rules publish one
connected component for the committed full seed, with the four interior
contacts surfaced for review rather than hidden.

## Decision

Keep pgRouting for on-trail routing. Build topology from the full committed
network during ETL, publish only after class-1 integrity checks pass, and keep
class-2/class-3 findings as review flags. A route must be computed across the
full graph first; segment status is inspected afterward so closed segments are
reported rather than silently removed from connectivity.

## Discarded

- Loop arithmetic and linear referencing as the routing engine: it cannot
  represent the observed second component, spurs, junctions, or interrupted
  paths.
- Blind endpoint snapping: it moves source geometry and can create false
  connections. The implementation shares node identity within tolerance while
  preserving coordinates.
- Exact endpoint matching only: it misses legitimate near contacts and
  interior meetings.
- Deprecated pgRouting topology helpers such as `pgr_createTopology` and
  `pgr_nodeNetwork`: the pinned 3.6.1 spike uses current graph functions and
  project-owned noding logic instead.