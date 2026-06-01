// Notificación toast en la esquina inferior. Auto-crea el container y
// los estilos en la primera invocación — la página no necesita HTML ni
// CSS para usarlo:
//
//   import { toast } from '../ui/toast.js';   // path relativo al importador
//   toast('Guardado', 'success');
//   toast('No se pudo conectar', 'error', 4000);
//
// Tipos: 'success' | 'error' | 'info' | 'warn'. El default es 'success'.

const CONTAINER_ID = '__af_toasts';
const FADE_MS = 300;

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    #${CONTAINER_ID} {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 10000;
      pointer-events: none;
    }
    #${CONTAINER_ID} .toast {
      background: #fff;
      border: 1px solid #D8DBE2;
      border-radius: 8px;
      padding: 10px 18px;
      box-shadow: 0 8px 28px rgba(0,0,0,.13);
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 13px;
      color: #001011;
      pointer-events: all;
      animation: af-toast-in 200ms ease-out;
      min-width: 200px;
      max-width: 480px;
    }
    #${CONTAINER_ID} .toast.success { border-left: 3px solid #15803d; }
    #${CONTAINER_ID} .toast.error   { border-left: 3px solid #b91c1c; }
    #${CONTAINER_ID} .toast.info    { border-left: 3px solid #1736F5; }
    #${CONTAINER_ID} .toast.warn    { border-left: 3px solid #b45309; }
    @keyframes af-toast-in {
      from { transform: translateY(10px); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

function ensureContainer() {
  let c = document.getElementById(CONTAINER_ID);
  if (c) return c;
  injectStyles();
  c = document.createElement('div');
  c.id = CONTAINER_ID;
  document.body.appendChild(c);
  return c;
}

export function toast(msg, type = 'success', ms = 2500) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = `opacity ${FADE_MS}ms`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), FADE_MS);
  }, ms);
  return el;
}
