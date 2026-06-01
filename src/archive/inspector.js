// Panel del inspector: muestra una foto rectificada en alta resolución
// con sus bboxes de detección encima, permite zoom/pan, regla de
// medición geográfica (vía homografía inversa) y ajuste manual de la
// proyección del ducto sobre la foto.
//
// Auto-crea su DOM + estilos en primer uso. Recibe vía config las
// dependencias del entorno: manifest, detecciones, builders de URL,
// infraestructura para overlay.
//
// Uso desde la página:
//   const inspector = createInspector({
//     manifest, detections, infrastructure,
//     photoUrl, photoHdUrl, cropUrl,
//     alertLog, toast,
//   });
//   inspector.open({ source_image: 'RAS_00083', id: 'detection-id' });

import {
  computeHomography, applyHomography,
  haversineMeters, formatDistance,
} from './homography.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = INSPECTOR_CSS;
  document.head.appendChild(s);
}

const INSPECTOR_CSS = `
  .af-inspector {
    position: fixed; inset: 0; z-index: 1000;
    display: none;
    background: radial-gradient(ellipse at center, rgba(15,23,42,.94), rgba(1,2,16,.99));
    animation: af-insp-in .18s ease-out;
    font-family: 'Outfit', system-ui, sans-serif;
  }
  .af-inspector.open { display: flex; }
  @keyframes af-insp-in { from { opacity: 0; } to { opacity: 1; } }
  .af-insp-content {
    width: 100%; height: 100%;
    display: grid; grid-template-columns: 1fr 320px;
    overflow: hidden;
  }
  .af-insp-img-wrap {
    position: relative; background: #000;
    overflow: hidden; cursor: grab; user-select: none;
  }
  .af-insp-img-wrap.drag { cursor: grabbing; }
  .af-insp-img-wrap.ruler-mode { cursor: crosshair !important; }
  .af-insp-img-wrap img {
    position: absolute; transform-origin: 0 0;
    max-width: none; user-select: none; pointer-events: none;
    will-change: transform;
  }
  .af-insp-svg {
    position: absolute; top: 0; left: 0;
    transform-origin: 0 0;
    pointer-events: none; overflow: visible;
    will-change: transform;
  }
  .af-insp-svg .dl { stroke: #fbbf24; stroke-width: 4; fill: none;
    filter: drop-shadow(0 0 6px rgba(251,191,36,.5)); }
  .af-insp-svg .di { stroke: #fef3c7; stroke-width: 1.5; fill: none; stroke-dasharray: 6 4; }
  .af-insp-svg .dp { fill: #fbbf24; stroke: #fff; stroke-width: 2; }
  .af-insp-svg .ruler-line { stroke: #fde047; stroke-width: 2.5; fill: none;
    stroke-dasharray: 10 5; filter: drop-shadow(0 0 5px rgba(253,224,71,.7)); }
  .af-insp-svg .ruler-dot { fill: #fde047; stroke: #000; stroke-width: 2;
    filter: drop-shadow(0 0 4px rgba(253,224,71,.7)); }
  .af-insp-svg .ruler-lbl { fill: #fff; font-family: 'JetBrains Mono', monospace;
    font-size: 26px; font-weight: 700; paint-order: stroke; stroke: #000; stroke-width: 5px; }

  .af-ibx {
    position: absolute; border: 2px solid rgba(96,165,250,.8);
    pointer-events: auto; cursor: pointer;
  }
  .af-ibx.active { border-color: #fde047; box-shadow: 0 0 20px rgba(253,224,71,.35); }
  .af-ibx-lbl {
    position: absolute; top: -20px; left: 0;
    white-space: nowrap;
    background: rgba(15,23,42,.9); color: #93c5fd;
    font-size: 9.5px; padding: 2px 6px; border-radius: 3px;
    font-family: 'JetBrains Mono', monospace; pointer-events: none;
  }
  .af-ibx.active .af-ibx-lbl { background: rgba(253,224,71,.95); color: #422006; font-weight: 600; }

  .af-insp-ctrl {
    position: absolute; top: 14px; left: 14px; z-index: 10;
    display: flex; gap: 2px;
    background: rgba(15,23,42,.6); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 4px;
  }
  .af-insp-ctrl button {
    min-width: 28px; height: 28px; padding: 0 8px;
    background: none; border: none; color: rgba(255,255,255,.8);
    cursor: pointer; border-radius: 5px; font-size: 13px;
    display: flex; align-items: center; justify-content: center; transition: all .12s;
    font-family: 'Outfit', system-ui, sans-serif;
  }
  .af-insp-ctrl button:hover { background: rgba(255,255,255,.12); color: #fff; }
  .af-insp-ctrl button.on { background: rgba(253,224,71,.2); color: #fde047; }
  .af-insp-ctrl .sep { width: 1px; height: 20px; background: rgba(255,255,255,.12); margin: 4px 2px; }

  .af-zoom-ind {
    position: absolute; bottom: 12px; left: 14px; z-index: 10;
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    color: rgba(255,255,255,.4); background: rgba(0,0,0,.3);
    padding: 2px 7px; border-radius: 4px; pointer-events: none;
  }

  .af-ruler-panel {
    position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%);
    z-index: 15;
    background: rgba(15,23,42,.92); backdrop-filter: blur(8px);
    border: 1px solid rgba(253,224,71,.5); border-radius: 10px;
    padding: 10px 24px; display: none; text-align: center;
    pointer-events: none; min-width: 160px;
  }
  .af-ruler-panel.show { display: block; }
  .af-ruler-val { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 700; color: #fde047; line-height: 1; }
  .af-ruler-sub { font-size: 11px; color: rgba(255,255,255,.45); margin-top: 3px; }
  .af-ruler-hint {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
    z-index: 15;
    background: rgba(253,224,71,.12); border: 1px solid rgba(253,224,71,.35);
    color: #fde047; font-size: 12px; font-weight: 600;
    padding: 5px 16px; border-radius: 99px;
    pointer-events: none; white-space: nowrap; display: none;
  }
  .af-ruler-hint.show { display: block; }

  .af-offset-panel {
    position: absolute; bottom: 56px; right: 14px; z-index: 15;
    background: rgba(15,23,42,.95); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
    padding: 14px 16px; display: none; width: 240px;
    font-family: 'Outfit', system-ui, sans-serif;
  }
  .af-offset-panel.show { display: block; }
  .af-offset-title { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .08em; color: rgba(255,255,255,.45); margin-bottom: 12px; }
  .af-offset-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .af-offset-lbl { font-size: 11px; color: rgba(255,255,255,.55); width: 20px; text-align: center; }
  .af-offset-slider { flex: 1; accent-color: #1736F5; cursor: pointer; height: 4px; }
  .af-offset-val { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,.8); width: 56px; text-align: right; }
  .af-offset-btns { display: flex; gap: 6px; margin-top: 6px; }
  .af-offset-btn { flex: 1; padding: 6px 8px; border-radius: 7px; border: none;
    font-family: 'Outfit', system-ui, sans-serif; font-size: 11px; font-weight: 600; cursor: pointer; }
  .af-offset-btn.save { background: #1736F5; color: #fff; }
  .af-offset-btn.save:hover { background: #0f27db; }
  .af-offset-btn.reset { background: rgba(255,255,255,.09); color: rgba(255,255,255,.65); }
  .af-offset-btn.reset:hover { background: rgba(255,255,255,.16); }

  .af-insp-side {
    background: rgba(12,17,30,.97);
    border-left: 1px solid rgba(255,255,255,.07);
    display: flex; flex-direction: column;
    overflow: hidden; position: relative;
  }
  .af-insp-x {
    position: absolute; top: 12px; right: 12px;
    width: 26px; height: 26px;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
    color: rgba(255,255,255,.7);
    border-radius: 5px; cursor: pointer; font-size: 11px;
    display: flex; align-items: center; justify-content: center; z-index: 5;
  }
  .af-insp-x:hover { background: rgba(255,255,255,.15); color: #fff; }
  .af-insp-inner { padding: 14px; flex: 1; overflow-y: auto; }
  .af-insp-title { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; padding-right: 28px; }
  .af-insp-fn { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(255,255,255,.3); margin-bottom: 10px; }
  .af-insp-sec { font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: rgba(255,255,255,.3); margin: 8px 0 4px; }
  .af-icr { display: flex; gap: 7px; align-items: baseline; padding: 2px 0; }
  .af-icr-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 3px; }
  .af-icr-l { font-size: 10px; color: rgba(255,255,255,.4); }
  .af-icr-v { font-size: 10px; color: rgba(255,255,255,.75); }
  .af-icp { display: flex; gap: 8px; align-items: center; padding: 5px 7px;
    border: 1px solid rgba(255,255,255,.08); border-radius: 5px;
    margin-bottom: 4px; cursor: pointer; transition: all .12s; }
  .af-icp:hover { border-color: rgba(255,255,255,.18); }
  .af-icp.active { border-color: rgba(253,224,71,.6); background: rgba(253,224,71,.07); }
  .af-icp img { width: 34px; height: 34px; border-radius: 3px; object-fit: cover; opacity: .8; }
  .af-icp-cls { font-size: 9px; font-weight: 700; text-transform: uppercase; }
  .af-icp-cls.vehicle { color: #fbbf24; } .af-icp-cls.person { color: #f87171; }
  .af-icp-cls.heavy_equipment { color: #c4b5fd; }
  .af-icp-conf { font-size: 9.5px; font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,.35); }
  .af-insp-acts {
    padding: 10px 14px; border-top: 1px solid rgba(255,255,255,.07);
    flex-shrink: 0;
  }
  .af-insp-act-lbl { font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .07em; color: rgba(255,255,255,.25); margin-bottom: 6px; }
  .af-insp-act-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .af-iab {
    padding: 6px 8px; background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1); color: rgba(255,255,255,.75);
    border-radius: 5px; cursor: pointer;
    font-family: 'Outfit', system-ui, sans-serif; font-size: 10.5px; font-weight: 500;
  }
  .af-iab:hover { background: rgba(255,255,255,.12); color: #fff; }
  .af-iab.ok { border-color: rgba(74,222,128,.3); color: #4ade80; }
  .af-iab.no { border-color: rgba(248,113,113,.3); color: #f87171; }
`;

const INSPECTOR_HTML = `
  <div class="af-insp-content">
    <div class="af-insp-img-wrap" data-ref="imgWrap">
      <img data-ref="img" src="" alt="">
      <svg class="af-insp-svg" data-ref="svg"></svg>
      <div class="af-insp-ctrl">
        <button data-action="zoomIn" title="Zoom +">+</button>
        <button data-action="zoomOut" title="Zoom −">−</button>
        <div class="sep"></div>
        <button data-action="fit" title="Ajustar">⊡</button>
        <button data-action="fitBbox" title="Zoom a detección">⊙</button>
        <div class="sep"></div>
        <button data-action="ruler" data-ref="rulerBtn" title="Regla de medición" style="padding:0 10px;">📏</button>
        <div class="sep"></div>
        <button data-action="offset" data-ref="offsetBtn" title="Ajustar proyección" style="padding:0 10px;">⊕</button>
      </div>
      <div class="af-zoom-ind" data-ref="zoom">1.0×</div>
      <div class="af-ruler-hint" data-ref="rulerHint">Clickeá dos puntos para medir · Esc para salir</div>
      <div class="af-ruler-panel" data-ref="rulerPanel">
        <div class="af-ruler-val" data-ref="rulerVal">—</div>
        <div class="af-ruler-sub">distancia estimada</div>
      </div>
      <div class="af-offset-panel" data-ref="offsetPanel">
        <div class="af-offset-title">Ajuste de proyección</div>
        <div class="af-offset-row">
          <span class="af-offset-lbl">←→</span>
          <input class="af-offset-slider" data-ref="offX" type="range" min="-50" max="50" step="0.5" value="0">
          <span class="af-offset-val" data-ref="offXVal">0 m</span>
        </div>
        <div class="af-offset-row">
          <span class="af-offset-lbl">↑↓</span>
          <input class="af-offset-slider" data-ref="offY" type="range" min="-50" max="50" step="0.5" value="0">
          <span class="af-offset-val" data-ref="offYVal">0 m</span>
        </div>
        <div class="af-offset-btns">
          <button class="af-offset-btn reset" data-action="resetOffset">Reset</button>
          <button class="af-offset-btn save" data-action="saveOffset">Guardar</button>
        </div>
      </div>
    </div>
    <div class="af-insp-side">
      <button class="af-insp-x" data-action="close">✕</button>
      <div class="af-insp-inner">
        <div class="af-insp-title" data-ref="title">—</div>
        <div class="af-insp-fn" data-ref="fn">—</div>
        <div class="af-insp-sec">Contexto</div>
        <div data-ref="ctx"></div>
        <div class="af-insp-sec">Detecciones</div>
        <div data-ref="chips"></div>
      </div>
      <div class="af-insp-acts">
        <div class="af-insp-act-lbl">Acción rápida</div>
        <div class="af-insp-act-grid">
          <button class="af-iab ok" data-action="confirmed">✓ Confirmar</button>
          <button class="af-iab no" data-action="dismissed">✗ Errónea</button>
          <button class="af-iab" data-action="resolved" style="color:#60a5fa;border-color:rgba(96,165,250,.3)">● Resuelta</button>
          <button class="af-iab" data-action="monitoring" style="color:#fbbf24;border-color:rgba(251,191,36,.3)">◉ Seguim.</button>
        </div>
      </div>
    </div>
  </div>
`;

export function createInspector(config) {
  injectStyles();
  const {
    manifest,
    detections,           // { type: FC, features: [...] }
    infrastructure,       // { ductos, postes, estaciones }
    photoUrl,             // fn(name) -> string
    photoHdUrl,           // fn(name) -> string
    cropUrl,              // fn(cropPath) -> string
    alertLog,             // { recordEvent, getStatus, ... }
    toast,                // fn(msg, type?, ms?)
    offsetStorageKey = imgName => `af_off_${imgName}`,
  } = config;

  // Mount el panel
  const root = document.createElement('div');
  root.className = 'af-inspector';
  root.innerHTML = INSPECTOR_HTML;
  document.body.appendChild(root);

  const refs = {};
  for (const el of root.querySelectorAll('[data-ref]')) {
    refs[el.dataset.ref] = el;
  }

  // Estado interno del inspector. Sustituye al global `IS` del legacy.
  const state = {
    img: null,            // name de la foto
    detectionId: null,    // id de la detección activa
    iw: 0, ih: 0,         // dimensiones de la imagen mostrada (post-resize)
    x: 0, y: 0, s: 1,     // transform (translate + scale)
    H: null,              // homografía geo → pixel
    Hinv: null,           // homografía pixel → geo (para regla)
    ovOffX: 0, ovOffY: 0, // offset manual del overlay del ducto
    rulerActive: false,
    rulerPts: [],
    rulerSkipNext: false,
  };

  // Object URL del blob HD ya redimensionado. Se revoca al cerrar o al
  // abrir otra foto para no leakear memoria.
  let currentHdObjectUrl = null;

  // Target width para el resize de la HD. ~3000 px da decoded ~25 MB
  // (vs ~240 MB nativos), suficiente para zoom hasta 6-8× sin
  // pixelación visible.
  const HD_TARGET_WIDTH = 3000;

  // ─── DOM events ──────────────────────────────────────────────────

  // Acción declarativa via [data-action="..."].
  const actions = {
    close: () => close(),
    zoomIn: () => zoom(1.5),
    zoomOut: () => zoom(1 / 1.5),
    fit: () => fit(),
    fitBbox: () => fitToActiveBbox(),
    ruler: () => toggleRuler(),
    offset: () => toggleOffsetPanel(),
    resetOffset: () => resetOffset(),
    saveOffset: () => saveOffset(),
    confirmed: () => quickAction('confirmed'),
    dismissed: () => quickAction('dismissed'),
    resolved: () => quickAction('resolved'),
    monitoring: () => quickAction('monitoring'),
  };
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action]();
  });

  // Pan + zoom de la imagen
  let drag = null;
  refs.imgWrap.addEventListener('mousedown', e => {
    if (e.button !== 0 || state.rulerActive) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: state.x, oy: state.y };
    refs.imgWrap.classList.add('drag');
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    state.x = drag.ox + (e.clientX - drag.sx);
    state.y = drag.oy + (e.clientY - drag.sy);
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    drag = null;
    refs.imgWrap.classList.remove('drag');
  });
  refs.imgWrap.addEventListener('click', e => {
    if (state.rulerActive) {
      rulerClick(e);
      e.stopPropagation();
    }
  });
  refs.imgWrap.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
  }, { passive: false });

  // Offset sliders en tiempo real
  refs.offX.addEventListener('input', applyOffsetFromSliders);
  refs.offY.addEventListener('input', applyOffsetFromSliders);

  // Esc cierra
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !root.classList.contains('open')) return;
    if (state.rulerActive) { toggleRuler(); return; }
    close();
  });

  // ─── lifecycle ───────────────────────────────────────────────────

  function open(props) {
    const img = props.source_image || props.img;
    if (!img) return;

    state.img = img;
    state.detectionId = props.id || null;
    state.rulerPts = [];
    state.rulerActive = false;

    // Cargar offset persistido
    try {
      const saved = JSON.parse(localStorage.getItem(offsetStorageKey(img)) || 'null');
      state.ovOffX = saved?.x || 0;
      state.ovOffY = saved?.y || 0;
    } catch { state.ovOffX = 0; state.ovOffY = 0; }

    // Reset UI state
    refs.imgWrap.classList.remove('ruler-mode');
    refs.rulerBtn.classList.remove('on');
    refs.rulerHint.classList.remove('show');
    refs.rulerPanel.classList.remove('show');
    refs.offsetPanel.classList.remove('show');
    refs.offsetBtn.classList.remove('on');

    refs.title.textContent = props.id || img;
    refs.fn.textContent = img;
    renderContext(findOverlay(img));
    renderChips(detectionsFor(img));

    root.classList.add('open');

    refs.img.onload = () => {
      state.iw = refs.img.naturalWidth;
      state.ih = refs.img.naturalHeight;
      const ov = findOverlay(img);
      if (ov?.footprint) {
        // Pixel order [BL, BR, TR, TL] coincide con footprint order
        // [LL, LR, UR, UL] — homografía geo→pixel + su inversa.
        const px = [[0, state.ih], [state.iw, state.ih], [state.iw, 0], [0, 0]];
        state.H = computeHomography(ov.footprint, px);
        state.Hinv = computeHomography(px, ov.footprint);
      } else {
        state.H = null;
        state.Hinv = null;
      }
      renderBboxes(detectionsFor(img));
      renderOverlay(ov);
      // Pequeño delay para que el layout asiente antes del fit.
      setTimeout(fitToActiveBbox, 80);
    };
    refs.img.onerror = () => {
      refs.fn.textContent = img + ' — no disponible';
      refs.img.style.display = 'none';
    };
    refs.img.style.display = '';
    loadHdImage(img);
  }

  // Carga la foto HD via fetch + createImageBitmap con resize. El
  // resultado es una textura ~10× más chica para el compositor GPU →
  // pan/zoom suave incluso en máquinas con GPU integrada. Si el fetch
  // o la decodificación fallan, fallback a la versión liviana de
  // `photos/` (sin resize, sirve directo).
  async function loadHdImage(imgName) {
    // Limpia el objectURL anterior para no leakear.
    if (currentHdObjectUrl) {
      URL.revokeObjectURL(currentHdObjectUrl);
      currentHdObjectUrl = null;
    }
    try {
      const resp = await fetch(photoHdUrl(imgName));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      // resizeWidth + resizeQuality decodifican y redimensionan en
      // una sola pasada. Si la HD no es mucho más ancha que el target
      // (caso del fallback a tiles 1024), no agrandar.
      const probeBmp = await createImageBitmap(blob);
      const targetW = probeBmp.width > HD_TARGET_WIDTH ? HD_TARGET_WIDTH : probeBmp.width;
      probeBmp.close();
      const bmp = await createImageBitmap(blob, {
        resizeWidth: targetW,
        resizeQuality: 'high',
      });
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      const resized = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.85));
      if (!resized) throw new Error('canvas.toBlob returned null');
      currentHdObjectUrl = URL.createObjectURL(resized);
      refs.img.src = currentHdObjectUrl;
    } catch (err) {
      console.warn('HD load failed, fallback a photos/:', err.message);
      // Fallback: cargar el tile liviano directo. Sin resize porque ya
      // es chico (ahora ~1024 px). El onload procesa el resto igual.
      refs.img.src = photoUrl(imgName);
    }
  }

  function close() {
    root.classList.remove('open');
    if (state.rulerActive) toggleRuler();
    // Liberar el bitmap HD inmediato — sin esto el browser puede
    // mantenerlo en RAM aun cerrado.
    refs.img.src = '';
    if (currentHdObjectUrl) {
      URL.revokeObjectURL(currentHdObjectUrl);
      currentHdObjectUrl = null;
    }
  }

  // ─── transform (zoom/pan/fit) ────────────────────────────────────

  function applyTransform() {
    const t = `translate(${state.x}px, ${state.y}px) scale(${state.s})`;
    refs.img.style.transform = t;
    refs.svg.style.transform = t;
    refs.zoom.textContent = `${state.s.toFixed(1)}×`;
    for (const b of refs.imgWrap.querySelectorAll('.af-ibx')) {
      const bx = parseFloat(b.dataset.bx);
      const by = parseFloat(b.dataset.by);
      const bw = parseFloat(b.dataset.bw);
      const bh = parseFloat(b.dataset.bh);
      b.style.left = (state.x + bx * state.s) + 'px';
      b.style.top = (state.y + by * state.s) + 'px';
      b.style.width = (bw * state.s) + 'px';
      b.style.height = (bh * state.s) + 'px';
    }
  }

  function zoom(factor, cx, cy) {
    const r = refs.imgWrap.getBoundingClientRect();
    cx = cx ?? r.left + r.width / 2;
    cy = cy ?? r.top + r.height / 2;
    const ns = Math.max(0.05, Math.min(20, state.s * factor));
    const ratio = ns / state.s;
    state.x = (cx - r.left) - (cx - r.left - state.x) * ratio;
    state.y = (cy - r.top) - (cy - r.top - state.y) * ratio;
    state.s = ns;
    applyTransform();
  }

  function fit() {
    const r = refs.imgWrap.getBoundingClientRect();
    if (!state.iw) return;
    const s = Math.min((r.width - 40) / state.iw, (r.height - 40) / state.ih);
    state.s = s;
    state.x = (r.width - state.iw * s) / 2;
    state.y = (r.height - state.ih * s) / 2;
    applyTransform();
  }

  function fitToActiveBbox() {
    const active = refs.imgWrap.querySelector('.af-ibx.active');
    if (!active) { fit(); return; }
    const r = refs.imgWrap.getBoundingClientRect();
    const bx = +active.dataset.bx, by = +active.dataset.by;
    const bw = +active.dataset.bw, bh = +active.dataset.bh;
    const s = Math.min((r.width - 80) / bw, (r.height - 80) / bh, 8);
    state.s = s;
    state.x = (r.width - (bx * 2 + bw) * s) / 2;
    state.y = (r.height - (by * 2 + bh) * s) / 2;
    applyTransform();
  }

  // ─── render: bboxes + chips + context + overlay ──────────────────

  function detectionsFor(imgName) {
    const out = [];
    if (!detections?.features) return out;
    for (const f of detections.features) {
      const src = f.properties?.source_image;
      if (!src) continue;
      if (src === imgName || src.replace(/\.[^.]+$/, '') + '.png' === imgName ||
          src === imgName.toUpperCase() || src === imgName.toLowerCase()) {
        out.push(f);
      }
    }
    return out;
  }

  function findOverlay(imgName) {
    const ov = manifest?.image_overlays;
    if (!ov) return null;
    if (ov[imgName]) return ov[imgName];
    const base = imgName.toLowerCase().replace(/\.[^.]+$/, '');
    for (const [k, v] of Object.entries(ov)) {
      if (k.toLowerCase().replace(/\.[^.]+$/, '') === base) return v;
    }
    return null;
  }

  function renderContext(ov) {
    if (!ov) {
      refs.ctx.innerHTML = '<span style="font-size:10px;color:rgba(255,255,255,.3)">Sin datos de contexto</span>';
      return;
    }
    let html = '';
    if (ov.ducto_segments?.length) {
      const names = [...new Set(ov.ducto_segments.map(s => s.name))].join(', ');
      html += `<div class="af-icr"><div class="af-icr-dot" style="background:#fbbf24"></div><span class="af-icr-l">Ducto:</span><span class="af-icr-v">${escapeHtml(names)}</span></div>`;
    }
    if (ov.postes?.length) {
      const kms = ov.postes.map(p => p.km).join(', ');
      html += `<div class="af-icr"><div class="af-icr-dot" style="background:#6b7280"></div><span class="af-icr-l">KM:</span><span class="af-icr-v">${escapeHtml(kms)}</span></div>`;
    }
    refs.ctx.innerHTML = html || '<span style="font-size:10px;color:rgba(255,255,255,.3)">Sin datos de contexto</span>';
  }

  function renderChips(dets) {
    refs.chips.innerHTML = '';
    for (const d of dets) {
      const p = d.properties;
      const chip = document.createElement('div');
      chip.className = 'af-icp' + (p.id === state.detectionId ? ' active' : '');
      chip.dataset.id = p.id;
      // `timestamp` viene en formato EXIF ("YYYY:MM:DD HH:MM:SS"),
      // no ISO — lo mostramos tal cual en el tooltip.
      if (p.timestamp) chip.title = `timestamp: ${p.timestamp}`;
      const cropSrc = p.crop ? cropUrl(p.crop) : '';
      chip.innerHTML = `
        <img src="${escapeAttr(cropSrc)}" onerror="this.style.opacity=.3" alt="">
        <div>
          <div class="af-icp-cls ${escapeAttr(p.class || '')}">${escapeHtml(p.class || '?')}</div>
          <div class="af-icp-conf">${Math.round((p.confidence || 0) * 100)}%</div>
        </div>
      `;
      chip.addEventListener('click', () => {
        state.detectionId = p.id;
        for (const x of refs.chips.querySelectorAll('.af-icp')) {
          x.classList.toggle('active', x.dataset.id === p.id);
        }
        for (const b of refs.imgWrap.querySelectorAll('.af-ibx')) {
          b.classList.toggle('active', b.dataset.id === p.id);
        }
        fitToActiveBbox();
      });
      refs.chips.appendChild(chip);
    }
  }

  function renderBboxes(dets) {
    for (const b of refs.imgWrap.querySelectorAll('.af-ibx')) b.remove();
    for (const d of dets) {
      const p = d.properties;
      if (!p.bbox_px) continue;
      // bbox_px viene en el espacio de `tile_dims` (típicamente las
      // dimensiones nativas del tile HD original). Si la imagen
      // mostrada fue redimensionada, escalamos las bboxes
      // proporcionalmente para que se alineen con lo que se ve.
      const tileW = p.tile_dims?.[0] || state.iw;
      const tileH = p.tile_dims?.[1] || state.ih;
      const sx = state.iw / tileW;
      const sy = state.ih / tileH;
      const bx = p.bbox_px[0] * sx;
      const by = p.bbox_px[1] * sy;
      const bw = p.bbox_px[2] * sx;
      const bh = p.bbox_px[3] * sy;
      const b = document.createElement('div');
      b.className = 'af-ibx' + (p.id === state.detectionId ? ' active' : '');
      b.dataset.id = p.id;
      b.dataset.bx = bx; b.dataset.by = by; b.dataset.bw = bw; b.dataset.bh = bh;
      b.style.cssText =
        `left:${state.x + bx * state.s}px;` +
        `top:${state.y + by * state.s}px;` +
        `width:${bw * state.s}px;` +
        `height:${bh * state.s}px;`;
      const lbl = document.createElement('div');
      lbl.className = 'af-ibx-lbl';
      lbl.textContent = `${p.class} ${Math.round((p.confidence || 0) * 100)}%`;
      b.appendChild(lbl);
      b.addEventListener('click', () => {
        state.detectionId = p.id;
        for (const x of refs.imgWrap.querySelectorAll('.af-ibx')) {
          x.classList.toggle('active', x.dataset.id === p.id);
        }
        for (const x of refs.chips.querySelectorAll('.af-icp')) {
          x.classList.toggle('active', x.dataset.id === p.id);
        }
        fitToActiveBbox();
      });
      refs.imgWrap.appendChild(b);
    }
  }

  function renderOverlay(ov) {
    refs.svg.innerHTML = '';
    refs.svg.setAttribute('width', state.iw);
    refs.svg.setAttribute('height', state.ih);
    if (!state.H) return;
    const ox = state.ovOffX || 0;
    const oy = state.ovOffY || 0;
    const proj = ll => {
      const [px, py] = applyHomography(state.H, ll);
      return [px + ox, py + oy];
    };
    const segs = ov?.ducto_segments?.length ? ov.ducto_segments : buildDuctoSegs();
    const psts = ov?.postes?.length ? ov.postes : buildPostes();
    for (const seg of segs) {
      const pts = seg.coords.map(proj);
      if (!pts.some(p => p[0] > -300 && p[0] < state.iw + 300 && p[1] > -300 && p[1] < state.ih + 300)) continue;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
      for (const cls of ['dl', 'di']) {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', d);
        el.setAttribute('class', cls);
        refs.svg.appendChild(el);
      }
    }
    for (const p of psts) {
      const [px, py] = proj(p.coord);
      if (px < -50 || px > state.iw + 50 || py < -50 || py > state.ih + 50) continue;
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', px); c.setAttribute('cy', py);
      c.setAttribute('r', 8); c.setAttribute('class', 'dp');
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', px + 12); t.setAttribute('y', py + 4);
      t.setAttribute('font-size', '24'); t.setAttribute('fill', '#fff');
      t.textContent = `KM ${p.km}`;
      refs.svg.appendChild(c);
      refs.svg.appendChild(t);
    }
  }

  function densifyLine(coords, maxDeg = 0.0005) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      const d = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.ceil(d / maxDeg));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      }
    }
    if (coords.length) out.push(coords[coords.length - 1]);
    return out;
  }

  function buildDuctoSegs() {
    const fc = infrastructure?.ductos;
    if (!fc?.features) return [];
    const out = [];
    for (const f of fc.features) {
      const g = f.geometry;
      const raw = g?.type === 'LineString' ? g.coordinates
        : g?.type === 'MultiLineString' ? g.coordinates.flat()
        : [];
      if (raw.length === 0) continue;
      out.push({ name: f.properties?.name || 'Ducto', coords: densifyLine(raw) });
    }
    return out;
  }

  function buildPostes() {
    const fc = infrastructure?.postes;
    if (!fc?.features) return [];
    const out = [];
    for (const f of fc.features) {
      if (f.geometry?.type !== 'Point') continue;
      out.push({ km: f.properties?.km || '?', coord: f.geometry.coordinates });
    }
    return out;
  }

  // ─── ruler ───────────────────────────────────────────────────────

  function toggleRuler() {
    state.rulerActive = !state.rulerActive;
    state.rulerPts = [];
    state.rulerSkipNext = state.rulerActive;
    refs.imgWrap.classList.toggle('ruler-mode', state.rulerActive);
    refs.rulerBtn.classList.toggle('on', state.rulerActive);
    refs.rulerHint.classList.toggle('show', state.rulerActive);
    if (!state.rulerActive) refs.rulerPanel.classList.remove('show');
    drawRuler();
  }

  function rulerClick(e) {
    if (!state.rulerActive || !state.Hinv) return;
    if (state.rulerSkipNext) { state.rulerSkipNext = false; return; }
    const r = refs.imgWrap.getBoundingClientRect();
    const natX = (e.clientX - r.left - state.x) / state.s;
    const natY = (e.clientY - r.top - state.y) / state.s;
    if (state.rulerPts.length >= 2) state.rulerPts = [];
    state.rulerPts.push([natX, natY]);
    if (state.rulerPts.length === 2) {
      const geo1 = applyHomography(state.Hinv, state.rulerPts[0]);
      const geo2 = applyHomography(state.Hinv, state.rulerPts[1]);
      refs.rulerVal.textContent = formatDistance(haversineMeters(geo1, geo2));
      refs.rulerPanel.classList.add('show');
    }
    drawRuler();
  }

  function drawRuler() {
    for (const el of refs.svg.querySelectorAll('.ruler-line, .ruler-dot, .ruler-lbl')) el.remove();
    if (!state.rulerActive || !state.rulerPts.length) return;
    if (state.rulerPts.length === 2) {
      const [p1, p2] = state.rulerPts;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', p1[0]); line.setAttribute('y1', p1[1]);
      line.setAttribute('x2', p2[0]); line.setAttribute('y2', p2[1]);
      line.setAttribute('class', 'ruler-line');
      refs.svg.appendChild(line);
      const mx = (p1[0] + p2[0]) / 2;
      const my = (p1[1] + p2[1]) / 2;
      const geo1 = applyHomography(state.Hinv, p1);
      const geo2 = applyHomography(state.Hinv, p2);
      const lbl = document.createElementNS(SVG_NS, 'text');
      lbl.setAttribute('x', mx + 10); lbl.setAttribute('y', my - 10);
      lbl.setAttribute('class', 'ruler-lbl');
      lbl.textContent = formatDistance(haversineMeters(geo1, geo2));
      refs.svg.appendChild(lbl);
    }
    for (const p of state.rulerPts) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 10);
      c.setAttribute('class', 'ruler-dot');
      refs.svg.appendChild(c);
    }
  }

  // ─── offset panel ────────────────────────────────────────────────

  function toggleOffsetPanel() {
    const show = !refs.offsetPanel.classList.contains('show');
    refs.offsetPanel.classList.toggle('show', show);
    refs.offsetBtn.classList.toggle('on', show);
    if (show) {
      const scale = offsetPixelsPerMeter();
      refs.offX.value = scale > 0 ? (state.ovOffX / scale).toFixed(1) : 0;
      refs.offY.value = scale > 0 ? (state.ovOffY / scale).toFixed(1) : 0;
      updateOffsetLabels();
    }
  }

  function offsetPixelsPerMeter() {
    if (!state.H || !state.iw) return 10;
    const ov = findOverlay(state.img);
    if (!ov?.footprint) return 10;
    const [ll, lr] = ov.footprint;
    const wMeters = haversineMeters(ll, lr);
    return wMeters > 0 ? state.iw / wMeters : 10;
  }

  function updateOffsetLabels() {
    const x = parseFloat(refs.offX.value);
    const y = parseFloat(refs.offY.value);
    refs.offXVal.textContent = `${x > 0 ? '+' : ''}${x} m`;
    refs.offYVal.textContent = `${y > 0 ? '+' : ''}${y} m`;
  }

  function applyOffsetFromSliders() {
    updateOffsetLabels();
    const scale = offsetPixelsPerMeter();
    state.ovOffX = parseFloat(refs.offX.value) * scale;
    state.ovOffY = parseFloat(refs.offY.value) * scale;
    renderOverlay(findOverlay(state.img));
  }

  function saveOffset() {
    if (!state.img) return;
    try {
      localStorage.setItem(offsetStorageKey(state.img),
        JSON.stringify({ x: state.ovOffX, y: state.ovOffY }));
      toast?.('Offset guardado', 'success');
    } catch {
      toast?.('No se pudo guardar el offset', 'error');
    }
  }

  function resetOffset() {
    state.ovOffX = 0; state.ovOffY = 0;
    refs.offX.value = 0; refs.offY.value = 0;
    updateOffsetLabels();
    try { localStorage.removeItem(offsetStorageKey(state.img)); } catch {}
    renderOverlay(findOverlay(state.img));
  }

  // ─── quick actions (feedback) ────────────────────────────────────

  function quickAction(action) {
    if (!state.detectionId) return;
    alertLog?.recordEvent(state.detectionId, action, '');
    const labels = {
      confirmed: 'Confirmada', dismissed: 'Errónea',
      resolved: 'Resuelta', monitoring: 'En seguimiento',
    };
    toast?.(`${labels[action]} — registrado`, 'success');
  }

  return { open, close };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(s) { return escapeHtml(s); }
