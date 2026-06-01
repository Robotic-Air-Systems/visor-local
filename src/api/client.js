import { getAuthHeader } from '../session/session.js';

// Prefix configurable para cuando aparezca el gateway nginx. Hoy
// vacío (photos-to-kmz se autosirve). Fase B: '/api'.
export const API_PREFIX = '';

// Host base configurable via window.API_BASE / window.WS_BASE en
// `config.local.js`. Si NO se setean, las URLs son relativas al origin
// del documento — modo "visor servido por el mismo host que el API"
// (la opción más simple). Si SE setean, el visor puede correr en un
// host distinto al backend (ej. laptop operador con `serve.py` local
// apuntando a un photos-to-kmz remoto vía Tailscale) — en ese caso el
// server necesita CORS habilitado + WS Origin allowlist.
function getApiBase() {
  if (typeof window !== 'undefined' && window.API_BASE) {
    return window.API_BASE.replace(/\/$/, '');
  }
  return '';
}

function getWsBase() {
  if (typeof window !== 'undefined' && window.WS_BASE) {
    return window.WS_BASE.replace(/\/$/, '');
  }
  // Derivar del origin actual (mismo-host como antes).
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

export function apiUrl(path) {
  return getApiBase() + API_PREFIX + path;
}

export function wsUrl(path) {
  return getWsBase() + API_PREFIX + path;
}

export async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  const headers = { ...(opts.headers || {}), ...getAuthHeader() };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw await normalizeError(res);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

async function normalizeError(res) {
  let payload = null;
  try { payload = await res.json(); } catch { /* not JSON */ }
  const err = new Error(payload?.error?.message || res.statusText || 'request failed');
  err.code = payload?.error?.code || `http_${res.status}`;
  err.status = res.status;
  err.hint = payload?.error?.hint || null;
  return err;
}
