import { listFlights } from '../api/flights.js';

const REFRESH_MS = 5000;

const els = {
  flights: document.getElementById('flights'),
  empty: document.getElementById('empty'),
  error: document.getElementById('error'),
  connDot: document.getElementById('conn-dot'),
  connText: document.getElementById('conn-text'),
  lastUpdate: document.getElementById('last-update'),
};

async function refresh() {
  try {
    const flights = await listFlights();
    flights.sort((a, b) => b.created_at.localeCompare(a.created_at));
    render(flights);
    setConnected(true);
    els.error.hidden = true;
  } catch (err) {
    console.error(err);
    setConnected(false);
    els.error.textContent = `No se pudo conectar al server (${err.code || err.message}). Reintentando…`;
    els.error.hidden = false;
  }
}

function render(flights) {
  els.empty.hidden = flights.length > 0;
  els.flights.innerHTML = '';
  for (const f of flights) {
    const card = document.createElement('a');
    card.className = 'flight-card';
    card.href = `flight-live.html?id=${encodeURIComponent(f.flight_id)}`;
    card.innerHTML = `
      <div class="flight-title">
        ${esc(f.cliente)} · ${esc(f.proyecto)} · ${esc(f.vuelo_id)}
      </div>
      <div class="flight-meta">
        <span class="badge ${f.status}">${esc(f.status)}</span>
        <span>${f.photo_count} fotos</span>
        <span>dron · ${esc(f.drone_id)}</span>
        <span>${esc(f.fecha)}</span>
      </div>
    `;
    els.flights.appendChild(card);
  }
}

function setConnected(ok) {
  els.connDot.classList.toggle('live', ok);
  els.connText.textContent = ok ? 'conectado al server' : 'sin conexión';
  if (ok) {
    els.lastUpdate.textContent = `· última actualización ${new Date().toLocaleTimeString('es-PE')}`;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

refresh();
setInterval(refresh, REFRESH_MS);
