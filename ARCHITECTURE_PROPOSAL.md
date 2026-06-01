# Architecture proposal — `visor-local` (rama `feature-streaming`)

Doc de arquitectura **del frontend** de `visor-local`. Para la
arquitectura del sistema completo (backends, gateway, auth, deploy)
ver [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md).

Status: **draft aprobado, listo para ejecutar**. Las secciones 1 y 2
están firmes. La 3 (plan) se va a ir tachando.

---

## 1. Decisiones de arquitectura

### 1.1 Multi-page con módulos compartidos

Cada vista es su propio archivo HTML, importa código de `src/` por
módulos ES nativos. No hay client-side router, no hay SPA.

Vistas previstas:

| Página | HTML | Reemplaza |
| --- | --- | --- |
| Lista de vuelos | `pages/flights-list.html` | (nueva) |
| Vuelo en vivo | `pages/flight-live.html` | `streaming/flight.html` |
| Vuelo archivado | `pages/flight-archive.html` | `index.html` del root |
| Gestión de drones | `pages/drones.html` | (nueva, cuando exista el backend) |

**Por qué**: cada página bootea limpia → el monolito del legacy puede
quedar contenido en una sola "isla" mientras se vacía hacia `src/`
pieza por pieza. Sumar drones es un HTML nuevo. Compartir código se
hace por imports, no por estado en memoria.

**Trade-off aceptado**: sin transiciones suaves entre vistas (cada
clic es un page load). Estado compartido pasa por URL params o
localStorage.

### 1.2 MapLibre en todas partes

Un solo renderer en todo el repo. El streaming view se migra de
Mapbox GL JS a MapLibre como parte del refactor.

**Por qué**: el token Mapbox es para las tiles, no para el renderer.
MapLibre consume `https://api.mapbox.com/styles/v1/.../tiles/...` con
el token sin problema (es lo que ya hace el legacy). Todas las features
que necesitamos (`ImageSource.setCoordinates()`, 4-point overlays, 3D
terrain) están en ambos.

**Trade-off aceptado**: si más adelante aparece una feature
exclusiva de Mapbox GL (ej. globe projection 3D), revisar.

### 1.3 Sin bundler

ES modules nativos vía `<script type="module" src="../src/pages/X.js">`
(paths relativos al archivo HTML).
Libs externas (MapLibre, etc.) por `<script>` tag o por
`https://esm.sh/<pkg>` si hace falta importarlas como módulo.

**Por qué**: `python3 serve.py` sigue siendo todo el deploy. Cero
`node_modules`, cero build step, ciclo dev = guardar + refrescar.

**Cuándo saltar a Vite**: si necesitamos un paquete que solo existe
en CJS, si el waterfall de imports duele en dev, o si querés
tree-shaking serio en prod. La migración es barata — los `import` ya
quedan bien escritos.

### 1.4 Auth: `apiFetch` wrapper + `session.js` no-op

Toda llamada HTTP pasa por `src/api/client.js`. Hoy ese wrapper no
agrega headers de auth. Cuando llegue Fase C de
[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md), `src/session/session.js`
crece con el login flow + manejo de cookies de sesión y el wrapper
empieza a interpretar 401 (redirect a login). El resto del código no
cambia.

`apiFetch` además agrega el prefix `/api/` configurable, así el día
que aparezca nginx delante de los servicios cambia una constante.

**MVP**: no hay login operador. **El sistema corre LAN-only**. Esto
es aceptable solo bajo esa restricción de red — para producción real
con cliente externo, ver Fase C en el doc de sistema. El roadmap
post-MVP prioriza auth precisamente por el contrato cliente: los
datos de las fotos no pueden quedar accesibles a cualquiera con la
URL.

Para drones: cuando `af-server` exponga `POST /api/drones`, el
response trae el bearer del **dron** (que va al daemon, no a la UI).
La UI lo muestra una vez y permite copiarlo. Eso es UX del flujo de
alta, separada del auth del operador.

---

## 2. File tree propuesto

```
visor-local/
├── README.md
├── ARCHITECTURE_PROPOSAL.md       ← este archivo (borrar cuando se
│                                    materialice como ARCHITECTURE.md
│                                    o se incorpore al README)
├── PROMPT_NEXT_SESSION.md
├── HANDOFF_frontend.md
│
├── serve.py
├── config.local.js                 (gitignored — MBT)
├── config.local.js.example
│
├── index.html                      → home provisional con links a las
│                                     vistas (live, archive, drones-soon).
│                                     Lógica mínima — pasa a ser el
│                                     "lobby" del sitio.
│
├── pages/
│   ├── flights-list.html           lista de vuelos en vivo (poll /flights)
│   ├── flight-live.html            vista live de un vuelo
│   ├── flight-archive.html         vuelo archivado (cliente, proyecto,
│                                     fecha, vuelo via query params —
│                                     ver §6)
│   ├── drones.html                 ← cuando exista el backend
│   └── legacy-monolith.html        ← copia íntegra del legacy mientras
│                                     se desangra (se borra al final
│                                     de Fase 2)
│
├── src/
│   ├── api/
│   │   ├── client.js               apiFetch + error normalization
│   │   ├── flights.js              listFlights, getFlight, getConfig, …
│   │   ├── archive.js              loadManifest, loadDetections, …
│   │   │                            (MVP: lee filesystem; Fase D
│   │   │                            del sistema: lee /api/archive)
│   │   └── drones.js               (futuro)
│   ├── live/
│   │   └── flight-socket.js        WS reconnect + event dispatch
│   ├── map/
│   │   ├── basemap.js              MapLibre + Mapbox raster tiles
│   │   │                            + OSM/ArcGIS fallback
│   │   ├── photo-overlay.js        ImageSource + setCoordinates
│   │   ├── inspector.js            homography, bbox, ruler
│   │   └── layers/                 ductos / postes / estaciones / etc.
│   ├── session/
│   │   └── session.js              getAuthHeader (no-op hoy)
│   ├── ui/
│   │   ├── toast.js
│   │   ├── modal.js
│   │   └── widgets/                ctx-card, alert-list, etc.
│   ├── i18n/
│   │   ├── i18n.js                 t(), setLang
│   │   └── strings.js              es / en
│   └── pages/
│       ├── flights-list.js         entry point por página
│       ├── flight-live.js
│       ├── flight-archive.js
│       └── drones.js
│
├── data/                            (sin cambios)
└── tools/                           (sin cambios)
```

### Convenciones

- **Naming**: `kebab-case.js` en archivos, `camelCase` en exports,
  nombres largos legibles (chau `pUrl`, `iQA`, `apIT` — ahora
  `photoUrl`, `inspectorQuickAction`, `applyInspectorTransform`).
- **Imports relativos al archivo que importa**: `import { apiFetch }
  from '../api/client.js'`. Esto hace que el sitio funcione tanto bajo
  `serve.py` (montaje en `/`) como bajo `photos-to-kmz` con
  `P2K_WEB_DIR` (montaje en `/web/`). Los paths absolutos rotos en
  ambos contextos.
- **Una responsabilidad por módulo**: si un archivo cruza dominios,
  se parte.
- **Estado**: vive dentro de los módulos de página. Los módulos de
  `src/map/`, `src/api/` etc. son funciones puras o factories que
  devuelven instancias — no tienen estado global propio.
- **HTML sin `onclick=` inline**: handlers se atan desde JS con
  `addEventListener`.

---

## 3. Plan de migración

Orden propuesto. Cada paso es mergeable independiente.

### Fase 0 — andamio (cero features nuevas)

1. Crear estructura `pages/`, `src/`.
2. Mover el legacy a `pages/legacy-monolith.html` (literal `cp`, sin
   tocarlo).
3. Reemplazar `index.html` con un home provisional simple: logo,
   título, y links a "Vuelos en vivo" → `pages/flights-list.html`,
   "Vuelos archivados" → `pages/flight-archive.html` (o `legacy-
   monolith.html` mientras la página nueva no esté), "Drones
   (próximamente)" deshabilitado.
4. `pages/flight-archive.html` como redirect provisional a
   `legacy-monolith.html` para no romper bookmarks.
5. Verificar que el visor legacy sigue funcionando idéntico desde la
   nueva URL.

### Fase 1 — refactor de `streaming/` a `pages/flight-live.html`

Es código nuevo y chico (~250 líneas). Se reescribe limpio:

1. `src/api/client.js` con `apiFetch`, error format del server.
2. `src/api/flights.js` con `listFlights`, `getFlight`, `getConfig`.
3. `src/live/flight-socket.js` con reconnect + event dispatch
   tipado.
4. `src/map/basemap.js` (MapLibre + raster tiles de Mapbox).
5. `src/map/photo-overlay.js` (`addOrUpdate`, `setQuad`, quad
   reorder LL→TL).
6. `pages/flight-live.html` + `src/pages/flight-live.js` —
   reemplaza `streaming/flight.html` + `live.js`.
7. `pages/flights-list.html` + `src/pages/flights-list.js` —
   reemplaza `streaming/index.html` + `index.js`. Esta página es el
   nuevo "home" del sitio.

Smoke test: live view conectada al server real (`photos-to-kmz`
corriendo) + `af-photos-uploader` mandando fotos. **Hito de mergeo:**
acá ya se puede borrar `streaming/`.

### Fase 2 — desangre del monolito hacia `flight-archive.html`

El monolito legacy expone funcionalidad que vamos a querer también
para vuelos archivados. Lo movemos en orden de dependencia:

1. `src/i18n/` — strings + `t()` + `setLang()`. Independiente, fácil.
2. `src/ui/toast.js`, `src/ui/modal.js`. Independientes.
3. `src/api/manifest.js` — carga de `manifest.json` + geojson.
4. `src/map/layers/` — ductos, postes, estaciones, flight_path.
5. `src/map/inspector.js` — homography, bbox, ruler, offset
   adjustment. Es la pieza más densa del legacy.
6. `pages/flight-archive.html` + `src/pages/flight-archive.js`
   armados sobre los módulos anteriores. Path canónico:
   `flight-archive.html?cliente=X&proyecto=Y&fecha=Z&vuelo=W` — la
   página resuelve el `data/` correspondiente. **Borrar el
   `MAP_ID='vuelo2'` hardcoded del legacy.**
7. **Basemap como preferencia del usuario**: `src/map/basemap.js`
   lee `localStorage.af_basemap` (default `satellite`), persiste
   cambios al togglear.
8. Annotations CRUD + draw — última porque el modelo de datos
   (localStorage por `ALERT_ID`) migra a server-side en Fase D del
   sistema (ver `SYSTEM_ARCHITECTURE.md`).

A medida que cada pieza sale del monolito, el legacy queda inalterado
en `pages/legacy-monolith.html` hasta el final. **Hito de mergeo:**
cuando `flight-archive` cubra paridad funcional, el legacy se borra.

### Fase 3 — drones

**Update**: los endpoints de drones ya existen en `photos-to-kmz`
(módulo `server/drones.py`). La página se puede shipear sin esperar
Fase B del sistema. Puede correr en paralelo con Fase 2.

1. `src/api/drones.js` con `listDrones`, `getDrone`, `createDrone`.
   El `createDrone` retorna `{drone_id, drone_token}` — el token solo
   aparece una vez en la response del server.
2. `pages/drones.html` + `src/pages/drones.js` con:
   - Lista con badge online (computed server-side desde `last_seen`).
   - Detalle con `current_flight_id` linkeable.
   - Formulario de alta. Al recibir el `drone_token`, mostrarlo
     destacado con botón de copy + disclaimer "no se puede recuperar
     después; solo va a quedar el prefix de 8 chars".
3. Polling de `GET /drones` cada 5-10s mientras no exista
   `WS /drones/live`. Cuando exista (server-side pending), agregar
   `src/live/drones-socket.js` y reemplazar el polling.
4. (Futuro, server-side) `PUT /drones/{id}` para editar metadata
   default, `POST /drones/{id}/rotate-token` para rotación.
5. En `flights-list`: indicador "qué dron está corriendo cada vuelo"
   leyendo del nuevo campo del flight.

---

## 4. Fuera de scope MVP

Tracking en el roadmap del sistema —
[`SYSTEM_ARCHITECTURE.md §7`](SYSTEM_ARCHITECTURE.md) cuando aplique.

| Item | Cuándo | Notas |
| --- | --- | --- |
| Login operador / auth real | Fase C del sistema | **Prioritario post-MVP** — contrato cliente real, datos de fotos sensibles |
| Persistencia server-side de annotations | Fase D del sistema | Hoy `localStorage` por `ALERT_ID` |
| Página de drones | Fase 3 (ver §3) | **Endpoints ya existen** en `photos-to-kmz`; la página puede shipear en paralelo con Fase 2 |
| Archive servido por API en vez de filesystem | Fase D del sistema | El módulo `src/api/archive.js` esconde el cambio. **Hoy** bajo Modo A (P2K_WEB_DIR), los blobs de `data/report_*/` quedan accesibles vía `https://host/web/data/...` sin auth de API. Aceptable para weekend test (Tailscale + drone auth cubren el perímetro de red), pero para prod hay que mover archive a endpoint API authenticated |
| Service worker / offline | sin fecha | LAN-only por ahora |
| Tests automatizados | sin fecha | Hoy: smoke manual |
| KMZ preview desde la UI | sin fecha | El backend tiene `kmz_preview_url` reservado |
| Mobile / touch optimization | sin fecha | Desktop primero |

---

## 5. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | MapLibre + tile URLs de Mapbox | Usar raster URLs directas (`https://api.mapbox.com/styles/v1/.../tiles/...`). Evitar `mapbox://styles/...` que requiere transformRequest. |
| 2 | Photo overlay performance / RAM | Empezar con `PCMAX=20`. `Cache-Control: no-store` en `photos_hd/*` (ya configurado en `serve.py`). En `closeInsp()`: `el.src=""` antes de cerrar para liberar el bitmap HD. Monitorear en sesiones largas. |
| 3 | `/config` round trip al bootstrap | Timeout de 3 s. Fallback al token de `config.local.js` si la respuesta no llega o no trae token. Permite a la página live arrancar offline-of-server. |
| 4 | Reconnect del WS y estado | El server re-emite `hello` (no hay replay). Cliente reconcilia: `overlays` map se reconstruye desde `hello.photos` en cada reconnect. Ya implementado correctamente en `streaming/live.js`. |
| 5 | Quad reorder `LL,LR,UR,UL` → `TL,TR,BR,BL` | Una sola función `quadToMapCoords()` en `src/map/photo-overlay.js`. Test manual: foto conocida, esquina pixel `(0,0)` debe caer sobre UL del polígono naranja. |
| 6 | Token Mapbox: dos fuentes | `src/map/basemap.js` recibe el token como parámetro. Helper `getMapboxToken()` en cada page: prueba `GET /config` → `window.MBT` (de `config.local.js`) → `null` (mapa no carga, mensaje a consola). |
| 7 | Path absoluto `/api/...` cuando hoy no hay `/api/` | `apiFetch(path)` antepone un prefix configurable. MVP: prefix vacío (`/flights`). Fase B del sistema: prefix `/api`. Una constante. |

---

## 6. Decisiones de UI / paths

### 6.1 Home

`index.html` (root) es un "lobby" provisional. Contenido mínimo:

- Logo Aerial Fences.
- Tres tarjetas / links:
  - **Vuelos en vivo** → `pages/flights-list.html`
  - **Vuelos archivados** → `pages/flight-archive.html` (parametrizado)
  - **Drones** → deshabilitado, texto "próximamente" (se habilita
    en Fase B del sistema).

Lógica cero. No conoce el server. Es solo navegación.

### 6.2 Path canónico de `flight-archive`

```
pages/flight-archive.html
    ?cliente=TGP
    &proyecto=PLNG
    &fecha=2026-04-25
    &vuelo=vuelo2
```

La página resuelve el `data/` correspondiente al server (MVP: a
filesystem; Fase D del sistema: a `/api/archive/flights/{...}`). El
`MAP_ID` hardcoded del legacy se elimina.

Cuando se hagan accesos directos al visor desde otro sistema (mail
de notificación, etc.), esos van a ser links con todos los query
params. Eso ya cubre el caso "cada vuelo tiene su URL única".

### 6.3 Basemap como preferencia del usuario

`src/map/basemap.js` lee `localStorage.af_basemap` (valores:
`satellite` | `streets` | `terrain`, default `satellite`). El
switcher de basemap, al cambiar, persiste el valor. Aplica a todas
las páginas con mapa.
