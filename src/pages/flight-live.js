/* global maplibregl */
import { connectFlightSocket } from '../live/flight-socket.js';
import {
  createBasemapStyle,
  getBasemapPreference,
} from '../map/basemap.js';
import {
  createPhotoOverlayManager,
} from '../map/photo-overlay.js';
import { getMapboxToken } from '../map/get-mapbox-token.js';

const FIT_DEBOUNCE_MS = 1500;
const INITIAL_CENTER = [-77.0, -12.0];  // Lima default; primera foto recentra
const INITIAL_ZOOM = 4;

const flightId = new URLSearchParams(location.search).get('id');
if (!flightId) {
  document.body.innerHTML = '<p style="padding:2em;font-family:system-ui">Falta <code>?id=&lt;flight_id&gt;</code> en la URL.</p>';
  throw new Error('missing flight_id query param');
}

const els = {
  title: document.getElementById('flight-title'),
  meta: document.getElementById('flight-meta'),
  connDot: document.getElementById('conn-dot'),
  connText: document.getElementById('conn-text'),
  photoCount: document.getElementById('photo-count'),
  strategy: document.getElementById('strategy'),
  droneDoneBanner: document.getElementById('drone-done-banner'),
};

let map = null;
let overlays = null;
let fitTimer = null;
let didInitialFit = false;

bootstrap();

async function bootstrap() {
  const mapboxToken = await getMapboxToken();
  if (!mapboxToken) {
    console.warn('Sin token Mapbox; basemap satellite no disponible, se usa streets.');
  }
  map = new maplibregl.Map({
    container: 'map',
    style: createBasemapStyle(getBasemapPreference(), mapboxToken),
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.on('load', () => {
    overlays = createPhotoOverlayManager(map, flightId);
    connect();
  });
}

function connect() {
  // Cuando se agregue render de detecciones en live, NO asumir que las
  // bboxes llegan junto con `photo_processed`. El roadmap server-side
  // (post-weekend) mueve detections a un evento separado
  // `detections_updated` (async, ~1-3s después de la foto). Reconnect
  // sigue trayendo lo histórico vía `hello.photos[*].detections`.
  connectFlightSocket(flightId, {
    onOpen: () => setStatus('connected', 'conectado'),
    onClose: () => setStatus('disconnected', 'desconectado — reintentando…'),
    onError: (e) => console.error('ws error', e),
    hello: onHello,
    photo_processed: onPhotoProcessed,
    strategy_updated: onStrategyUpdated,
    flight_ended: onFlightEnded,
    drone_done: onDroneDone,
    // detections_updated: onDetectionsUpdated,  // post-weekend
  });
}

function onHello(evt) {
  const f = evt.flight;
  els.title.textContent = `${f.cliente} · ${f.proyecto} · ${f.vuelo_id}`;
  els.meta.innerHTML = `
    <dt>flight_id</dt><dd>${esc(f.flight_id)}</dd>
    <dt>fecha</dt><dd>${esc(f.fecha)}</dd>
    <dt>dron</dt><dd>${esc(f.drone_id)}</dd>
  `;
  setStrategy(f.strategy_version, f.strategy_descriptor);
  for (const p of (evt.photos || [])) overlays.addOrUpdate(p);
  bumpPhotoCount();
  scheduleFit();
}

function onPhotoProcessed(evt) {
  overlays.addOrUpdate(evt.photo);
  bumpPhotoCount();
  scheduleFit();
}

function onStrategyUpdated(evt) {
  setStrategy(evt.strategy_version, evt.descriptor);
  for (const upd of (evt.affected_photos || [])) {
    overlays.setQuad(upd.name, upd.quad);
  }
}

function onFlightEnded(evt) {
  setStatus('ended', `vuelo terminado · ${evt.summary?.photo_count ?? overlays.size()} fotos`);
}

function onDroneDone(_evt) {
  els.droneDoneBanner.classList.add('show');
}

// Fit throttle: una sola animación cada FIT_DEBOUNCE_MS. La primera vez
// snap al cluster de fotos; después no zoom-out más que el zoom actual
// (drones con drift wide bbox no fuerzan zoom-out constante).
function scheduleFit() {
  if (fitTimer) return;
  fitTimer = setTimeout(() => {
    fitTimer = null;
    const bounds = overlays.getBounds();
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: 60,
      duration: 800,
      maxZoom: didInitialFit ? map.getZoom() : 17,
    });
    didInitialFit = true;
  }, FIT_DEBOUNCE_MS);
}

function setStatus(state, text) {
  els.connDot.className = `dot ${state}`;
  els.connText.textContent = text;
}

function setStrategy(version, descriptor) {
  const desc = Array.isArray(descriptor)
    ? `${descriptor[0]} ${Number(descriptor[1]).toFixed(2)}`
    : '—';
  els.strategy.textContent = `strategy v${version ?? '—'}: ${desc}`;
}

function bumpPhotoCount() {
  els.photoCount.textContent = String(overlays.size());
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
