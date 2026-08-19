# Seed data

`segments.seed.geojson` — 20 route segments for Stage C3 of the walking
skeleton (`docs/walking_skeleton_plan.md`). Loaded by the DB seed step so
the skeleton has data without requiring the full dataset.

**Source:** City of Detroit ArcGIS FeatureServer — `Joe_Louis_Greenway_Routes/FeatureServer/0`
(ADR-001 §4.8), queried 2026-08-17:
```
https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Joe_Louis_Greenway_Routes/FeatureServer/0/query?outFields=*&where=1%3D1&f=geojson
```
The full layer returns 52 `LineString` features in WGS 84 (no `crs` member,
so RFC 7946 §4 default applies — no reprojection needed).

**Field mapping** to the `GET /api/v1/segments` contract in `openapi.yaml`:

| Source field | Contract field | Notes |
| :--- | :--- | :--- |
| `OBJECTID` | `segment_id` | stringified; stable within this frozen snapshot |
| `PHASE_DESCRIPTION` | `phase` | segment status (FR-05) — `Open`, `Under Construction`, `Funded`, `Unfunded` |
| `TYPOLOGY` | `type` | segment type (FR-06) — e.g. `Off-Street`, `On-Street`, `Bridge` |

All other source fields (`OBJECT_ID`, `ROUTE_SEGMENT_NAME`, `NEIGHBORHOOD`,
`PLANNED_DISTRICT`, `Shape__Length`) were dropped — not part of the
contract.

**Selection.** 20 of 52 features, chosen to cover every `phase` × `type`
combination present in the source (15 combinations), plus 5 extra drawn
from the largest groups. Not a random or first-N sample — it's picked so
the seed alone exercises every status/type value the endpoint can return.
