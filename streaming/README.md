# streaming/ — snapshot crudo de la UI de live coverage

**No es la arquitectura final.** Este directorio contiene los archivos
tal como vivían en `photos-to-kmz/web/` antes de que la UI saliera del
repo del engine. Es el punto de partida para el trabajo de la rama
`feature-streaming`. La siguiente sesión refactoriza esto a una
arquitectura limpia (ver el prompt en `PROMPT_NEXT_SESSION.md` del
root del repo).

## Qué hace esta UI

Es una vista para ver, durante el vuelo, las fotos que el dron va
subiendo en tiempo real. Diferente del visor de producción del root
de este repo (que muestra un vuelo ya terminado a partir de un
manifest estático).

* `index.html` — lista de vuelos activos. Polla `GET /flights` cada
  5 s. Click → `flight.html?id=<flight_id>`.
* `flight.html` — vista en vivo de un vuelo. Conecta al WebSocket
  `/flights/{id}/live` del servidor FastAPI y monta un
  `ImageSource + RasterLayer` por cada foto a medida que llegan.
* `live.js` — lógica del WebSocket + manejo de overlays.
* `index.js` — lógica de la lista de vuelos.
* `style.css` — estilos.

## Contrato con el servidor

El servidor vive en
[Robotic-Air-Systems/photos-to-kmz](https://github.com/Robotic-Air-Systems/photos-to-kmz)
(rama `main`, package `server/`). El contrato HTTP + WebSocket está
documentado en `docs/api.md` de ese repo.

Endpoints relevantes:

* `GET /config` → `{ mapbox_token: "pk.eyJ..." }`. Token leído del env
  `P2K_MAPBOX_TOKEN` del lado servidor.
* `GET /flights` → lista de vuelos activos + recientes.
* `GET /flights/{id}` → detalle de un vuelo.
* `WS /flights/{id}/live` → eventos `hello`, `photo_processed`,
  `strategy_updated`, `flight_ended`, `drone_done`.
* `GET /flights/{id}/tiles/{name}.{ext}` → bytes del tile WebP.

## Diferencias con el visor de `main`

| | `main` (producción) | esta rama (`feature-streaming`) |
| --- | --- | --- |
| Vuelo | terminado (post-USB) | activo (durante el vuelo) |
| Tile lib | MapLibre GL JS | Mapbox GL JS |
| Token | `window.MBT` desde `config.local.js` | `GET /config` del servidor |
| Datos | `data/report_<id>/manifest.json` estático | WebSocket + REST contra `server/` |
| Quad updates | uno y se queda | cambian al disparar `strategy_updated` |

La próxima sesión decide si:

* mantener las dos UIs separadas (`/` para producción, `/streaming` para live),
* unificar (una sola UI con modo "vivo" vs "histórico"),
* o algo intermedio.

## Lo que NO hay que hacer

* **NO** seguir el patrón actual de "todo en un solo HTML de 2400+
  líneas". El módulo `index.html` del repo (en `main`) es un monolito
  histórico — la siguiente sesión lo va a romper en módulos.
* **NO** introducir un framework (React/Vue/etc.) sin consultar.
  Vanilla JS + módulos ES6 + un bundler liviano (o sin bundler) es
  el patrón que pidieron.
