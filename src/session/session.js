// Auth seam. MVP corre LAN-only, sin auth. La Fase C del sistema crece
// este módulo con login + manejo de cookies. Mientras, getAuthHeader()
// devuelve un objeto vacío y apiFetch lo spreadea sin efecto.
//
// Cuando se enchufe auth real: este módulo emite/parsea cookies de
// sesión y eventualmente expone login(), logout(), currentUser().

export function getAuthHeader() {
  return {};
}
