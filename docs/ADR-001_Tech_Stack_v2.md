# ADR-001: Technology stack for the Phase 1 map and geospatial layer

| Field | Value |
| :---- | :---- |
| **ADR ID** | ADR-001 |
| **Title** | Technology stack for the Phase 1 map and geospatial layer |
| **Status** | Accepted (Phase 1 stack agreed by the team); sub-decisions and open items tracked in this record |
| **Date drafted** | 2026-07-14 |
| **Date revised** | 2026-08-01 |
| **Date accepted** | \[date TBD\] |
| **Deciders** | \[to be confirmed; role assignments for the architecture and backend leads are ambiguous across project records and should be reconciled before sign-off\] |
| **Author** | \[author name to be filled in\] |
| **Reviewer and approver** | \[reviewer to be filled in\] |
| **Related documents** | JLG\_Phase1\_FRD v1.0; JLG\_Phase1\_FR\_Sequencing workbook |
| **Supersedes** | The earlier draft of this record, which proposed a Leaflet plus MapTiler stack ("Stack C"). See the change log for why the team moved to the stack below. |

> ***In plain terms:*** *An Architecture Decision Record captures one significant technical choice: the situation that forced it, the options weighed, the option chosen, and what living with it will mean. It exists so that later anyone can see why the choice was made and what would have to change to revisit it. This record now documents the stack the team actually agreed on, plus the follow-on decisions that close the gaps found when that stack was checked against the requirements.*

## 1\. Context and problem statement

The FRD baselined a technology direction as an assumption rather than a validated decision. An earlier draft of this record proposed a Leaflet plus MapTiler stack. The team subsequently adopted a different, static-first architecture built around vector tiles served from a content delivery network, keeping a self-hosted backend for dynamic data. This record documents that agreed stack, records the follow-on decisions that resolve the gaps found when the stack was checked against the 15 functional and 22 non-functional requirements, and captures the points of failure across the stack so the availability posture is explicit.

## 2\. Decision drivers

Each driver traces to a requirement or a stated project constraint:

1. **Accessibility is pass or fail.** NFR-USA-01 pins WCAG 2.2 AA, including keyboard operability and non-text contrast.  
2. **Spatial query performance with indexes.** NFR-PRF-03 requires spatial indexes and sub-second common queries, which forces a spatial database.  
3. **Scalability for a read-heavy public map.** NFR-PRF-05 requires horizontal scaling of a stateless tier and sub-linear cost growth with data size.  
4. **Privacy and minimal collection.** NFR-PRV-01 to 03 require client-only live location, no server persistence of coordinates, and no-login public use.  
5. **Availability with recovery.** NFR-AVL-01 requires a self-hosted deployment with monitoring and a defined recovery approach; NFR-AVL-02 requires core browsing to survive a dependency outage.  
6. **Budget and small-team operations.** A three-developer civic project needs low cost and low operational load.

## 3\. **The agreed Phase 1 stack**

| Layer | Technology | Why |
| :---- | :---- | :---- |
| Language | TypeScript | Type safety for geographic data (coordinates, segments, POIs, events) reduces a whole class of bugs. |
| Frontend framework | React | Team familiarity; component model suits map, panels, filters, and detail views. |
| Build tool | Vite | Fast builds and small output, supporting the mobile load-time target. |
| Map rendering engine | MapLibre GL JS | Open-source, GPU vector rendering; native fit for vector PMTiles; strong for data-driven segment styling (FR-05, FR-06). Accessibility must be built (see Section 4.4). |
| Base map data | OpenStreetMap | Open geographic data, no proprietary map fees. |
| Map tile format | PMTiles | A whole tile set in one file served by HTTP range requests; low cost, low maintenance on object storage. |
| Tile hosting | Cloudflare R2 | Cheap object storage with zero egress fees, so serving tiles at scale does not create a cost cliff. |
| Website hosting | Cloudflare Pages | Global CDN delivery of the static frontend; scales to many users without touching the backend. |
| Backend API | Node.js and Express (self-hosted) | Serves dynamic data (events, near-me queries, admin) over REST; kept self-hosted per NFR-AVL-01. |
| Database | PostgreSQL with PostGIS | Spatial storage, indexes, and distance and buffer predicates. |
| Admin login | Firebase Auth (owner and admin roles) | External JLGP staff author events, trail status, and topology flag decisions (NFR-SEC-01, FR-05b, FR-08d, FR-14b). Two roles: admin, held by one or more accounts, and owner, a superset that additionally manages accounts (FR-14c). Firebase custom claims carry the role; claims are set server-side via the Admin SDK. Firebase issues a stateless JWT, which suits the horizontal-scaling posture (NFR-PRF-05). Recorded as a conscious divergence from the self-hosted, no-managed-service philosophy: the admin has no Wayne State account, so Wayne State Entra ID is not an option, and offloading password storage and reset removes security-sensitive code for a single account (see Section 4.3). |
| Routing | pgRouting (Phase 1\) | On-trail greenway routing on owned geometry, with the open-segment gate. Genuine pathfinding is required because the processed network is a multi-component graph with junctions and spurs, not a single loop (D8). Version 3.6.1 in use; the reasoning holds for 3.x. See FR-08e for the function set, several Topology-family functions having been deprecated in 3.8.0. |
| Place search | PostgreSQL full-text search with pg\_trgm (Phase 1\) | Fuzzy, typo-tolerant search over the app's own places (access points, POIs, landmarks, event spaces); no external dependency in Phase 1\. An external geocoder for arbitrary typed addresses is deferred to a Phase 2 spike (see Section 4.1). |
| In-browser live distance | Turf.js | Client-side snap-and-measure for live along-route distance, so live GPS never needs the server (NFR-PRF-02, NFR-PRV-01). |
| Timezone evaluator (added) | date-fns-tz | Correct OPEN NOW status in America/Detroit with daylight saving (see Section 4.2). |
| Transport security (added) | Nginx reverse proxy plus Cloudflare in front | HTTPS on the API with edge protection; Nginx chosen as the industry-standard reverse proxy (see Section 4.3). Caddy documented as previously considered. |
| Data ingestion (added) | Node ETL scripts plus a scheduler (for example cron) | Mirrored-data currency and the geocode-and-store step (see Section 4.5). |

x

> ***In plain terms:*** *The stack splits into two halves by how often data changes. Stable things (the app itself and the base map) are pre-built and served from a global cache, which is cheap and scales easily. Fast-changing things (events, live queries) come from a backend you run yourself. This split is the reason the app can serve many users cheaply while keeping control of its data.*

**Decision: retain pgRouting for Phase 1 on-trail routing.**

**Context.** The Joe Louis Greenway is designed as a closed loop, and on a pure loop point-to-point distance can be solved arithmetically without a routing engine: measure each segment's position around the ring, and the distance between any two points becomes subtraction, with the second arc being the circumference minus the first. That alternative was evaluated and rejected. It is worth recording that the arithmetic model was never available in the first place: the published dataset is not a single ring, and the reasons below hold independently of that.

**Rationale.** Three reasons, in order of weight.

First, FR-08a shall-3 requires the user to build a route by selecting and linking contiguous segments. Answering "does this segment connect to that one" is a connectivity question, not a distance question. Arithmetic around a ring cannot answer it without a separate adjacency structure, which is a graph by another name. Building half a graph to avoid using a graph is not a simplification.

Second, FR-08a shall-4 forbids substituting the longer arc when the shorter one is interrupted, and requires the interruption to be reported instead. This is implemented by routing across the full network as if all segments were open, then inspecting the returned segments' status and flagging any that are not. Both approaches can express this, but the graph model keeps the route computation and the status inspection cleanly separated, which reduces the risk of the status filter silently becoming a routing filter.

Third, and as present fact rather than headroom: the loop model is correct only while the network remains a single closed ring, and it is not one. The published dataset resolves into two connected components, with four dead ends, junctions, and four points where segments meet partway along rather than end to end. Any spur, any connection to an adjacent trail such as the Dequindre Cut or the Iron Belle, and any Phase 2 off-trail seam would each break the arithmetic model independently. A graph model absorbs all of them without structural change. This was recorded as foreseeable when the section was written; it has since been confirmed by measurement.

**Costs accepted.** pgRouting is a PostgreSQL extension, so it adds no separate service and no new operational surface, but it does add an extension to install, version, and maintain. Its topology must be generated from segment geometry and validated, which creates a data quality dependency: segment endpoints that do not coincide within tolerance produce a disconnected network and silently wrong routes. This validation is a required step in the ETL pipeline, not an optional one. That required validation is now specified as FR-08e (network construction, including noding and endpoint tolerance) and FR-08c (topology change detection at each rebuild). pgRouting 3.8.0 deprecated `pgr_createTopology`, `pgr_createVerticesTable`, `pgr_nodeNetwork`, `pgr_analyzeGraph` and `pgr_analyzeOneWay`; FR-08e's implementation note records the current replacements.

**Supersedes.** This section previously recorded, on 2026-07-21, that "the trail is a loop," retiring an earlier rationale that described the JLG as a branched network. That earlier rationale is reinstated, on evidence.

The loop description is accurate for the completed greenway and is how the Framework Plan, and this project's own documents, describe it. It is not accurate for the published dataset. Topology analysis of the City of Detroit route segments on 2026-08-01 found two connected components, the main one at 41.7 km and a separate 7.6 km section in southwest Detroit, together with four dead ends, junctions, and four points where segments meet partway along rather than end to end. The Framework Plan gives the cause: Phase 2 is named "Connecting Dearborn and Southwest" and Phase 4 "Connecting Southwest and Corktown." The connections are unbuilt.

The 2026-07-21 entry asserted the loop without reference to the dataset. Recorded here because the mistake is an easy one to repeat: every description of this project, including this document, calls the JLG a loop. Any rationale that depends on loop topology must state whether it means the designed greenway or the published data, and cite a topology check if it means the latter.

pgRouting is retained on the grounds above.

**In plain terms:** If the trail were one unbroken ring, simple arithmetic could work out distances and we would not need a routing engine at all. The finished greenway will be that ring. The trail as it exists today is not, because some connecting stretches have not been built yet. So we need the engine now, and we would have wanted it anyway, because the app also has to answer "do these two stretches join up," which arithmetic cannot do.

## 4\. Follow-on decisions (gap resolutions)

### 4.1 Place search and address geocoding (FR-01)

**Decision: Phase 1 uses the app's own place search only; an external geocoder is deferred to a Phase 2 spike.** The standard pattern for map search is two tiers, and Phase 1 builds the first tier only.

**Phase 1, place search.** PostgreSQL full-text search with the pg\_trgm trigram extension gives fuzzy, typo-tolerant matching over the app's own entities (access points, POIs, landmarks, event spaces). These are the authoritative, high-value results and they already live in the database, so no external service is needed. This removes a moving part and a cost source from Phase 1\.

**Phase 2, external geocoder.** Resolving an arbitrary typed street address that is not one of the app's known places needs a geocoder. This is deferred to a scoped Phase 2 spike. The Phase 1 decision rests on the assumption that arbitrary typed-address entry is not required in Phase 1 (FR-01-OQ1); if Leona or the team confirms it is required, this decision reopens.

> ***In plain terms:*** *Searching the app's own list of places (trailheads, parks, restrooms) needs nothing from outside, so Phase 1 does exactly that. Only when someone types a street address the app has never heard of would an outside address-lookup service be needed, and that is a Phase 2 question.*

**Phase 2 provider options (reference for the spike).** Two options are carried for the team to finalize, **Geoapify** and **Stadia Maps**. Two project-specific facts frame the choice.

First, the tile-to-credit pricing of these providers **does not apply to this project**, because the base map is served from PMTiles on Cloudflare R2. No map tiles are consumed from either provider; only geocoding requests draw credits. To keep even that minimal, call the external geocoder only on final submit rather than per keystroke, since the app searches its own places first.

Second, the deciding factor is the ETL geocode-and-store step, because storing results is licensed differently by each provider.

|  | Geoapify | Stadia Maps |
| :---- | :---- | :---- |
| Free tier | About 3,000 credits per day (about 90,000 per month), no SLA | 2,500 credits per month |
| Cap style | Daily (resets each day; no rollover) | Monthly pool; hard-limits with HTTP 429 until the next month when exhausted |
| Credit cost per geocode | 1 credit per request; batch about 0.5 credit per address | 20 credits per forward or reverse geocode; 1 credit per autocomplete keystroke |
| Effective free geocodes per month | About 90,000 | About 125 (2,500 divided by 20\) |
| Store results (needed for ETL) | Yes on the free tier; permissive license | Requires a paid Standard or Professional plan |
| Free-tier eligibility | Open | Non-commercial or academic use only on the free tier |
| Paid entry | About 49 euros per month for 300,000 credits | From 20 US dollars per month |
| Notable extras | OSM-based, transparent credits | Privacy-first (no tracking, 30-day log retention), MapLibre founding member, also offers Valhalla routing |

For the live typed-address lookup, either works and the volume is trivial. For the ETL step, Geoapify stores results on its free tier while Stadia needs a paid plan to store. Geoapify's free geocoding volume is also far larger, though the actual need is small.

**Open items:** confirm whether the project qualifies for Stadia's non-commercial or academic free tier before relying on it, and re-confirm all credit figures at sign-off, since pricing drifts.

### 4.2 Timezone-aware evaluator (FR-11, REL-01)

**Decision: date-fns-tz.** It is function-based and tree-shakeable, keeping the client bundle small (supporting NFR-PRF-01), and it works identically in Node if the OPEN NOW status is computed server-side. One shared evaluator serves restrooms (FR-11), play areas (FR-12), and events (FR-14b). The built-in Temporal API is the emerging standard but still needs a large polyfill in 2026, so it is noted as a future migration rather than the current pick.

### 4.3 Transport security (SEC-03)

**Decision: Nginx reverse proxy on the origin, plus Cloudflare proxied in front for edge protection.** Nginx terminates TLS to Express and is the industry-standard reverse proxy, recommended by the technical reviewer over the alternatives; certificates are automated with an ACME client (for example Certbot). Caddy was considered for its built-in automatic certificate management but set aside in favor of Nginx as the more widely adopted standard. Cloudflare provides managed edge TLS, DDoS protection, a firewall, and hides the origin address. Because Cloudflare only helps if it cannot be bypassed, the origin is locked so it accepts inbound traffic only from Cloudflare (via a firewall allowlist, Authenticated Origin Pulls, or a Cloudflare Tunnel), and Cloudflare SSL is set to Full (strict). Admin authentication is handled by Firebase Auth, so the origin stores no passwords; it verifies the Firebase-issued JWT on each admin request, and logs exclude tokens and precise location.

> ***In plain terms:*** *Cloudflare is the guarded lobby at the street entrance; Nginx is the locked door to your actual office inside. Two checkpoints. But a guarded lobby is pointless if the back window is open, so the origin is also locked to accept visitors only from Cloudflare.*

### 4.4 Accessibility (USA-01)

**Decision: the team will build the accessibility features on MapLibre.** MapLibre meets most WCAG 2.2 AA criteria by default but not full keyboard operability and change-on-request, so the team will add keyboard handling, ARIA labeling, focus management, the color-plus-pattern encoding for segment status and type (FR-05, FR-06), and contrast that meets AA. The near-me list views are treated as the guaranteed accessible path, so keyboard and screen-reader users can complete every task without depending on visual map interaction. Accessibility is built in from the start and tested continuously with an automated tool plus manual keyboard and screen-reader passes, not retrofitted at the end.

### 4.5 Data ingestion pipeline (REL-04)

**Decision: add an ETL pipeline to the stack.** Node scripts plus a scheduler (for example cron) pull records from a source, normalize them, geocode addresses where needed, remove duplicates, link each record to its nearest access point with a stored walking distance, and stamp each with a source and a last-verified date. The pipeline re-runs on a defined cadence (monthly) so mirrored data stays current and its freshness is transparent.

### 4.6 Availability checklist (AVL-01)

AVL-01 is a compound requirement, so all four items are required together, not alternatives:

1. **Origin host.** Express and PostgreSQL with PostGIS run on a self-hosted Linux host or VM, packaged with Docker Compose.  
2. **Monitoring.** An uptime monitor with alerting is in place.  
3. **Recovery.** Automated database backups plus a tested restore procedure.  
4. **Interpretation record.** "Self-hosted" here means the dynamic origin and the data are self-hosted while static public assets ride Cloudflare's CDN; this reading is recorded for sign-off.

### 4.7 Dependency-outage posture (AVL-02)

The core of AVL-02 is already satisfied by the static and dynamic split: if the database or event store fails, the static map still loads from the CDN, and the FR-03 directions handoff falls back to a web map. For the one remaining external dependency, Cloudflare, the recorded posture is **accept and document**, with the full failure-point map in Section 6\. This is defensible because the frontend (Pages) and tiles (R2) already commit the project to Cloudflare, so routing the API through it does not add a new point of failure; it makes the existing one explicit.

### 4.8 Trail geometry and segment data source (FR-05, FR-06, FR-15, FR-16)

**Decision: the authoritative source for the trail centerline and segment attributes is the City of Detroit Open Data "Joe Louis Greenway Route Segments" layer, pulled into PostGIS by the ETL as a source, not called at runtime.**

The layer is a segmented line representation of the route (item id 432cf397a7814cd583ace8aff386d482), backed by the Joe\_Louis\_Greenway\_Routes feature service in the City's ArcGIS organization (services2.arcgis.com/qvkbeam7Wirps6zC). Each segment carries a development phase (open, under construction, funded, unfunded) and a type (for example off-street or on-street).

Why this matters beyond geometry: the phase attribute is the source for segment status (FR-05) and the type attribute is the source for segment type (FR-06), which supplies the data half of the FR-05-OQ1 blocker. The operational, testable definition of "open" remains a decision for Leona or the JLG authority, so FR-05-OQ1 is partially, not fully, cleared. The same line is the centerline that the corridor buffer (Section 4.9) and any linear-referencing distance work depend on.


**Nullability decision (B-O3): keep segment phase/status and type nullable; do not add an "unknown" vocabulary row.** A null value means the authoritative source does not provide a known classification. "Unknown" is not itself a real segment status or type, so adding it to the controlled vocabulary would conflate missing information with an actual classification. The ETL therefore preserves null when the source value is absent or unmapped, and API clients must handle `phase: null` and/or `type: null`. Removing null later would be a breaking API-contract change and would require an explicit ADR amendment together with the corresponding database, OpenAPI, and generated-type changes.

Access pattern: the ETL bulk-downloads the layer as GeoJSON into PostGIS on the monthly cadence (NFR-REL-04). It is a source for the ETL, not a live runtime dependency, so it adds no new runtime point of failure; the app always serves from its own PostGIS copy.

Provenance and currency: the dataset is described as an approximate route, and the City's live interactive map is built on the same service, so before the source is treated as final the team cross-checks the downloaded geometry against that interactive map and records the source service URL, the item id, the snapshot date, and the feature count.

> ***In plain terms:*** *The shape of the trail already exists as an official City of Detroit dataset, so the team does not draw it. The team copies it into its own database on a schedule and serves from that copy, which keeps the app fast and independent of the City's servers at run time. The same dataset also tells the app which segments are open and what type each segment is.*

### 4.9 Corridor buffer method (FR-15, FR-16)

**Decision: Phase 1 uses a straight-line half-mile buffer around the trail centerline, verified once in QGIS and then automated in PostGIS. The network-walkshed method (for example ParkServe) is recorded as a deliberately deferred alternative.**

Leona confirmed a half-mile buffer on each side of the greenway, and the JLG Framework Plan uses the same half-mile corridor. The requirement is a distance threshold, not a walk-time or equity-grade measure, so a straight-line buffer answers exactly what FR-15 and FR-16 ask. A network-walkshed method answers a higher-stakes question (it drives national park-equity funding), needs a full walkable street network dataset plus real routing analysis, and would front-load work the requirement does not call for. Starting simple is not a fork: both methods answer the same "is this place near the trail" question from the same place and trail-geometry data, so a later upgrade swaps the distance calculation for a given place, not the schema or the ETL.

Method (rehearsed in QGIS, then run in PostGIS): (1) take the dissolved, geometry-fixed centerline from Section 4.8; (2) reproject it onto a projected coordinate system whose units are real distance (see the note below); (3) build the corridor with a half-mile buffer of the line (ST\_Buffer); (4) keep the places inside the corridor (ST\_DWithin); (5) store each kept place's shortest straight-line distance to the trail, and store its distance to the nearest access point as a separate value. A GiST spatial index supports steps 3 and 4 at the performance the NFRs require. The distance to the access point is a straight-line proxy, not a routed walking distance, which is acceptable for the Phase 1 MVP.

Two values are kept separate: geometric distance to the trail (for corridor inclusion) and user-facing distance to the nearest access point are different questions and are stored as separate relationships, because a place can be close to the trail but farther from a legal entrance.

**Coordinate system pinned: EPSG:26917 (UTM zone 17N, NAD83, meters).** Closes Section 10 open item 6.

The schema already commits to this pick, not merely a plan to. `core.route_segment.geom_proj`, `core.access_point.geom_proj`, `core.parking.geom_proj`, `core.point_of_interest.geom_proj`, and both `routing.segment_edge.geom` and `routing.segment_vertex.geom` are all typed `geometry(*, 26917)`, and the `core.set_geom_proj()` trigger (migration 0005) transforms every incoming geometry with `ST\_Transform(NEW.geom, 26917)` on insert. Every distance constant written against that schema is already in meters, not feet: the half-mile buffer distance is stored as 804.672 (migration 0011, recorded there as "the exact metre conversion of Leona's half-mile"), and the routing topology tolerances -- 0.5 m contact and join distance, a 2.0 m review band, a 10.0 m detection radius (migration 0012), and the 30.000 m on-greenway tolerance (migration 0011, G4-OQ2) -- are all authored and documented in meters.

EPSG:2253 (Michigan South State Plane) was the other candidate and remains a legitimate choice in the abstract for Michigan GIS work generally. It is set aside here specifically because its native unit is US survey feet: adopting it now would mean converting every constant above, or silently storing feet values under meter-named columns and meter-labeled comments, which is a worse outcome than the schema being wrong outright. UTM 17N also sits centrally over the Detroit area, keeping distortion low without a state-plane unit mismatch. No migration follows from this decision; it formalizes what migrations 0003, 0005, 0008, 0011, and 0012 already built.

> ***In plain terms (pinning the coordinate system):*** *Latitude and longitude are measured in degrees, and a degree is not a fixed number of feet everywhere, so half a mile cannot be measured reliably in degrees. Before buffering, the line is placed on a flat local grid whose units are real feet or meters, and everyone uses the same grid so the buffer comes out identical no matter who runs it. For Detroit the two sensible choices were EPSG:2253 (Michigan South, US feet) or EPSG:26917 (UTM zone 17N, meters). The project pins EPSG:26917, meters, because that is what the database, the tolerances, and the buffer distance already use -- picking feet now would mean converting numbers that are already correct.*

### 4.10 Off-trail preview and navigation handoff (FR-03, FR-04)

**Decision: Phase 1 hands off off-trail navigation with a native-map deep link, plus an optional lightweight in-app pin preview. A routed in-app preview is deferred to Phase 2, where two options are documented for the spike owner.**

Phase 1 (chosen): the app opens the user's native maps app with a deep link for turn-by-turn directions to a parking lot or off-trail destination (FR-03-OQ1). This is near-zero maintenance and needs no off-trail geometry, which suits handoff to greenway staff.

Optional Phase 1 addition: a lightweight in-app pin preview. When the user selects an off-trail destination, the app drops a pin on its own MapLibre map, shows the stored straight-line distance, and still offers the deep link. It stays entirely in-app, needs no new data, and softens the risk that a user who leaves for an external map never returns.

Phase 2 (documented for the spike owner): a routed in-app preview that draws the off-trail path. Two options: the Google Maps Embed API, an iframe-embedded map (the way a video embeds on a slide) whose directions mode can show a route inside the frame, free with unlimited usage but requiring an API key and a billing account on file, and being a separate Google-branded map not integrated with the app's MapLibre map; or Valhalla, a self-hosted engine that would draw the route inside the app's own MapLibre map with full control, at the cost of operating a separate server and solving the two-engine seam with pgRouting (Section 5). The preview reuses MapLibre GL JS; Leaflet or Mapbox suggested during review are not adopted, to avoid a second map library.

> ***In plain terms:*** *Phase 1 keeps navigation simple: tap a button, the phone's normal maps app opens with directions. Optionally the app first shows a pin and a distance on its own map so the user sees where they are headed before leaving. Drawing the actual off-trail route inside the app is a Phase 2 choice between a free Google embed and a self-hosted engine.*

### 4.11 Confirmed scope: restroom status, admin surface, and stakeholder confirmations (FR-11, FR-14b, FR-15, FR-16)

**Confirmed by the stakeholder (Leona).** The half-mile corridor buffer on each side of the greenway is confirmed (applied in Section 4.9). Live event publication is confirmed as a requirement, served by the events admin surface (FR-14b); a possible future event feed that could reduce manual authoring is tracked in Section 10\.

**Restroom OPEN NOW status (FR-11).** The proposed admin dashboard for editing restroom hours is dropped. Hours will be sourced from the Google API, deferred until that data is accessible; until then the default status is "hours unknown", which is the correct reliability posture, since a facility is never shown as open on a guess. Mirrored records carry a source, a last-verified timestamp, and a confidence level, so the app can distinguish missing data from unverified data and stay correct as data quality improves.

**Admin surface scope.** With restroom hours no longer admin-edited, the authenticated admin surface (Firebase Auth, Section 4.3) covers event authoring (FR-14b), trail segment status authoring (FR-05b), topology flag review (FR-08d, Phase 2), and admin account management (FR-14c). Scope widened on 2026-07-29 from event authoring only.

> ***In plain terms:*** *The app will not ask a person to type in restroom hours by hand. When Google's data is available it will fill those in; until then a restroom simply shows "hours unknown" rather than guessing it is open. Every piece of borrowed data also records where it came from and when it was last checked, so the team can trust it. Admins log in to manage events, trail status, and topology review notes; the owner also manages who has access.*

## 5\. Routing scope and the Valhalla spike

Phase 1 routing (FR-08a) is greenway-only, on owned geometry, and is served by pgRouting; off-trail and mode-aware routing are deferred to Phase 2 by the FRD.

pgRouting is retained rather than a simpler linear-referencing scheme because the JLG is not a single closed loop: the published dataset resolves into two connected components, and the trail has street connectors and links to adjacent trails (for example the Dequindre Cut and the Riverwalk). Clockwise-versus-counter-clockwise linear referencing breaks down as soon as the geometry branches. Linear referencing was considered and recorded as insufficient for this reason. The confirmation this section previously committed to has been performed: topology analysis of the published Route Segments dataset on 2026-08-01 found two components (41.7 km and 7.6 km), four dead ends, junctions, and four mid-line meeting points. The rationale is now grounded in the actual geometry rather than anticipating it.

The team is considering a timeboxed spike into Valhalla for off-trail routing (parking and access points),keeping pgRouting for on-trail routing, where the open-segment gate is enforced and where pathfinding across a multi-component network with junctions and spurs is required. The spike should test the seam between the two engines, whether pgRouting's status-gating is genuinely needed versus Valhalla costing, and Valhalla's operational cost, then compare against single-engine baselines before committing. Valhalla, if adopted, is a separate self-hosted server and belongs to Phase 2\. The off-trail preview options in Section 4.10 (Google Maps Embed API versus Valhalla) are part of what the spike owner evaluates.

## 6\. Points of failure across the stack (AVL-02)

Each row is a component, what happens if it fails, the user impact, and the mitigation. This is the documented availability posture.

| Component | If it fails | User impact | Mitigation |
| :---- | :---- | :---- | :---- |
| Cloudflare Pages (frontend host) | App UI unreachable | Total outage of the app shell | Accepted dependency; Cloudflare is highly reliable; static assets could be self-hosted as a fallback if ever required |
| Cloudflare R2 (tiles) | Base map tiles do not load | Overlays draw on a blank background; map is degraded but data still visible | Edge caching serves repeat tiles; accepted dependency |
| Cloudflare edge or proxy (in front of API) | API unreachable through the edge | Dynamic features (events, server near-me) unavailable | Accepted dependency; origin locked to Cloudflare by design |
| Nginx reverse proxy (origin) | API not served from the origin | Dynamic features down; static map still served by Cloudflare | Process monitoring and auto-restart |
| Node and Express (API) | Dynamic endpoints fail | Events and server-side queries fail; static map and tiles still load; client-side Turf.js distance still works | Monitoring and restart; stateless tier so a second instance can run |
| PostgreSQL with PostGIS (database) | Data-backed queries fail | POIs, routing, and events unavailable; base map still loads | Backups and tested restore; this is the stateful anchor to protect |
| Event store (authored content in the database) | Event data unavailable or empty | Venues still display, without event indicators | Built-in graceful degradation (NFR-AVL-02 shall-1, NFR-REL-03) |
| Firebase Auth (owner and admin login) | No admin can sign in | Event authoring, trail status updates, and account management all paused. Public read features unaffected (no login required), but a status change that cannot be published leaves the routing gate serving stale segment status, which NFR-REL-02 identifies as the highest-consequence write path | Accepted external dependency on an admin-only surface; already-authored content remains served; multiple admin accounts reduce single-account lockout risk (FR-14c) |
| External geocoder (Phase 2; Geoapify or Stadia) | Typed-address lookup fails | Own place-search and device-location origin still work | Graceful degradation (NFR-REL-03); Phase 1 has no external geocoder, so typed-address lookup is a Phase 2 feature |
| Browser Geolocation (device) | No live position | Static browsing and typed-address origin still work | FR-01 and FR-07 exceptions already specify fallbacks |
| Valhalla (if added in Phase 2\) | Off-trail routing fails | On-trail routing (pgRouting) still works | Separate server, monitored; Phase 2 only |

> ***In plain terms:*** *The most important line to read here is that if the database goes down, the map still shows. The design fails in pieces, not all at once. The one thing that would take everything down is Cloudflare itself, which the project has chosen to accept and watch, because the app already depends on Cloudflare for the frontend and tiles.*

## 7\. Hosting philosophy

Static-first hybrid: managed edge for stable public assets (React app on Cloudflare Pages, PMTiles base map on R2), self-hosted origin for dynamic data and the database (Express and PostGIS behind Nginx). The governing rule for any future feature is one question: does this data change often? If not, it belongs on the edge; if so, it belongs on the self-hosted origin.

## 8\. Consequences

**Positive.** Strong scalability and low cost for a read-heavy public map (static assets from the CDN with zero egress); the map survives a backend outage; live GPS stays on the client via Turf.js; the backend and data remain self-hosted per NFR-AVL-01; and place search runs in the existing database at no added cost, with any future external geocoder minimized because tiles are self-hosted.

**Negative.** MapLibre requires the team to build the keyboard and screen-reader accessibility that a hard requirement (NFR-USA-01) demands. Cloudflare is a single external dependency for the whole app, accepted and documented. The stack has several moving parts (Cloudflare Pages, R2, Nginx, Express, PostGIS, Firebase Auth, an ETL scheduler) for a three-person team to operate. Firebase Auth is a managed external dependency accepted deliberately for the single admin surface, a divergence from the otherwise self-hosted design.

**Neutral.** PostGIS, pgRouting, and Turf.js are common to any viable option; on-trail routing is custom regardless of stack.

## 9\. Traceability

| Decision element | Traces to |
| :---- | :---- |
| MapLibre plus PMTiles plus R2 plus Pages | NFR-PRF-01, NFR-PRF-05; FR-05, FR-06 (data-driven styling) |
| Accessibility built on MapLibre | NFR-USA-01 |
| PostgreSQL with PostGIS and spatial indexes | NFR-PRF-03; FRD spatial patterns |
| pgRouting; Valhalla spike deferred | FR-08a; FR-01-OQ2 and FR-03-OQ1 (off-trail deferred to Phase 2\) |
| Turf.js client-side distance | FR-07 shall-5; NFR-PRF-02; NFR-PRV-01 |
| Place search with pg\_trgm (Phase 1); external geocoder deferred to Phase 2 | FR-01 shall-3; FR-01-OQ1 (typed address) |
| date-fns-tz evaluator | FR-11, FR-12, FR-14b; NFR-REL-01 |
| Nginx plus Cloudflare; origin lockdown | NFR-SEC-03 |
| Firebase Auth (admin only); stateless JWT | NFR-SEC-01; NFR-PRF-05 |
| ETL pipeline | Shared pattern 4.6; NFR-REL-04 |
| Self-hosted origin, monitoring, backups | NFR-AVL-01 |
| Failure-point map; accept-and-document Cloudflare | NFR-AVL-02; NFR-REL-03 |
| Static-first hosting philosophy | NFR-PRF-05; NFR-AVL-01 |
| Trail geometry and segment source (Route Segments dataset) | FR-05, FR-06, FR-15, FR-16; FR-05-OQ1 (partial); NFR-REL-04 |
| Straight-line corridor buffer (QGIS then PostGIS) | FR-15, FR-16; NFR-PRF-03 |
| Deep-link handoff plus lightweight pin preview; routed preview deferred | FR-03, FR-04; FR-03-OQ1 |
| pgRouting retained (multi-component network, confirmed by topology analysis 2026-08-01); linear referencing insufficient | FR-08a |
| Restroom OPEN NOW: Google API source (deferred); default hours-unknown; source, last-verified, and confidence metadata | FR-11; FR-11-OQ1; NFR-REL-01 |
| Admin surface scoped to events; live publication confirmed | FR-14b; NFR-SEC-01 |
| Stakeholder data-sourcing requests (partnerships, restroom hours, play areas, event feed) | FR-11, FR-12, FR-14b |
| Bidirectional traversal; no one-way mechanism in Phase 1 | FR-08a shall-10, shall-11; FRD Section 4.9 |
| Topology change detection at each rebuild | FR-08c; NFR-REL-02, NFR-REL-04 |
| Network construction: noding, endpoint tolerance, gap flagging | FR-08e; FR-08a |
| Topology flag review workflow deferred to Phase 2 | FR-08d |
| Owner plus multiple admin accounts; in-app account management | FR-14c; NFR-SEC-01 |

## 10\. Open items to ratify

1. The Phase 2 external-geocoder spike and selection between Geoapify and Stadia, including confirming Stadia's non-commercial or academic eligibility and re-confirming pricing. Phase 1 uses pg\_trgm place-search only, on the assumption (to confirm with Leona or the team) that arbitrary typed-address entry is not required in Phase 1 (FR-01-OQ1).  
2. The Valhalla spike outcome (two-engine seam versus single-engine baselines) before any Phase 2 routing commitment.  
3. The still-unratified NFR targets: NFR-AVL-01 uptime, NFR-PRF-01 device and network profile, and NFR-PRF-05 data and concurrency multipliers.  
4. The remaining data questions, reconciled against the new source decisions. FR-05-OQ1 is partly resolved: the segment-status source is the Route Segments dataset (Section 4.8), but the operational, testable definition of "open" still needs Leona or the JLG authority. FR-06-OQ1 (segment type) is resolved by the same dataset. FR-11-OQ1 (restroom hours) has a chosen source, the Google API, deferred until accessible (Section 4.11). Still unconfirmed: the sources behind FR-16-OQ1 (food venues) and FR-02-OQ1.  
5. Author, reviewer, and decider names, and reconciliation of the architecture and backend role assignments.  
6. ~~The buffer coordinate system to pin, EPSG:2253 (Michigan South, US feet) or EPSG:26917 (UTM zone 17N, meters), for whoever runs QGIS.~~ **Closed 2026-08-21: pinned to EPSG:26917 (UTM zone 17N, meters), matching what the schema and every distance constant already use. See Section 4.9.**  
7. Stakeholder data-sourcing requests awaiting Leona (email drafted, to be sent once the prior thread is resolved). The team is asking her to confirm existing relationships with, and to introduce the team to, the City of Detroit (General Services and GIS / Open Data), the Detroit Riverfront Conservancy (for the Dequindre Cut and Riverwalk portions), and the cities of Dearborn, Hamtramck, and Highland Park. The request names three specific needs: an authoritative source for restroom locations and open hours (would supplement or replace the deferred Google API path, FR-11); play-area data on the greenway, still missing (FR-12); and access to whatever powers the JLG website's event list, which if available would let the events admin surface become a fallback and partly revisit the FR-14b manual-authoring decision. The aim is to secure authoritative, reliable sources early for accuracy and maintainability as the app scales.

## 11\. Sources

Pricing, licensing, and capability claims were verified against current vendor and independent sources during 2026-07: Geoapify and Stadia Maps pricing and terms (including result-storage and free-tier eligibility); Cloudflare R2 and Pages terms; the OpenStreetMap tile and Nominatim usage policies; a 2025 peer-reviewed evaluation of web-map library accessibility; and Cloudflare documentation on Full (strict) SSL and origin protection. Pricing is volatile and should be re-confirmed at ratification.

## 12\. Change log

| Date | Change |
| :---- | :---- |
| 2026-07-14 | ADR-001 drafted, proposing a Leaflet plus MapTiler stack ("Stack C"). |
| 2026-07-16 | Superseded that proposal with the team-agreed static-first stack (MapLibre, PMTiles, Cloudflare R2 and Pages, Node and Express, pgRouting, Geoapify or Stadia geocoding). Reason: the team adopted the static-first CDN architecture for scalability and cost; MapLibre chosen as the PMTiles-native renderer, accepting that accessibility must be built (Section 4.4). Added follow-on decisions: date-fns-tz (4.2), Caddy plus Cloudflare with origin lockdown (4.3), accessibility commitment (4.4), ETL pipeline (4.5), the AVL-01 checklist (4.6), and the AVL-02 accept-and-document posture with a full failure-point map (Section 6). |
| 2026-07-21 | Pass 1 of the post-review update. Admin login changed from a self-built session login to Firebase Auth (single external admin with no Wayne State account; Wayne State Entra ID ruled out; stateless JWT for scalability; recorded as a conscious divergence from the no-managed-service philosophy). Reverse proxy switched from Caddy to Nginx per the technical reviewer's industry-standard recommendation, with Caddy documented as previously considered. Phase 1 place search set to PostgreSQL pg\_trgm over the app's own data, with the external geocoder deferred to a Phase 2 spike. Consistency updates applied across the stack table, Section 4.3, the failure-point map, hosting philosophy, consequences, and traceability. |
| 2026-07-21 | Pass 2 of the post-review update. Rewrote Section 4.1 to the two-tier place-search model (pg\_trgm in Phase 1, external geocoder deferred). Added Section 4.8 (Route Segments dataset as the trail geometry and segment-status source, ETL-sourced not runtime), Section 4.9 (straight-line half-mile buffer method with the coordinate-system explanation and ParkServe recorded as a deferred alternative), and Section 4.10 (deep-link handoff plus optional lightweight pin preview, with Google Maps Embed API and Valhalla documented for the Phase 2 spike). Refined Section 5 with the pgRouting branched-network rationale. Added traceability rows for the new decisions. |
| 2026-07-21 | Pass 3 of the post-review update. Added Section 4.11 (stakeholder confirmations of the half-mile buffer and live event publication; FR-11 admin dashboard for hours dropped; OPEN NOW hours from the Google API, deferred; default hours-unknown; source, last-verified, and confidence metadata on mirrored records; admin surface scoped to events only). Reconciled the Section 10 data-question item against the source decisions (FR-05-OQ1 partly resolved, FR-06-OQ1 resolved, FR-11-OQ1 deferred). Added open items for the buffer-CRS pin and the outstanding stakeholder data-sourcing requests awaiting Leona (partnerships, restroom hours, play-area data, and a possible event feed). Added traceability rows for FR-11, FR-14b, and the stakeholder requests. |
| 2026-07-30 | Auth model widened from a single external admin to an owner role plus multiple admin accounts, following FR-08d-OQ2 and the decision to bring account management in-app in Phase 1\. Admin surface scope widened from event authoring to event authoring, trail status authoring, topology flag review, and account management. Failure analysis for the admin login corrected accordingly. Sections 3, 4.11, 8, 11\. |
| 2026-08-21 | Section 4.9 buffer coordinate system pinned: EPSG:26917 (UTM zone 17N, meters), closing Section 10 open item 6 (lane 3 spike, L3.1). Formalizes rather than changes the implementation: migrations 0003, 0005, 0008, 0011, and 0012 already type every projected geometry column as 26917 and already record every tolerance and the half-mile buffer distance in meters. EPSG:2253 (Michigan South, US feet) was set aside as the alternative because adopting it now would require converting those already-correct meter values. No schema change required. |
| 2026-08-01 | Section 4.0 corrected. The closed-loop premise recorded on 2026-07-21 described the designed greenway rather than the published dataset, and is retired on evidence; the branched-network rationale it had superseded is reinstated and grounded in topology analysis of the Route Segments dataset. Section 5's outstanding commitment to confirm the branch structure once the geometry was loaded has been discharged, and its finding recorded. pgRouting version pinned and the 3.8.0 Topology-family deprecations noted. Traceability extended to FR-08c, FR-08d, FR-08e, FR-14c and FRD Section 4.9. |

### **11\. Next steps**

These follow from the decisions above and the open items in Section 10\. Several can run in parallel once the trail geometry is loaded.

**Immediate, on the critical path.**

* Pull the Route Segments GeoJSON into PostGIS (bulk download, Section 4.8), run the currency cross-check against the City's live interactive map, and confirm geometry type and attribute completeness on load. ~~Pin the buffer coordinate system (open item 6) while QGIS is open.~~ Closed 2026-08-21, EPSG:26917 -- see Section 4.9. This unblocks the buffer work (Section 4.9) and the data half of FR-05-OQ1.  
* Send the batched message to Leona, combining the data-sourcing and partnership requests (open item 7\) with the requirements clarifications below, so her input arrives in one round rather than piecemeal.

**Technical spikes, started up front and in parallel.** The technical review's strongest recommendation was to spike the hard, uncertain work before implementation, not during.

* Off-trail preview and routing: deep-link baseline versus Google Maps Embed API versus Valhalla (Section 4.10, Section 5).  
* Buffer pipeline: rehearse once in QGIS, then automate in PostGIS with ST\_Buffer and ST\_DWithin behind a GiST index (Section 4.9).  
* Optional: Firebase Auth plus the JWT flow for the admin surface (Section 4.3), to prove the auth path before build.

**SDLC continuation, not blocked by this ADR.**

* Move from stable functional requirements into use case identification and prioritization, then fully-dressed use case descriptions, the domain glossary, and the UML set (use case, class, sequence). Wireframes and mockups follow the UML.

**Before build, so build is not blocked later.**

* Name the machinery this ADR does not yet cover: the PMTiles build pipeline, the testing stack, CI/CD, and database connection pooling. This is a candidate for a separate ADR-002 rather than further growth of ADR-001.  
* Stand up version control with a branching workflow, and establish the regression-testing habit now. Both were flagged in the review as decisive for AI-assisted builds.

**Route to Leona (batched), open questions not to be resolved by assumption.**

* The operational, testable definition of "open" for segment status (the remaining half of FR-05-OQ1).  
* Confirmation that arbitrary typed-address entry is not required in Phase 1 (the assumption under the place-search decision, open item 1).  
* The data-sourcing and partnership requests in open item 7: restroom hours, play-area data, a possible event feed, and introductions to the City of Detroit, the Detroit Riverfront Conservancy, and the cities of Dearborn, Hamtramck, and Highland Park.

**Documentation hygiene.**

* Reconcile the FRD with this ADR wherever decisions changed (FR-11 admin dashboard dropped, the buffer and live-event confirmations, and the routing rationale), so the two artifacts do not drift.

