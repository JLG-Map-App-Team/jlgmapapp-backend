# jlgmapapp-backend
Joe Louis Greenway Map Application- Backend 

(This Read Me File is subject to change!!)

# JLG Map App — Backend 

API and database services for the **Joe Louis Greenway Map App** — supports the frontend

## What it does
- Serves route, access point, and points-of-interest (POI) data from PostGIS
- Handles on-trail routing (pgRouting)
- Handles place search (Postgres `pg_trgm`)
- Computes OPEN NOW status from stored hours (no stored true/false flag)
- Admin-only endpoints for events and trail status (Firebase Auth)
- Runs a scheduled ETL job to pull and clean source data

## Design Principles
- Privacy-first: live location stays on the device; this server never stores user coordinates.
- Self-hosted origin behind Nginx + Cloudflare.
- If this API goes down, the static map/tiles still load on the frontend.

## Tech Stack
- **Language:** TypeScript
- **Backend:** Node.js + Express (self-hosted), behind Nginx + Cloudflare
- **Database:** PostgreSQL + PostGIS; pgRouting; pg_trgm
- **Admin auth:** Firebase Auth (staff only — events, trail status)
- **Containers:** Docker Compose

## Getting started
**Prerequisites**
- Node.js `[version — confirm]`
- `[npm/pnpm — confirm]`
- PostgreSQL with PostGIS, pgRouting, pg_trgm extensions

**Clone**
```bash
git clone [backend repo URL — confirm]
cd [repo folder name — confirm]
```

## Team
- Maha — Project Lead Software Engineer
- Asmita — Cybersecurity Intern
- Rachael — Cybersecurity Intern
- Lawrence — Frontend Developer
- Musammat — Software Tester
- Asim — Reviewer/Approvals
