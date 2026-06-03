# HANDOFF — visor-local (frontend)

Doc de arranque para el frontend engineer que toma `visor-local`. Te
pone al día sin tener que leer todo el historial. Para el **porqué**
de las decisiones de arquitectura, ver
[`ARCHITECTURE_PROPOSAL.md`](ARCHITECTURE_PROPOSAL.md) (frontend) y
[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) (ecosistema completo).

---

## 1. Qué es esto

Frontend del ecosistema **Aerial Fences / Robotic Air Systems**. Tres
vistas sobre un mismo backend:

| Vista | Página | Qué hace |
| --- | --- | --- |
| Portal (home) | `index.html` | Lobby con 3 cards. Cero lógica. |
| Vuelos en vivo | `pages/flights-list.html` + `pages/flight-live.html` | Lista de vuelos activos (poll `GET /flights` cada 5s) + vista live de un vuelo (WS, tiles aparecen a medida que el dron sube fotos). |
| Vuelos archivados | `pages/flight-archive.html` | Vuelo terminado: mapa con infra + detecciones + inspector de fotos (homografía, regla, bbox). Lee data estática de `data/report_*/`. |
| Drones | `pages/drones.html` | Alta + listado de drones (online/offline, token-shown-once). |

Más `pages/legacy-monolith.html`: el visor viejo de ~2.400 líneas,
**preservado intacto** como referencia mientras se termina de migrar
funcionalidad. No es parte del flujo nuevo; no construir encima de él.

**Stack**: vanilla JS + módulos ES6 nativos (`<script type="module">`),
MapLibre GL para mapas, **sin bundler, sin framework**. El deploy es
copiar archivos estáticos. No hay build step.

---

## 2. Contrato con el server (Modo A — same-origin)

El visor habla con el backend (`photos-to-kmz`) por paths
**root-relative**, mismo origin que el documento. **No** hay
`window.API_BASE` / `window.WS_BASE` seteados en prod.

| Recurso | Path |
| --- | --- |
| Lista de vuelos | `GET /flights` |
| Detalle de vuelo | `GET /flights/{id}` |
| Config (Mapbox token) | `GET /config` |
| Healthcheck | `GET /healthz` |
| Drones | `GET/POST /drones`, `GET /drones/{id}` |
| Live (WS) | `WS /flights/{id}/live` |
| Tiles de fotos live | `GET /flights/{id}/tiles/{name}.{ext}` |

Todo pasa por `src/api/client.js` → `apiFetch(path)` / `apiUrl(path)` /
`wsUrl(path)`. Ese wrapper:

- Antepone `API_PREFIX` (hoy `''`; cuando aparezca un gateway nginx
  pasa a `'/api'` — **cambio de una constante**).
- Soporta host override vía `window.API_BASE`/`WS_BASE` (Modo B, para
  servir el visor desde un origin distinto al backend; requiere CORS
  server-side). En prod no se usa.
- Normaliza errores del server (`{error:{code,message,hint}}`) a un
  `Error` con `.code/.status/.hint`.

El contrato HTTP/WS autoritativo vive en `docs/api.md` del repo
`photos-to-kmz` (branch `main`). Si ves drift entre eso y el runtime,
es bug del server — escalá, no parchees el cliente.

### WebSocket events (live)

El server emite: `hello` (snapshot completo al conectar — trae todas
las fotos previas con su `tile_url`, `quad`, `detections`),
`photo_processed` (foto nueva), `strategy_updated` (re-posiciona quads
de fotos previas), `drone_done`, `flight_ended`. Reconnect re-emite
`hello`, no hay replay → el cliente reconcilia desde el snapshot.

---

## 3. Mapbox token

- **Prod**: viene de `GET /config` (el server lo provee desde
  `P2K_MAPBOX_TOKEN`). No hace falta configurar nada en el cliente.
- **Dev local**: `src/map/get-mapbox-token.js` intenta `GET /config`
  primero, y si no hay, cae a `window.MBT` (de `config.local.js`,
  gitignored). Copiá `config.local.js.example` → `config.local.js` y
  poné tu token, **o** apuntá el dev contra el server real (que ya
  expone `/config`).

---

## 4. Deploy productivo

Servido en la **raíz** de `https://4g.roboticairsystems.com/` (NO bajo
`/web/`):

- **Caddy** termina TLS (cert Let's Encrypt) y hace:
  - rutas de API (`/flights`, `/drones`, `/config`, `/healthz`, WS) →
    `reverse_proxy` a uvicorn (`photos-to-kmz`) en `localhost:8000`.
    `/config` es **exact match** (para no sombrear el estático
    `/config.local.js.example`).
  - todo lo demás → file_server estático del checkout de `visor-local`.
- **Basic-auth de borde** (Caddy): el browser la pide una vez, después
  navega normal. Las WS pasan con las credenciales cacheadas en el
  upgrade. El daemon del dron bypassa basic-auth con su Bearer. No hay
  nada que hacer del lado del visor por esto.
- El server hace `git pull` del repo a `/opt/visor-local`. **No tocar
  el server directamente** — lo coordina el master agent.

**Colisión de paths a cuidar**: el estático NO debe tener carpetas
`flights/`, `drones/`, `config`, `healthz` a nivel raíz (chocarían con
la API). Hoy no las hay (`drones` vive en `pages/drones.html`).

---

## 5. Correr local

```bash
# 1. (opcional) token Mapbox para dev sin server:
cp config.local.js.example config.local.js   # editar window.MBT

# 2. servidor estático con cache headers tuneados:
python3 serve.py          # → http://127.0.0.1:8765/
```

`serve.py` sirve desde la raíz, igual que Caddy en prod — los paths
root-relative funcionan idénticos. Para que las vistas **live/drones**
tengan datos, necesitás un backend `photos-to-kmz` corriendo:

- **Opción simple**: apuntá el browser directo al server deployado
  (`https://4g.roboticairsystems.com/`) — ya tiene todo.
- **Opción local**: corré `photos-to-kmz` local en `:8000` con
  `P2K_WEB_DIR=/path/to/visor-local` y entrá por `http://localhost:8000/`
  (el server se autosirve el visor + la API same-origin). Ver
  `photos-to-kmz/docs/api.md`.

La vista **archive** funciona sin backend (lee `data/report_*/`
estático), pero las fotos rectificadas están gitignored (regenerables,
ver §7) — sin ellas ves el mapa + geometría pero no los tiles de foto.

---

## 6. Mapa de módulos

```
index.html                  Portal home (3 cards, sin lógica)
pages/
  flights-list.html/.js     lista de vuelos live, poll /flights 5s
  flight-live.html          vista live (WS) — entry: src/pages/flight-live.js
  flight-archive.html       vuelo archivado — entry: src/pages/flight-archive.js
  drones.html               gestión de drones — entry: src/pages/drones.js
  legacy-monolith.html      visor viejo, referencia, NO tocar

src/
  api/
    client.js               apiFetch/apiUrl/wsUrl + error normalization + API_PREFIX
    flights.js              listFlights, getFlight, getConfig
    drones.js               listDrones, getDrone, createDrone
    archive.js              loadManifest/Detections/Infra + buildFootprintsFC + URLs
  live/
    flight-socket.js        connectFlightSocket(id, handlers) — WS + reconnect
  map/
    basemap.js              MapLibre style, 3 basemaps, preferencia en localStorage
    get-mapbox-token.js     /config → window.MBT → null
    photo-overlay.js        ImageSource por foto + quad reorder (live)
    layers/                 ductos, estaciones, postes, footprints, flight-path,
                            detections, annotations — cada uno addX(map, geojson)→{setVisible}
  archive/
    inspector.js            panel HD: zoom/pan, bbox, regla (homografía), offset.
                            HD se decodifica con resize (createImageBitmap) para
                            no reventar RAM (ver §8).
    homography.js           math pura: computeHomography, applyHomography, haversine
    photo-cache.js          LRU de tiles raster sobre el mapa + prefetch + evict
    photo-popup.js          popup al click en footprint/foto
    annotations.js          store CRUD + persist localStorage + toFeatureCollection
    annotation-draw.js      dibujar círculo/rect/polígono en el mapa
    annotation-editor.js    modal create/edit/delete
    alert-log.js            feedback por detección (localStorage)
  ui/
    toast.js                toast(msg, type, ms) — auto-monta DOM+CSS
    modal.js                createModal({title,width}) genérico
  session/
    session.js              getAuthHeader() — no-op hoy (seam para auth futura)
  i18n/
    i18n.js, strings.js     t(), setLang(), onLangChange() (es/en)
```

Patrón de las capas del mapa: cada `addXxxLayer(map, geojson, opts)`
devuelve un handle `{ setVisible(bool), ... }`. Los toggles del sidebar
del archive llaman esos handles.

---

## 7. Data de prueba

`data/` tiene lo chico que el frontend consume directo (tracked):
`manifest.json`, `*.geojson` (ductos/postes/estaciones/detections/
flight_path), `KMZ_TGP.kmz` (infra de referencia).

**Gitignored** (NO en el repo, regenerables): las fotos rectificadas
`data/report_*/photos/` + `photos_hd/`, backups `photos.bak/`, y los
alerts crudos del YOLO `data/Detecciones/`. Para regenerar los tiles
desde un KMZ del engine: ver `README.md` (`tools/build_manifest.py`).

---

## 8. Notas de RAM (ya optimizado, no romper)

WebP comprime en disco/transferencia, pero el browser decodifica a
píxeles crudos (4 bytes/px) — **el formato no ayuda en RAM una vez
decodificado**. Dos optimizaciones ya aplicadas:

- **Tiles del mapa**: el dataset se sirve a 1024px (no 3072). Cache LRU
  con cap bajo (`photo-cache.js`: maxCache 12, softMax 30) + evict al
  `document.hidden`. Pico ~33 MB vs ~300 MB.
- **Inspector HD**: `inspector.js` hace `createImageBitmap(blob,
  {resizeWidth: 3000})` → textura GPU ~25 MB en vez de ~240 MB nativos.
  Las bboxes se escalan dinámicamente con `tile_dims`. `revokeObjectURL`
  al cerrar/cambiar foto para no leakear.

Si tocás el pipeline de imágenes, tené presente estas dos.

---

## 9. Decisión abierta — control de streaming (PARQUEADO)

Los botones de **iniciar / terminar vuelo desde el visor** están
parqueados: el lado dron cambió de dueño y el command-channel (el
trigger que arranca una misión) quedó en pausa esperando que el nuevo
dueño lo defina. **No hay UI a medio construir** — simplemente no
existe todavía.

Independiente de eso: un botón **"Cerrar vuelo"** (`POST /flights/{id}/end`,
operator-only, ya existe en el server e idempotente) no depende del
trigger del dron y se puede sumar cuando se quiera. Hoy el flight se
cierra por el operador vía curl, por `drone_done` + decisión manual, o
por el safety-net de inactividad del server (60 min sin foto).

Contexto adicional del lado dron (FYI, no es del visor): la Jetson crea
una carpeta `vueloX` nueva por cada power-on del VTOL, lo que puede
generar flights vacíos (`0 fotos, active`) si se prende sin volar. El
servicio de inferencia `geo_inference` (repo aparte, en la Jetson)
tiene el flight-detector/watcher. Si querés, la lista de vuelos podría
filtrar/atenuar los vacíos — está sin decidir.

---

## 10. Estado y próximos pasos sugeridos

Hecho (Fase A del refactor): arquitectura multi-page, live view, drones
page, archive view con inspector + annotations, optimización de RAM.

Pendientes razonables (ninguno bloqueante):
- Integrar i18n en las páginas nuevas (hoy `src/i18n/` existe pero las
  páginas nuevas están en español hardcodeado).
- Stats view + alert list del legacy, si se quieren en el archive nuevo.
- Render de detecciones en el live view (el server ya las manda en
  `photo_processed`/`hello`; ver nota forward-compat en `flight-live.js`
  sobre el futuro evento `detections_updated` async).
- Filtro de flights vacíos en la lista (ver §9).
- Cuando el sistema crezca: auth de operador (Fase C en
  `SYSTEM_ARCHITECTURE.md`), archive servido por API en vez de
  filesystem (Fase D).
