// MapLibre basemap factory. Tres fondos: satélite (Mapbox, requiere
// token), calles (OSM), terreno (ArcGIS topo). La preferencia se
// persiste en localStorage para que aplique a todas las páginas con
// mapa. Si el usuario eligió 'satellite' pero no hay token, fallback
// silencioso a 'streets'.

const STORAGE_KEY = 'af_basemap';
const DEFAULT_BASEMAP = 'satellite';

export const BASEMAPS = [
  { id: 'satellite', label: 'Satélite', requiresToken: true },
  { id: 'streets', label: 'Calles', requiresToken: false },
  { id: 'terrain', label: 'Terreno', requiresToken: false },
];

export function getBasemapPreference() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASEMAP;
}

export function setBasemapPreference(name) {
  localStorage.setItem(STORAGE_KEY, name);
}

function basemapSources(mapboxToken) {
  return {
    satellite: mapboxToken ? {
      tiles: [
        `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxToken}`,
      ],
      tileSize: 512,
      maxzoom: 19,
    } : null,
    streets: {
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
    },
    terrain: {
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  };
}

export function resolveBasemapName(preferredName, mapboxToken) {
  const sources = basemapSources(mapboxToken);
  if (sources[preferredName]) return preferredName;
  // Pidió uno no disponible (típicamente satellite sin token).
  return 'streets';
}

export function createBasemapStyle(preferredName, mapboxToken) {
  const sources = basemapSources(mapboxToken);
  const name = resolveBasemapName(preferredName, mapboxToken);
  const cfg = sources[name];
  const style = {
    version: 8,
    sources: { bm: { type: 'raster', ...cfg } },
    layers: [{ id: 'bm-l', type: 'raster', source: 'bm' }],
  };
  // Glyphs habilitan symbol layers (text labels). Si no hay token,
  // las capas de tipo symbol simplemente no renderizan texto — los
  // círculos sí.
  if (mapboxToken) {
    style.glyphs = `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${mapboxToken}`;
  }
  return style;
}

export function switchBasemap(map, name, mapboxToken) {
  const sources = basemapSources(mapboxToken);
  const cfg = sources[name];
  if (!cfg) throw new Error(`basemap not available: ${name}`);
  map.getSource('bm')?.setTiles(cfg.tiles);
  setBasemapPreference(name);
}
