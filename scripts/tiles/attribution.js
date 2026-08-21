/**
 * OSM/Protomaps attribution (D3).
 *
 * The PMTiles basemap is a Produced Work of the OpenStreetMap dataset, which
 * is licensed under the ODbL — a share-alike license that requires visible
 * attribution wherever the map is displayed. docs/walking_skeleton_plan.md's
 * D3 row calls this out by name and says to add it in this step, not later.
 *
 * The harness (D4) does not exist yet, so there is nowhere to click an
 * "attribution control" on today. What D3 can do instead is make the
 * attribution part of the map source definition itself, via pmtilesSource()
 * below, so whichever code builds the MapLibre style has to carry it along
 * rather than add it as an afterthought.
 */

export const OSM_ATTRIBUTION_HTML =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

export const OSM_ATTRIBUTION_TEXT = 'Protomaps © OpenStreetMap contributors';

/**
 * A MapLibre vector source pointing at our own R2-hosted PMTiles archive,
 * carrying the required attribution as part of the source object rather
 * than as separate map configuration.
 */
export function pmtilesSource(pmtilesUrl) {
  return {
    type: 'vector',
    url: `pmtiles://${pmtilesUrl}`,
    attribution: OSM_ATTRIBUTION_HTML,
  };
}
