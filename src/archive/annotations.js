import { geoCircleToPolygon } from './homography.js';

// Store de anotaciones manuales por vuelo. Persiste en localStorage
// con debounce 400ms (`af_ann_<vueloId>`). Cuando aparezca persistencia
// server-side (Fase D del sistema), este módulo cambia su backend; el
// contrato (list/add/update/remove/subscribe/toFeatureCollection) se
// preserva.
//
// Shape de una anotación:
//   {
//     id: 'ann_xxx',
//     name: 'Obs_001_KM_42' (opcional, free text),
//     class: 'construccion' | 'vehiculo' | 'persona' | 'maquinaria' | 'otro',
//     priority: 'alta' | 'media' | 'baja',
//     description: 'free text',
//     shape: 'circle' | 'rectangle' | 'polygon',
//     geometry: {
//       // shape='circle':
//       center: [lng, lat], radius_m: number,
//       // shape='rectangle' or 'polygon':
//       corners: [[lng,lat], ...],
//     },
//   }

const SAVE_DEBOUNCE_MS = 400;

export function createAnnotations(vueloId) {
  const KEY = `af_ann_${vueloId}`;
  let items = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) items = JSON.parse(raw);
  } catch {
    items = [];
  }

  const listeners = new Set();
  let saveTimer = null;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    }, SAVE_DEBOUNCE_MS);
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.error('annotation listener', e); }
    }
  }

  function newId() {
    return 'ann_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  return {
    list() { return items.slice(); },
    get(id) { return items.find(a => a.id === id) || null; },
    count() { return items.length; },

    add(data) {
      const id = data.id || newId();
      items.push({ id, ...data });
      persist();
      emit();
      return id;
    },

    update(id, patch) {
      const idx = items.findIndex(a => a.id === id);
      if (idx < 0) return false;
      items[idx] = { ...items[idx], ...patch, id };
      persist();
      emit();
      return true;
    },

    remove(id) {
      const before = items.length;
      items = items.filter(a => a.id !== id);
      if (items.length === before) return false;
      persist();
      emit();
      return true;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    toFeatureCollection() {
      const features = [];
      for (const a of items) {
        let coords = null;
        if (a.shape === 'circle' && a.geometry?.center && a.geometry?.radius_m != null) {
          coords = [geoCircleToPolygon(a.geometry.center, a.geometry.radius_m)];
        } else if ((a.shape === 'rectangle' || a.shape === 'polygon') && a.geometry?.corners?.length >= 3) {
          coords = [[...a.geometry.corners, a.geometry.corners[0]]];
        }
        if (!coords) continue;
        features.push({
          type: 'Feature',
          properties: {
            id: a.id,
            name: a.name || '',
            class: a.class || 'otro',
            priority: a.priority || 'media',
          },
          geometry: { type: 'Polygon', coordinates: coords },
        });
      }
      return { type: 'FeatureCollection', features };
    },
  };
}

// Calcula el centroide aproximado de la geometría (centro del bbox para
// rect/polígono, center para círculo). Útil para "Ver foto" y para
// auto-generar IDs basados en KM marker más cercano.
export function geometryCenter(annotation) {
  if (annotation.shape === 'circle') return annotation.geometry?.center || null;
  const c = annotation.geometry?.corners;
  if (!c?.length) return null;
  const lngs = c.map(p => p[0]);
  const lats = c.map(p => p[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}
