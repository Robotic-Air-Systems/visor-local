// Modal genérico. Auto-crea backdrop + card con header + body + footer.
// Maneja Esc + click-outside + close button. Múltiples instancias
// independientes coexisten (z-index único por instancia).
//
// Uso:
//   const m = createModal({ title: 'Editar', width: 460 });
//   m.setBody(htmlOrElement);
//   m.setFooter(htmlOrElement);
//   m.open();
//   m.onClose(() => { ... });

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .af-modal-backdrop {
      position: fixed; inset: 0; z-index: 500;
      background: rgba(0, 16, 17, .45);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center; justify-content: center;
      padding: 20px;
      font-family: 'Outfit', system-ui, sans-serif;
    }
    .af-modal-backdrop.show { display: flex; }
    .af-modal-card {
      background: #fff;
      border-radius: 12px;
      max-height: 90vh;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.18);
      animation: af-modal-in .15s ease-out;
    }
    @keyframes af-modal-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .af-modal-head {
      background: #111D4A;
      color: #fff;
      padding: 13px 16px;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .af-modal-title { font-size: 14px; font-weight: 600; }
    .af-modal-x {
      background: rgba(255,255,255,.1);
      border: 1px solid rgba(255,255,255,.2);
      color: #fff;
      width: 26px; height: 26px;
      border-radius: 5px; cursor: pointer; font-size: 11px;
      display: flex; align-items: center; justify-content: center;
    }
    .af-modal-x:hover { background: rgba(255,255,255,.2); }
    .af-modal-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }
    .af-modal-foot {
      padding: 11px 16px;
      border-top: 1px solid #D8DBE2;
      background: #F4F6FA;
      display: flex; align-items: center; gap: 7px;
      flex-shrink: 0;
    }
    .af-modal-foot:empty { display: none; }
    .af-modal-btn {
      padding: 7px 14px;
      background: #fff;
      color: #001011;
      border: 1px solid #D8DBE2;
      border-radius: 6px;
      cursor: pointer;
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 12px; font-weight: 500;
      transition: background .12s, border-color .12s;
    }
    .af-modal-btn:hover { border-color: #1736F5; }
    .af-modal-btn.ghost { background: #fff; color: #5b6478; }
    .af-modal-btn.primary {
      background: #1736F5; color: #fff; border-color: #1736F5; font-weight: 600;
    }
    .af-modal-btn.primary:hover { background: #0f27db; }
    .af-modal-btn.danger {
      background: #fff; color: #dc2626; border-color: #fca5a5;
    }
    .af-modal-btn.danger:hover { background: #fee2e2; }
    .af-modal-btn[hidden] { display: none; }
  `;
  document.head.appendChild(s);
}

export function createModal({ title = '', width = 460 } = {}) {
  injectStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'af-modal-backdrop';
  backdrop.innerHTML = `
    <div class="af-modal-card" style="width:${width}px;max-width:95vw">
      <div class="af-modal-head">
        <h3 class="af-modal-title"></h3>
        <button class="af-modal-x" type="button" aria-label="Cerrar">✕</button>
      </div>
      <div class="af-modal-body"></div>
      <div class="af-modal-foot"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const titleEl = backdrop.querySelector('.af-modal-title');
  const body = backdrop.querySelector('.af-modal-body');
  const foot = backdrop.querySelector('.af-modal-foot');
  const closeBtn = backdrop.querySelector('.af-modal-x');

  titleEl.textContent = title;
  const closeListeners = new Set();

  function open() {
    backdrop.classList.add('show');
  }

  function close() {
    if (!backdrop.classList.contains('show')) return;
    backdrop.classList.remove('show');
    for (const fn of closeListeners) {
      try { fn(); } catch (e) { console.error('modal close listener', e); }
    }
  }

  function setTitle(t) { titleEl.textContent = t; }

  function setBody(content) {
    if (typeof content === 'string') body.innerHTML = content;
    else { body.innerHTML = ''; body.appendChild(content); }
  }

  function setFooter(content) {
    if (typeof content === 'string') foot.innerHTML = content;
    else { foot.innerHTML = ''; foot.appendChild(content); }
  }

  function onClose(fn) {
    closeListeners.add(fn);
    return () => closeListeners.delete(fn);
  }

  function destroy() {
    closeListeners.clear();
    backdrop.remove();
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  // Esc cierra solo si este modal está visible (otros pueden estar arriba).
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('show')) close();
  });

  return {
    open, close, setTitle, setBody, setFooter, onClose, destroy,
    get body() { return body; },
    get foot() { return foot; },
    get element() { return backdrop; },
  };
}
