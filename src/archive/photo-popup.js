// Popup chico al click sobre una foto/footprint en el mapa. Muestra el
// nombre de la foto + cantidad de detecciones, con un botón "Ver foto"
// que abre el inspector.
//
// Auto-crea su DOM y estilos en primer uso. Reutilizable en múltiples
// instancias (cada `createPhotoPopup` es independiente).

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .af-photo-popup {
      position: absolute;
      display: none;
      z-index: 30;
      background: #fff;
      border: 1px solid #D8DBE2;
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0,0,0,.18);
      width: 260px;
      font-family: 'Outfit', system-ui, sans-serif;
      animation: af-pp-in .15s ease-out;
    }
    .af-photo-popup.show { display: block; }
    @keyframes af-pp-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .af-photo-popup .close {
      position: absolute;
      top: 8px; right: 8px;
      width: 22px; height: 22px;
      background: none; border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      color: #6b7488;
      display: flex; align-items: center; justify-content: center;
    }
    .af-photo-popup .close:hover { background: rgba(0,0,0,.06); }
    .af-photo-popup .body { padding: 14px 16px 12px; }
    .af-photo-popup .name {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #001011;
      margin-bottom: 4px;
      padding-right: 22px;
    }
    .af-photo-popup .sub { font-size: 12px; color: #6b7488; margin-bottom: 12px; }
    .af-photo-popup .sep {
      height: 1px;
      background: #D8DBE2;
      margin: 0 -16px 12px;
    }
    .af-photo-popup .link {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #1736F5;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-family: 'Outfit', system-ui, sans-serif;
      text-align: left;
    }
    .af-photo-popup .link:hover { text-decoration: underline; }
  `;
  document.head.appendChild(s);
}

export function createPhotoPopup({ container, onOpen, countDetections }) {
  injectStyles();
  let currentImg = null;
  const el = document.createElement('div');
  el.className = 'af-photo-popup';
  el.innerHTML = `
    <button class="close" type="button" aria-label="Cerrar">✕</button>
    <div class="body">
      <div class="name"></div>
      <div class="sub"></div>
      <div class="sep"></div>
      <button class="link" type="button">Ver foto completa →</button>
    </div>
  `;
  container.appendChild(el);

  const nameEl = el.querySelector('.name');
  const subEl = el.querySelector('.sub');
  const closeBtn = el.querySelector('.close');
  const openBtn = el.querySelector('.link');

  closeBtn.addEventListener('click', close);
  openBtn.addEventListener('click', () => {
    if (!currentImg) return;
    const img = currentImg;
    close();
    onOpen?.(img);
  });

  function show(imgName, clientX, clientY) {
    currentImg = imgName;
    const detCount = countDetections?.(imgName) ?? 0;
    nameEl.textContent = imgName;
    subEl.textContent = detCount
      ? `Foto del dron · ${detCount} detección${detCount !== 1 ? 'es' : ''}`
      : 'Foto del dron · sin alertas';
    // Posicionar relativo al container (usa offsetParent positioning).
    const r = container.getBoundingClientRect();
    const popW = 260;
    let left = clientX - r.left - popW / 2;
    let top = clientY - r.top - 120;
    left = Math.max(8, Math.min(left, r.width - popW - 8));
    top = Math.max(8, top);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.classList.add('show');
  }

  function close() {
    el.classList.remove('show');
    currentImg = null;
  }

  return { show, close, get currentImg() { return currentImg; } };
}
