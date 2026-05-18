# visor-local

Standalone workspace to run the client visor (`visor-cliente-v8.html`)
on the laptop against local TGP_half data, no backend required.

## Layout

```
visor-local/
├── index.html              modified visor (login bypassed)
├── serve.py                static HTTP server on :8765
├── tools/
│   └── build_manifest.py   KMZ → manifest.json + photos/ extraction
└── data/
    ├── ductos.geojson      pipeline geometry (placeholder = flight centroids)
    ├── estaciones.geojson  stub (empty FC)
    ├── postes.geojson      stub (empty FC)
    ├── annotations/
    │   └── vuelo2.json     stub (empty)
    └── report_vuelo2/
        ├── manifest.json   per-overlay footprints + flight metadata
        ├── footprints.geojson  stub (rebuilt at runtime from manifest)
        ├── flight_path.geojson LineString through photo centroids
        ├── detections.geojson  stub
        ├── photos/         tiles served when overlays toggled on
        └── photos_hd/      tiles served in the inspector view
```

## Run

### Setup inicial (una sola vez)

1. **Token de Mapbox.** El visor necesita un token público de Mapbox
   para renderear el mapa. Copiar el archivo de ejemplo y completarlo
   con tu token:

   ```bash
   cp config.local.js.example config.local.js
   # editar config.local.js y reemplazar el placeholder con el token real
   ```

   `config.local.js` está en `.gitignore` — no se sube al repo. Cada
   quien usa su token. Si no se crea, el mapa simplemente no carga
   (la consola del browser muestra el aviso).

   Conseguir un token: <https://account.mapbox.com/access-tokens/> —
   un token público "default" alcanza.

2. **Datos del vuelo.** Si solo cloñaste el repo, las fotos del vuelo
   no están (son ~665 MB, se ignoran). Para regenerarlas necesitás
   un KMZ del engine (ver "Rebuilding the data" abajo).

### Lanzar el servidor

```bash
python3 serve.py
# abrir http://127.0.0.1:8765/
```

El visor carga sin login (el bypass ya está aplicado). El manifest +
las fotos vienen de `data/`.

## Rebuilding the data

If you regenerate the KMZ (different `--max-edge`, different photo
set, etc.), re-run the manifest builder pointing at the new file:

```bash
python3 tools/build_manifest.py \
    /path/to/your.kmz \
    -o data/report_vuelo2 \
    --name "Vuelo TGP_half" \
    --date 2026-05-12
```

That extracts every tile to `photos/` and `photos_hd/` (lowercased
to match what the visor's `pUrl`/`pUrlHD` helpers request) and writes
the manifest with the per-photo footprint and the flight_path
LineString through the centroids.

For a hi-res inspector view (more zoom detail), regenerate the KMZ
at a higher max-edge and point `photos_hd/` at it specifically:

```bash
# In the photos-to-kmz repo:
python photos_to_kmz.py data/TGP_half/ --max-edge 6144 -o /tmp/tgp-hd.kmz

# Then back here, extract only the HD tiles (skip manifest rebuild):
python3 tools/build_manifest.py /tmp/tgp-hd.kmz -o /tmp/tgp-hd-extracted \
    --name "_" --date "_"
rm -rf data/report_vuelo2/photos_hd
mv /tmp/tgp-hd-extracted/photos_hd data/report_vuelo2/photos_hd
```

## Ducto data

Right now `ductos.geojson` is a **placeholder** — a LineString
through the photo centroids. If the drone flew along the pipeline,
that line approximates it, and a correct alignment shows it near
the center of each photo in the inspector. **Swap it for the real
TGP pipeline GeoJSON** when you have it; same `FeatureCollection`
shape, no other changes needed.

## What this lets you do

Open a photo in the inspector and verify whether the pipeline
overlay (drawn via 4-point homography from `manifest.image_overlays.<name>.footprint`)
aligns with the visible content. The four image pixel corners
`(0,0), (w,0), (w,h), (0,h)` must correspond exactly to the four
ground points in `footprint` for the homography to work — that's
the property the engine guarantees for KMZ tiles.

If the placeholder ducto line draws on the correct trace through
each photo, the alignment math is sound and any remaining
misalignment with the real pipeline data is in the real GeoJSON
(coordinate frame, datum, surveyor offset, etc.). If even the
placeholder is misaligned, there's a bug in the homography or the
manifest's footprint emission.
