# HANDOFF — Integración de "Vuelos en vivo" (streaming)

Guía para sumar una sección de **cobertura en vivo durante el vuelo** a
tu visor. Vos ya tenés la UI; esto es el **contrato con el backend** +
los detalles que cuestan tiempo si los descubrís solo.

Qué hace la feature: mientras el dron vuela, sube fotos al server; el
server las rectifica y te las empuja por WebSocket; vos las pintás como
overlays georreferenciados sobre un mapa, en tiempo real.

> El contrato autoritativo es `docs/api.md` en el repo `photos-to-kmz`
> (branch `main`). Si algo del runtime difiere de este doc, gana
> `docs/api.md` — avisá al equipo de server.
>
> Implementación de referencia (vanilla JS, funcionando) en este repo:
> `src/live/flight-socket.js`, `src/pages/flight-live.js`,
> `src/map/photo-overlay.js`, `src/map/get-mapbox-token.js`. Podés
> portar la lógica a tu stack.

---

## 1. Modelo de conexión

- **Same-origin, paths root-relative.** El visor se sirve desde la
  misma raíz que la API (`https://4g.roboticairsystems.com/`). Llamás
  `fetch('/flights')`, `new WebSocket('wss://' + location.host + '/flights/{id}/live')`.
  No hardcodees host.
- **WSS, no WS, en prod.** Derivá el scheme de `location.protocol`
  (`https:` → `wss:`).
- **Basic-auth de borde** (Caddy): el browser pide user/pass una vez al
  entrar y cachea. El WS upgrade lleva esas credenciales solo. No tenés
  que hacer nada en el código por esto.
- **Mapbox token**: no lo hardcodees — `GET /config` lo provee (ver §5).

---

## 2. Endpoints REST

### `GET /flights` → lista

```json
{
  "flights": [
    {
      "flight_id": "f1b3c4d5-…",        // UUID, úsalo para el WS y tiles
      "cliente": "TGP",
      "proyecto": "PLNG",
      "vuelo_id": "vuelo-1",
      "drone_id": "vtol-01",
      "fecha": "2026-05-13",
      "status": "active",                // "active" | "ended"
      "photo_count": 67,
      "strategy_version": 3,
      "strategy_descriptor": ["flat", 1.4],   // o null al inicio
      "created_at": "2026-05-13T14:23:01Z",
      "ended_at": null
    }
  ]
}
```

Para la lista de vuelos: pollear cada ~5 s. Ordená por `created_at`
desc. `status` y `photo_count` te dejan distinguir el activo real de
uno recién creado sin fotos.

### `GET /flights/{id}` → detalle
Mismo shape que un item de la lista. Útil para refrescar estado puntual.

### `GET /healthz` → salud del server
```json
{ "ok": true, "version": "0.1.0", "uptime_s": 3421.5,
  "flight_count": 14, "active_flight_count": 2, "drone_count": 3 }
```
Barato de pollear. Buen "indicador de servidor caído" — si esto falla,
todo lo demás falla; mostralo antes que errores sueltos.

### `GET /flights/{id}/tiles/{name}.{ext}` → bytes del tile
WebP rectificado. `Cache-Control: public, max-age=86400` — inmutable por
`(flight_id, name)`; solo el **quad** (posición) cambia, nunca los bytes.
Normalmente no lo pedís a mano: viene `tile_url` en cada foto (§4).

---

## 3. WebSocket — conexión

```
WS /flights/{flight_id}/live
```

- Conexión long-lived. El server pushea JSON; vos no mandás nada (solo
  consumís para mantener vivo el socket).
- **Reconnect**: en cada (re)conexión el server reenvía `hello` con el
  snapshot completo. **No hay replay de eventos.** → reconciliás desde
  el snapshot, no acumulás (ver §6).
- Reconectá con backoff simple en `onclose` (la referencia usa 1.5 s
  fijo).

---

## 4. WebSocket — eventos

Cada mensaje es `{ "type": "...", ... }`. Cinco tipos:

### `hello` — snapshot inicial (al conectar y al reconectar)
```json
{
  "type": "hello",
  "flight": { /* mismo shape que GET /flights/{id} */ },
  "photos": [ /* array de PhotoObjects — todas las fotos hasta ahora */ ]
}
```

### `photo_processed` — una foto nueva
```json
{ "type": "photo_processed", "photo": { /* PhotoObject */ } }
```

### `PhotoObject` (el shape que aparece en `hello.photos[*]` y `photo_processed.photo`)
```json
{
  "name": "DJI_0042",
  "ext": "webp",
  "quad": [[-12.0461,-77.0249],[-12.0461,-77.0241],
           [-12.0455,-77.0241],[-12.0455,-77.0249]],
  "agl_m": 87.3,
  "rel_alt_m": 90.1,
  "tile_url": "/flights/{id}/tiles/DJI_0042.webp",
  "strategy_version": 3,
  "metadata": { "lat": …, "lon": …, "abs_alt_m": …, … },
  "detections": [ /* ver §8 — puede ser [] */ ]
}
```
⚠️ **`quad` viene en orden `[LL, LR, UR, UL]`, cada punto `[lat, lon]`.**
Mapbox/MapLibre `ImageSource` espera otro orden y `[lng, lat]` — ver §7.

### `strategy_updated` — se recalcularon posiciones de fotos previas
```json
{
  "type": "strategy_updated",
  "strategy_version": 4,
  "descriptor": ["anchored", 152.3],
  "affected_photos": [
    { "name": "DJI_0001", "quad": [...], "agl_m": 87.1 },
    { "name": "DJI_0002", "quad": [...], "agl_m": 86.8 }
  ]
}
```
El server ajusta la estrategia AGL a mitad de vuelo y **re-georreferencia
fotos ya pintadas**. Tenés que **mover** esos overlays (no re-crearlos:
los bytes del tile no cambiaron, solo el quad). Ver §7.

### `drone_done` — el dron terminó de subir (NO cierra el vuelo)
```json
{ "type": "drone_done", "drone_done_at": "2026-05-13T18:45:00Z" }
```
Señal informativa: "no vienen más fotos". El vuelo sigue `active` hasta
que el operador lo cierra. Usalo para sugerir "cerrar vuelo" en la UI.

### `flight_ended` — vuelo cerrado
```json
{
  "type": "flight_ended",
  "summary": {
    "photo_count": 142, "duration_s": 1834,
    "strategy_descriptor": ["flat", 1.4],
    "kmz_preview_url": null,           // reservado, hoy siempre null → no muestres botón
    "end_reason": "operator"           // "operator" | "drone_done" | "inactivity"
  }
}
```
Se dispara por `POST /flights/{id}/end` (operador) o por el safety-net de
inactividad del server (60 min sin foto → auto-end). Chequeá
`end_reason` para distinguir.

---

## 5. Mapbox token

```js
// Pedí el token al server; fallback a window.MBT (config.local.js) en dev.
const cfg = await fetch('/config').then(r => r.json());
const token = cfg.mapbox_token || window.MBT || null;
```
`GET /config` → `{ "mapbox_token": "pk.eyJ…" }`. En prod el server lo
provee; no necesitás `config.local.js`. La referencia (`get-mapbox-token.js`)
le mete un timeout de 3 s al `/config` y cae al fallback.

---

## 6. Estructura mínima del cliente

```
1. GET /config           → token Mapbox, iniciar mapa
2. abrir WS /flights/{id}/live
3. on 'hello'            → reconciliar: reconstruir el set de overlays
                           desde flight + photos[] (NO append — reset)
4. on 'photo_processed'  → agregar/actualizar UN overlay
5. on 'strategy_updated' → mover los overlays de affected_photos
6. on 'flight_ended'     → marcar terminado en la UI
7. on close              → reconnect con backoff; el próximo 'hello'
                           reconcilia el estado completo
```

Clave del reconnect: mantené los overlays en un `Map<name, …>`. En
`hello`, recorré `photos[]` y hacé add-or-update por `name` (idempotente).
Así una reconexión a mitad de vuelo no duplica ni pierde nada.

---

## 7. El gotcha que más cuesta: quad → coords del mapa

El server emite `quad = [LL, LR, UR, UL]`, cada punto `[lat, lon]`.
Mapbox/MapLibre `ImageSource.coordinates` espera **`[TL, TR, BR, BL]`,
cada punto `[lng, lat]`**. El mapeo:

```js
// TL = UL = quad[3], TR = UR = quad[2], BR = LR = quad[1], BL = LL = quad[0]
// y además swap [lat,lon] -> [lng,lat]
function quadToMapCoords(quad) {
  return [3, 2, 1, 0].map(i => [quad[i][1], quad[i][0]]);
}
```

Agregar un overlay nuevo (MapLibre/Mapbox GL):
```js
map.addSource(srcId, { type: 'image', url: photo.tile_url,
                       coordinates: quadToMapCoords(photo.quad) });
map.addLayer({ id: lyrId, type: 'raster', source: srcId });
```

Mover un overlay existente en `strategy_updated` (NO re-crear):
```js
map.getSource(srcId).setCoordinates(quadToMapCoords(updatedQuad));
```

`tile_url` ya viene absoluto-relativo (`/flights/{id}/tiles/…`); en
same-origin lo usás tal cual. Fallback si faltara:
`/flights/${flightId}/tiles/${name}.${ext}`.

Sanity check de orientación: un círculo en el pixel `(0,0)` del tile
debe caer sobre la esquina **UL** (top-left) del footprint en el mapa.

Detalle de UX: throttleá el fit-to-bounds (la referencia: 1 fit / 1.5 s)
y después del primer fit no hagas zoom-out más allá del zoom actual —
algunos drones derivan en un bbox ancho y el mapa "salta" feo si re-fiteás
agresivo en cada foto.

---

## 8. Detecciones (opcional, disponible)

Cada `PhotoObject` trae `detections` (puede ser `[]`, nunca falta):
```json
{
  "id": "20260425_DJI_0042_vehicle_1",
  "class": "vehicle",
  "confidence": 0.83,
  "bbox_px": [x, y, w, h],          // tile-pixel space del tile rectificado
  "bbox_px_original": [x0,y0,x1,y1],// debug
  "tile_dims": [w, h]               // dims del tile al que refiere bbox_px
}
```
Si dibujás bboxes sobre el tile, escalá `bbox_px` por
`(displayW/tile_dims[0], displayH/tile_dims[1])` por si mostrás el tile
a otra resolución. `geometry` a nivel detección puede ser `null` (alert
sin GPS) — manejalo defensivo.

**Heads-up forward-compat**: hoy las detecciones llegan dentro del
`PhotoObject` (junto con la foto). El roadmap del server las va a mover a
un evento separado **`detections_updated`** (async, segundos después de
la foto, porque la inferencia YOLO tarda). **No asumas que las bboxes
llegan siempre junto con la foto** — dejá el path listo para agregarlas a
una foto ya pintada. Reconnect siempre las trae en `hello`.

---

## 9. Cerrar un vuelo desde la UI (independiente)

```
POST /flights/{id}/end      (operador)
```
Idempotente: llamarlo 2 veces devuelve el mismo summary, status 200.
Dispara `flight_ended` por el WS. Es independiente de cualquier trigger
del dron — podés tener un botón "Terminar vuelo" sin coordinar con el
lado dron. (El control de **iniciar** vuelo desde la UI está parqueado
del lado dron; no lo implementes todavía.)

---

## 10. Checklist de integración

- [ ] Lista de vuelos: `GET /flights` cada 5 s, ordenada, distingue
      active/ended y photo_count.
- [ ] Mapa con token de `GET /config`.
- [ ] WS `/flights/{id}/live` con reconnect + reconciliación en `hello`.
- [ ] `quadToMapCoords` aplicado en add y en `setCoordinates`.
- [ ] `strategy_updated` mueve overlays existentes (no recrea).
- [ ] `flight_ended` refleja estado terminado + `end_reason`.
- [ ] `wss://` en prod; nada hardcodeado de host.
- [ ] (opcional) bboxes de `detections`, con el path listo para
      `detections_updated` futuro.
