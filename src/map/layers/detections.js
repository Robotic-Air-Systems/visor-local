import { setLayersVisible } from './_util.js';

const SRC = 'detections';
const IDS = ['detections-halo', 'detections-point'];

// Color por clase de detección. El fallback gris cubre clases nuevas.
const CLASS_COLORS = ['match', ['get', 'class'],
  'vehicle', '#f59e0b',
  'person', '#ef4444',
  'heavy_equipment', '#8b5cf6',
  '#888',
];

// Dos capas por detección: un halo grande semi-transparente que la
// hace visible a baja zoom, y un punto sólido encima. Ambas crecen
// con el zoom.
export function addDetectionsLayer(map, geojson, { visible = true } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 18],
      'circle-color': 'transparent',
      'circle-stroke-width': 2,
      'circle-stroke-color': CLASS_COLORS,
      'circle-stroke-opacity': 0.55,
    },
  });
  map.addLayer({
    id: IDS[1], type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 9],
      'circle-color': CLASS_COLORS,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
