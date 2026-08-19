# Stage B2 scaffold — TypeScript toolchain for the API contract

Drop these into `jlgmapapp-backend/`, preserving paths.

    tsconfig.json
    package.json                                (replaces the existing 6-line one)
    .gitignore
    scripts/check-api-types-fresh.mjs
    src/types/segments.ts
    src/utils/problem.ts
    .github/workflows/api-contract.yml

`src/types/api.d.ts` is NOT included — generate it, don't copy it:

    npm install
    npm run gen:api
    git add src/types/api.d.ts

Then confirm everything works:

    npm run verify

Expected output: spec lints (1 warning — missing licence), types report in sync,
typecheck passes. Exit code 0.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run lint:api` | Validates the OpenAPI spec |
| `npm run gen:api` | Regenerates `src/types/api.d.ts` from the spec |
| `npm run gen:api:check` | Fails if the committed types are stale (CI gate) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | All of the above, in order |

## Requires

`redocly.yaml` at the repo root. Both `lint:api` and `gen:api` read it for the
spec path and the codegen output path.
