# Fixtures

One file, generated. **Do not hand-edit it.** Run:

```bash
npm run fixture:build
```

| File | Role |
| :--- | :--- |
| `segments.response.fixture.geojson` | Expected `GET /api/v1/segments` response for the committed export. |

Generator: `scripts/seed/build-segments-fixture.mjs`.

## There is no separate database seed file

`segments.seed.geojson` has been **deleted**. Two reasons.

**Nothing consumed it.** `scripts/etl/cityRouteSegments.js` loads the committed
export straight through `staging.route_segment_raw` into `core.route_segment` and
then rebuilds the routing topology. **The ETL importer *is* Stage C3's seed
step.** A second load path added no capability.

**It was keyed wrongly, and the failure was silent.** It set `source_ref` from
`OBJECTID`. `scripts/data-validation/field_mapping.csv` row **MAP-013**
specifies `OBJECT_ID` → `core.route_segment.source_ref`, described as *"Stable
source key"*, and the importer implements that.

These are different fields:

| Field | Shape | What it is |
| :--- | :--- | :--- |
| `OBJECTID` | dense `1`–`51` | ArcGIS internal row id. Can change when the layer is republished. |
| `OBJECT_ID` | sparse, `2`…`233` | City planning identifier. The stable key. |

**Twenty values exist in both key spaces, and all twenty refer to different
segments.** An upsert on `(source, source_ref)` fed from the wrong key would have
overwritten twenty rows with another segment's geometry and name, and inserted
the remaining thirty-one as duplicates — with no error, no warning, and no change
in row count. Verified against a live PostGIS database.

To load the database:

```bash
npm run db:up          # docker compose, PostGIS 3.4 + pgRouting 3.6.1 pinned
npm run migrate        # dbmate, all 16 migrations
npm run etl:segments   # loads all 51 segments, rebuilds topology
```

## Source

`docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson` — **51
`LineString` features**, two-dimensional coordinates, 638 vertices.

The committed file is the source of truth, not the live service. M016 records
this dataset as *"FILE-BASED. Phase 1 loads from a committed GeoJSON export, not
from the service: an ETL that fetches during a run cannot be replayed"* and
states **51 segments**. Provenance URLs live in `staging.data_source`.

The export carries a legacy `crs` member naming `EPSG:4326`. That member is not
part of RFC 7946 — it is a holdover from the 2008 GeoJSON specification — but it
names the CRS RFC 7946 mandates anyway, so no reprojection is needed. Both the
generator and the importer assert it.

## `segment_id` in this fixture is the `source_ref`, not a database id

⚠️ **The most important caveat in this file.**

The contract types `segment_id` as `core.route_segment.id`, which is
`GENERATED ALWAYS AS IDENTITY` and unknowable outside the database. An earlier
version of this fixture used `OBJECTID` as a stand-in. Measured against a real
load, that matched the assigned identity for only **32 of 51** features — the
importer's `src` CTE has no `ORDER BY`, so insert order is a property of the
query plan, not of the file.

So this fixture carries **`source_ref` (`OBJECT_ID`)** as `segment_id`. That
value is stable, traceable to the source, and joins
`core.route_segment.source_ref`.

**Use it for shape and attribute assertions, and join on `source_ref`. Never
assert that `segment_id` equals a database identity value — it does not.**

Verified against a live database after a real ETL run:

| Check | Result |
| :--- | :--- |
| `segment_id` joins `core.route_segment.source_ref` | 51 / 51 |
| `phase` and `type` match the database | 51 / 51 |
| Geometry matches the database | 51 / 51 |
| Validates against `SegmentFeatureCollection` in `openapi.yaml` | ✅ |

Minified it is **26,043 bytes** — the figure to set the D2 response-size budget
against.

## Vocabulary

Source values are translated to the vocabulary **codes** seeded by M011. The maps
in the generator match `scripts/etl/cityRouteSegments.js`.

> `scripts/data-validation/code_translations.csv` is **stale and wrong** — it maps
> to `off_street` / `on_street`, which exist in no vocabulary, and names a table
> `core.route_phase` that no migration creates. Do not use it as a reference.
> Tracked as roadmap item B-O5.

| Source | Fixture field | Values |
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
