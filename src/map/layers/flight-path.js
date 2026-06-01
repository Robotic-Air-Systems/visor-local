import { setLayersVisible } from './_util.js';

const SRC = 'flight-path';
const IDS = ['flight-path-line'];

// LineString a través de los centroides de cada foto, en orden
// cronológico — visualiza la trayectoria del dron.
export function addFlightPathLayer(map, geojson, { visible = true } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'line', source: SRC,
    paint: {
      'line-color': '#06b6d4', 'line-width': 1.5,
      'line-dasharray': [2, 2], 'line-opacity': 0.75,
    },
    layout: { 'line-cap': 'round' },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
