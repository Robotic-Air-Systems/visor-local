/* global maplibregl */
import { apiUrl } from '../api/client.js';

// Gestiona ImageSource + RasterLayer por foto. El server emite quads
// como [LL, LR, UR, UL] en [lat, lon]. MapLibre image coords espera
// [TL, TR, BR, BL] en [lng, lat]. Map: TL=UL[3], TR=UR[2], BR=LR[1],
// BL=LL[0].
//
// Sanity check: si tirás un círculo en pixel (0,0) del tile, tiene que
// caer sobre la esquina UL del polígono del footprint.

export function quadToMapCoords(quad) {
  return [3, 2, 1, 0].map(i => [quad[i][1], quad[i][0]]);
}

export function createPhotoOverlayManager(map, flightId) {
  const overlays = new Map();  // name -> { sourceId, layerId, quad }

  function tileUrlFor(photo) {
    // El POST /photo y el WS event photo_processed devuelven tile_url
    // poblado. El evento hello hoy NO lo trae (server no lo emite en
    // ese caso, aunque la doc lo lista). Lo construimos según patrón
    // canónico /flights/{id}/tiles/{name}.{ext}.
    if (photo.tile_url) return photo.tile_url;
    if (!flightId) throw new Error('photo-overlay needs flightId when photo.tile_url is missing');
    return `/flights/${encodeURIComponent(flightId)}/tiles/${photo.name}.${photo.ext}`;
  }

  function addOrUpdate(photo) {
    const { name, quad } = photo;
    const coords = quadToMapCoords(quad);
    const existing = overlays.get(name);
    if (existing) {
      // Las bytes del tile no cambian; solo el quad puede moverse en
      // strategy_updated. setCoordinates es la primitiva correcta.
      map.getSource(existing.sourceId).setCoordinates(coords);
      existing.quad = quad;
      return;
    }
    const sourceId = `photo-src-${cssSafe(name)}`;
    const layerId = `photo-lyr-${cssSafe(name)}`;
    map.addSource(sourceId, {
      type: 'image',
      url: apiUrl(tileUrlFor(photo)),
      coordinates: coords,
    });
    map.addLayer({ id: layerId, type: 'raster', source: sourceId });
    overlays.set(name, { sourceId, layerId, quad });
  }

  function setQuad(name, quad) {
    const existing = overlays.get(name);
    if (!existing) return;
    map.getSource(existing.sourceId).setCoordinates(quadToMapCoords(quad));
    existing.quad = quad;
  }

  function getBounds() {
    if (overlays.size === 0) return null;
    const bounds = new maplibregl.LngLatBounds();
    for (const ov of overlays.values()) {
      for (const [lat, lon] of ov.quad) bounds.extend([lon, lat]);
    }
    return bounds;
  }

  function size() {
    return overlays.size;
  }

  return { addOrUpdate, setQuad, getBounds, size };
}

function cssSafe(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}
