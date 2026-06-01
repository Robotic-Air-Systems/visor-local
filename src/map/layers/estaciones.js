import { setLayersVisible } from './_util.js';

const SRC = 'estaciones';
const IDS = ['estaciones-pt', 'estaciones-lbl'];

export function addEstacionesLayer(map, geojson, { visible = true } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'circle', source: SRC,
    paint: {
      'circle-radius': 6, 'circle-color': '#1e3a8a',
      'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
    },
  });
  // Symbol layer requiere glyphs en el style — basemap.js los agrega
  // cuando hay token Mapbox. Sin token, esta capa no renderiza texto.
  map.addLayer({
    id: IDS[1], type: 'symbol', source: SRC,
    layout: {
      'text-field': ['get', 'name'], 'text-size': 11,
      'text-offset': [0, 1.3], 'text-anchor': 'top',
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
    },
    paint: {
      'text-color': '#111D4A', 'text-halo-color': '#fff', 'text-halo-width': 2,
    },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
