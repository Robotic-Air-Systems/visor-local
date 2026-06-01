import { setLayersVisible } from './_util.js';

const SRC = 'ductos';
const IDS = ['ductos-casing', 'ductos-line'];

export function addDuctosLayer(map, geojson, { visible = true } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  // Casing blanco semi-transparente — hace el ducto legible sobre
  // satélite oscuro o calles claras sin perder contraste.
  map.addLayer({
    id: IDS[0], type: 'line', source: SRC,
    paint: { 'line-color': '#fff', 'line-width': 5, 'line-opacity': 0.45 },
    layout: { 'line-cap': 'round' },
  });
  map.addLayer({
    id: IDS[1], type: 'line', source: SRC,
    paint: { 'line-color': '#111D4A', 'line-width': 2.5 },
    layout: { 'line-cap': 'round' },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
