import { createModal } from '../ui/modal.js';
import { haversineMeters } from './homography.js';
import { geometryCenter } from './annotations.js';

// Editor modal-based para anotaciones — crear y editar comparten DOM.
// Callbacks de save/delete/open-photo desacoplan el editor del store
// (el page wire los callbacks).
//
// Uso:
//   const editor = createAnnotationEditor({
//     onSave: data => { ... },           // data tiene id si es edit
//     onDelete: id => { ... },
//     onOpenPhoto: imgName => { ... },   // botón "Ver foto"
//     findNearestPhoto: ([lng,lat]) => imgName | null,
//   });
//   editor.openCreate({ shape: 'circle', center, radius_m });
//   editor.openEdit(annotation);

const CLASS_OPTIONS = [
  { v: 'construccion', l: 'Construcción' },
  { v: 'vehiculo', l: 'Vehículo' },
  { v: 'persona', l: 'Persona' },
  { v: 'maquinaria', l: 'Maquinaria' },
  { v: 'otro', l: 'Otro' },
];

const PRIORITY_OPTIONS = [
  { v: 'alta', l: 'Alta' },
  { v: 'media', l: 'Media' },
  { v: 'baja', l: 'Baja' },
];

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .af-ann-geom {
      font-size: 11px;
      color: #6b7488;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      background: #F4F6FA;
      padding: 8px 11px;
      border-radius: 6px;
      margin-bottom: 14px;
    }
    .af-ann-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
    .af-ann-field > label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .06em; color: #A9BCD0;
    }
    .af-ann-field select,
    .af-ann-field input[type=text],
    .af-ann-field textarea {
      padding: 8px 10px;
      border: 1px solid #D8DBE2;
      border-radius: 6px;
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 13px;
      background: #fff;
      color: #001011;
      outline: none;
      transition: border-color .12s, box-shadow .12s;
    }
    .af-ann-field select:focus,
    .af-ann-field input[type=text]:focus,
    .af-ann-field textarea:focus {
      border-color: #1736F5;
      box-shadow: 0 0 0 3px rgba(23,54,245,.1);
    }
    .af-ann-field textarea { resize: vertical; min-height: 60px; }
    .af-ann-prio {
      display: flex; gap: 6px;
    }
    .af-ann-prio-opt {
      flex: 1;
      padding: 8px 6px;
      text-align: center;
      border: 1px solid #D8DBE2;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      background: #fff;
      transition: all .1s;
    }
    .af-ann-prio-opt input { display: none; }
    .af-ann-prio-opt.alta:has(input:checked)  { background: #fee2e2; border-color: #ef4444; color: #991b1b; font-weight: 700; }
    .af-ann-prio-opt.media:has(input:checked) { background: #fef3c7; border-color: #f59e0b; color: #92400e; font-weight: 700; }
    .af-ann-prio-opt.baja:has(input:checked)  { background: #dbeafe; border-color: #3b82f6; color: #1e3a8a; font-weight: 700; }
  `;
  document.head.appendChild(s);
}

export function createAnnotationEditor({ onSave, onDelete, onOpenPhoto, findNearestPhoto }) {
  injectStyles();
  const modal = createModal({ title: 'Nueva anotación', width: 460 });

  modal.setBody(`
    <div class="af-ann-geom" data-ref="geom">—</div>
    <div class="af-ann-field">
      <label>Clase</label>
      <select data-ref="class">
        ${CLASS_OPTIONS.map(c => `<option value="${c.v}">${c.l}</option>`).join('')}
      </select>
    </div>
    <div class="af-ann-field">
      <label>Nombre / ID</label>
      <input type="text" data-ref="name" placeholder="Auto-generado">
    </div>
    <div class="af-ann-field">
      <label>Descripción</label>
      <textarea data-ref="desc" rows="3" placeholder="Notas opcionales"></textarea>
    </div>
    <div class="af-ann-field">
      <label>Prioridad</label>
      <div class="af-ann-prio">
        ${PRIORITY_OPTIONS.map(p => `
          <label class="af-ann-prio-opt ${p.v}">
            <input type="radio" name="ann-prio" value="${p.v}" ${p.v === 'media' ? 'checked' : ''}>
            <span>${p.l}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `);

  modal.setFooter(`
    <button class="af-modal-btn danger" data-action="delete" hidden>Eliminar</button>
    <span style="flex:1"></span>
    <button class="af-modal-btn ghost" data-action="cancel">Cancelar</button>
    <button class="af-modal-btn" data-action="open-photo" hidden>Ver foto</button>
    <button class="af-modal-btn primary" data-action="save">Guardar</button>
  `);

  const refs = {};
  for (const el of modal.body.querySelectorAll('[data-ref]')) refs[el.dataset.ref] = el;
  const btns = {};
  for (const el of modal.foot.querySelectorAll('[data-action]')) btns[el.dataset.action] = el;

  let editingId = null;
  let pendingGeom = null;
  let nearestImage = null;

  function describe(g) {
    if (!g) return '—';
    if (g.shape === 'circle') {
      return `Círculo · r ${g.radius_m.toFixed(1)} m`;
    }
    if (g.shape === 'rectangle') {
      const c = g.corners;
      const w = haversineMeters(c[0], c[1]);
      const h = haversineMeters(c[0], c[3]);
      return `Rectángulo · ${w.toFixed(1)} × ${h.toFixed(1)} m`;
    }
    if (g.shape === 'polygon') {
      return `Polígono · ${g.corners.length} vértices`;
    }
    return '—';
  }

  function readForm() {
    const prio = modal.body.querySelector('input[name="ann-prio"]:checked')?.value || 'media';
    return {
      class: refs.class.value,
      name: refs.name.value.trim() || autoName(),
      description: refs.desc.value.trim(),
      priority: prio,
    };
  }

  function autoName() {
    return `Obs_${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  function save() {
    const data = readForm();
    if (editingId) {
      onSave?.({ id: editingId, ...data });
    } else if (pendingGeom) {
      onSave?.({ shape: pendingGeom.shape, geometry: pendingGeom, ...data });
    }
    modal.close();
  }

  function setupNearestPhoto(annOrGeom) {
    if (!findNearestPhoto) { nearestImage = null; btns['open-photo'].hidden = true; return; }
    let center;
    if (annOrGeom.geometry) center = geometryCenter(annOrGeom);
    else if (annOrGeom.shape === 'circle') center = annOrGeom.center;
    else center = geometryCenter({ shape: annOrGeom.shape, geometry: annOrGeom });
    if (!center) { nearestImage = null; btns['open-photo'].hidden = true; return; }
    nearestImage = findNearestPhoto(center);
    btns['open-photo'].hidden = !nearestImage;
  }

  btns.cancel.addEventListener('click', () => modal.close());
  btns.save.addEventListener('click', save);
  btns.delete.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('¿Eliminar esta anotación?')) return;
    onDelete?.(editingId);
    modal.close();
  });
  btns['open-photo'].addEventListener('click', () => {
    if (!nearestImage) return;
    modal.close();
    onOpenPhoto?.(nearestImage);
  });

  function openCreate(geom) {
    editingId = null;
    pendingGeom = geom;
    modal.setTitle('Nueva anotación');
    btns.delete.hidden = true;
    refs.class.value = 'construccion';
    refs.name.value = '';
    refs.desc.value = '';
    const prioEl = modal.body.querySelector('input[name="ann-prio"][value="media"]');
    if (prioEl) prioEl.checked = true;
    refs.geom.textContent = describe(geom);
    setupNearestPhoto(geom);
    modal.open();
    setTimeout(() => refs.name.focus(), 30);
  }

  function openEdit(ann) {
    editingId = ann.id;
    pendingGeom = null;
    modal.setTitle('Editar anotación');
    btns.delete.hidden = false;
    refs.class.value = ann.class || 'otro';
    refs.name.value = ann.name || ann.id;
    refs.desc.value = ann.description || '';
    const prioEl = modal.body.querySelector(`input[name="ann-prio"][value="${ann.priority || 'media'}"]`);
    if (prioEl) prioEl.checked = true;
    refs.geom.textContent = `${ann.shape} · ${ann.name || ann.id}`;
    setupNearestPhoto(ann);
    modal.open();
  }

  return { openCreate, openEdit };
}
