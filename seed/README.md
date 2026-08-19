# Seed data

Two files, both generated. **Do not hand-edit either one.** Run:

```bash
npm run seed:build
```

| File | Role |
| :--- | :--- |
| `segments.seed.geojson` | Database seed input. Loaded by the seed step for Stage C3. |
| `segments.response.fixture.geojson` | Expected `GET /api/v1/segments` response once that seed is loaded. |

Generator: `scripts/seed/build-segments-seed.mjs`.

## Source

`docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson` — the committed
export. **51 `LineString` features, `OBJECTID` 1–51 with no gaps**, two-dimensional
coordinates, 638 vertices.

The committed file is the source of truth, not the live service. Migration M016
records this dataset as *"FILE-BASED. Phase 1 loads from a committed GeoJSON
export, not from the service: an ETL that fetches during a run cannot be
replayed"* and states **51 segments**. Provenance URLs live in
`staging.data_source` (M016), not here.

The export carries a legacy `crs` member naming `EPSG:4326`. That member is not
part of RFC 7946 — it is a holdover from the 2008 GeoJSON specification — but it
names the CRS RFC 7946 mandates anyway, so no reprojection is needed. The
generator asserts it and fails if it ever says anything else.

## Scope: the full network, not a sample

**The seed is all 51 segments.** Plan task C3 says *"roughly 20 route segments …
not the full dataset — the skeleton must start fast and work offline."* Measured,
that rationale does not hold and the sample costs more than it saves:

| | 20-segment sample | all 51 |
| :--- | :--- | :--- |
| Minified size | 11,220 bytes | 29,155 bytes |
| Connected components (exact endpoint match) | **10** | **3** |
| Centreline length | 23.3 km | 49.3 km |
| Vertices | 238 | 638 |

- **Size is not a constraint.** 29 KB loads instantly and works offline just as
  well as 11 KB.
- **A sample destroys the network.** Ten disconnected components against three.
  Lane 2's pgRouting spike depends on C3 and would be measuring an artefact of
  the sampling rather than the greenway.
- **A sample makes the Stage D visual check ambiguous.** Stage D's DoD is *"the
  greenway is visible."* With 20 of 51 segments a reader cannot distinguish a
  rendering bug from absent seed data.
- **M016 already treats this dataset as the full Phase 1 load path.** A separate
  20-segment path would be a second source of truth.

This requires amending C3's wording. **Tracked as roadmap item B-O1.**

All 15 distinct `PHASE_DESCRIPTION` × `TYPOLOGY` combinations are present, so the
seed exercises every status and type value the endpoint can return. The generator
asserts the count and fails if a new combination appears — which would mean the
vocabulary in M011 is incomplete.

## Field mapping

Source values are translated to the vocabulary **codes** seeded by M011. The maps
in the generator match `scripts/etl/cityRouteSegments.js`.

### `segments.seed.geojson` — database columns

| Source field | Seed property | Notes |
| :--- | :--- | :--- |
| — | `source` | Constant `city_route_segments` — `staging.data_source.code` (M016) |
| `OBJECTID` | `source_ref` | Stringified. The natural key for the `(source, source_ref)` upsert |
| `ROUTE_SEGMENT_NAME` | `name` | |
| `PHASE_DESCRIPTION` | `status_code` | `open`, `under_construction`, `funded`, `unfunded` |
| `TYPOLOGY` | `type_code` | `off_street_trail`, `on_street_greenway`, `bridge`, `adjacent`, `alley`, `shared_street` |
| — | `status_source` | Constant `ingested` — `core.status_source.code` (M011) |
| — | `source_snapshot_date` | **`null` deliberately.** The query date is not recorded anywhere verifiable in this repository. The seed step must set it. Do not guess it. |

Deliberately **absent**, and why:

- **`segment_id`** — `core.route_segment.id` is `GENERATED ALWAYS AS IDENTITY`,
  assigned on insert. A seed file cannot know it. This is the field the previous
  version of this file wrongly carried.
- **`geom_proj`** — derived by the `core.set_geom_proj` trigger (M05) as
  `ST_Transform(geom, 26917)`. Supplying it would be ignored.
- **`greenway_id`** — resolved by the seed step from `core.greenway` (M011).

Dropped from the source, not part of any contract: `OBJECT_ID`, `NEIGHBORHOOD`,
`PLANNED_DISTRICT`, `PHASE`.

⚠️ `OBJECTID` and `OBJECT_ID` are **two different fields**. `OBJECTID` runs 1–51;
`OBJECT_ID` is a separate string identifier running as high as `"233"`. Only
`OBJECTID` is used. Confusing them is how the previous seed acquired a feature
labelled `"52"`.

### `segments.response.fixture.geojson` — API contract

Matches `SegmentFeatureCollection` in `openapi.yaml`: `segment_id`, `phase`,
`phase_label`, `type`, `type_label`. Validated against the spec schema.
Minified, it is **26,030 bytes** — the figure to check the D2 response-size
budget against.

⚠️ `segment_id` in the fixture is the **`source_ref`**, not a real
`core.route_segment.id`. The two coincide only if the loader happens to assign
identities in source order. **Use this fixture for shape and attribute
assertions, never for identity assertions.**

## Why this file was regenerated

The previous `segments.seed.geojson` could not be reproduced from anything in
this repository:

- 19 of its 20 features matched the committed export exactly.
- The twentieth, labelled `segment_id: "52"`, was **the final two vertices of
  `OBJECTID` 23**, extracted as a standalone 2-point `LineString`. Its `phase`
  and `type` match `OBJECTID` 23. Its identifier matches no `OBJECTID` in the
  layer — `52` is a valid `OBJECT_ID`, but it belongs to `OBJECTID` 21, whose
  attributes are different. So it was a truncated fragment of a real segment
  carrying an identifier from nowhere.
- Its `phase` and `type` carried raw source strings (`"Open"`, `"Off-Street"`),
  matching neither the codes nor the labels in M011. All 40 property values
  failed the contract once the enums landed.
- This README previously claimed **52 features** and **no `crs` member**. Both
  were wrong. There is no 52nd segment in the layer.

A "fixed seed extract" that cannot be rebuilt is not fixed — it is a snapshot of
a lost state. The generator replaces trust with reproducibility: run it, and
`git diff --exit-code -- seed/` proves the committed files are what the source
produces.
