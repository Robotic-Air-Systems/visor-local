# System architecture — ecosystem Robotic Air Systems / Aerial Fences

Doc de arquitectura del sistema completo (no solo `visor-local`). Vive
acá porque hoy es el repo más activo, pero conceptualmente describe el
target del despliegue productivo y va a tener una copia / link desde
los otros repos (`photos-to-kmz`, futuro `af-server`) cuando exista.

Para la arquitectura interna del frontend, ver
[`ARCHITECTURE_PROPOSAL.md`](ARCHITECTURE_PROPOSAL.md).

Status: **draft inicial**. La sección 7 (roadmap) se va a ir tachando
a medida que se materialicen las fases.

---

## 1. Propósito y alcance

El sistema sirve a vuelos de inspección aérea con drones VTOL sobre
infraestructura del cliente (hoy: TGP, ductos en Perú). Las piezas:

- Procesar fotos del dron en tiempo real durante el vuelo →
  rectificarlas y mostrar cobertura live en una UI.
- Post-vuelo, generar un KMZ deliverable sobre el dataset completo.
- Mantener una identidad persistente del dron (telemetría, salud,
  credenciales rotables).
- Dar al cliente final una vista archivada del vuelo (fotos
  rectificadas, detecciones, anotaciones manuales).

**Restricciones explícitas**:

- `photos-to-kmz` **solo procesa fotos**. Auth, gestión de drones,
  archive, usuarios, etc., NO van ahí.
- La UI no es un cliente "fat" con lógica de negocio. Es presentación
  sobre APIs.
- Producción es un contrato real con cliente — los datos de vuelo son
  sensibles, no exposición pública sin auth.

---

## 2. Picture target (producción)

```
┌────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  · operator portal  (RAS interno)                                │
│  · client portal    (TGP, etc.)                                  │
└────────────────────┬───────────────────────────────────────────┘
                     │  HTTPS · session cookie / bearer
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  Gateway (nginx)                                                 │
│  · TLS termination                                               │
│  · sirve estáticos del frontend  (visor-local)                   │
│  · rutea /api/*  → servicios internos                            │
│  · valida sesión, agrega header X-User al proxy upstream         │
└──┬───────────────┬────────────────┬─────────────────┬──────────┘
   │/api/flights   │/api/drones     │/api/archive     │/api/auth
   ▼               ▼                ▼                 ▼
┌──────────┐ ┌──────────────────────────────────────────────────┐
│ photos-  │ │  af-server (FastAPI)                            │
│ to-kmz   │ │  · drones (alta, heartbeat, tokens, rotate)       │
│ (FastAPI)│ │  · archive (índice de vuelos terminados, KMZs,    │
│ · live   │ │     fotos HD, annotations)                        │
│ · WS     │ │  · auth (users, sessions, scopes)                 │
│ · tile   │ │                                                   │
│   cache  │ │                                                   │
└────┬─────┘ └────────────────────────┬────────────────────────┘
     │                                │
     └────────────────┬───────────────┘
                      ▼
        ┌──────────────────────────┐
        │  Postgres                │  users, sessions, drones,
        │                          │  flights_archive, annotations
        └──────────────────────────┘
        ┌──────────────────────────┐
        │  Disco (volumen) → S3    │  tiles streaming, KMZ finales,
        │                          │  fotos HD
        └──────────────────────────┘

        ─── del lado del campo (clientes del API) ───
        ┌──────────────────────┐
        │ af-photos-uploader   │  POST /api/flights              (drone-mode)
        │ (Jetson, dron)       │  POST /api/flights/{id}/photo
        │                      │  POST /api/drones/{id}/heartbeat
        │                      │  POST /api/drones/{id}/drone_done
        │                      │  GET  /api/flights/{id}         (recovery)
        └──────────────────────┘

  Nota: `POST /flights/{id}/end` es **operator-only**, lo llama el
  visor — no el daemon. El daemon señala fin de misión con
  `drone_done` (informativo); el operador confirma cierre.
```

---

## 3. Estado actual (mapeado al target)

| Pieza target | Estado hoy | Detalle |
| --- | --- | --- |
| Frontend (visor) | ✅ en refactor | `visor-local/`, static-only, sin build |
| Gateway nginx | ❌ no existe | Hoy `photos-to-kmz` se autoescudo (`P2K_WEB_DIR`) |
| `photos-to-kmz` | ✅ con auth dron | FastAPI, in-memory. **Drone auth completa**: endpoints `/drones/*` y los del dron en `/flights/*` validan `Bearer <drone_token>`. Operator-side endpoints sin auth todavía. |
| Drones subsystem | ✅ vive en `photos-to-kmz` | Módulo `server/drones.py`. CRUD + heartbeat + `online: bool` derivado de `last_seen`. **Va a migrar a `af-server` en Fase B** — shape no cambia, tokens permanecen válidos. |
| `af-server` | ❌ no existe | Materializa en Fase B con migración del subsystem de drones (no nacimiento). |
| Postgres | ❌ no existe | MVP arranca con SQLite en `af-server`. |
| Disco / S3 | parcial | Tiles del live van a disco del server; KMZs finales no se persisten todavía. |
| `af-photos-uploader` | ✅ con identity persistente | Fases A→E del daemon cerradas. UUID + Bearer real (32 bytes), heartbeat 10-30s adaptativo, drone-mode flight creation, recovery mid-misión, systemd hardening. 115 tests pasando. Corre contra `photos-to-kmz` directo (sin gateway). |

---

## 4. Decisiones de sistema

### 4.1 Dos servicios — `photos-to-kmz` + `af-server`

- `photos-to-kmz` queda dedicado a procesar fotos (live + batch KMZ
  post-vuelo). No conoce drones, ni usuarios, ni archive index.
- `af-server` (FastAPI nuevo) absorbe drones, auth, archive
  metadata, annotations. Arranca chico y se parte si crece mucho.

**Por qué no N servicios desde el día 1**: orquestación, logging y
deploy de N servicios pequeños es overhead que no se paga en MVP. El
costo de partir más adelante es bajo si los módulos internos están
bien delimitados.

**Por qué no 1 servicio**: contradice la restricción explícita
("`photos-to-kmz` solo procesa fotos").

### 4.2 Gateway: nginx en prod, proxy en `serve.py` en dev

- **Producción**: nginx termina TLS, sirve `visor-local/` como
  estático, hace `proxy_pass` de:
  - `/api/flights/*` → `photos-to-kmz:8000`
  - `/api/drones/*` → `af-server:8001`
  - `/api/archive/*` → `af-server:8001`
  - `/api/auth/*` → `af-server:8001`
- **Desarrollo**: `serve.py` se extiende con un proxy minimal para
  `/api/*` apuntando a los backends locales. Alternativa: correr todo
  contra `photos-to-kmz` con su `P2K_WEB_DIR` apuntando a
  `visor-local/`. Decidir cuando aparezca `af-server` — para MVP
  solo-photos-to-kmz alcanza con la segunda.

**Punto clave**: el frontend **siempre** hace `fetch('/api/...')`
relativo al origin actual. Nunca conoce los hosts ni los ports de
los backends. Eso es lo que hace el desacople real.

### 4.3 Persistencia: SQLite → Postgres

- `af-server` arranca con SQLite (un solo archivo, cero infra).
- Se migra a Postgres cuando: hay más de un proceso de
  `af-server`, hay concurrencia de escritura no trivial, o el
  archive crece.
- `photos-to-kmz` sigue siendo in-memory para flights activos
  (correcto: son efímeros). El handoff al archive lo hace
  `af-server` cuando un flight termina (subscribe vía WS o
  endpoint que `photos-to-kmz` llama al cerrar).

### 4.4 Storage: disco → S3-compatible cuando duela

- Tiles del streaming: viven en el volumen del server de
  `photos-to-kmz` (como hoy).
- KMZ finales y fotos HD del archive: volumen montado, accesible
  desde `af-server`.
- Migración a S3 / minio cuando el tamaño total justifique. Sin
  abstracción prematura.

---

## 5. Identidades y auth

Tres identidades distintas. Cada una tiene su propia ruta de auth y
su propio modelo de scope. **No mezclar.**

```
        usuarios            drones              daemons / cron
          │                   │                   │
          ▼                   ▼                   ▼
    session cookie       bearer token        service account
    del browser          por dron            (futuro)
          │                   │                   │
          └───────────────────┴───────────────────┘
                              ▼
                       af-server / auth
```

| Identidad | Cómo se autentica | Scope | Quién lo emite | Estado hoy |
| --- | --- | --- | --- | --- |
| Operador / cliente | login + cookie de sesión | sus vuelos / proyectos | `af-server` (Fase C) | ❌ pendiente |
| Dron | bearer en `Authorization` | vuelo activo del dron | `POST /api/drones` (emisión única) | ✅ implementado |
| Service account | bearer largo-plazo | scope amplio | manual, en config | futuro |

### Postura actual (MVP)

- **Drone auth ya está**: endpoints `/drones/*` y los del dron en
  `/flights/*` (photo, drone_done, drone-mode flight creation)
  validan `Authorization: Bearer <drone_token>` contra el registro
  de drones. Token emitido en cleartext **una sola vez** en la
  response del `POST /drones`. Mismatch entre token y `flight_id`
  retorna `403 token_drone_mismatch`.
- **Modo legacy** (sin identity provisionada en el daemon) acepta
  `Bearer dev-token` para tests/transición.
- **Operator auth todavía no**: la UI corre sin login. Por eso el
  sistema sigue siendo LAN/VPN-only para el lado humano hasta
  Fase C.
- Endpoints operator-only que existen hoy SIN auth: todo lo que el
  visor consume (listing, archive, `POST /flights/{id}/end`, etc.).

### Migración a producción (Fase C en §7)

- `af-server/auth` emite cookies de sesión (httpOnly, Secure,
  SameSite=Lax) para operadores.
- nginx valida la cookie, agrega `X-User`/`X-Scope` al request
  upstream a endpoints operator-only.
- Drone auth (ya implementada) sigue funcionando vía Bearer: el
  daemon NO usa cookies de sesión.
- Endpoints sin auth (futuros): `/api/auth/login`, `/api/healthz`.

---

## 6. Contratos de URL desde el frontend

El frontend asume estas URLs (todas relativas al origin). Los
servicios backend pueden cambiar de puerto, host, o partirse — el
frontend no se entera.

| Path prefix | Servicio responsable | Estado |
| --- | --- | --- |
| `/api/flights/*` | `photos-to-kmz` | ✅ existe (sin prefix `/api/` hoy) |
| `/api/flights/{id}/live` (WS) | `photos-to-kmz` | ✅ existe |
| `/api/config` | `photos-to-kmz` (hoy) → `af-server` (Fase C) | ✅ existe |
| `/api/healthz` | `photos-to-kmz` | ✅ existe |
| `/api/drones/*` | `photos-to-kmz` (hoy) → `af-server` (Fase B) | ✅ existe (migra en Fase B; shape no cambia) |
| `/api/drones/live` (WS) | `af-server` | Fase B — server-side pendiente |
| `/api/archive/flights/*` | `af-server` | Fase D (hoy: filesystem) |
| `/api/auth/*` | `af-server` | Fase C |

**Errores del API**: shape uniforme
`{"error": {"code": "...", "message": "...", "hint": null}}`. Códigos
en uso hoy: `missing_credentials`, `invalid_token`,
`token_drone_mismatch`, `drone_not_found`, `flight_not_found`,
`no_active_flight`, `flight_already_ended`, `flight_gone`,
`missing_fields`. El `apiFetch` del frontend ya normaliza esto a
`Error{code, status, message, hint}`.

**Nota MVP**: hoy los paths no tienen prefix `/api/` porque
`photos-to-kmz` se autosirve. El wrapper `apiFetch` agrega el prefix
desde una constante (`API_PREFIX`) — el día que nginx aparezca,
cambia una sola línea. **Esto coordina con `af-photos-uploader`**:
el daemon también hardcodea paths sin prefix hoy. Cuando se haga el
flip a `/api/`, los dos repos cambian juntos en un release coordinado
(daemon agrega `--api-prefix=/api`).

---

## 7. Roadmap por fases

Cada fase es independiente y mergeable. Las fechas son tentativas —
dependen del lado backend.

### Fase A (MVP, ahora) — Refactor del visor

- Multi-page con módulos compartidos (ver `ARCHITECTURE_PROPOSAL.md`).
- MapLibre unificado.
- `apiFetch` + `session.js` (no-op) preparados para auth futura.
- Archive sigue leyendo del filesystem pero a través de
  `src/api/archive.js`.
- **Página de drones puede shipear acá** (los endpoints ya existen
  en `photos-to-kmz`). Polling de `GET /drones` cada 5-10s mientras
  no exista `WS /drones/live`.
- Sin operator auth.

### Fase B — `af-server` se materializa (migración de drones)

**Reframe**: drones ya viven en `photos-to-kmz` (módulo
`server/drones.py`, in-memory). Esta fase los **extrae** a un
servicio separado, no los crea.

- Nuevo paquete/repo `af-server` (FastAPI + SQLite).
- Migración del subsystem de drones: shape de endpoints intacto,
  tokens emitidos siguen válidos (registry se migra completo).
- Server-side pendientes (planeados, no urgentes): `PUT /drones/{id}`,
  `POST /drones/{id}/rotate-token`, `WS /drones/live`, worker async
  que marca offline al exceder threshold.
- nginx aparece como gateway. Ambos servicios bajo `/api/*`.
- **Coordinación con `af-photos-uploader`**: el daemon agrega flag
  `--api-prefix=/api` el mismo día que nginx aparece.
- Frontend del visor: cambia `API_PREFIX` constant en `apiFetch`.
  Si la página de drones ya existía (de Fase A), no cambia código
  porque ya usa `apiFetch` con paths relativos.

### Fase C — Operator auth

**Drone auth ya está implementada** (ver §5). Esta fase agrega la
identidad del lado humano.

- `af-server/auth` con users + sessions + login UI.
- Gateway valida cookies en endpoints operator-only.
- `session.js` del frontend crece con login flow y manejo de
  redirects-on-401.
- Drone auth no se toca: el daemon sigue mandando Bearer; los
  endpoints del dron no requieren cookie.
- **Aquí termina el "LAN-only" para la UI** — recién acá el sistema
  puede salir a internet con usuarios reales.

### Fase D — Archive en backend

- Hoy: vuelos terminados son archivos en el disco del visor.
- Target: `af-server/archive` indexa vuelos terminados en SQLite,
  expone `/api/archive/flights/{id}/manifest`, sirve fotos HD via
  endpoint (eventualmente con presigned URLs).
- Annotations se mueven de `localStorage` a tabla en DB.
- Frontend: `src/api/archive.js` cambia su implementación, las
  páginas no se enteran.

### Fase E — Postgres

- Migración de SQLite a Postgres en `af-server`.
- Sin cambios en frontend.
- Disparador: concurrencia o tamaño.

### Fase F — Storage S3-compatible

- Tiles del streaming y fotos HD del archive van a minio/S3.
- `photos-to-kmz` y `af-server` aprenden a escribir a object
  storage.
- Frontend ve URLs distintas (CDN o presigned) — el cambio queda
  contenido en `src/api/*`.

---

## 8. Seguridad — postura y migración

### Hoy (Fase A)

- Servidor corre en LAN o VPN interna.
- Cero auth en endpoints.
- Datos del cliente accesibles a cualquier dispositivo en la red.
- **Es aceptable solo si el operador asegura el perímetro de red.**

### Mínimo para salir a internet (Fase C lista)

- TLS en el gateway (Let's Encrypt o cert corporativo).
- Cookies `Secure; HttpOnly; SameSite=Lax`.
- CSRF: token en formularios mutating o `SameSite=Strict` para
  cookies de sesión.
- Rate limiting en `af-server/auth/login`.
- Logs de acceso retenidos N días.
- Backup de la DB (cron + retention policy).

### Auditoría post-MVP

- Pen-test antes de exponer a cliente externo.
- Política de rotación de tokens de drones.
- Revisión de scopes — un operador NO ve vuelos de otro cliente.

---

## 9. Repositorios y deploy

Layout esperado (cuando todos existan):

```
~/RAS_personal/
├── visor-local/       frontend (este repo)
├── photos-to-kmz/     engine + live API
├── af-server/       drones + auth + archive (futuro)
├── af-photos-uploader/  daemon del dron
└── deploy/            (futuro) compose, nginx config, scripts
```

Deploy en prod: `docker compose` con un servicio por repo + nginx +
postgres. El detalle se define en Fase B o C, no antes.

---

## 10. Glosario

- **vuelo** (`flight`): una sesión de captura con un dron sobre un
  proyecto, identificada por `(cliente, proyecto, fecha, vuelo_id)`.
- **dron**: identidad persistente del hardware. Un dron corre
  múltiples vuelos a lo largo de su vida útil.
- **operador**: usuario humano del lado RAS o del cliente. Tiene
  sesión, scopes.
- **tile**: imagen rectificada (georreferenciada) lista para
  mostrarse en el mapa como `ImageSource`.
- **footprint / quad**: los 4 corners `[lat, lon]` del tile en el
  terreno. Orden del API: `LL, LR, UR, UL`.
- **strategy**: del lado de `photos-to-kmz`, la heurística de AGL
  (Above Ground Level) que se infiere/locks durante el vuelo.
- **archive**: vuelos ya terminados, congelados. El visor de
  producción del cliente trabaja sobre archive.
- **live**: vuelos activos, datos llegando por WS.
