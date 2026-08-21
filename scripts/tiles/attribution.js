/**
 * OSM/Protomaps attribution (D3).
 *
 * The PMTiles basemap is a Produced Work of the OpenStreetMap dataset, which
 * is licensed under the ODbL and requires visible attribution wherever the
 * map is displayed.
 *
 * The Detroit PMTiles archive is hosted by the project through GitHub Pages.
 * GitHub Pages was manually verified to support HTTP byte-range requests
 * (206 Partial Content), which PMTiles requires.
 */

export const DETROIT_PMTILES_URL =
  'https://jlg-map-app-team.github.io/jlgmapapp-tiles/detroit.pmtiles';

export const OSM_ATTRIBUTION_HTML =
  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

export const OSM_ATTRIBUTION_TEXT =
  'Protomaps © OpenStreetMap contributors';

/**
 * A MapLibre vector source pointing at the project-hosted Detroit PMTiles
 * archive, with the required attribution attached to the source itself.
 */
export function pmtilesSource(pmtilesUrl = DETROIT_PMTILES_URL) {
  return {
    type: 'vector',
    url: `pmtiles://${pmtilesUrl}`,
    attribution: OSM_ATTRIBUTION_HTML,
  };
}
