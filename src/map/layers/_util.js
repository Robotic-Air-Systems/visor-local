// Helper compartido por los módulos de capa. Toggle visibility de
// un grupo de layers, ignorando los que no existen (defensa contra
// re-toggle antes del 'load' completo).

export function setLayersVisible(map, layerIds, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of layerIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}
