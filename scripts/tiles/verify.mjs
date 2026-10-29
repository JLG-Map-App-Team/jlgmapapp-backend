#!/usr/bin/env node
/**
 * PMTiles hosting check — D3.
 *
 * Confirms the published Detroit archive is actually usable by MapLibre:
 * the host answers an HTTP Range request with 206, sends CORS headers, and
 * the bytes are a PMTiles v3 archive whose bounds cover DETROIT_BBOX.
 *
 * Hits the network, so it is NOT part of `npm test`. Run it after publishing
 * a new extract, or whenever the tiles repository moves.
 */

import { argv, exit } from 'node:process';
import { pathToFileURL } from 'node:url';
import { DETROIT_BBOX } from './detroitRegion.js';
import { DETROIT_PMTILES_URL } from './attribution.js';

// PMTiles v3 fixed header is 127 bytes.
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
const HEADER_BYTES = 127;

export function parseHeader(buf) {
  if (buf.length < HEADER_BYTES) {
    throw new Error(`header is ${buf.length} bytes, expected ${HEADER_BYTES}`);
  }
  if (buf.subarray(0, 7).toString('ascii') !== 'PMTiles') {
    throw new Error('missing PMTiles magic bytes');
  }

  const e7 = (offset) => buf.readInt32LE(offset) / 1e7;

  return {
    version: buf[7],
    tileType: buf[99],
    minZoom: buf[100],
    maxZoom: buf[101],
    bounds: {
      minLon: e7(102),
      minLat: e7(106),
      maxLon: e7(110),
      maxLat: e7(114),
    },
  };
}

export function coversBbox(bounds, bbox) {
  return (
    bounds.minLon <= bbox.minLon &&
    bounds.minLat <= bbox.minLat &&
    bounds.maxLon >= bbox.maxLon &&
    bounds.maxLat >= bbox.maxLat
  );
}

async function main() {
  const url = argv[2] ?? DETROIT_PMTILES_URL;
  console.log(`url       ${url}`);

  const res = await fetch(url, {
    headers: {
      Range: `bytes=0-${HEADER_BYTES - 1}`,
      Origin: 'http://localhost:5173',
    },
  });

  const failures = [];

  if (res.status !== 206) {
    failures.push(`expected 206 Partial Content, got ${res.status}`);
  }
  const cors = res.headers.get('access-control-allow-origin');
  if (!cors) failures.push('no Access-Control-Allow-Origin header');

  console.log(`status    ${res.status}`);
  console.log(`cors      ${cors ?? '(none)'}`);
  console.log(`range     ${res.headers.get('content-range') ?? '(none)'}`);

  if (res.status === 206) {
    try {
      const header = parseHeader(Buffer.from(await res.arrayBuffer()));
      const { bounds } = header;

      console.log(`version   ${header.version}`);
      console.log(`zoom      ${header.minZoom}–${header.maxZoom}`);
      console.log(
        `bounds    ${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`,
      );

      if (header.version !== 3) {
        failures.push(`expected PMTiles v3, got v${header.version}`);
      }
      if (!coversBbox(bounds, DETROIT_BBOX)) {
        failures.push('archive bounds do not cover DETROIT_BBOX');
      }
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (failures.length > 0) {
    failures.forEach((f) => console.error(`FAIL      ${f}`));
    return 1;
  }

  console.log('ok        archive is range-servable, CORS-enabled and covers Detroit');
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1]).href) {
  let code = 2;

  try {
    code = await main();
  } catch (error) {
    console.error(error);
    code = 2;
  }

  exit(code);
}
