// Live view: connect to /flights/{id}/live, render tiles on Mapbox as
// they arrive, re-position quads on strategy_updated.

const flightId = new URLSearchParams(location.search).get('id');
if (!flightId) {
  document.body.innerHTML = '<p style="padding:2em">Missing ?id=&lt;flight_id&gt;</p>';
  throw new Error('no flight_id');
}

// One Mapbox ImageSource + RasterLayer per photo. We need the source id
// to call setCoordinates() on strategy_updated; we keep the latest known
// quad so a re-fit can include it.
const overlays = new Map();  // name -> { sourceId, layerId, quad }
let map;
let mapboxToken;
let flightInfo = null;
let fitTimer = null;
let firstPhotoSeen = false;

async function bootstrap() {
  const cfg = await fetch('/config').then(r => r.json());
  mapboxToken = cfg.mapbox_token || '';
  if (!mapboxToken) {
    document.getElementById('status').textContent =
      'Set P2K_MAPBOX_TOKEN env var on the server.';
    return;
  }
  mapboxgl.accessToken = mapboxToken;
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [-77.0, -12.0],   // Lima default; first photo will re-center
    zoom: 4,
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('load', () => connect());
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/flights/${flightId}/live`);
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
  ws.onopen = () => setStatus('connected');
  ws.onclose = () => {
    setStatus('disconnected — retrying…');
    setTimeout(connect, 1500);
  };
  ws.onerror = (e) => console.error('ws error', e);
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'hello':
      onHello(evt);
      break;
    case 'photo_processed':
      addOrUpdate(evt.photo);
      bumpPhotoCount();
      scheduleFit();
      break;
    case 'strategy_updated':
      onStrategyUpdated(evt);
      break;
    case 'flight_ended':
      onFlightEnded(evt);
      break;
    default:
      console.log('unknown event', evt);
  }
}

function onHello(evt) {
  flightInfo = evt.flight;
  document.getElementById('flight-title').textContent =
    `${flightInfo.cliente} · ${flightInfo.proyecto} · ${flightInfo.vuelo_id}`;
  const meta = document.getElementById('flight-meta');
  meta.innerHTML = `
    <dt>flight_id</dt><dd>${escape(flightInfo.flight_id)}</dd>
    <dt>fecha</dt><dd>${escape(flightInfo.fecha)}</dd>
    <dt>drone</dt><dd>${escape(flightInfo.drone_id)}</dd>
  `;
  setStrategy(flightInfo.strategy_version, flightInfo.strategy_descriptor);
  for (const p of (evt.photos || [])) addOrUpdate(p);
  bumpPhotoCount();
  scheduleFit();
}

function addOrUpdate(photo) {
  const name = photo.name;
  const coords = quadToMapboxCoords(photo.quad);
  const tileUrl = location.origin + photo.tile_url;
  const sourceId = `src-${cssId(name)}`;
  const layerId = `lyr-${cssId(name)}`;
  const existing = overlays.get(name);
  if (existing) {
    // Tile bytes never change; only the quad does. setCoordinates()
    // is the right primitive for that.
    map.getSource(existing.sourceId).setCoordinates(coords);
    existing.quad = photo.quad;
    return;
  }
  map.addSource(sourceId, { type: 'image', url: tileUrl, coordinates: coords });
  map.addLayer({ id: layerId, type: 'raster', source: sourceId });
  overlays.set(name, { sourceId, layerId, quad: photo.quad });
}

function onStrategyUpdated(evt) {
  setStrategy(evt.strategy_version, evt.descriptor);
  for (const upd of (evt.affected_photos || [])) {
    const existing = overlays.get(upd.name);
    if (!existing) continue;
    map.getSource(existing.sourceId).setCoordinates(quadToMapboxCoords(upd.quad));
    existing.quad = upd.quad;
  }
}

function onFlightEnded(evt) {
  setStatus(`vuelo terminado · ${evt.summary.photo_count} fotos`);
}

// Server emits quads as [LL, LR, UR, UL] each [lat, lon]. Mapbox image
// coords expect [TL, TR, BR, BL] each [lng, lat]. Map:
//   TL = UL = [3]   TR = UR = [2]   BR = LR = [1]   BL = LL = [0]
function quadToMapboxCoords(quad) {
  return [3, 2, 1, 0].map(i => [quad[i][1], quad[i][0]]);
}

// Throttled fit: at most one fit per 1.5 s, batches multiple arrivals.
function scheduleFit() {
  if (fitTimer) return;
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (overlays.size === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const ov of overlays.values()) {
      for (const [lat, lon] of ov.quad) bounds.extend([lon, lat]);
    }
    map.fitBounds(bounds, {
      padding: 60,
      duration: 800,
      // First photo: snap to it. After that: don't zoom out too far,
      // some drones drift into a wide bbox and we don't want a constant
      // zoom-out animation.
      maxZoom: firstPhotoSeen ? map.getZoom() : 17,
    });
    firstPhotoSeen = true;
  }, 1500);
}

function setStatus(s) { document.getElementById('status').textContent = s; }
function setStrategy(v, desc) {
  const d = Array.isArray(desc) ? `${desc[0]} ${Number(desc[1]).toFixed(2)}` : '—';
  document.getElementById('strategy').textContent = `strategy v${v}: ${d}`;
}
function bumpPhotoCount() {
  document.getElementById('photo-count').textContent = `${overlays.size} fotos`;
}
function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

bootstrap();
