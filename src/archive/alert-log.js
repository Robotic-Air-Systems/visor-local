// Log de feedback por alerta (detección/anotación) en localStorage.
// Cada vuelo tiene su key (`af_log_<vueloId>`) — no se mezclan.
//
// Esquema:
//   { [itemId]: { status: '...', events: [{action, comment, ts}] } }
//
// `status` es derivado del último `action`. `events` mantiene historial.
// Cuando exista persistencia server-side (Fase D del sistema), este
// módulo cambia su implementación interna; el contrato se preserva.

export function createAlertLog(vueloId) {
  const KEY = `af_log_${vueloId}`;
  let log = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) log = JSON.parse(raw);
  } catch {
    log = {};
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch {}
  }

  return {
    getStatus(id) { return log[id]?.status || 'pending'; },
    getEvents(id) { return log[id]?.events || []; },
    recordEvent(id, action, comment = '') {
      if (!log[id]) log[id] = { status: 'pending', events: [] };
      log[id].status = action;
      log[id].events.push({ action, comment, ts: Date.now() });
      persist();
    },
    remove(id) {
      if (id in log) {
        delete log[id];
        persist();
      }
    },
    all() { return { ...log }; },
  };
}
