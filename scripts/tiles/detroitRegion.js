/**
 * Detroit region bounds for the PMTiles basemap extract (D3).
 *
 * Deliberately the same box as the one already used by the route-segment
 * importer (scripts/etl/cityRouteSegments.js) to sanity-check incoming
 * geometry. Reusing it keeps "the Detroit area" meaning one bounding box
 * across the codebase instead of two independently-drawn ones that quietly
 * drift apart.
 */

export const DETROIT_BBOX = { minLon: -83.5, minLat: 42.0, maxLon: -82.8, maxLat: 42.6 };

/**
 * `pmtiles extract` takes the bbox as one flag:
 *   --bbox=minLon,minLat,maxLon,maxLat
 * https://docs.protomaps.com/pmtiles/cli
 */
export function bboxToExtractFlag(bbox) {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  return `--bbox=${minLon},${minLat},${maxLon},${maxLat}`;
}
