import { setLayersVisible } from './_util.js';

const SRC = 'postes';
const IDS = ['postes-pt', 'postes-lbl'];

// Postes (mojones KM) hidden por default — son cientos y saturan el
// mapa cuando se ven todos a la vez.
export function addPostesLayer(map, geojson, { visible = false } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'circle', source: SRC,
    paint: {
      'circle-radius': 3, 'circle-color': '#6b7280',
      'circle-stroke-width': 1, 'circle-stroke-color': '#fff',
    },
  });
  map.addLayer({
    id: IDS[1], type: 'symbol', source: SRC,
    layout: {
      'text-field': ['concat', 'KM ', ['get', 'km']],
      'text-size': 9, 'text-offset': [0, 0.9], 'text-anchor': 'top',
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': '#374151', 'text-halo-color': '#fff', 'text-halo-width': 1.5,
    },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
