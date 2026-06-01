// Cache LRU de raster tiles de fotos sobre el mapa.
//
// Cada tile decoded pesa ~25 MB en RAM (3072×2048 RGBA). Con un cache
// sin límite, panear pocos segundos por un vuelo de 200 fotos satura
// la RAM del browser. El cap duro es `maxCache`; cuando se excede
// `softMax`, evictamos los más viejos hasta volver a `maxCache`,
// preservando los que están visibles ahora o en el área de prefetch.
//
// Los layers de fotos se insertan ANTES de `beforeLayerId` para que la
// infraestructura (ducto, estaciones) quede arriba.

// Caps bajados desde 20/60 a 12/30 para reducir el pico de RAM durante
// paneo (~40% menos). Si se siente que la UX sufre — fotos
// recargándose seguido al ir y venir — subir maxCache primero.
const DEFAULTS = {
  maxCache: 12,
  softMax: 30,
  minZoom: 13,
  rasterOpacity: 0.88,
  prefetchPaddingRatio: 0.75,  // 75% del viewport como halo de prefetch
};

export function createPhotoCache(map, opts) {
  const {
    manifest,
    photoUrl,                  // fn(name) -> string
    beforeLayerId = null,
    maxCache = DEFAULTS.maxCache,
    softMax = DEFAULTS.softMax,
    minZoom = DEFAULTS.minZoom,
    rasterOpacity = DEFAULTS.rasterOpacity,
    prefetchPaddingRatio = DEFAULTS.prefetchPaddingRatio,
  } = opts;

  // sourceId -> { t: lastTouchedMs, name }
  const cache = new Map();
  let visible = true;

  function sourceId(name) {
    return `photo-${name.replace(/[^a-z0-9]/gi, '-')}`;
  }

  function ensure(name) {
    const sid = sourceId(name);
    if (cache.has(sid)) {
      cache.get(sid).t = Date.now();
      return;
    }
    const ov = manifest?.image_overlays?.[name];
    if (!ov?.footprint?.length || map.getSource(sid)) return;
    // Manifest order: [LL, LR, UR, UL] en [lon, lat].
    // MapLibre ImageSource espera [TL, TR, BR, BL] en [lng, lat].
    const [ll, lr, ur, ul] = ov.footprint;
    map.addSource(sid, { type: 'image', url: photoUrl(name), coordinates: [ul, ur, lr, ll] });
    map.addLayer({
      id: `${sid}-l`, type: 'raster', source: sid,
      paint: {
        'raster-opacity': rasterOpacity,
        'raster-opacity-transition': { duration: 250 },
      },
    }, beforeLayerId || undefined);
    cache.set(sid, { t: Date.now(), name });
  }

  function remove(sid) {
    if (map.getLayer(`${sid}-l`)) map.removeLayer(`${sid}-l`);
    if (map.getSource(sid)) map.removeSource(sid);
    cache.delete(sid);
  }

  function evictAll() {
    for (const sid of cache.keys()) remove(sid);
    cache.clear();
  }

  function refresh() {
    if (!map || !map.isStyleLoaded() || !manifest?.image_overlays) return;
    if (!visible || map.getZoom() < minZoom) { evictAll(); return; }
    const bd = map.getBounds();
    const lngSpan = (bd.getEast() - bd.getWest()) * prefetchPaddingRatio;
    const latSpan = (bd.getNorth() - bd.getSouth()) * prefetchPaddingRatio;
    const exp = {
      w: bd.getWest() - lngSpan, e: bd.getEast() + lngSpan,
      s: bd.getSouth() - latSpan, n: bd.getNorth() + latSpan,
    };
    const visNow = [];
    const preNow = [];
    for (const [name, ov] of Object.entries(manifest.image_overlays)) {
      if (!ov.footprint?.length) continue;
      const lngs = ov.footprint.map(p => p[0]);
      const lats = ov.footprint.map(p => p[1]);
      const ovW = Math.min(...lngs), ovE = Math.max(...lngs);
      const ovS = Math.min(...lats), ovN = Math.max(...lats);
      if (ovE >= bd.getWest() && ovW <= bd.getEast() &&
          ovN >= bd.getSouth() && ovS <= bd.getNorth()) {
        visNow.push(name);
      } else if (ovE >= exp.w && ovW <= exp.e && ovN >= exp.s && ovS <= exp.n) {
        preNow.push(name);
      }
    }
    // Visible cargan inmediato; prefetch con stagger para no saturar
    // la red en flights densos.
    visNow.forEach(ensure);
    preNow.forEach((n, i) => setTimeout(() => ensure(n), i * 30 + 100));
    // Soft eviction: si el cache rebalsó el softMax, recortamos hasta
    // maxCache descartando los más viejos que no están en
    // visNow/preNow.
    if (cache.size > softMax) {
      const keep = new Set([...visNow, ...preNow].map(sourceId));
      const candidates = [...cache.entries()]
        .filter(([sid]) => !keep.has(sid))
        .sort((a, b) => a[1].t - b[1].t)
        .slice(0, cache.size - maxCache);
      for (const [sid] of candidates) remove(sid);
    }
  }

  function setVisible(v) {
    visible = v;
    if (!v) evictAll();
    else refresh();
  }

  // Pre-carga fotos vecinas a una foto dada (por número en el nombre).
  // Útil cuando se abre el inspector — anticipamos que el usuario va a
  // ver fotos adyacentes en orden cronológico.
  function prefetchAround(name, count = 6) {
    const overlays = manifest?.image_overlays;
    if (!overlays) return;
    const num = parseInt(name.replace(/[^0-9]/g, ''), 10);
    if (!num) return;
    const all = Object.keys(overlays)
      .map(k => ({ k, n: parseInt(k.replace(/[^0-9]/g, ''), 10) }))
      .filter(x => !isNaN(x.n))
      .sort((a, b) => a.n - b.n);
    const idx = all.findIndex(x => Math.abs(x.n - num) <= 1);
    if (idx < 0) return;
    const lo = Math.max(0, idx - count);
    const hi = Math.min(all.length - 1, idx + count);
    for (let i = lo; i <= hi; i++) {
      setTimeout(() => ensure(all[i].k), Math.abs(i - idx) * 60);
    }
  }

  function size() { return cache.size; }

  // Cuando la pestaña pierde foco (otro tab, otra ventana), evictamos
  // todo. El usuario probablemente vuelve después; pagar el re-fetch es
  // barato y mantener decenas de tiles decodificados en RAM mientras
  // no se está mirando es desperdicio puro. Cuando la pestaña vuelve a
  // visible, hacemos un refresh para repoblar los tiles del viewport.
  const onVisChange = () => {
    if (document.hidden) evictAll();
    else refresh();
  };
  document.addEventListener('visibilitychange', onVisChange);

  function destroy() {
    document.removeEventListener('visibilitychange', onVisChange);
    evictAll();
  }

  return { refresh, setVisible, evictAll, prefetchAround, size, destroy };
}
