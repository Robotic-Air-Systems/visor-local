import { setLayersVisible } from './_util.js';

const SRC = 'annotations';
const IDS = ['annotations-fill', 'annotations-line'];

// Colores por prioridad. Fill semi-transparente para no tapar la
// imagen del satélite, línea sólida para que el contorno se vea.
const FILL_COLOR = ['match', ['get', 'priority'],
  'alta', '#ef4444',
  'media', '#f59e0b',
  'baja', '#3b82f6',
  '#10b981'];

const LINE_COLOR = ['match', ['get', 'priority'],
  'alta', '#dc2626',
  'media', '#d97706',
  'baja', '#2563eb',
  '#059669'];

export function addAnnotationsLayer(map, geojson, { visible = true } = {}) {
  map.addSource(SRC, { type: 'geojson', data: geojson });
  map.addLayer({
    id: IDS[0], type: 'fill', source: SRC,
    paint: { 'fill-color': FILL_COLOR, 'fill-opacity': 0.3 },
  });
  map.addLayer({
    id: IDS[1], type: 'line', source: SRC,
    paint: { 'line-color': LINE_COLOR, 'line-width': 2.5, 'line-opacity': 1 },
  });
  if (!visible) setLayersVisible(map, IDS, false);

  return {
    setData(newGeojson) {
      map.getSource(SRC)?.setData(newGeojson);
    },
    setVisible(v) {
      setLayersVisible(map, IDS, v);
    },
    // Subscribe a clicks sobre las anotaciones. fn recibe el id de la
    // feature clickeada. El cursor se vuelve pointer al hover.
    onClick(fn) {
      map.on('click', IDS[0], e => {
        if (!e.features?.length) return;
        const id = e.features[0].properties.id;
        e.preventDefault();
        fn(id);
      });
      map.on('mouseenter', IDS[0], () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', IDS[0], () => { map.getCanvas().style.cursor = ''; });
    },
  };
}
