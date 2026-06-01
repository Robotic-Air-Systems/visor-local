import { apiFetch } from './client.js';

export function listDrones() {
  return apiFetch('/drones').then(r => r.drones || []);
}

export function getDrone(droneId) {
  return apiFetch(`/drones/${encodeURIComponent(droneId)}`);
}

// El response trae `drone_token` en cleartext una sola vez. La UI
// es responsable de mostrarlo al operador con disclaimer. Subsiguientes
// GET /drones solo devuelven token_prefix (primeros 8 chars).
export function createDrone(body) {
  return apiFetch('/drones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
