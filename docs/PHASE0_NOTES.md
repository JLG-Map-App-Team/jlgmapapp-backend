# Phase 0 — Stage C wiring: what changed, and what it does to Stage C

**Date:** 2026-08-21
**Scope:** make the Stage C claims true as written. No new capability.
**Lane 2 owners:** Maha, Asmita
**Reviewer / approvals:** Asim

---

## 1. Does Stage C reopen?

**No. No Stage C task reopens.** My earlier step 0.6 said C4, C5 and C6 should
reopen. That was wrong, and the objection to it is correct: reopening a task in
order to close it again in the same change is bookkeeping churn, not
traceability. What the record needs is a **correction note on a closed cell**,
which preserves the audit trail without pretending the work is undone.

The team already set this precedent. Task C3 was amended in place — from
"roughly 20 route segments" to the full 51 — with a rationale paragraph and a
change-log entry, and it stayed Done. Same treatment here.

| Task | Status after this change | What the cell needs |
| :---- | :---- | :---- |
| C1 pinned Compose | **Done**, untouched | Nothing. `pgrouting/pgrouting:16-3.4-3.6.1` is pinned and correct. |
| C2 migrations up/down | **Done** | Wording narrowed, plus the script is now reachable. |
| C3 seed extract and seed step | **Done** | Its "the SEED STEP does not exist" note is superseded. One residual recorded. |
| C4 one real test on each side | **Done** | Correction note: the tests could not import until this change. |
| C5 CI stages before deploy | **Done** | Scope amended in writing: build and deploy return at D1 / Stage E. |
| C6 accessibility gate in CI | **Done** | Correction note: the gate could not import until this change. |

**Stage C's Definition of Done** — *"a teammate clones the repository, runs one
command, and has a working database with data"* — is now literally satisfied
rather than approximately. There was no single command; there is now
`npm run bootstrap`, which chains `db:up` → `migrate` → `etl:segments`. It
requires `cp .env.example .env` first, because `src/db/pool.js` refuses a default
connection string on purpose.

### The one thing that could legitimately reopen Stage C

`package-lock.json` does not appear in the repository dump I was given. If it is
genuinely not committed, `npm ci` fails at the first step, no CI run can ever be
green, and Stage C's DoD fails for real rather than on a technicality. Dumps of
this kind sometimes exclude lockfiles, so **this is unverified, not asserted.**
One command settles it:

```bash
git ls-files --error-unmatch package-lock.json
```

If that errors, commit the lockfile before merging this change. That is the only
finding in Phase 0 that is a genuine Stage C reopener, and it is a two-minute fix
rather than a scope question.

---

## 2. Files in this change

### Modified

| File | Change |
| :---- | :---- |
| `package.json` | Five scripts added (`test`, `test:contract`, `test:load`, `test:a11y`, `verify:migrations`, `bootstrap`); `db:up` gains `--wait`; `jsdom` and `axe-core` pinned as devDependencies. |
| `.github/workflows/api-contract.yml` | Every step name corrected to a script that exists; `DATABASE_URL` and `POSTGRES_PORT` set at job level; Compose project renamed to `jlgmapapp-ci`; build/package/deploy removed with the reason recorded inline; teardown added. |
| `scripts/seed-contract.test.mjs` | Rewritten against `seed/segments.response.fixture.geojson`, delegating validation to the existing `scripts/contract/response-validator.mjs`. |

### Added

| File | Purpose |
| :---- | :---- |
| `scripts/segments-load.test.mjs` | The database-side test, rewritten from the assertions in the old `scripts/seed.test.mjs` and pointed at the ETL load instead of the deleted seed file. |

### Deleted

```bash
git rm scripts/seed.mjs
git rm scripts/seed.test.mjs
git rm scripts/seed/build-segments-seed.mjs
```

All three read or write `seed/segments.seed.geojson`, which `seed/README.md`
records as deleted. Keeping them keeps a **second, wrongly-keyed load path**
alive: `scripts/seed.mjs` upserts `source_ref` from a `source_ref` property the
deleted generator filled from `OBJECTID`, while `scripts/etl/cityRouteSegments.js`
uses `OBJECT_ID`. `seed/README.md` records that twenty values exist in both key
spaces and all twenty refer to different segments — so that path would overwrite
twenty rows with another segment's geometry and name, with no error, no warning
and no change in row count.

`scripts/seed/build-segments-fixture.mjs` is **kept**. It is the live generator,
it is wired to `npm run fixture:build`, and its output is the subject of the
rewritten contract test.

---

## 3. Roadmap cell text, ready to paste

### C2 — Notes, append

> AMENDED 2026-08-21. What this task proves, precisely: `scripts/verify-migrations.mjs`
> splits each file on the `migrate:up` / `migrate:down` markers and pipes the SQL
> straight to `psql`. It proves the SQL is **reversible**. It does **not**
> exercise dbmate or `public.schema_migrations`, so it does not prove
> `npm run migrate` and `npm run migrate:rollback` work — that is a separate
> guarantee and is not claimed here.
>
> The script was unreachable: `README.md` documented `npm run verify:migrations`
> and `package.json` did not define it. Now defined. It is deliberately **not**
> in the PR job: it runs `docker compose down -v` on entry and exit, and its
> default project name `jlgmapapp-c2` was the same one the workflow used for the
> CI database. The workflow now uses `jlgmapapp-ci`. Never let those two names
> converge.

### C3 — Notes, replace the "STATUS" and "OPEN" paragraphs

> SUPERSEDED 2026-08-21. The note reading *"The SEED STEP does not exist —
> nothing in scripts/ or seed/ loads segments.seed.geojson"* is no longer true and
> was already contradicted by `seed/README.md`: `segments.seed.geojson` was
> deleted, and **the ETL importer is Stage C3's seed step.** The load path is
> `npm run bootstrap`, or `db:up` → `migrate` → `etl:segments`. A teammate now
> gets a working database with 51 segments in it.
>
> The three artefacts that still referenced the deleted file — `scripts/seed.mjs`,
> `scripts/seed.test.mjs`, `scripts/seed/build-segments-seed.mjs` — are removed,
> because they were a second load path keyed on `OBJECTID` where MAP-013
> specifies `OBJECT_ID`.
>
> RESIDUAL, recorded not resolved: `core.route_segment.source_snapshot_date` is
> still null for all 51 rows. `scripts/etl/cityRouteSegments.js` sets
> `source_snapshot_date` on `staging.etl_run` only, not in the `core.route_segment`
> upsert. The column exists (M03). This is a provenance gap, not a DoD gap — the
> run date is recoverable from `staging.etl_run` — and the query date for the
> committed export is still not recorded anywhere verifiable, so **do not guess
> it.** Fixing it means adding one column to the upsert, which is ETL scope and
> outside skeleton scope per plan section 2.1.

### C4 — Notes, append

> CORRECTION 2026-08-21. This task was marked Done on the strength of test files
> existing. None of the three could import, so there was no passing test on
> either side at the time it was closed:
>
> - `scripts/seed.test.mjs` imported `loadSeed` from `scripts/seed.mjs`, which read the deleted `seed/segments.seed.geojson`.
> - `scripts/seed-contract.test.mjs` imported `validateDocument` from that same dead module and read the deleted file directly.
> - `scripts/accessibility.test.mjs` imported `jsdom` and `axe-core`, neither of which was in `package.json`.
>
> A suite that errors on import is worse than a failing suite, because it can be
> mistaken for a suite with nothing to report.
>
> Closed as of this change with two real tests: `test:contract` validates the
> committed fixture against `components.schemas` compiled from the spec, and
> `test:load` asserts the post-ETL database state — 51 segments, `geom` in
> EPSG:4326, `geom_proj` in EPSG:26917, unique `source_ref`s, and an `etl_run`
> recorded as `succeeded` rather than topology-aborted.
>
> One observation is still outstanding and it is **already tracked** — the
> existing ACTION on task B2: confirm the workflow has run green on a real pull
> request. Do not open a duplicate item for it.

### C5 — Notes, append

> SCOPE AMENDED 2026-08-21, in the same manner as C3's 20→51 amendment. The task
> named `install → typecheck → lint → test → build → deploy`. Build and deploy
> are removed and the reason is recorded in the workflow itself: `src/` contains
> types, `utils/problem.ts`, `db/pool.js` and three `.gitkeep` placeholders —
> there is no Express entrypoint — and `tsconfig.json` is `--noEmit`, so `dist/`
> was never produced and the artefact step tarred nothing. A publish button in
> front of an empty directory is not a gate.
>
> C5's intent is fully met: install, typecheck, lint, contract, database and
> accessibility all now actually execute. Build returns at task D1, when there is
> an endpoint to build. Deployment stays at Stage E, which the workflow header
> already said.
>
> Also corrected here: every step invoked a script `package.json` does not
> define (`lint`, `db:migrate`, `seed`, `test`, `test:a11y`, `build`), and
> `DATABASE_URL` was never set, which `src/db/pool.js` requires and refuses to
> default.

### C6 — Notes, append

> CORRECTION 2026-08-21. The gate was wired into the workflow but could not run:
> `scripts/accessibility.test.mjs` imports `jsdom` and `axe-core` and neither was
> a declared dependency. Both are now pinned (`jsdom` 30.0.1, `axe-core` 4.13.0,
> versions taken from the npm registry on 2026-08-21). The intent stands
> unchanged — install the gate while it is free, not to make the harness
> accessible.

### Lane 2 — Owner column

> Maha, Asmita. Note that plan section 7 suggests one person for this lane;
> two are assigned. Update section 7 or record the deviation.

---

## 4. Verify before merging

Four checks, in order. Each is a command, not a judgement.

1. `git ls-files --error-unmatch package-lock.json` — see section 1. Blocks everything else.
2. `npm ci && npm run verify` — the pre-existing gate still passes.
3. `npm run bootstrap && npm test` — the DoD claim, on a clone that has never seen this project.
4. Open a pull request and confirm the workflow goes green. This is the B2 ACTION, and it is the only thing that converts "the gate is wired" into "the gate is a gate."

### Unresolved, and not resolved by inference

**The spec filename.** Roadmap task B1 records the name as *resolved to*
`openapi.yaml`. The repository still contains `openapi_B2.yaml`, and the name is
hardcoded in three places: `redocly.yaml`'s `root:`, `scripts/contract/response-validator.mjs`
(`const SPEC = 'openapi_B2.yaml'`), and a comment in the workflow. I have not
renamed anything, because I cannot tell from the repository whether the rename was
decided or only proposed. If it goes ahead, all three move together and
`npm run gen:api:check` must be re-run — B1 already notes that the recorded clean
lint run predates the rename.

---

## 5. Change-log entry for `docs/walking_skeleton_plan.md`

> | 2026-08-21 | Stage C wiring corrected ahead of Lane 2. Every CI step invoked an
> npm script that did not exist, and `DATABASE_URL` was never set, so the gate
> could not have run green; all three test files failed on import. Fixed by
> defining the missing scripts, pinning `jsdom` and `axe-core`, setting the
> connection string at job level, and renaming the CI Compose project to
> `jlgmapapp-ci` so it cannot collide with `verify-migrations.mjs`. Build and
> deploy removed from the CI job with the reason recorded inline; they return at
> D1 and Stage E respectively, amending task C5's wording in the same manner as
> C3's 20→51 amendment. The dead second seed path (`scripts/seed.mjs`,
> `scripts/seed.test.mjs`, `scripts/seed/build-segments-seed.mjs`) deleted; its
> database assertions preserved in a new `scripts/segments-load.test.mjs` pointed
> at the ETL load. `npm run bootstrap` added so Stage C's "one command" DoD is
> literal. No Stage C task reopened. Lane 2 assigned to Maha and Asmita, a
> deviation from section 7's one-person suggestion. |
