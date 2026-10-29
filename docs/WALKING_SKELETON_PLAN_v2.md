# Walking Skeleton Plan v2

**Repository:** `jlgmapapp-backend`
**Suggested path:** `docs/WALKING_SKELETON_PLAN_v2.md`

| Field | Value |
| :---- | :---- |
| **Status** | Active — rebased on ADR-001 **v5**. Stages A and B complete; Stage C complete except the seed-loader step; Stage D in progress; Stages E–F not started; Lanes 2 and 3 complete. See the status summary below. |
| **Date drafted** | 2026-08-17 (v1); revised 2026-10-29 (v2) |
| **Owners (backend, database, architecture)** | Maha, Eity, Asmita, Rachael — architecture is jointly owned by all four |
| **Frontend** | Lawrence — **not assigned to any task in this plan** (see §3) |
| **Reviewer / approvals** | Asim |
| **Related documents** | ADR-001 Technology stack for the Phase 1 map and geospatial layer, **v5** (this plan is rebased on v5; all ADR section references below are to v5); JLG_Phase1_FRD v6; JLG Project Roadmap workbook — **Walking Skeleton** sheet (the live task tracker; this plan does not duplicate its per-task execution log) |
| **Supersedes** | v1 (2026-08-17). See the change log for everything that changed. |

> ***In plain terms:*** *This document is a work plan, not a decision record. It says what we are building first and in what order. Decisions of record belong in ADR-001 — where a decision is referenced here, the ADR section is cited so the two do not drift apart. Live task status lives in the roadmap's Walking Skeleton sheet; this plan carries only a summary of it.*

---

## Current status (as of 2026-10-29, from the roadmap's Walking Skeleton sheet)

The roadmap sheet is the authoritative live tracker; it self-reports roughly 70% complete (26 of 37 tasks). This summary exists so the plan is not read as if nothing has been built.

| Stage / Lane | Status | Notes |
| :---- | :---- | :---- |
| **A — Clear the blockers** | **Done** | A GitHub organisation **was** created (reversing the v1 "no org" decision — see §4.1, §9 item 6). |
| **B — The contract** | **Done** | `openapi.yaml` + generated TypeScript types delivered; six Stage-B open items (B-O1–B-O6) tracked and closed in the roadmap sheet, some with closure steps still to verify there. |
| **C — The harness** | **Done except the seed-loader step** | C1, C2, C4, C5, C6 done; the C3 **extract** is done, but the **seed step that loads it into the database does not yet exist** (roadmap C3). Until it does, a fresh clone gets an empty database, which the Stage C Definition of Done forbids. |
| **D — The vertical slice** | **In progress** | D1 and D2 done. **D3 is in progress and is being retargeted from R2 to GitHub Pages per ADR-001 v5 §4.12** (see §4.1 and D3). D4 and D5 not started. |
| **E — Deployable, not just runnable** | **Not started** | — |
| **F — Prove the claim, then stop** | **Not started** | — |
| **Lane 2 — pgRouting spike** | **Done** | 2026-08-01 topology analysis: 2 components (41.7 km / 7.6 km), 4 dead ends, junctions, 4 mid-line meeting points. |
| **Lane 3 — Buffer / CRS spike** | **Done**, with one conflict | The roadmap marks L3.1 "CRS decision recorded in ADR-001," but ADR v5 §4.9 and §10 item 6 still show the CRS **unpinned**. Treated here as open per the ADR — see §9 item 4. |

---

## 1. What a Walking Skeleton is, and why we are building one

A **walking skeleton** is a tiny implementation of the system that performs one small end-to-end function and links together all the main architectural components (Cockburn). It is deliberately thin: no features, no polish, no business logic worth speaking of. Its purpose is to prove the pipes connect and to make the system deployable from the first week rather than the last.

This sits inside the broader practice of **architectural prototyping** — building executables specifically to investigate architectural qualities raised as concerns by stakeholders (Bardram, Christensen & Hansen, WICSA 2004). Architectural prototypes come in three classes: *explorative* and *experimental* (throwaway, used to answer a question) and *evolutionary* (kept, grown into the real system). This skeleton is the **evolutionary** one. Our routing and buffer spikes are the throwaway ones, and they are tracked separately.

The distinction matters in practice: spike code answers a question and is then deleted; skeleton code is kept and built upon. Confusing the two is how throwaway code quietly becomes load-bearing.

> ***In plain terms:*** *We are building the thinnest possible version of the whole app — one line drawn on one map from one database query — so that everything is connected and deployable before we build anything real on top of it.*

---

## 2. Scope statement

> **A user opens the public URL on a phone and sees the Joe Louis Greenway drawn on a map, where the base map came from a static PMTiles archive on GitHub Pages and the greenway line came from our own PostGIS database through our own API.**

That single sentence touches every component on the public read path in ADR-001 §3: React/Vite/TypeScript → MapLibre GL JS → PMTiles on GitHub Pages → Express → PostgreSQL/PostGIS → Nginx → Cloudflare.

### 2.1 Non-goals

These are **out of scope for the skeleton**, explicitly and in writing, because scope creep is the primary failure mode of this exercise:

- No routing. pgRouting is a separate spike (§7).
- No place search (`pg_trgm`).
- No POIs, restrooms, play areas, food venues, event spaces, or events.
- No OPEN NOW status. (Opening hours were removed from Phase 1 entirely — ADR-001 §4.14.)
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

The frontend repository originally contained `firebase.json`, `.firebaserc`, and two auto-generated GitHub Actions workflows that deployed to Firebase Hosting on merge and on pull request. These were generated by `firebase init`, not chosen against the ADR, and they contradicted ADR-001 §3 (*"Website hosting: Cloudflare Pages"*) and §7 (static-first hybrid). They have since been removed (Stage A, A1.1, Done).

**Rationale.** Three factors, in order of weight.

First, **failure domain.** ADR-001 §4.7 records the external-dependency posture as *accept and document* for Cloudflare (frontend and API edge) and **GitHub Pages (basemap tiles, since 2026-08-14)**, with the full failure map in §6. Hosting the frontend on Firebase would add a third external host that could take the app down and would force a rewrite of §6's failure table. Keeping the frontend on Cloudflare Pages holds the set of external hosts to the ones the ADR already accepts.

Second, **conformance.** ADR-001 §3 names Cloudflare Pages. Keeping the repository and the ADR in agreement costs about an hour; the alternative is a silent contradiction of exactly the kind the 2026-08-01 loop-topology correction was written to prevent.

Third, **cost is not a real differentiator and should not be cited as one.** Cloudflare's documentation states that on both free and paid plans, requests to static assets are free and unlimited. Firebase Hosting offers 10 GB storage and 10 GB/month transfer free, then $0.026/GB stored and $0.15/GB transferred. But **map tiles are served directly from GitHub Pages to the browser, bypassing the website host entirely under either option**, so the only thing the website host carries is the app shell — a few megabytes. At Phase 1 volumes both are effectively free. This is recorded so nobody re-litigates the decision on a cost argument that does not hold. (GitHub Pages is itself free on a public repository within its soft limits — 100 GB/month bandwidth, 1 GB site size; confirm the tile repository is public. See §9.)

**Costs accepted.** Roughly one hour of setup, and the loss of a working deployment pipeline that already existed. Cloudflare Pages' Free plan caps builds at 500/month with one concurrent build and a 20-minute timeout, and individual assets at 25 MB — none of which binds us, since tiles live on GitHub Pages and the app shell is well under 25 MB.

**Explicitly unaffected: Firebase Auth stays.** ADR-001 §4.3 and §4.11 scope Firebase Auth to the admin surface (event authoring, trail status authoring, topology flag review, account management). That decision is untouched. Only Firebase *Hosting* was removed.

> ***In plain terms:*** *We removed Firebase as the place our website lives, and kept Firebase as the way admins log in. Those are two different Firebase products and only one of them went.*

### 4.2 Ownership (A2)

Backend, database and architecture are jointly owned by **Maha, Eity, Asmita and Rachael**. Lawrence owns the frontend and is not assigned here. Asim reviews and approves.

This closed the backend and architecture role assignments. On ADR-001 itself, the deciders, reviewer and approver are now recorded; only the **author** field remains unfilled (ADR-001 §10 item 12). See §9 item 2.

---

## 5. Stages

Six stages. Each has a Definition of Done that can be pasted into a ticket. The **Status** column reflects the roadmap's Walking Skeleton sheet as of 2026-10-29; that sheet remains the live tracker for execution detail.

### Stage A — Clear the blockers — **Done**

| ID | Task | Status |
| :---- | :---- | :---- |
| A1.1 | Delete `firebase.json`, `.firebaserc`, `.github/workflows/firebase-hosting-merge.yml` and `.github/workflows/firebase-hosting-pull-request.yml` from the frontend repository. | Done |
| A1.2 | Create the Cloudflare Pages project and connect it to the frontend repository. | Done |
| A1.3 | Confirm in writing that the Firebase project `joe-louis-greenway-ea7ab` is retained for **Auth only**, and that Hosting is disabled on it. | Done |
| A2.1 | Record ownership (§4.2) in the ADR-001 decider field and in both repository READMEs. | Done |
| A3.1 | Commit this plan to `docs/` in the backend repository. (v1 was committed; v2 supersedes it.) | Done (v1); v2 to commit |
| A3.2 | Enable branch protection on `main` in both repositories, requiring a pull request before merge; confirm all four backend owners have collaborator access. **A GitHub organisation was created and members were added to it** — this reverses the v1 decision to keep the repositories under a personal account. See §9 item 6 for the governance consequences, including a new least-privilege concern. | Done |

**Definition of Done:** no Firebase Hosting artefacts remain in the frontend repository; a Cloudflare Pages project exists; ownership is recorded in three places; `main` is protected on both repositories; all four owners have access; the repositories are held in a GitHub organisation.

### Stage B — The contract — **Done**

| ID | Task | Status |
| :---- | :---- | :---- |
| B1 | Write `openapi.yaml` for **one endpoint**: `GET /api/v1/segments`. Response is a GeoJSON `FeatureCollection` of `LineString` features with properties `segment_id`, `phase`, `type`. Version the path from the first commit. | Done |
| B2 | Generate TypeScript types from the spec. The backend uses them for response validation; the harness consumes the same generated types. | Done |

The endpoint's shape is derived from ADR-001 §4.8 — the City of Detroit Route Segments layer, whose *phase* attribute is the source for segment status (FR-05) and whose *type* attribute is the source for segment type (FR-06). It is **not** derived from the UI design, so it was safe to write before that design is approved. The former mock server (once B3) was cut: no consumer while frontend work is paused.

**Definition of Done:** the spec is committed and versioned; types generate reproducibly and are imported by at least one compiling backend module; the harness import is verified at D4.

**Stage B open items (B-O1–B-O6).** Six consequences of Stage B decisions are tracked and closed in the roadmap's Walking Skeleton sheet, which carries the full verification log. They are listed here for visibility; none blocked Stage B sign-off: **B-O1** regenerate the seed against the code vocabulary; **B-O2** make the ETL loader UPSERT on `(source, source_ref)`; **B-O3** decide whether `phase`/`type` stay nullable or gain an "unknown" row; **B-O4** resolve whether "response validation" is compile-time or runtime; **B-O5** fix or delete the stale `code_translations.csv`; **B-O6** set `info.license` in `openapi.yaml`. See the roadmap sheet for each item's detail and closure state.

### Stage C — The harness *(shared prerequisite — see §7)* — **Done except the seed-loader step**

| ID | Task | Status |
| :---- | :---- | :---- |
| C1 | `docker-compose.yml` with PostgreSQL + PostGIS + pgRouting, **versions pinned**. ADR-001 §3 pins pgRouting 3.6.1 and records that 3.8.0 deprecated `pgr_createTopology`, `pgr_createVerticesTable`, `pgr_nodeNetwork`, `pgr_analyzeGraph` and `pgr_analyzeOneWay`. Unpinned versions make spike results incomparable. | Done |
| C2 | Prove migrations run `up` from an empty database and `down` back. | Done |
| C3 | Commit a **script-generated** seed extract of the **full 51-segment network** as GeoJSON, loaded by a seed step. | Extract **Done**; **seed step not built** |
| C4 | One real test on each side, running in CI on pull request. | Done |
| C5 | Add the missing CI stages: install → typecheck → lint → test → build → deploy. | Done |
| C6 | Add `axe-core` (or equivalent) as a CI stage, per §2.2. | Done |

**Amended 2026-08-19 — the full dataset, not ~20 segments.** v1 called for "roughly 20 route segments." That is retired. A 20-segment sample fragmented the network into 10 connected components, versus far fewer for the full network (the exact full-network component count is recorded inconsistently across the roadmap — see §9 item 9), so a spike run on the sample would measure the sampling, not the greenway. Size was the original reason to sample and is not a real constraint: the full seed is 29,155 bytes minified against the sample's 11,220. The seed is generated by `scripts/seed/build-segments-seed.mjs`, not hand-curated, and reproducibility is provable: run the generator, then `git diff --exit-code -- seed/` must be silent.

**Two outputs, kept distinct:** `segments.seed.geojson` (database input; property names are DB columns; deliberately no `segment_id` or `geom_proj`, which are generated on insert) and `segments.response.fixture.geojson` (the expected API response; **26,030 bytes minified — this is the figure for the D2 response-size budget**, not the old 20-segment number, which under-measured by ~60%).

**Open within C3:** the **seed step does not yet exist** — nothing in `scripts/` or `seed/` loads `segments.seed.geojson`, so a fresh clone today gets a working database with no data, which this stage's Definition of Done forbids. Build it together with B-O2 (the UPSERT on `(source, source_ref)` is what the seed step must do). Also, `source_snapshot_date` is null in all 51 features and must be set by the seed step — **it must not be guessed** (the one repository artefact that named a date was wrong on two other facts). See §9 items 8 and 9.

**Definition of Done:** a teammate clones the repository, runs one command, and has a working database **with data** — on a machine that has never seen this project before. *(Not yet met: the seed step is outstanding.)*

### Stage D — The vertical slice — **In progress**

| ID | Task | Status |
| :---- | :---- | :---- |
| D1 | Implement `GET /api/v1/segments`: PostGIS query → GeoJSON via `ST_AsGeoJSON`. One integration test against a real containerised PostgreSQL, not a mock. | Done |
| D2 | **Two contract tests, non-negotiable.** (a) Assert `ST_SRID` = 4326 on every geometry the endpoint emits. (b) Assert response size against a stated byte budget — **26,030 bytes (provisional; flag in code until NFR-PRF-01 is ratified).** | Done |
| D3 | Base map: use `pmtiles extract` to pull a Detroit-sized region from the Protomaps daily OpenStreetMap basemap build, and publish it to **our GitHub Pages tile repository** (ADR-001 §4.12) — Protomaps discourage hotlinking their downloads, and GitHub Pages was verified on 2026-08-14 to honour the HTTP range requests and CORS that PMTiles requires. The basemap is ODbL as a Produced Work, so **add the OpenStreetMap attribution control in this step**, not later. | **In progress — retarget from R2 to GitHub Pages** |
| D4 | Build `harness/` per §3: Vite page, MapLibre canvas, one `fetch`, one layer, throwaway header comment. | Not started |
| D5 | Configure CORS. Put the API base URL in an environment variable, never hardcoded. Render the layer. | Not started |

> **D3 note:** the roadmap still described this task as "→ our own R2 bucket," which predates ADR-001 v5 §4.12. Per that decision of record, the target is GitHub Pages. If any D3 work has already been done against R2, treat it as rework to redirect — the artefact is a single static file, so the change is the publish destination, not the extract itself.

**Definition of Done:** `docker compose up` plus the harness dev server, and the greenway is visible — drawn from our own database over an OpenStreetMap base map.

#### Why D2 is non-negotiable

RFC 7946 §4 mandates that all GeoJSON coordinates use WGS 84, longitude then latitude, in decimal degrees. But ADR-001 §4.9 requires reprojecting the centreline onto a projected grid — EPSG:2253 or EPSG:26917 — in order to buffer in real distance units. Per ADR-001 §4.9 and §10 item 6 that grid is **still unpinned** (the roadmap marks the spike done; the ADR does not record a chosen EPSG — see §9 item 4). **Our database will therefore legitimately hold geometry in two coordinate systems.** `ST_AsGeoJSON` emits whatever SRID the geometry carries, without complaint.

An endpoint that serves projected coordinates returns perfectly valid, well-formed, 200-OK JSON that draws the greenway somewhere off the coast of Africa. Every backend unit test passes. The harness catches it visually; the contract test catches it in CI forever. Keep both — an eyeball is not a regression gate.

> ***In plain terms:*** *Latitude and longitude are one way of describing a location; a flat local grid in feet is another. We need both, for different jobs. If the wrong one leaks out of the API, the map draws the trail in the middle of the ocean and nothing in the backend complains. So we test for it.*

### Stage E — Deployable, not just runnable — **Not started**

| ID | Task | Status |
| :---- | :---- | :---- |
| E1 | Nginx reverse proxy terminating TLS in front of Express, certificates automated via an ACME client (ADR-001 §4.3). Lock the origin to accept inbound traffic only from Cloudflare. | Not started |
| E2 | Deploy the backend via Docker Compose to the self-hosted Linux host or VM (ADR-001 §4.6 item 1). | Not started |
| E3 | Deploy the harness to a **separate Cloudflare Pages preview project** — not the production frontend site. This proves the CDN path without occupying the deployment the real app will own. | Not started |
| E4 | Uptime monitor with one working alert (ADR-001 §4.6 item 2). Automated database backups plus **one restore that has actually been performed** (item 3). An untested backup is a hope, not a recovery plan. | Not started |

**Definition of Done:** a teammate who is not on our network, on a phone, on cellular data, opens the preview URL and sees the greenway. Everything before this point is localhost theatre.

### Stage F — Prove the claim, then stop — **Not started**

| ID | Task | Status |
| :---- | :---- | :---- |
| F1 | Stop the database. Confirm the base map still loads and the app degrades rather than dying. ADR-001 §4.7 and §6 assert this; this is where we find out whether it is true. | Not started |
| F2 | Tag `v0.1.0-skeleton`. Write one page: what the skeleton proves, what it does not, and what is being thrown away. | Not started |
| F3 | Delete or quarantine `harness/` when the approved design lands. Tracked now so it cannot quietly become load-bearing. | Not started |
| F4 | Add threads through the harness: the Firebase Auth thread (ADR-001 §4.3), then the pgRouting thread once the routing spike has an answer. **Threads, not features.** | Not started |

F1 is the step where this stops being a plumbing exercise and becomes an architectural prototype in the strict sense — an executable built to test a stated quality attribute (NFR-AVL-02) rather than to trust the design document.

---

## 6. Explicit non-goals of this document

This is not an ADR. It records no new architectural decisions except §4.1, which is also reflected in ADR-001. It does not supersede the FRD. It does not cover the PMTiles build pipeline, the testing stack, CI/CD strategy or database connection pooling — ADR-001 **§13 (Next steps)** and §4.12 correctly identify those as belonging in a separate ADR-002, and the skeleton is expected to generate the evidence for it. *(v1 cited "ADR-001 §11" here; in v5 that content is in §13, and §11 is Sources.)*

---

## 7. Lane structure

**Stage C is the shared prerequisite.** The routing and buffer spikes do not need the skeleton; they need the pinned, containerised environment that C1–C3 produces.

```
A → B → C ─┬─→ D → E → F          Lane 1: the skeleton        (evolutionary — kept)
           ├─→ Spike: pgRouting    Lane 2: topology, noding    (throwaway — DONE)
           └─→ Spike: buffer/CRS   Lane 3: EPSG, ST_Buffer     (throwaway — DONE)
```

With four people on the backend lane, all three ran concurrently after Stage C.

- **Lane 1 (skeleton)** — evolutionary, kept. In progress at Stage D.
- **Lane 2 (pgRouting)** — **Done.** Highest architectural risk on the project: ADR-001 §3 warns that segment endpoints failing to coincide within tolerance *"produce a disconnected network and silently wrong routes,"* and the 2026-08-01 topology analysis found two connected components (41.7 km and 7.6 km), four dead ends, junctions, and four mid-line meeting points. L2.1 (load/node/build topology) and L2.2 (verify the open-segment gate reports interruption, not the long arc) are both done.
- **Lane 3 (buffer/CRS)** — **Done, with one unresolved conflict.** L3.2 (rehearse the buffer in QGIS, then automate in PostGIS) is done. L3.1 (pin the CRS) is marked done in the roadmap but ADR-001 §4.9 and §10 item 6 still show the CRS unpinned; per the ADR being authoritative, this plan treats it as open. See §9 item 4.

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
| Response-size budget (26,030 bytes, provisional) | NFR-PRF-01 (unratified); C3 response fixture |
| Full 51-segment seed (not a sample) | Lane 2 topology need; C3 amendment 2026-08-19 |
| PMTiles from **GitHub Pages**; OSM attribution | ADR-001 §4.12, §3; ODbL Produced Work terms |
| `axe-core` gate in CI from Stage C | ADR-001 §4.4; NFR-USA-01 |
| Nginx + origin lockdown | ADR-001 §4.3; NFR-SEC-03 |
| Self-hosted origin, monitoring, tested restore | ADR-001 §4.6; NFR-AVL-01 |
| Database-down degradation test (F1) | ADR-001 §4.7, §6; NFR-AVL-02 |
| GitHub organisation holds the repositories | Stage A A3.2 (reverses v1); §9 item 6 |
| pgRouting spike scope | ADR-001 §3, §5; FR-08a, FR-08e |
| Buffer/CRS spike scope | ADR-001 §4.9; ADR-001 §10 item 6; FR-15 |
| Deferral of PMTiles pipeline, testing stack, CI/CD, pooling to ADR-002 | ADR-001 §13 (Next steps), §4.12 |

---

## 9. Open items

1. **Team roster conflict, unresolved.** The frontend repository README has listed *Musammat — Software Tester* and not named Eity; the ownership list in §4.2 was given by the project lead and names Eity, not Musammat. **Not reconciled by inference.** Both READMEs need a single accurate roster.
2. **ADR-001 author field remains unfilled.** Per ADR-001 §10 item 12, the deciders, reviewer and approver are now recorded; only the author field is still open. (This closes the remainder of the former "author, reviewer and approver" item.)
3. **NFR targets still unratified** (ADR-001 §10 item 3): NFR-AVL-01 uptime, NFR-PRF-01 device and network profile, NFR-PRF-05 data and concurrency multipliers. The D2 response-size budget currently asserts against a **provisional 26,030 bytes**, which must be flagged in the code until NFR-PRF-01 is ratified.
4. **Buffer coordinate system — conflict, treated as open per the ADR.** ADR-001 §4.9 and §10 item 6 record the CRS (EPSG:2253 or EPSG:26917) as **still unpinned**. The roadmap's Walking Skeleton sheet marks Lane 3 task L3.1 *"Done — CRS decision recorded in ADR-001."* These disagree. Because ADR-001 v5 is the decision of record, this plan treats the CRS as open; whoever ran the spike should confirm whether an EPSG was actually chosen and, if so, record it in ADR-001 §4.9. **No EPSG is assumed here.**
5. **Google restroom-hours API question — closed.** v1 flagged a Google API dependency for restroom opening hours (FR-11-OQ1). ADR-001 §4.14 removed opening hours from Phase 1 entirely and §10 item 4 records FR-11-OQ1 as closed. The Phase 1 Google concern is therefore resolved. (A Google Maps Embed API option for off-trail preview remains a **Phase 2** item under ADR-001 §4.10 — separate and out of scope here.)
6. **Repository custody — "no org" decision reversed; a new least-privilege concern opened.** v1 recorded that a GitHub organisation was explicitly *not* being created, and logged the continuity, secret-custody and audit risks as *accepted* on that basis. **A GitHub organisation has since been created and members added** (confirmed by the project lead; roadmap A3.2). This largely mitigates those three risks. However, the roadmap records that *"everyone was elevated to admin and no teams were created,"* which re-introduces an access-control (least-privilege) concern: broad admin access with no team-scoped permissions. **Recommend defining non-admin roles / teams and a permission baseline before Phase 4 (Development).**
7. **Frontend repository README describes an application that does not exist.** It has claimed React, Vite, TypeScript, MapLibre and Turf.js over a static HTML placeholder with no `package.json`; it gave a clone URL of `jlgmapapp.git` where the repository is `jlgmapapp-frontend`; and it stated the greenway is 30 miles where project records state 27.5 — to be reconciled against the Framework Plan, not picked.
8. **The C3 seed-loader step does not yet exist.** The extract is committed, but nothing in `scripts/` or `seed/` loads it, so a fresh clone gets an empty database — the Stage C Definition of Done is not met until this is built (alongside B-O2's UPSERT on `(source, source_ref)`).
9. **`source_snapshot_date` is null in all 51 seed features.** The query date is not recorded anywhere verifiable in the repository; the one artefact that named a date was wrong on two other facts. The seed step must set it. **It must not be guessed.**
10. **Connected-component count recorded inconsistently.** Lane 2's L2.1 note gives the full network as **two** connected components (41.7 km / 7.6 km); C3's rationale note gives **three**. These are two cells of the same roadmap and disagree. Reconcile against the actual topology output, not by inference.
11. **Tile repository public/private status unconfirmed.** GitHub Pages is free on a public repository within its soft limits (100 GB/month bandwidth, 1 GB site size); a private repository on a personal/free account cannot use Pages. Confirm the tile repository is public, or budget a paid GitHub plan.
12. **E2 host location and cost unrecorded.** ADR-001 §4.6 item 1 commits to "a self-hosted Linux host or VM" but does not record where it runs or what it costs. If it is existing/donated hardware the recurring dollar cost is ~0; if it is a rented cloud VM it is a real monthly cost (and PostGIS + pgRouting wants memory). This is the one deployment component not structurally free. Record the host and its cost in ADR-002.

---

## 10. Sources

- Cockburn, A. — *Walking Skeleton* (definition as quoted from his website, 2008; not verified against *Crystal Clear*).
- Bardram, J., Christensen, H. B., & Hansen, K. M. — *Architectural Prototyping: An Approach for Grounding Architectural Design and Learning*, WICSA 2004. Three-class taxonomy per H. B. Christensen's Aarhus University course materials.
- Shank, C. — *Start with a Walking Skeleton*, in *97 Things Every Software Architect Should Know*.
- RFC 7946, *The GeoJSON Format*, §4 (Coordinate Reference System) and §3.1.1 (Position).
- GitHub Pages documentation — platform limits (soft 100 GB/month bandwidth; recommended/maximum 1 GB site size; 10 builds/hour; 10-minute deploy timeout) and plan availability (free on public repositories; private repositories require a paid plan). HTTP range-request and CORS behaviour was verified directly against the published archive on 2026-08-14 (ADR-001 §4.12).
- Cloudflare Pages documentation — platform limits and static-asset request pricing (free and unlimited on all plans).
- Firebase Hosting documentation — usage levels, quotas and pricing (retained for the §4.1 cost comparison only; Hosting is not used).
- Protomaps documentation — PMTiles Cloud Storage (HTTP Range request requirement) and Basemap Downloads (daily build channel, `extract` CLI, ODbL attribution, hotlinking discouraged).
- ADR-001 Technology stack for the Phase 1 map and geospatial layer, **v5** (decision of record; all ADR section references in this plan are to v5).
- JLG Project Roadmap workbook — **Walking Skeleton** sheet (status source as of 2026-10-29).

---

## 11. Change log

| Date | Change |
| :---- | :---- |
| 2026-08-17 | Created (v1). Stage A decisions locked: Cloudflare Pages retained per ADR-001 §3 with Firebase Hosting to be removed (§4.1); backend, database and architecture ownership assigned to Maha, Eity, Asmita and Rachael (§4.2). Mock server dropped from Stage B as having no consumer while frontend work is paused; OpenAPI spec and generated types retained. Harness relocated to the backend repository so the frontend repository stays clean for the approved design. |
| 2026-08-17 | A3.2 revised (v1). GitHub organisation ruled out by decision of the project lead; task reduced to branch protection and collaborator access. Continuity, secret-custody and audit risks recorded as accepted in §9 item 6. *(Note: this decision was subsequently reversed — see the 2026-10-29 entry.)* |
| 2026-10-29 | **v2 — rebased on ADR-001 v5, and reconciled against the roadmap's Walking Skeleton sheet.** Changes: (1) **Tile host corrected from Cloudflare R2 to GitHub Pages** throughout (§2, §4.1, Stage D3, §8), per ADR-001 §4.12; the §4.1 failure-domain reasoning updated to v5's §4.7 wording. (2) **Status added** — a per-stage summary and a Status column reflecting the roadmap (Stages A–B done; C done except the seed-loader step; D in progress; E–F not started; Lanes 2–3 done; ~70% overall). (3) **GitHub organisation created**, reversing the v1 "no org" decision (Stage A3.2, §9 item 6); a new least-privilege concern recorded (all members admin, no teams). (4) **C3 amended** to the full 51-segment seed, retiring the "~20 segments" language, with rationale. (5) **D2 response-size budget set to 26,030 bytes** (provisional, pending NFR-PRF-01). (6) **Citation fix:** the ADR-002 deferral is ADR-001 §13 and §4.12 in v5, not §11 (§6, §8). (7) **Open items reconciled** per ADR-001 §10: author-only now (item 2); Google restroom-hours question closed (item 5); CRS conflict flagged and treated as open per the ADR (item 4); new items added for the missing seed step (8), the null snapshot date (9), the 2-vs-3 component-count discrepancy (10), tile-repository public status (11), and the unrecorded E2 host/cost (12). (8) Sources updated to ADR-001 v5 and GitHub Pages documentation. Supersedes v1. |
