#!/usr/bin/env node
/**
 * PMTiles Detroit extract — D3.
 *
 * Extracts the Detroit region from a Protomaps daily PMTiles build.
 * The published project copy is hosted through GitHub Pages.
 */

import { argv, exit } from 'node:process';
import { spawn } from 'node:child_process';
import { bboxToExtractFlag, DETROIT_BBOX } from './detroitRegion.js';
import {
  DETROIT_PMTILES_URL,
  OSM_ATTRIBUTION_TEXT,
} from './attribution.js';

function usage(message) {
  if (message) console.error(`error: ${message}\n`);

  console.error(
    'usage: node scripts/tiles/run.mjs --source <url-or-path> --output <file> ' +
      '[--maxzoom <n>] [--dry-run]',
  );

  console.error(
    `\ndefault bbox (Detroit area): ${bboxToExtractFlag(DETROIT_BBOX)}`,
  );

  return 2;
}

export function parseArgs(args) {
  const opts = {
    source: null,
    output: null,
    maxzoom: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--source') {
      opts.source = args[++i];
      if (!opts.source) throw new Error('--source needs a value');
    } else if (arg === '--output') {
      opts.output = args[++i];
      if (!opts.output) throw new Error('--output needs a value');
    } else if (arg === '--maxzoom') {
      opts.maxzoom = args[++i];
      if (!opts.maxzoom) throw new Error('--maxzoom needs a value');
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  return opts;
}

function runPmtilesExtract({ source, output, bbox, maxzoom }) {
  const args = [
    'extract',
    source,
    output,
    bboxToExtractFlag(bbox),
  ];

  if (maxzoom) args.push(`--maxzoom=${maxzoom}`);

  return new Promise((resolve, reject) => {
    const child = spawn('pmtiles', args, { stdio: 'inherit' });

    child.on('error', reject);

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
  } catch (error) {
    return usage(error.message);
  }

  if (!opts.source) return usage('--source is required');
  if (!opts.output) return usage('--output is required');

  console.log(`source    ${opts.source}`);
  console.log(`output    ${opts.output}`);
  console.log(`bbox      ${bboxToExtractFlag(DETROIT_BBOX)}`);
  console.log(`mode      ${opts.dryRun ? 'DRY RUN' : 'live'}`);

  if (opts.dryRun) {
    console.log('dry run — skipping pmtiles extraction');
    return 0;
  }

  try {
    await runPmtilesExtract({
      source: opts.source,
      output: opts.output,
      bbox: DETROIT_BBOX,
      maxzoom: opts.maxzoom,
    });
  } catch (error) {
    console.error(`pmtiles extract failed: ${error.message}`);

    if (error.code === 'ENOENT') {
      console.error('The pmtiles CLI is not installed or not on PATH.');
    }

    return 1;
  }

  console.log(`extracted  ${opts.output}`);
  console.log(`published  ${DETROIT_PMTILES_URL}`);
  console.log(`attribution required: ${OSM_ATTRIBUTION_TEXT}`);

  return 0;
}

if (import.meta.url === `file://${argv[1]}`) {
  let code = 2;

  try {
    code = await main();
  } catch (error) {
    console.error(error);
    code = 2;
  }

  exit(code);
}
