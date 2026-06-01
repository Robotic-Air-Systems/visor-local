import { STRINGS } from './strings.js';

// Mini-runtime de i18n. Mantiene `currentLang` en memoria + persistencia
// en localStorage. La página llama `applyToDom()` después de cargar para
// inyectar las traducciones iniciales, y se suscribe con `onLangChange()`
// si necesita re-renderizar contenido dinámico (listas, cards, etc.)
// cuando cambia el idioma.
//
// El legacy llamaba directamente a renderAlertsList/renderAfGrid/etc.
// dentro de setLang — eso acopla i18n a la página. Acá invertimos:
// la página registra qué hacer.

const STORAGE_KEY = 'af_lang';
const DEFAULT_LANG = 'es';

let currentLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
if (!STRINGS[currentLang]) currentLang = DEFAULT_LANG;

const listeners = new Set();

export function getLang() {
  return currentLang;
}

export function availableLangs() {
  return Object.keys(STRINGS);
}

export function t(key) {
  return STRINGS[currentLang]?.[key] || STRINGS[DEFAULT_LANG][key] || key;
}

export function setLang(lang) {
  if (!STRINGS[lang]) throw new Error(`unknown lang: ${lang}`);
  if (lang === currentLang) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyToDom();
  for (const fn of listeners) {
    try { fn(lang); } catch (e) { console.error('lang listener error', e); }
  }
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Aplica traducciones a todos los elementos con `data-i18n="key"`
// (cambia .textContent) y `data-i18n-ph="key"` (cambia .placeholder).
// Llamar en boot y después de inyectar HTML dinámico.
export function applyToDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (k) el.textContent = t(k);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh;
    if (k) el.placeholder = t(k);
  });
}
