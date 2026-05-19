// Lists all flights from GET /flights, renders one card per flight,
// links each to flight.html?id=<flight_id>.
async function refresh() {
  const data = await fetch('/flights').then(r => r.json());
  const flights = data.flights || [];
  const container = document.getElementById('flights');
  container.innerHTML = '';
  document.getElementById('empty').hidden = flights.length > 0;
  // Newest first.
  flights.sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const f of flights) {
    const card = document.createElement('a');
    card.className = `flight-card status-${f.status}`;
    card.href = `flight.html?id=${encodeURIComponent(f.flight_id)}`;
    card.innerHTML = `
      <div class="title">${escape(f.cliente)} · ${escape(f.proyecto)} · ${escape(f.vuelo_id)}</div>
      <div class="meta">
        <span class="badge ${f.status}">${f.status}</span>
        <span>${f.photo_count} fotos</span>
        <span>${escape(f.drone_id)}</span>
        <span>${escape(f.fecha)}</span>
      </div>
    `;
    container.appendChild(card);
  }
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

refresh();
setInterval(refresh, 5000);
