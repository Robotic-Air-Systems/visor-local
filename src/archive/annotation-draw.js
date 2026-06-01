import { haversineMeters, geoCircleToPolygon } from './homography.js';

// Herramienta de dibujo de anotaciones sobre el mapa. Mantiene un
// source/layers de "draft" (la forma en construcción) y emite la
// geometría final al callback `onFinish` cuando el usuario termina.
//
// Tres modos:
//   - circle:    mousedown center + drag radius + mouseup → finish
//   - rectangle: mousedown corner + drag opposite + mouseup → finish
//   - polygon:   click cada vértice, dblclick para terminar
//
// Mientras dibuja, los eventos de map.dragPan se deshabilitan para
// circle/rect (drag = definir forma). Para polygon el pan sigue
// funcionando entre clicks.

const DRAFT_SRC = 'ann-draft';
const DRAFT_FILL = 'ann-draft-fill';
const DRAFT_LINE = 'ann-draft-line';
const DRAFT_POINT = 'ann-draft-point';

export function createAnnotationDraw(map) {
  map.addSource(DRAFT_SRC, { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: DRAFT_FILL, type: 'fill', source: DRAFT_SRC,
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': '#1736F5', 'fill-opacity': 0.08 },
  });
  map.addLayer({
    id: DRAFT_LINE, type: 'line', source: DRAFT_SRC,
    paint: { 'line-color': '#1736F5', 'line-width': 2, 'line-dasharray': [4, 2] },
  });
  map.addLayer({
    id: DRAFT_POINT, type: 'circle', source: DRAFT_SRC,
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 5, 'circle-color': '#1736F5',
      'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
    },
  });

  let mode = null;        // 'circle' | 'rectangle' | 'polygon' | null
  let drawing = null;     // estado en curso
  let onFinishCb = null;
  const modeListeners = new Set();

  function setDraft(features) {
    map.getSource(DRAFT_SRC)?.setData({ type: 'FeatureCollection', features });
  }

  function clearDraft() {
    setDraft([]);
  }

  function emitMode() {
    for (const fn of modeListeners) fn(mode);
  }

  function start(shape) {
    if (!['circle', 'rectangle', 'polygon'].includes(shape)) {
      throw new Error(`unknown shape: ${shape}`);
    }
    mode = shape;
    drawing = null;
    clearDraft();
    map.getCanvas().style.cursor = 'crosshair';
    emitMode();
  }

  function cancel() {
    if (!mode) return;
    mode = null;
    drawing = null;
    clearDraft();
    map.getCanvas().style.cursor = '';
    map.dragPan.enable();
    emitMode();
  }

  function finish(geometry) {
    const cb = onFinishCb;
    cancel();
    cb?.(geometry);
  }

  // ── circle / rectangle: drag-based ─────────────────────────────────

  map.on('mousedown', e => {
    if (!mode || mode === 'polygon') return;
    e.preventDefault();
    map.dragPan.disable();
    drawing = {
      start: [e.lngLat.lng, e.lngLat.lat],
      cur: [e.lngLat.lng, e.lngLat.lat],
    };
  });

  map.on('mousemove', e => {
    if (!drawing) return;
    drawing.cur = [e.lngLat.lng, e.lngLat.lat];
    if (mode === 'circle') {
      const r = haversineMeters(drawing.start, drawing.cur);
      setDraft([{
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [geoCircleToPolygon(drawing.start, r)] },
      }]);
    } else if (mode === 'rectangle') {
      const [x1, y1] = drawing.start;
      const [x2, y2] = drawing.cur;
      setDraft([{
        type: 'Feature', properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
      }]);
    }
  });

  map.on('mouseup', () => {
    if (!drawing || mode === 'polygon') return;
    map.dragPan.enable();
    if (mode === 'circle') {
      const r = haversineMeters(drawing.start, drawing.cur);
      if (r < 2) { cancel(); return; }
      finish({ shape: 'circle', center: drawing.start, radius_m: r });
    } else if (mode === 'rectangle') {
      const [x1, y1] = drawing.start;
      const [x2, y2] = drawing.cur;
      if (Math.abs(x2 - x1) < 1e-6 || Math.abs(y2 - y1) < 1e-6) { cancel(); return; }
      finish({ shape: 'rectangle', corners: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });
    }
  });

  // ── polygon: click vertices + dblclick to finish ───────────────────

  map.on('click', e => {
    if (mode !== 'polygon') return;
    if (!drawing) drawing = { points: [] };
    drawing.points.push([e.lngLat.lng, e.lngLat.lat]);
    const pts = drawing.points;
    const features = pts.map(p => ({
      type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: p },
    }));
    if (pts.length >= 3) {
      features.unshift({
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
      });
    }
    setDraft(features);
  });

  map.on('dblclick', e => {
    if (mode !== 'polygon' || !drawing?.points?.length) return;
    if (drawing.points.length < 3) return;
    e.preventDefault();
    finish({ shape: 'polygon', corners: drawing.points.slice() });
  });

  return {
    start, cancel,
    onFinish(fn) { onFinishCb = fn; },
    onModeChange(fn) {
      modeListeners.add(fn);
      return () => modeListeners.delete(fn);
    },
    getMode() { return mode; },
  };
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}
