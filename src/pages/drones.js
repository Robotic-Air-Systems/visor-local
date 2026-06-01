import { listDrones, createDrone } from '../api/drones.js';

const REFRESH_MS = 5000;

const els = {
  list: document.getElementById('drones'),
  empty: document.getElementById('empty'),
  error: document.getElementById('error'),
  connDot: document.getElementById('conn-dot'),
  connText: document.getElementById('conn-text'),
  lastUpdate: document.getElementById('last-update'),
  btnCreate: document.getElementById('btn-create'),
  modalCreate: document.getElementById('modal-create'),
  formCreate: document.getElementById('form-create'),
  btnCancel: document.getElementById('btn-cancel'),
  btnSubmit: document.getElementById('btn-submit'),
  createError: document.getElementById('create-error'),
  modalToken: document.getElementById('modal-token'),
  tokenValue: document.getElementById('token-value'),
  btnCopy: document.getElementById('btn-copy'),
  btnTokenDone: document.getElementById('btn-token-done'),
  copyFlash: document.getElementById('copy-flash'),
};

let refreshTimer = null;
let modalOpen = false;

async function refresh() {
  // Si hay modal abierto, no re-renderizamos la lista (UX racy si el
  // usuario está creando uno y la lista cambia bajo sus pies).
  if (modalOpen) return;
  try {
    const drones = await listDrones();
    drones.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    render(drones);
    setConnected(true);
    els.error.hidden = true;
  } catch (err) {
    console.error(err);
    setConnected(false);
    els.error.textContent = `No se pudo conectar al server (${err.code || err.message}). Reintentando…`;
    els.error.hidden = false;
  }
}

function render(drones) {
  els.empty.hidden = drones.length > 0;
  els.list.innerHTML = '';
  for (const d of drones) {
    const card = document.createElement('div');
    card.className = 'drone-card';
    const lastSeen = d.last_seen_at
      ? `visto ${relativeTime(d.last_seen_at)}`
      : 'sin heartbeats aún';
    const flightLink = d.current_flight_id
      ? `<a href="flight-live.html?id=${encodeURIComponent(d.current_flight_id)}">ver vuelo activo →</a>`
      : '<span>sin vuelo activo</span>';
    card.innerHTML = `
      <div>
        <div class="drone-head">
          <span class="drone-name">${esc(d.name)}</span>
          <span class="drone-status ${d.online ? 'online' : 'offline'}">
            ${d.online ? 'online' : 'offline'}
          </span>
        </div>
        <div class="drone-meta">
          <span>cliente · ${esc(d.default_cliente)}</span>
          <span>proyecto · ${esc(d.default_proyecto)}</span>
          <span>label · ${esc(d.default_drone_id_label)}</span>
          <span>token · <code>${esc(d.token_prefix)}…</code></span>
        </div>
      </div>
      <div class="drone-side">
        <span>${esc(lastSeen)}</span>
        ${flightLink}
      </div>
    `;
    els.list.appendChild(card);
  }
}

function setConnected(ok) {
  els.connDot.classList.toggle('live', ok);
  els.connText.textContent = ok ? 'conectado al server' : 'sin conexión';
  if (ok) {
    els.lastUpdate.textContent = `· última actualización ${new Date().toLocaleTimeString('es-PE')}`;
  }
}

// ── modal create flow ───────────────────────────────────────────────

els.btnCreate.addEventListener('click', () => openCreate());
els.btnCancel.addEventListener('click', () => closeCreate());
els.modalCreate.addEventListener('click', (e) => {
  if (e.target === els.modalCreate) closeCreate();
});

els.formCreate.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(els.formCreate);
  const body = Object.fromEntries(fd.entries());
  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = 'Creando…';
  els.createError.hidden = true;
  try {
    const res = await createDrone(body);
    closeCreate();
    openTokenReveal(res.drone_token);
    // refresh inmediato cuando se cierre el token reveal
  } catch (err) {
    console.error(err);
    els.createError.textContent = `Error: ${err.message} (${err.code || err.status})`;
    els.createError.hidden = false;
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = 'Crear';
  }
});

function openCreate() {
  modalOpen = true;
  els.formCreate.reset();
  els.createError.hidden = true;
  els.modalCreate.hidden = false;
  els.formCreate.querySelector('input[name="name"]').focus();
}

function closeCreate() {
  modalOpen = false;
  els.modalCreate.hidden = true;
}

// ── token reveal ────────────────────────────────────────────────────

els.btnTokenDone.addEventListener('click', () => closeTokenReveal());
els.btnCopy.addEventListener('click', () => copyToken());
els.modalToken.addEventListener('click', (e) => {
  if (e.target === els.modalToken) closeTokenReveal();
});

function openTokenReveal(token) {
  modalOpen = true;
  els.tokenValue.textContent = token;
  els.copyFlash.innerHTML = '&nbsp;';
  els.modalToken.hidden = false;
}

function closeTokenReveal() {
  modalOpen = false;
  els.tokenValue.textContent = '';  // no dejarlo en el DOM
  els.modalToken.hidden = true;
  refresh();  // fetch inmediato — la lista debería tener el nuevo dron
}

async function copyToken() {
  const token = els.tokenValue.textContent;
  try {
    await navigator.clipboard.writeText(token);
    els.copyFlash.innerHTML = '<span class="copied-flash">copiado al portapapeles ✓</span>';
  } catch (err) {
    els.copyFlash.innerHTML = '<span class="copied-flash" style="color:var(--red)">no se pudo copiar — seleccioná y copiá a mano</span>';
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function relativeTime(iso) {
  const dt = new Date(iso);
  const secs = Math.max(0, (Date.now() - dt.getTime()) / 1000);
  if (secs < 60) return `hace ${Math.round(secs)}s`;
  if (secs < 3600) return `hace ${Math.round(secs / 60)} min`;
  if (secs < 86400) return `hace ${Math.round(secs / 3600)} h`;
  return dt.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── boot ────────────────────────────────────────────────────────────

refresh();
refreshTimer = setInterval(refresh, REFRESH_MS);
