// Validation: the ETL translation layer may only produce codes the migrations
// define. The migrations are the source of truth for vocabulary; the Master
// Data Collection is raw input, and scripts/data-validation/code_translations.csv
// is the only place raw values become database codes.
//
//   raw source / Master Data value -> code_translations.csv -> core.<lookup>.code
//
// Added after the Master Data workbook's translation sheet drifted from the
// migrations (off_street, major, merged_needs_review ... none of which exist)
// and nothing failed until a load would have hit the foreign keys.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import pg from 'pg'

const { Client } = pg
// DATABASE_URL first, matching src/db/pool.ts and the CI workflow.
const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
      database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
      user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
      password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
    }

const CSV_PATH = resolve(import.meta.dirname, 'data-validation/code_translations.csv')

// Directives, not codes: [NULL] writes null, [QUARANTINE] stops the record,
// [INHERIT] translates an embedded value with the same domain's rules.
const DIRECTIVE = /^\[[A-Z]+\]$/

// Every code in these tables must be produced by some translation, because the
// source is known to use all of them. Other tables may hold codes no current
// source produces (e.g. coordinate_confidence 'exact', coordinate_method 'surveyed').
const MUST_BE_REACHABLE = new Set(['core.segment_status', 'core.segment_type', 'core.access_point_subtype'])

// RFC 4180 subset: quoted fields may contain commas and doubled quotes.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function readTranslations() {
  const [header, ...rows] = parseCsv(readFileSync(CSV_PATH, 'utf8'))
  assert.deepEqual(header.slice(0, 4), ['Domain', 'Source value', 'Normalized code', 'Lookup table'])
  return rows.map(([domain, source, code, table]) => ({ domain, source, code, table }))
}

test('translation rows are well formed', () => {
  for (const { domain, source, code, table } of readTranslations()) {
    const where = `${domain} / ${source}`
    assert.ok(domain && source && code, `${where}: domain, source value and code are required`)
    if (table) {
      assert.match(table, /^core\.[a-z_]+$/, `${where}: lookup table must be core.<name>`)
      assert.doesNotMatch(code, DIRECTIVE, `${where}: a directive cannot target a lookup table`)
    }
  }
})

test('every translated code exists in the vocabulary the migrations seed', async () => {
  const translations = readTranslations().filter((row) => row.table)
  const tables = [...new Set(translations.map((row) => row.table))]
  const client = new Client(databaseConfig)
  await client.connect()
  try {
    for (const table of tables) {
      const { rows } = await client.query(`SELECT code FROM ${table}`)
      const defined = new Set(rows.map((row) => row.code))
      const produced = new Set(translations.filter((row) => row.table === table).map((row) => row.code))

      const missing = [...produced].filter((code) => !defined.has(code))
      assert.deepEqual(missing, [], `${table}: translations point at codes no migration defines`)

      if (MUST_BE_REACHABLE.has(table)) {
        const unreachable = [...defined].filter((code) => !produced.has(code))
        assert.deepEqual(unreachable, [], `${table}: codes no translation produces`)
      }
    }
  } finally {
    await client.end()
  }
})
