#!/usr/bin/env node
/**
 * PMTiles extract + R2 upload — D3.
 *
 * Pulls a Detroit-sized region out of the Protomaps daily OpenStreetMap
 * basemap build (https://build.protomaps.com/YYYYMMDD.pmtiles) and copies it
 * into our own Cloudflare R2 bucket. Protomaps discourage hotlinking their
 * download servers in production, so the app must serve its own copy — not
 * fetch the daily build at request time.
 *
 * Requires the `pmtiles` CLI (github.com/protomaps/go-pmtiles) on PATH:
 *   https://docs.protomaps.com/pmtiles/cli
 *
 * Usage
 *   node scripts/tiles/run.mjs --source <url-or-path> --output <file> \
 *     [--key <r2-object-key>] [--maxzoom <n>] [--dry-run]
 *
 *   node scripts/tiles/run.mjs \
 *     --source https://build.protomaps.com/20260820.pmtiles \
 *     --output tmp/detroit.pmtiles \
 *     --dry-run
 *
 * Env (required unless --dry-run)
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * EXIT CODES
 *   0  succeeded, or a dry run
 *   1  the pmtiles extract or the R2 upload failed
 *   2  usage error, or an unexpected exception
 */

import { argv, env, exit } from 'node:process';
import { spawn } from 'node:child_process';
import { bboxToExtractFlag, DETROIT_BBOX } from './detroitRegion.js';
import { createR2Client, uploadPmtiles } from './r2Client.js';
import { OSM_ATTRIBUTION_TEXT } from './attribution.js';

const DEFAULT_KEY = 'basemaps/detroit.pmtiles';
const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    'usage: node scripts/tiles/run.mjs --source <url-or-path> --output <file> ' +
    '[--key <r2-object-key>] [--maxzoom <n>] [--dry-run]',
  );
  console.error(`\ndefault bbox (Detroit area): ${bboxToExtractFlag(DETROIT_BBOX)}`);
  console.error(`default R2 key: ${DEFAULT_KEY}`);
  console.error('\nRequires the pmtiles CLI on PATH: https://docs.protomaps.com/pmtiles/cli');
  console.error(`${REQUIRED_ENV.join(', ')} must be set unless --dry-run is given.`);
  return 2;
}

export function parseArgs(args) {
  const opts = { source: null, output: null, key: DEFAULT_KEY, maxzoom: null, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--source') {
      opts.source = args[i + 1];
      if (!opts.source) throw new Error('--source needs a value');
      i += 1;
    } else if (a === '--output') {
      opts.output = args[i + 1];
      if (!opts.output) throw new Error('--output needs a value');
      i += 1;
    } else if (a === '--key') {
      opts.key = args[i + 1];
      if (!opts.key) throw new Error('--key needs a value');
      i += 1;
    } else if (a === '--maxzoom') {
      opts.maxzoom = args[i + 1];
      if (!opts.maxzoom) throw new Error('--maxzoom needs a value');
      i += 1;
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return opts;
}

function runPmtilesExtract({ source, output, bbox, maxzoom }) {
  const args = ['extract', source, output, bboxToExtractFlag(bbox)];
  if (maxzoom) args.push(`--maxzoom=${maxzoom}`);

  return new Promise((resolve, reject) => {
    const child = spawn('pmtiles', args, { stdio: 'inherit' });
    child.on('error', reject); // e.g. ENOENT — the pmtiles binary isn't installed
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pmtiles extract exited with code ${code}`));
    });
  });
}

async function main() {
  let opts;
  try {
    opts = parseArgs(argv.slice(2));
  } catch (err) {
    return usage(err.message);
  }

  if (!opts.source) return usage('--source is required (a Protomaps daily build URL, or a local .pmtiles path)');
  if (!opts.output) return usage('--output is required (local path for the extracted region)');

  console.log(`source    ${opts.source}`);
  console.log(`output    ${opts.output}`);
  console.log(`bbox      ${bboxToExtractFlag(DETROIT_BBOX)}`);
  console.log(`r2 key    ${opts.key}`);
  console.log(`mode      ${opts.dryRun ? 'DRY RUN — no upload' : 'live'}`);
  console.log('');

  try {
    await runPmtilesExtract({ source: opts.source, output: opts.output, bbox: DETROIT_BBOX, maxzoom: opts.maxzoom });
  } catch (err) {
    console.error(`pmtiles extract failed: ${err.message}`);
    if (err.code === 'ENOENT') {
      console.error('Is the `pmtiles` CLI installed and on PATH? https://docs.protomaps.com/pmtiles/cli');
    }
    return 1;
  }

  console.log(`extracted ${opts.output}`);

  if (opts.dryRun) {
    console.log('dry run — skipping R2 upload');
    return 0;
  }

  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) return usage(`missing required env var(s): ${missing.join(', ')}`);

  try {
    const client = createR2Client({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
    const result = await uploadPmtiles({ client, bucket: env.R2_BUCKET, key: opts.key, filePath: opts.output });
    console.log(`uploaded  s3://${result.bucket}/${result.key} (${result.bytes} bytes)`);
  } catch (err) {
    console.error(`R2 upload failed: ${err.message}`);
    return 1;
  }

  console.log('');
  console.log(`ATTRIBUTION REQUIRED ON THE MAP: ${OSM_ATTRIBUTION_TEXT}`);
  console.log('Build the map source with scripts/tiles/attribution.js#pmtilesSource ' +
    'so the attribution travels with it — see D3 in docs/walking_skeleton_plan.md.');

  return 0;
}

// Guarded so this file can be imported for its exports (parseArgs, in tests)
// without running the CLI and calling exit().
if (import.meta.url === `file://${argv[1]}`) {
  let code = 2;
  try {
    code = await main();
  } catch (err) {
    console.error('');
    console.error('UNEXPECTED FAILURE — the run did not complete.');
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    code = 2;
  }

  exit(code);
}
