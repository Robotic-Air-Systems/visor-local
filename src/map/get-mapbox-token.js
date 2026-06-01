import { getConfig } from '../api/flights.js';

// Resuelve el token Mapbox de dos fuentes posibles:
//   1. GET /config — caso normal cuando hay server live (photos-to-kmz
//      lee P2K_MAPBOX_TOKEN del env y lo expone).
//   2. window.MBT — caso archive sin server live, leído de
//      config.local.js (gitignored, cada dev pone el suyo).
//
// Si ninguno responde con un token, devuelve null y el caller decide
// si seguir con basemap streets (sin token) o abortar.

const CONFIG_TIMEOUT_MS = 3000;

export async function getMapboxToken() {
  try {
    const cfg = await withTimeout(getConfig(), CONFIG_TIMEOUT_MS);
    if (cfg?.mapbox_token) return cfg.mapbox_token;
  } catch (e) {
    console.warn('GET /config falló, intentando fallback window.MBT:', e.message);
  }
  if (window.MBT) return window.MBT;
  return null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}
