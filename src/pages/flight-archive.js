/* global maplibregl */
import { createBasemapStyle, getBasemapPreference } from '../map/basemap.js';
import { getMapboxToken } from '../map/get-mapbox-token.js';
import {
  loadManifest, loadDetections, loadFlightPath, loadInfrastructure,
  buildFootprintsFC,
  photoTileUrl, photoHdUrl, cropUrl,
} from '../api/archive.js';
import { addDuctosLayer } from '../map/layers/ductos.js';
import { addEstacionesLayer } from '../map/layers/estaciones.js';
import { addPostesLayer } from '../map/layers/postes.js';
import { addFootprintsLayer } from '../map/layers/footprints.js';
import { addFlightPathLayer } from '../map/layers/flight-path.js';
import { addDetectionsLayer } from '../map/layers/detections.js';
import { createPhotoCache } from '../archive/photo-cache.js';
import { createPhotoPopup } from '../archive/photo-popup.js';
import { createInspector } from '../archive/inspector.js';
import { createAlertLog } from '../archive/alert-log.js';
import { createAnnotations } from '../archive/annotations.js';
import { createAnnotationDraw } from '../archive/annotation-draw.js';
import { createAnnotationEditor } from '../archive/annotation-editor.js';
import { addAnnotationsLayer } from '../map/layers/annotations.js';
import { toast } from '../ui/toast.js';

const params = new URLSearchParams(location.search);
const cliente = params.get('cliente');
const proyecto = params.get('proyecto');
const fecha = params.get('fecha');
const vuelo = params.get('vuelo');

if (!vuelo) {
  document.body.innerHTML = `
    <div class="missing-param">
      <h2 style="margin-bottom:14px">Falta el parámetro <code>vuelo</code></h2>
      <p style="font-size:14px;line-height:1.5;margin-bottom:18px">
        El visor archivado necesita identificar qué vuelo cargar. Esperado:
      </p>
      <pre style="background:#F4F6FA;padding:14px;border-radius:8px;font-size:12px;overflow:auto">flight-archive.html?cliente=TGP&amp;proyecto=PLNG&amp;fecha=2026-05-12&amp;vuelo=vuelo2</pre>
      <p style="margin-top:18px"><a href="../">← Volver al inicio</a></p>
    </div>
  `;
  throw new Error('missing vuelo query param');
}

const els = {
  title: document.getElementById('flight-title'),
  sub: document.getElementById('flight-sub'),
  meta: document.getElementById('flight-meta'),
  status: document.getElementById('status'),
};

let map = null;
let manifest = null;
let detections = null;
let infrastructure = null;
let photoCache = null;
let popup = null;
let inspector = null;
let annotations = null;
let annotationDraw = null;
let annotationEditor = null;
const layers = {};
const alertLog = createAlertLog(vuelo);

bootstrap();

async function bootstrap() {
  els.status.textContent = 'cargando manifest e infraestructura…';

  const token = await getMapboxToken();

  let flightPath;
  try {
    [manifest, detections, flightPath, infrastructure] = await Promise.all([
      loadManifest(vuelo),
      loadDetections(vuelo),
      loadFlightPath(vuelo),
      loadInfrastructure(),
    ]);
  } catch (err) {
    console.error(err);
    setError(`No se pudo cargar el vuelo "${vuelo}": ${err.message}`);
    return;
  }

  renderHeader(manifest);

  let center = [-76.5, -12.9];
  if (manifest.bounds) {
    const [[w, s], [e, n]] = manifest.bounds;
    center = [(w + e) / 2, (s + n) / 2];
  }

  map = new maplibregl.Map({
    container: 'map',
    style: createBasemapStyle(getBasemapPreference(), token),
    center,
    zoom: 9,
    maxZoom: 19,
    maxPitch: 60,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');

  map.on('load', () => {
    // Orden: infra abajo, overlays del vuelo en el medio, detecciones arriba.
    layers.ductos       = addDuctosLayer(map, infrastructure.ductos);
    layers.estaciones   = addEstacionesLayer(map, infrastructure.estaciones);
    layers.postes       = addPostesLayer(map, infrastructure.postes);
    layers.footprints   = addFootprintsLayer(map, buildFootprintsFC(manifest, detections));
    layers['flight-path'] = addFlightPathLayer(map, flightPath);
    // Filtra geometry:null antes del layer — el contrato lo permite
    // (alerts sin GPS). Las chips del inspector y el footprint
    // coloring siguen usando `detections` completo, solo el mapa
    // descarta las que no se pueden plotear.
    layers.detections   = addDetectionsLayer(map, detectionsWithGeometry(detections));

    // Photo cache: raster tiles sobre el mapa, debajo del ducto para
    // que la infraestructura quede arriba.
    photoCache = createPhotoCache(map, {
      manifest,
      photoUrl: name => photoTileUrl(vuelo, name),
      beforeLayerId: 'ductos-casing',
    });
    photoCache.refresh();

    let _t = null;
    const debouncedRefresh = () => {
      clearTimeout(_t);
      _t = setTimeout(() => photoCache.refresh(), 250);
    };
    map.on('moveend', debouncedRefresh);
    map.on('zoomend', debouncedRefresh);

    // Popup: aparece al click sobre footprint o sobre una foto raster.
    popup = createPhotoPopup({
      container: document.getElementById('map'),
      countDetections: imgName => detectionsForImage(imgName).length,
      onOpen: imgName => openInspectorForImage(imgName),
    });

    // Inspector: panel modal full-screen.
    inspector = createInspector({
      manifest, detections, infrastructure,
      photoUrl: name => photoTileUrl(vuelo, name),
      photoHdUrl: name => photoHdUrl(vuelo, name),
      cropUrl: cropPath => cropUrl(vuelo, cropPath),
      alertLog,
      toast,
    });

    // Annotations: store + layer + draw tool + editor modal.
    annotations = createAnnotations(vuelo);
    layers.annotations = addAnnotationsLayer(map, annotations.toFeatureCollection());
    annotationDraw = createAnnotationDraw(map);
    annotationEditor = createAnnotationEditor({
      onSave: data => {
        if (data.id) {
          annotations.update(data.id, data);
          toast('Anotación actualizada', 'success');
        } else {
          annotations.add(data);
          toast('Anotación creada', 'success');
        }
      },
      onDelete: id => {
        annotations.remove(id);
        toast('Anotación eliminada', 'info');
      },
      onOpenPhoto: imgName => openInspectorForImage(imgName),
      findNearestPhoto: ([lng, lat]) => findNearestOverlay(lng, lat),
    });
    annotations.subscribe(() => {
      layers.annotations.setData(annotations.toFeatureCollection());
      updateAnnCount();
    });
    annotationDraw.onFinish(geom => {
      annotationEditor.openCreate(geom);
    });
    annotationDraw.onModeChange(mode => updateDrawUI(mode));
    layers.annotations.onClick(id => {
      const a = annotations.get(id);
      if (a) annotationEditor.openEdit(a);
    });
    wireAnnotationUI();

    wireMapClicks();

    // Fit a los bounds del vuelo.
    if (manifest.bounds) {
      const [[w, s], [e, n]] = manifest.bounds;
      map.fitBounds([[w, s], [e, n]], { padding: 80, duration: 0 });
    }

    setReady(manifest, detections);
  });

  wireLayerToggles();
}

function wireMapClicks() {
  // Click en una detección → abre inspector directo con esa detección activa.
  map.on('click', 'detections-point', e => {
    const id = e.features[0].properties.id;
    const det = detections.features.find(f => f.properties.id === id);
    if (det?.properties?.source_image) {
      inspector.open(det.properties);
      e.preventDefault();
    }
  });
  map.on('mouseenter', 'detections-point', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'detections-point', () => { map.getCanvas().style.cursor = ''; });

  // Click en un footprint → popup con resumen + botón a inspector.
  map.on('click', 'footprints-fill', e => {
    const p = e.features[0].properties;
    const imgName = p.image || findNearestOverlay(e.lngLat.lng, e.lngLat.lat);
    if (imgName) popup.show(imgName, e.originalEvent.clientX, e.originalEvent.clientY);
    e.preventDefault();
  });
  map.on('mouseenter', 'footprints-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'footprints-fill', () => { map.getCanvas().style.cursor = ''; });

  // Click general en el mapa: si caemos sobre una foto raster (que no
  // emite eventos), buscamos qué foto contiene el punto.
  map.on('click', e => {
    if (e.defaultPrevented) { popup.close(); return; }
    if (!manifest?.image_overlays || map.getZoom() < 12) { popup.close(); return; }
    const lng = e.lngLat.lng, lat = e.lngLat.lat;
    let hit = null;
    for (const [name, ov] of Object.entries(manifest.image_overlays)) {
      if (!ov.footprint?.length) continue;
      const lngs = ov.footprint.map(p => p[0]);
      const lats = ov.footprint.map(p => p[1]);
      if (lng >= Math.min(...lngs) && lng <= Math.max(...lngs) &&
          lat >= Math.min(...lats) && lat <= Math.max(...lats)) {
        hit = name; break;
      }
    }
    if (hit) popup.show(hit, e.originalEvent.clientX, e.originalEvent.clientY);
    else popup.close();
  });
}

function openInspectorForImage(imgName) {
  // Si hay detecciones para la foto, abrir el inspector seleccionando
  // la primera. Sino, abrir solo con la foto.
  photoCache?.prefetchAround(imgName);
  const dets = detectionsForImage(imgName);
  if (dets.length > 0) inspector.open(dets[0].properties);
  else inspector.open({ source_image: imgName, id: imgName });
}

function detectionsForImage(imgName) {
  if (!detections?.features) return [];
  return detections.features.filter(f => {
    const src = f.properties?.source_image;
    return src === imgName || src === imgName.toUpperCase() || src === imgName.toLowerCase();
  });
}

function findNearestOverlay(lng, lat) {
  if (!manifest?.image_overlays) return null;
  let best = null, bestD = Infinity;
  for (const [name, ov] of Object.entries(manifest.image_overlays)) {
    if (!ov.footprint?.length) continue;
    const lngs = ov.footprint.map(p => p[0]);
    const lats = ov.footprint.map(p => p[1]);
    const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const d = Math.hypot(cLng - lng, cLat - lat);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

function renderHeader(manifest) {
  els.title.textContent = manifest.name || `Vuelo ${vuelo}`;
  els.sub.textContent = `${cliente || '—'} · ${proyecto || '—'}`;
  els.meta.innerHTML = `
    <dt>cliente</dt><dd>${esc(cliente || '—')}</dd>
    <dt>proyecto</dt><dd>${esc(proyecto || '—')}</dd>
    <dt>vuelo</dt><dd><code>${esc(vuelo)}</code></dd>
    <dt>fecha</dt><dd>${esc(manifest.date || fecha || '—')}</dd>
    <dt>fotos</dt><dd>${Object.keys(manifest.image_overlays || {}).length}</dd>
  `;
}

function setReady(manifest, detections) {
  const photoCount = Object.keys(manifest.image_overlays || {}).length;
  const detCount = detections.features?.length || 0;
  els.status.classList.remove('error');
  els.status.textContent = `listo · ${photoCount} fotos · ${detCount} detecciones · zoom >13 muestra fotos`;
}

function setError(msg) {
  els.status.classList.add('error');
  els.status.textContent = msg;
}

function wireLayerToggles() {
  for (const cb of document.querySelectorAll('[data-layer]')) {
    cb.addEventListener('change', () => {
      const key = cb.dataset.layer;
      if (key === 'photos') {
        photoCache?.setVisible(cb.checked);
        return;
      }
      const h = layers[key];
      if (h) h.setVisible(cb.checked);
    });
  }
}

const ANN_HINT_TEXT = {
  circle: 'Mantené click + arrastrá para definir radio. Soltá para terminar.',
  rectangle: 'Mantené click + arrastrá para definir esquinas. Soltá para terminar.',
  polygon: 'Click para agregar vértices. Doble click para terminar (mínimo 3).',
};

function wireAnnotationUI() {
  const shapeBtns = document.querySelectorAll('[data-shape]');
  const cancelBtn = document.getElementById('ann-cancel-btn');
  const hint = document.getElementById('ann-hint');

  for (const btn of shapeBtns) {
    btn.addEventListener('click', () => {
      const shape = btn.dataset.shape;
      // Si el mismo shape ya está activo, cancela; sino arranca/cambia.
      if (annotationDraw.getMode() === shape) annotationDraw.cancel();
      else annotationDraw.start(shape);
    });
  }

  cancelBtn.addEventListener('click', () => annotationDraw.cancel());

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && annotationDraw.getMode()) {
      annotationDraw.cancel();
    }
  });

  // Estado inicial de UI
  updateAnnCount();
  updateDrawUI(null);
}

function updateDrawUI(mode) {
  for (const btn of document.querySelectorAll('[data-shape]')) {
    btn.classList.toggle('active', btn.dataset.shape === mode);
  }
  const cancelBtn = document.getElementById('ann-cancel-btn');
  const hint = document.getElementById('ann-hint');
  if (mode) {
    cancelBtn.classList.add('show');
    hint.textContent = ANN_HINT_TEXT[mode] || '';
    hint.classList.add('show');
  } else {
    cancelBtn.classList.remove('show');
    hint.classList.remove('show');
  }
}

function updateAnnCount() {
  const el = document.getElementById('ann-count');
  if (!el || !annotations) return;
  const n = annotations.count();
  el.textContent = `${n} anotación${n === 1 ? '' : 'es'}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function detectionsWithGeometry(fc) {
  if (!fc?.features) return fc;
  return {
    ...fc,
    features: fc.features.filter(f => f.geometry?.coordinates),
  };
}
