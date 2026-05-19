# Prompt — sesión nueva sobre `visor-local` (rama `feature-streaming`)

Pegale el bloque siguiente al iniciar una sesión nueva de Claude Code
en `/home/alvaro/Documents/RAS_personal/visor-local`, checked-out en
`feature-streaming`. Asume que va a leer el repo en frío.

---

## Contexto

Estás en `visor-local`, el repo de **interfaces de usuario** del
ecosistema `photos-to-kmz`. Hasta ahora `visor-local` tenía un solo
visor (rama `main`): un único `index.html` de ~2 400 líneas (vanilla
HTML + JS + MapLibre GL JS) que el cliente usa para ver vuelos
**terminados** — toma un `manifest.json` estático más unos `.geojson`
y los pinta sobre un mapa.

Ahora se sumó una segunda UI: una vista **live durante el vuelo** que
conecta al servidor `photos-to-kmz` por WebSocket y muestra las fotos
del dron a medida que se procesan. Ese código vivía dentro del repo
del engine (`photos-to-kmz/web/`) pero se sacó de ahí — `photos-to-kmz`
queda engine + API only. La rama actual (`feature-streaming`) trae ese
snapshot dentro de `streaming/` como punto de partida (ver
`streaming/README.md`).

Tu trabajo es **refactorizar y armar arquitectura limpia** para
soportar ambas vistas + futuras (próxima: gestión de drones, ver más
abajo) sin caer otra vez en el patrón del monolito.

## El repo en una mirada

```
visor-local/
├── README.md                       overview general del repo
├── PROMPT_NEXT_SESSION.md         ← este archivo
├── HANDOFF_frontend.md            doc técnico sobre los fixes de
│                                   alineación que ya resolvimos
├── config.local.js                token Mapbox local (gitignored)
├── config.local.js.example        plantilla
├── serve.py                       server estático Python con cache headers
├── index.html                     visor de producción (LEGACY,
│                                   2 400 líneas, refactor pendiente)
├── streaming/                     snapshot crudo de la UI live (a
│                                   refactorizar — ver README ahí)
├── data/                          datos de muestra (TGP_half + KMZ
│                                   de infraestructura + detecciones)
└── tools/                         scripts de generación de datos
                                    (kmz → manifest, kmz → geojson, etc.)
```

## Servidor y contrato

Las UIs hablan con `server/` del repo
[Robotic-Air-Systems/photos-to-kmz](https://github.com/Robotic-Air-Systems/photos-to-kmz)
(rama `main`). El contrato HTTP + WebSocket vive en `docs/api.md` de
ese repo. **Eso es autoritativo** — no inventar endpoints; si necesitás
algo que no existe, abrir issue o conversar con la sesión del lado
servidor.

Endpoints relevantes hoy:

* `GET /healthz`, `GET /config`, `GET /flights`, `GET /flights/{id}`
* `POST /flights`, `POST /flights/{id}/photo`, `POST /flights/{id}/end`,
  `POST /flights/{id}/drone_done`
* `GET /flights/{id}/tiles/{name}.{ext}`
* `WS /flights/{id}/live` — eventos `hello`, `photo_processed`,
  `strategy_updated`, `flight_ended`, `drone_done`

## Lo que viene del lado servidor (próxima fase, no implementado aún)

El lado servidor está por agregar un sistema de **identidad
persistente del dron**:

* Nuevo endpoint `POST /drones` (operador) que crea un dron con su
  UUID + token bearer.
* `GET /drones`, `GET /drones/{id}`, `PUT /drones/{id}` para
  administración.
* `POST /drones/{id}/heartbeat` que el dron llama periódicamente.
  Server registra `last_seen`; calcula `online = (now − last_seen) < 90s`.
* `POST /drones/{id}/rotate-token` para rotar credenciales.
* Nuevo `WS /drones/live` que broadcast `drone_online`,
  `drone_offline`, `drone_heartbeat`, `drone_created`,
  `drone_metadata_updated`.
* Modificación de `POST /flights`: si el body trae solo `drone_id` +
  el bearer del dron, el server enriquece con los defaults del dron
  (cliente, proyecto). El operador conserva el modo manual.

Eso implica que del lado UI vas a necesitar agregar:

* Una **página de gestión de drones** — lista con indicador
  online/offline, alta de nuevo dron (mostrando el token una sola
  vez), edición de metadata default, rotación de token.
* Indicador en la lista de vuelos: qué dron lo está corriendo.

Hoy esos endpoints **no existen todavía**. Tu trabajo es:

1. Refactorizar lo que hay (legacy + streaming) a una arquitectura
   que soporte agregar la página de drones sin volver a hacer un
   monolito.
2. Implementar `streaming/` como una vista limpia.
3. Cuando el servidor exponga los endpoints de drones (te avisarán),
   sumar esa vista.

## Decisiones de arquitectura por tomar

Estas son las grandes decisiones. Plantealas explícitamente antes de
empezar a tipear, llegá a un acuerdo con Alvaro:

1. **¿Una app o varias páginas?**
   * Opción A: una sola SPA con routing client-side (Hash / History
     API) entre `/flights/list`, `/flights/{id}`, `/drones/list`,
     `/drones/{id}`.
   * Opción B: páginas HTML separadas (`flights.html`, `flight.html`,
     `drones.html`) con código compartido por imports.
   * Opción C: dos apps (visor de producción mantenido como hoy,
     todo lo streaming/drones en una app nueva).

2. **¿MapLibre o Mapbox?**
   * El visor de producción usa MapLibre (open-source fork).
   * El snapshot streaming usa Mapbox GL JS (necesita token).
   * MapLibre tira por el costado del token para tiles abiertos, pero
     hay funciones de Mapbox que no están en MapLibre.

3. **¿Bundler o no?**
   * Sin bundler: módulos ES6 nativos (`<script type="module">`),
     simple pero limitado en deps.
   * Con bundler: Vite (más fácil), esbuild (más rápido), o
     rollup. Pidieron evitar frameworks pero un bundler no es
     framework.

4. **¿Cómo se autentica el operador?**
   * El backend de drones eventual tiene endpoints de operador sin auth
     en Fase 1 (LAN interna). En Fase 2 hay sesión / JWT / OAuth.
   * Tu UI tiene que dejar el path abierto para auth posterior sin
     rediseño.

## Lo que NO hay que hacer

* **NO** introducir React/Vue/Svelte sin consultar.
* **NO** copiar el patrón del monolito de 2 400 líneas. La
  arquitectura limpia es el principal driver de este refactor.
* **NO** tocar `photos-to-kmz` (el repo del engine). Si necesitás un
  cambio en el contrato del servidor, conversalo con la sesión que
  trabaja allá.
* **NO** committear tokens / secretos. `config.local.js` está en
  gitignore por una razón — GitHub bloqueó un push hace poco por un
  token de Mapbox hardcodeado en `index.html`.

## Primer paso recomendado

1. **Leer en este orden**:
   1. `README.md` del root
   2. `streaming/README.md`
   3. `HANDOFF_frontend.md` (contexto de los bugs ya resueltos)
   4. `index.html` del root — **al menos por arriba** para entender
      el patrón que se quiere reemplazar
   5. `docs/api.md` del repo `photos-to-kmz` (es el contrato que la
      UI consume — está en GitHub)

2. **Antes de tocar código**, escribí un plan en
   `ARCHITECTURE_PROPOSAL.md` con tus respuestas a las 4 decisiones de
   arriba + un diagrama del file tree propuesto. Pasalo por Alvaro.

3. Una vez aprobado, empezás con `streaming/` (que es código nuevo,
   menos riesgoso). Después o en paralelo, el plan de migración del
   legacy `index.html` a la nueva estructura.

## Datos de prueba en el repo

`data/` trae todo lo necesario para correr local:

* `data/report_vuelo2/manifest.json` + `detections.geojson` (las fotos
  HD son ~665 MB y están gitignored — Alvaro las pasa por Drive si
  hacen falta o las regenerás con `tools/build_manifest.py` sobre un
  KMZ del engine).
* `data/ductos.geojson`, `postes.geojson`, `estaciones.geojson` —
  infraestructura TGP.

`python3 serve.py` levanta el server de estáticos en `:8765` con cache
headers tuned (`Cache-Control: no-store` en `photos_hd/*.webp`, etc.).

## Coordinación

* Cuando tengas el `ARCHITECTURE_PROPOSAL.md`, Alvaro lo pasa por la
  sesión del lado servidor por si hay assumptions que afecten el
  contrato.
* Cuando llegues a poder demostrar la streaming view talking against
  el server real, smoke test end-to-end con la sesión de
  `photos-to-kmz` + `af-photos-uploader` corriendo todos a la vez.
* Mergeo a `main` de este repo recién cuando: arquitectura aprobada +
  ambas vistas funcionando + tests/smoke pasan.

Buena suerte.
