import { wsUrl } from '../api/client.js';

// Conecta al WS /flights/{id}/live y despacha eventos tipados a handlers.
// Reconnect automático con backoff fijo (1.5s) — el server re-emite
// 'hello' con el snapshot completo, así que el cliente reconcilia
// automáticamente sin necesidad de replay.
//
// handlers: {
//   hello, photo_processed, strategy_updated, flight_ended, drone_done,
//   onOpen, onClose, onError, unknown
// }
//
// Devuelve { close } para cortar la reconexión.

export function connectFlightSocket(flightId, handlers = {}) {
  let ws = null;
  let stopped = false;
  let reconnectTimer = null;

  function open() {
    // wsUrl respeta `window.WS_BASE` si se setea, fallback a
    // wss?://location.host (mismo origin que el documento).
    const url = wsUrl(`/flights/${encodeURIComponent(flightId)}/live`);
    ws = new WebSocket(url);
    ws.onopen = () => handlers.onOpen?.();
    ws.onerror = (e) => handlers.onError?.(e);
    ws.onclose = () => {
      handlers.onClose?.();
      if (stopped) return;
      reconnectTimer = setTimeout(open, 1500);
    };
    ws.onmessage = (e) => {
      let evt;
      try {
        evt = JSON.parse(e.data);
      } catch (err) {
        console.error('flight-socket: bad JSON payload', err, e.data);
        return;
      }
      const fn = handlers[evt.type] || handlers.unknown;
      if (fn) fn(evt);
      else console.warn('flight-socket: unhandled event', evt.type, evt);
    };
  }

  function close() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }

  open();
  return { close };
}
