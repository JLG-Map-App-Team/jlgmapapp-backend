#!/usr/bin/env node
/**
 * ETL runner — the entry point for every importer.
 *
 * The importers themselves export a module with a run() function and no
 * side effects, which makes them testable but not executable. This is the only
 * place that resolves an importer by name, hands it a file path, and turns its
 * result into an exit code.
 *
 * Usage
 *   node scripts/etl/run.mjs <importer> [--path <file>] [--dry-run]
 *
 *   node scripts/etl/run.mjs city_route_segments
 *   node scripts/etl/run.mjs city_route_segments --dry-run
 *   node scripts/etl/run.mjs city_route_segments --path docs/etl/other_export.geojson
 *
 * EXIT CODES
 *   0  succeeded, or a dry run that found no fatal problem
 *   1  the importer reported failure (validation, or a topology abort)
 *   2  usage error, or an unexpected exception
 *
 * A topology abort exits 1 even though core data loaded successfully. The
 * importer's own comment is the reason: an importer that reports success because
 * its own load worked, while the topology silently did not update, is worse than
 * either failure alone. CI must see a non-zero exit.
 */

import { argv, exit } from 'node:process';
import { closePool } from '../../dist/db/pool.js';
import cityRouteSegments from './cityRouteSegments.js';

// Registry. Keys match staging.data_source.code so the name in a command and
// the name in the provenance table are the same string.
const IMPORTERS = {
  city_route_segments: {
    module: cityRouteSegments,
    defaultPath: 'docs/etl/Joe_Louis_Greenway_Routes_6582477513894808108.geojson',
  },
};

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('usage: node scripts/etl/run.mjs <importer> [--path <file>] [--dry-run]');
  console.error('\nimporters:');
  for (const [name, cfg] of Object.entries(IMPORTERS)) {
    console.error(`  ${name}`);
    console.error(`      default path: ${cfg.defaultPath}`);
  }
  console.error('\nDATABASE_URL must be set unless --dry-run is given.');
  return 2;
}

function parseArgs(args) {
  const opts = { name: null, path: null, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--path') {
      opts.path = args[i + 1];
      if (!opts.path) throw new Error('--path needs a value');
      i += 1;
    } else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (opts.name === null) opts.name = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(argv.slice(2));
  } catch (err) {
    return usage(err.message);
  }

  if (!opts.name) return usage('no importer named');

  const cfg = IMPORTERS[opts.name];
  if (!cfg) return usage(`unknown importer "${opts.name}"`);

  const path = opts.path ?? cfg.defaultPath;

  console.log(`importer  ${opts.name}`);
  console.log(`path      ${path}`);
  console.log(`mode      ${opts.dryRun ? 'DRY RUN — no database writes' : 'live'}`);
  console.log('');

  const result = await cfg.module.run({ path, dryRun: opts.dryRun });

  console.log('');
  console.log(`status    ${result.status}`);
  if (result.runId) console.log(`etl_run   ${result.runId}`);

  return result.status === 'failed' ? 1 : 0;
}

let code = 2;
try {
  code = await main();
} catch (err) {
  console.error('');
  console.error('UNEXPECTED FAILURE — the run did not complete.');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  code = 2;
} finally {
  // The pool holds the event loop open. A dry run never connects, and calling
  // end() on an unused pool is a no-op, so this is safe either way.
  await closePool().catch(() => {});
}

exit(code);
