import { setLayersVisible } from './_util.js';

const SRC = 'footprints';
const IDS = ['footprints-fill', 'footprints-line'];

// Polígonos de cobertura de cada foto. Hidden por default porque los
// tiles de las fotos rectificadas ya muestran cobertura visualmente —
// los footprints sirven cuando las fotos están ocultas o para debug.
// Fotos con detecciones se muestran en rojo, el resto en azul.
export function addFootprintsLayer(map, geojson, { visible = false } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'fill', source: SRC,
    paint: {
      'fill-color': ['case', ['get', 'has_detections'], '#ef4444', '#1736F5'],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'],
        10, 0,
        12, ['case', ['get', 'has_detections'], 0.15, 0.04],
      ],
    },
  });
  map.addLayer({
    id: IDS[1], type: 'line', source: SRC,
    paint: {
      'line-color': ['case', ['get', 'has_detections'], '#ef4444', '#1736F5'],
      'line-width': 0.8,
      'line-opacity': ['case', ['get', 'has_detections'], 0.7, 0.3],
    },
  });
  if (!visible) setLayersVisible(map, IDS, false);
  return { setVisible: v => setLayersVisible(map, IDS, v) };
}
