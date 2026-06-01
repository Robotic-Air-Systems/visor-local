import { apiFetch } from './client.js';

export function listFlights() {
  return apiFetch('/flights').then(r => r.flights || []);
}

export function getFlight(flightId) {
  return apiFetch(`/flights/${encodeURIComponent(flightId)}`);
}

export function getConfig() {
  return apiFetch('/config');
}
