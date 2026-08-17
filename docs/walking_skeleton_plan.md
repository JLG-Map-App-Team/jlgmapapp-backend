# Walking Skeleton Plan v1

**Repository:** `jlgmapapp-backend`
**Suggested path:** `docs/WALKING_SKELETON_PLAN_v1.md`

| Field | Value |
| :---- | :---- |
| **Status** | Active — Stage A decisions locked, Stages B–F not started |
| **Date drafted** | 2026-08-17 |
| **Owners (backend, database, architecture)** | Maha, Eity, Asmita, Rachael — architecture is jointly owned by all four |
| **Frontend** | Lawrence — **not assigned to any task in this plan** (see §3) |
| **Reviewer / approvals** | Asim |
| **Related documents** | ADR-001 Technology stack for the Phase 1 map and geospatial layer (v2); JLG_Phase1_FRD v6 |
| **Supersedes** | Nothing. First version. |

> ***In plain terms:*** *This document is a work plan, not a decision record. It says what we are building first and in what order. Decisions of record belong in ADR-001 — where a decision is referenced here, the ADR section is cited so the two do not drift apart.*

---

## 1. What a Walking Skeleton is, and why we are building one

A **walking skeleton** is a tiny implementation of the system that performs one small end-to-end function and links together all the main architectural components (Cockburn). It is deliberately thin: no features, no polish, no business logic worth speaking of. Its purpose is to prove the pipes connect and to make the system deployable from the first week rather than the last.

This sits inside the broader practice of **architectural prototyping** — building executables specifically to investigate architectural qualities raised as concerns by stakeholders (Bardram, Christensen & Hansen, WICSA 2004). Architectural prototypes come in three classes: *explorative* and *experimental* (throwaway, used to answer a question) and *evolutionary* (kept, grown into the real system). This skeleton is the **evolutionary** one. Our routing and buffer spikes are the throwaway ones, and they are tracked separately.

The distinction matters in practice: spike code answers a question and is then deleted; skeleton code is kept and built upon. Confusing the two is how throwaway code quietly becomes load-bearing.

> ***In plain terms:*** *We are building the thinnest possible version of the whole app — one line drawn on one map from one database query — so that everything is connected and deployable before we build anything real on top of it.*

---

## 2. Scope statement

> **A user opens the public URL on a phone and sees the Joe Louis Greenway drawn on a map, where the base map came from PMTiles on object storage and the greenway line came from our own PostGIS database through our own API.**

That single sentence touches every component on the public read path in ADR-001 §3: React/Vite/TypeScript → MapLibre GL JS → PMTiles on Cloudflare R2 → Express → PostgreSQL/PostGIS → Nginx → Cloudflare.

### 2.1 Non-goals

These are **out of scope for the skeleton**, explicitly and in writing, because scope creep is the primary failure mode of this exercise:

- No routing. pgRouting is a separate spike (§7).
- No place search (`pg_trgm`).
- No POIs, restrooms, play areas, food venues, event spaces, or events.
- No OPEN NOW status.
- No filtering, no mode-awareness.
- No admin authentication. Firebase Auth is **thread two**, added after the skeleton is tagged (§6, F4).
- No ETL pipeline or scheduler.
- At most one styling rule on the rendered line.

### 2.2 One deliberate exception

An automated accessibility check goes into CI at Stage C, before there is anything meaningful to check. This is not to make the harness accessible — there is almost nothing there. It is because ADR-001 §4.4 commits us to accessibility *"built in from the start and tested continuously… not retrofitted at the end,"* and a gate that starts green and stays green is the cheapest way to keep that commitment honest. Adding it in month three means adding it to a codebase that already fails it.

---

## 3. The harness is not the app

Lawrence is producing a user interface prototype and we are not writing frontend application code until that design is approved. **This plan does not change that.**

What the skeleton needs on the client side is roughly forty lines: a Vite page, a MapLibre canvas, one `fetch`, one layer. No layout, no components, no styling, no interaction — nothing a designer would ever want to make a decision about. It is the client end of an integration test that happens to render.

Therefore:

- The harness lives in **this repository** (`jlgmapapp-backend`), under `harness/`, not in the frontend repository.
- It is written and owned by the backend team.
- The frontend repository stays clean for the approved design.
- The harness carries a header comment reading `THROWAWAY — delete when the approved design lands`, and its deletion is a tracked task (§6, F3).

> ***In plain terms:*** *We need something that draws a line on a screen so we can prove the backend actually works end to end. That is a test tool, not a user interface. It does not pre-empt any design decision, and Lawrence does not touch it.*

---

## 4. Decisions locked at Stage A

### 4.1 Hosting — Cloudflare Pages (A1)

**Decision: Cloudflare Pages, as already recorded in ADR-001 §3. No ADR amendment required.**

The frontend repository currently contains `firebase.json`, `.firebaserc`, and two auto-generated GitHub Actions workflows that deploy to Firebase Hosting on merge and on pull request. These were generated by `firebase init`, not chosen against the ADR, and they contradict ADR-001 §3 (*"Website hosting: Cloudflare Pages"*) and §7 (static-first hybrid).

**Rationale.** Three factors, in order of weight.

First, **failure domain.** ADR-001 §4.7 accepts Cloudflare as a single point of failure on the explicit reasoning that *"the frontend (Pages) and tiles (R2) already commit the project to Cloudflare, so routing the API through it does not add a new point of failure; it makes the existing one explicit."* Hosting the frontend on Firebase would make that sentence false and give the app two independent external services either of which could take it down, requiring a rewrite of §6's failure table.

Second, **conformance.** ADR-001 §3 names Cloudflare Pages. Keeping the repository and the ADR in agreement costs about an hour now; the alternative is a silent contradiction of exactly the kind the 2026-08-01 loop-topology correction was written to prevent.

Third, **cost is not a real differentiator and should not be cited as one.** Cloudflare's documentation states that on both free and paid plans, requests to static assets are free and unlimited. Firebase Hosting offers 10 GB storage and 10 GB/month transfer free, then $0.026/GB stored and $0.15/GB transferred. But **map tiles are served directly from Cloudflare R2 to the browser under either option**, so the only thing the website host carries is the app shell — a few megabytes. At Phase 1 volumes both are effectively free. This is recorded so nobody re-litigates the decision on a cost argument that does not hold.

**Costs accepted.** Roughly one hour of setup, and the loss of a working deployment pipeline that already exists. Cloudflare Pages' Free plan caps builds at 500/month with one concurrent build and a 20-minute timeout, and individual assets at 25 MB — none of which binds us, since tiles live on R2.

**Explicitly unaffected: Firebase Auth stays.** ADR-001 §4.3 and §4.11 scope Firebase Auth to the admin surface (event authoring, trail status authoring, topology flag review, account management). That decision is untouched. Only Firebase *Hosting* is being removed.

> ***In plain terms:*** *We are removing Firebase as the place our website lives, and keeping Firebase as the way admins log in. Those are two different Firebase products and only one of them is going.*

### 4.2 Ownership (A2)

Backend, database and architecture are jointly owned by **Maha, Eity, Asmita and Rachael**. Lawrence owns the frontend and is not assigned here. Asim reviews and approves.

This closes ADR-001 §10 item 5 in part — the backend and architecture role assignments. The author, reviewer and approver fields on ADR-001 itself remain unfilled and are still open.

---

## 5. Stages

Six stages. Each has a Definition of Done that can be pasted into a ticket.

### Stage A — Clear the blockers

| ID | Task |
| :---- | :---- |
| A1.1 | Delete `firebase.json`, `.firebaserc`, `.github/workflows/firebase-hosting-merge.yml` and `.github/workflows/firebase-hosting-pull-request.yml` from the frontend repository. |
| A1.2 | Create the Cloudflare Pages project and connect it to the frontend repository. |
| A1.3 | Confirm in writing that the Firebase project `joe-louis-greenway-ea7ab` is retained for **Auth only**, and that Hosting is disabled on it. |
| A2.1 | Record ownership (§4.2) in the ADR-001 decider field and in both repository READMEs. |
| A3.1 | Commit this document to `docs/` in the backend repository. |
| A3.2 | Move both repositories into a GitHub organisation and enable branch protection on `main`. They currently sit on a personal account with a deploy secret and auto-deploy on merge. |

**Definition of Done:** no Firebase Hosting artefacts remain in the frontend repository; a Cloudflare Pages project exists; ownership is recorded in three places; both repositories are org-owned with `main` protected.

### Stage B — The contract

| ID | Task |
| :---- | :---- |
| B1 | Write `openapi.yaml` for **one endpoint**: `GET /api/v1/segments`. Response is a GeoJSON `FeatureCollection` of `LineString` features with properties `segment_id`, `phase`, `type`. Version the path from the first commit. |
| B2 | Generate TypeScript types from the spec. The backend uses them for response validation; the harness consumes the same generated types. |

The endpoint's shape is derived from ADR-001 §4.8 — the City of Detroit Route Segments layer, whose *phase* attribute is the source for segment status (FR-05) and whose *type* attribute is the source for segment type (FR-06). It is **not** derived from the UI design, so it is safe to write before that design is approved.

**Definition of Done:** the spec is committed and versioned; types generate cleanly; backend and harness both import from the same generated source.

### Stage C — The harness *(shared prerequisite — see §7)*

| ID | Task |
| :---- | :---- |
| C1 | `docker-compose.yml` with PostgreSQL + PostGIS + pgRouting, **versions pinned**. ADR-001 §3 pins pgRouting 3.6.1 and records that 3.8.0 deprecated `pgr_createTopology`, `pgr_createVerticesTable`, `pgr_nodeNetwork`, `pgr_analyzeGraph` and `pgr_analyzeOneWay`. Unpinned versions make spike results incomparable. |
| C2 | Prove migrations run `up` from an empty database and `down` back. |
| C3 | Commit a fixed seed extract of roughly 20 route segments as GeoJSON, loaded by a seed step. Not the full dataset — the skeleton must start fast and work offline. |
| C4 | One real test on each side, running in CI on pull request. |
| C5 | Add the missing CI stages: install → typecheck → lint → test → build → deploy. |
| C6 | Add `axe-core` (or equivalent) as a CI stage, per §2.2. |

**Definition of Done:** a teammate clones the repository, runs one command, and has a working database with data — on a machine that has never seen this project before.

### Stage D — The vertical slice

| ID | Task |
| :---- | :---- |
| D1 | Implement `GET /api/v1/segments`: PostGIS query → GeoJSON via `ST_AsGeoJSON`. One integration test against a real containerised PostgreSQL, not a mock. |
| D2 | **Two contract tests, non-negotiable.** (a) Assert `ST_SRID` = 4326 on every geometry the endpoint emits. (b) Assert response size against a stated byte budget. |
| D3 | Base map: use `pmtiles extract` to pull a Detroit-sized region from the Protomaps daily OpenStreetMap basemap build, and copy it to **our own R2 bucket** — Protomaps discourage hotlinking their downloads. The basemap is ODbL as a Produced Work, so **add the OpenStreetMap attribution control in this step**, not later. |
| D4 | Build `harness/` per §3: Vite page, MapLibre canvas, one `fetch`, one layer, throwaway header comment. |
| D5 | Configure CORS. Put the API base URL in an environment variable, never hardcoded. Render the layer. |

**Definition of Done:** `docker compose up` plus the harness dev server, and the greenway is visible — drawn from our own database over an OpenStreetMap base map.

#### Why D2 is non-negotiable

RFC 7946 §4 mandates that all GeoJSON coordinates use WGS 84, longitude then latitude, in decimal degrees. But ADR-001 §4.9 requires reprojecting the centreline onto a projected grid — EPSG:2253 or EPSG:26917, still unpinned per ADR-001 §10 item 6 — in order to buffer in real distance units. **Our database will therefore legitimately hold geometry in two coordinate systems.** `ST_AsGeoJSON` emits whatever SRID the geometry carries, without complaint.

An endpoint that serves projected coordinates returns perfectly valid, well-formed, 200-OK JSON that draws the greenway somewhere off the coast of Africa. Every backend unit test passes. The harness catches it visually; the contract test catches it in CI forever. Keep both — an eyeball is not a regression gate.

> ***In plain terms:*** *Latitude and longitude are one way of describing a location; a flat local grid in feet is another. We need both, for different jobs. If the wrong one leaks out of the API, the map draws the trail in the middle of the ocean and nothing in the backend complains. So we test for it.*

### Stage E — Deployable, not just runnable

| ID | Task |
| :---- | :---- |
| E1 | Nginx reverse proxy terminating TLS in front of Express, certificates automated via an ACME client (ADR-001 §4.3). Lock the origin to accept inbound traffic only from Cloudflare. |
| E2 | Deploy the backend via Docker Compose to the self-hosted Linux host or VM (ADR-001 §4.6 item 1). |
| E3 | Deploy the harness to a **separate Cloudflare Pages preview project** — not the production frontend site. This proves the CDN path without occupying the deployment the real app will own. |
| E4 | Uptime monitor with one working alert (ADR-001 §4.6 item 2). Automated database backups plus **one restore that has actually been performed** (item 3). An untested backup is a hope, not a recovery plan. |

**Definition of Done:** a teammate who is not on our network, on a phone, on cellular data, opens the preview URL and sees the greenway. Everything before this point is localhost theatre.

### Stage F — Prove the claim, then stop

| ID | Task |
| :---- | :---- |
| F1 | Stop the database. Confirm the base map still loads and the app degrades rather than dying. ADR-001 §4.7 and §6 assert this; this is where we find out whether it is true. |
| F2 | Tag `v0.1.0-skeleton`. Write one page: what the skeleton proves, what it does not, and what is being thrown away. |
| F3 | Delete or quarantine `harness/` when the approved design lands. Tracked now so it cannot quietly become load-bearing. |
| F4 | Add threads through the harness: the Firebase Auth thread (ADR-001 §4.3), then the pgRouting thread once the routing spike has an answer. **Threads, not features.** |

F1 is the step where this stops being a plumbing exercise and becomes an architectural prototype in the strict sense — an executable built to test a stated quality attribute (NFR-AVL-02) rather than to trust the design document.

---

## 6. Explicit non-goals of this document

This is not an ADR. It records no new architectural decisions except §4.1 and §4.2, both of which are also to be reflected in ADR-001. It does not supersede the FRD. It does not cover the PMTiles build pipeline, the testing stack, CI/CD strategy or database connection pooling — ADR-001 §11 correctly identifies those as belonging in a separate ADR-002, and the skeleton is expected to generate the evidence for it.

---

## 7. Lane structure

**Stage C is the shared prerequisite.** The routing and buffer spikes do not need the skeleton; they need the pinned, containerised environment that C1–C3 produces.

```
A → B → C ─┬─→ D → E → F          Lane 1: the skeleton
           ├─→ Spike: pgRouting    Lane 2: topology, noding, endpoint tolerance
           └─→ Spike: buffer/CRS   Lane 3: pin EPSG, ST_Buffer + ST_DWithin + GiST
```

With four people on the backend lane, all three can run concurrently after Stage C. Suggested shape, to be confirmed by the owners rather than assigned here:

- **Lane 1 (skeleton)** — two people, since D and E span both API and deployment.
- **Lane 2 (pgRouting)** — one person. Highest architectural risk on the project: ADR-001 §3 warns that segment endpoints failing to coincide within tolerance *"produce a disconnected network and silently wrong routes,"* and the 2026-08-01 topology analysis found two connected components (41.7 km and 7.6 km), four dead ends, junctions, and four mid-line meeting points.
- **Lane 3 (buffer/CRS)** — one person. Pins EPSG:2253 or EPSG:26917, closing ADR-001 §10 item 6, which Stage D's contract test depends on being understood.

Lanes 2 and 3 are **explorative/experimental** prototypes — timeboxed, with a written pass/fail criterion, and thrown away. Lane 1 is **evolutionary** and is kept.

---

## 8. Traceability

| Element of this plan | Traces to |
| :---- | :---- |
| Scope statement and component list | ADR-001 §3 |
| Cloudflare Pages retained; Firebase Hosting removed | ADR-001 §3, §4.7, §6, §7 |
| Firebase Auth retained for admin only | ADR-001 §4.3, §4.11 |
| Response properties `phase` and `type` | ADR-001 §4.8; FR-05, FR-06 |
| `ST_SRID` = 4326 contract test | ADR-001 §4.9; ADR-001 §10 item 6; RFC 7946 §4 |
| Response-size budget | NFR-PRF-01 |
| PMTiles from R2; OSM attribution | ADR-001 §3; ODbL Produced Work terms |
| `axe-core` gate in CI from Stage C | ADR-001 §4.4; NFR-USA-01 |
| Nginx + origin lockdown | ADR-001 §4.3; NFR-SEC-03 |
| Self-hosted origin, monitoring, tested restore | ADR-001 §4.6; NFR-AVL-01 |
| Database-down degradation test (F1) | ADR-001 §4.7, §6; NFR-AVL-02 |
| pgRouting spike scope | ADR-001 §3, §5; FR-08a, FR-08e |
| Buffer/CRS spike scope | ADR-001 §4.9; ADR-001 §10 item 6; FR-15, FR-16 |
| Deferral of PMTiles pipeline, testing stack, CI/CD, pooling to ADR-002 | ADR-001 §11 |

---

## 9. Open items

NFR targets still unratified (ADR-001 §10 item 3): NFR-AVL-01 uptime, NFR-PRF-01 device and network profile, NFR-PRF-05 data and concurrency multipliers. Stage D's response-size budget needs a number from NFR-PRF-01; until ratified, the test asserts against a provisional figure that must be flagged in the code.

4. **Buffer coordinate system unpinned** (ADR-001 §10 item 6): EPSG:2253 or EPSG:26917. Closed by Lane 3.
5. **Google API references in ADR-001 §4.11 and §10 item 4 need reconciling.** The team has clarified that "validating Google feasibility" meant open-data source discovery, not the Google Maps Platform API. ADR-001 currently records the Google API as the chosen source for restroom hours (FR-11-OQ1). Either the ADR should be amended, or the Google Maps Platform Service Specific Terms restriction on using Places content with a non-Google map applies to our MapLibre stack and the decision needs revisiting.
6. **Frontend repository README describes an application that does not exist.** It claims React, Vite, TypeScript, MapLibre and Turf.js; the repository contains a 24-line static HTML placeholder and no `package.json`. It also gives a clone URL of `jlgmapapp.git` where the repository is `jlgmapapp-frontend`, and states the greenway is 30 miles where project records state 27.5 — to be reconciled against the Framework Plan rather than picked.

---

## 10. Sources

- Cockburn, A. — *Walking Skeleton* (definition as quoted from his website, 2008; not verified against *Crystal Clear*).
- Bardram, J., Christensen, H. B., & Hansen, K. M. — *Architectural Prototyping: An Approach for Grounding Architectural Design and Learning*, WICSA 2004. Three-class taxonomy per H. B. Christensen's Aarhus University course materials.
- Shank, C. — *Start with a Walking Skeleton*, in *97 Things Every Software Architect Should Know*.
- RFC 7946, *The GeoJSON Format*, §4 (Coordinate Reference System) and §3.1.1 (Position).
- Cloudflare Pages documentation — platform limits, and Functions pricing (static asset requests free and unlimited on all plans).
- Firebase Hosting documentation — usage levels, quotas and pricing.
- Protomaps documentation — Cloud Storage for PMTiles (Range request requirement; R2 recommended) and Basemap Downloads (daily build channel, `extract` CLI, ODbL attribution, hotlinking discouraged).
- Google Maps Platform Service Specific Terms — §14.2 / §14.3 (current), §5.3 / §5.4 (2025-03-31 archive).
- ADR-001 Technology stack for the Phase 1 map and geospatial layer, v2.

---

## 11. Change log

| Date | Change |
| :---- | :---- |
| 2026-08-17 | Created. Stage A decisions locked: Cloudflare Pages retained per ADR-001 §3 with Firebase Hosting to be removed (§4.1); backend, database and architecture ownership assigned to Maha, Eity, Asmita and Rachael (§4.2). Mock server dropped from Stage B as having no consumer while frontend work is paused pending design approval; OpenAPI spec and generated types retained. Harness relocated to the backend repository so the frontend repository stays clean for the approved design. |