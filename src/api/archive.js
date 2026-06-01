// Data layer del archive view. Hoy lee filesystem estático; Fase D
// del sistema (ver SYSTEM_ARCHITECTURE.md) cambia a /api/archive/*. Las
// páginas no se enteran porque consumen estas funciones.
//
// Paths relativos al document (`pages/flight-archive.html` → `../data/`),
// así funciona en cualquier mount-point: raíz del dominio
// (https://host/), serve.py local (http://127.0.0.1:8765/), o un
// subpath si algún día se monta bajo prefijo.

const DATA_ROOT = '../data';

function reportPath(vuelo) {
  return `${DATA_ROOT}/report_${encodeURIComponent(vuelo)}`;
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`failed to load ${url}: HTTP ${res.status}`);
    err.status = res.status;
    err.url = url;
    throw err;
  }
  return res.json();
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function emptyFCOn404(err) {
  if (err.status === 404) return emptyFC();
  throw err;
}

export function loadManifest(vuelo) {
  return loadJson(`${reportPath(vuelo)}/manifest.json`);
}

export function loadDetections(vuelo) {
  return loadJson(`${reportPath(vuelo)}/detections.geojson`).catch(emptyFCOn404);
}

export function loadFlightPath(vuelo) {
  return loadJson(`${reportPath(vuelo)}/flight_path.geojson`).catch(emptyFCOn404);
}

// La infraestructura (ducto, postes, estaciones) es estática del cliente
// — la geometría no cambia por vuelo, así que vive en `data/` a nivel
// root, no por carpeta de reporte.
export function loadInfrastructure() {
  return Promise.all([
    loadJson(`${DATA_ROOT}/ductos.geojson`).catch(emptyFCOn404),
    loadJson(`${DATA_ROOT}/estaciones.geojson`).catch(emptyFCOn404),
    loadJson(`${DATA_ROOT}/postes.geojson`).catch(emptyFCOn404),
  ]).then(([ductos, estaciones, postes]) => ({ ductos, estaciones, postes }));
}

// Convierte el `image_overlays` del manifest en un FeatureCollection
// de polígonos. Si se pasan detecciones, marca las fotos que las
// tienen para que la capa de footprints pinte distinto.
//
// Orden del footprint en el manifest: [LL, LR, UR, UL] en [lon, lat].
// Polígono GeoJSON debe cerrar (último punto = primero) y va
// counter-clockwise para outer ring; el orden UL→UR→LR→LL→UL
// satisface ambas.
export function buildFootprintsFC(manifest, detections = null) {
  if (!manifest?.image_overlays) return emptyFC();
  const detSet = new Set();
  if (detections?.features) {
    for (const f of detections.features) {
      const name = f.properties?.source_image;
      if (name) detSet.add(name.toUpperCase());
    }
  }
  const features = [];
  for (const [name, ov] of Object.entries(manifest.image_overlays)) {
    if (!ov.footprint?.length) continue;
    const [ll, lr, ur, ul] = ov.footprint;
    features.push({
      type: 'Feature',
      properties: {
        image: name,
        has_detections: detSet.has(name.toUpperCase()),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[ul, ur, lr, ll, ul]],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// URLs de tiles. El visor las consume directo (image sources, <img>,
// etc.). Lowercase porque las fotos del KMZ se extraen en lowercase
// y el server estático es case-sensitive en Linux.
export function photoTileUrl(vuelo, name) {
  return `${reportPath(vuelo)}/photos/${name.toLowerCase()}.webp`;
}

export function photoHdUrl(vuelo, name) {
  return `${reportPath(vuelo)}/photos_hd/${name.toLowerCase()}.webp`;
}

export function cropUrl(vuelo, cropPath) {
  return cropPath ? `${reportPath(vuelo)}/${cropPath}` : '';
}
