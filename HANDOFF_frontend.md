# Handoff — fixes para el visor

Te paso dos correcciones que mejoran el visor sobre el dataset TGP_half.
**No necesitás tocar `visor-cliente-v8.html`** — los cambios son sobre
los archivos de datos que consume. Reemplazás los archivos viejos por
los nuevos y listo.

---

## Resumen

| Problema | Cómo se ve | Qué cambia |
| --- | --- | --- |
| Las fotos HD no calzan con el ducto en el inspector | El ducto aparece corrido / mal posicionado sobre la foto | Te paso un KMZ HD nuevo donde las imágenes alinean pixel-perfect con el footprint |
| Las detecciones no aparecen en el inspector (ni cajas ni chips) | El panel de detections queda vacío | Te paso un `detections.geojson` con las bboxes ya en el sistema de coordenadas correcto y los `source_image` con el formato que tu filtro espera |

---

## Bug 1 — alineación HD ↔ ducto

### Lo que pasaba

Tu inspector dibuja el ducto encima de la foto usando una homografía
de 4 puntos:

```js
// línea ~2199 de visor-cliente-v8.html
const px = [[0,IS.ih],[IS.iw,IS.ih],[IS.iw,0],[0,0]];
IS.H = compH(ovForH.footprint, px);
```

Esa homografía asume que **las 4 esquinas-pixel de la imagen
corresponden exactamente a los 4 puntos del `footprint` del manifest**.
Si esa asunción se cumple, el ducto calza pixel-perfect siempre (es
matemática exacta sobre un plano). Si no se cumple, todo se ve corrido.

Las imágenes HD que tenías eran de **una rectificación distinta a la
que produjo el `footprint`** — los métodos rectificaban a tamaños y
con recortes diferentes. Las 4 esquinas-pixel no caían sobre los 4
puntos del footprint, así que la homografía mapeaba al lugar
equivocado.

### Fix

Te paso un KMZ nuevo (`tgp-half-9504.kmz`) cuyos tiles internos
**fueron generados por el mismo proceso que generó el footprint del
manifest**. Por construcción:

> Las 4 esquinas-pixel de cada `.webp` dentro del KMZ caen exactamente
> sobre los 4 puntos `footprint` correspondientes del manifest.

La homografía de tu HTML calza pixel-perfect.

Resolución: **9504×6336 nativa** de la cámara. Sin downsample, sin
pérdida. KMZ pesa ~620 MB.

### Acción

1. Extraé las imágenes del KMZ (cualquier `unzip`):

   ```bash
   unzip tgp-half-9504.kmz "photos/*" -d tgp-hd/
   ```

   Adentro hay 252 archivos `RAS_NNNNN.webp`.

2. Servílos desde tu endpoint `photos_hd/<name>.webp` (en lowercase
   si tu visor hace `.toLowerCase()`, que sí lo hace en `pUrlHD`).

3. El endpoint `photos/<name>.webp` para el overlay del mapa lo podés
   dejar como está si te funciona, o reemplazar con la versión 3072
   también desde mí (`tgp-half-3072.kmz`, ~70 MB). Ambos tienen
   footprints compatibles.

> **¿Y el `doc.kml` adentro del KMZ?** Tiene `<GroundOverlay>` con
> `<gx:LatLonQuad>` por foto — son los mismos 4 corners que están en
> tu `manifest.image_overlays[name].footprint`. Si tu backend genera el
> manifest a partir del KMZ, dejalo que lo regenere desde este KMZ
> nuevo. Si tu manifest actual ya vino de una corrida anterior del
> mismo proceso (e.g. cuando te pasamos el KMZ a 3072), las quads no
> cambian con la resolución y el manifest sigue válido — solo
> reemplazás las imágenes y listo.

### Verificación rápida

En el inspector, cargá una foto cualquiera. Si dibujás un círculo en
pixel `(0,0)` del tile, debería caer exactamente sobre la esquina UL
del polígono naranja del footprint en el mapa. Si calza, el resto
calza solo. Probado sobre las 252 fotos del flight, todo perfecto.

---

## Bug 2 — detecciones no aparecen

### Lo que pasaba

Dos cosas, ambas en `detections.geojson`:

**(a) `source_image` con extensión.** Tu filtro en `openInsp` (línea ~2190):

```js
const si = detections.filter(d =>
  d.properties.source_image === img ||
  d.properties.source_image?.replace(/\.[^.]+$/,'') + '.png' === img
);
```

Compara con `===` estricto contra el `img` que sale del manifest, que es
`"RAS_00083"` sin extensión. Las detecciones venían con
`"RAS_00083.JPG"` — no matcheaba nunca, `si` quedaba vacío.

**(b) `bbox_px` en coordenadas equivocadas.** El detector YOLO corre
sobre **la foto original tilteada** (la que sale de la cámara), y los
pixels de la bbox son sobre esa imagen (9504×6336). Pero el inspector
muestra **la foto rectificada**, que es otro sistema de coordenadas
pixel. Una bbox YOLO en `[6348, 5183, ...]` de la original no apunta
al mismo objeto en la rectificada.

### Fix

Te paso `detections.geojson` con las dos correcciones:

* `source_image` sin extensión (`"RAS_00083"`).
* `bbox_px` ya transformada al pixel-space del tile rectificado que tu
  inspector muestra.

Cada feature se ve así:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [-76.140, -13.334]
  },
  "properties": {
    "id": "20260425_165112_RAS_00083_vehicle_1",
    "source_image": "RAS_00083",
    "source_image_file": "RAS_00083.JPG",
    "class": "vehicle",
    "confidence": 0.80,
    "bbox_px": [6356.4, 5160.5, 208.7, 181.3],
    "bbox_px_original": [6348, 5183, 6557, 5364],
    "tile_dims": [9504, 6326],
    "crop": "crops/20260425_165112_RAS_00083_vehicle_1.jpg",
    "timestamp": "2026:04:25 16:51:12.000000"
  }
}
```

Campos clave para tu lado:

| Campo | Para qué | Cómo lo usás |
| --- | --- | --- |
| `source_image` | Matcheo contra el manifest (sin ext.) | tu filtro ya lo hace |
| `bbox_px` | `[x, y, w, h]` en pixel-coords del tile rectificado | tu `renderBx` lo destructura tal cual |
| `tile_dims` | Las dimensiones del tile a las que se refieren las coords | sanity check — debe coincidir con `naturalWidth` / `naturalHeight` |
| `crop` | Ruta al thumbnail del chip | tu `cUrl(p.crop)` lo levanta |
| `bbox_px_original` | Coords originales pre-transform | solo para debug, ignoralo |

### Acción

1. Reemplazá `data/report_vuelo2/detections.geojson` con el archivo que
   te paso.
2. Serví los thumbnails desde `data/report_vuelo2/crops/<id>.jpg`. Te
   paso la carpeta `crops/` con 44 archivos.

### Cobertura

26 de 44 detecciones tienen tile correspondiente en el KMZ de TGP_half
(las otras 18 son sobre fotos pares que no entraron en este subset).
Si más adelante les pasamos el flight completo, todas van.

Fotos con detecciones para que las testees:

```
RAS_00023, RAS_00083, RAS_00095, RAS_00097,
RAS_00113, RAS_00115, RAS_00117, RAS_00119,
RAS_00145, RAS_00149, RAS_00181, RAS_00295
```

### Nota sobre tilts fuertes

La bbox del JSON es **axis-aligned** en el tile rectificado. El
cuadrilátero real (warpeado) sería levemente rotado para frames con
mucho tilt. Diferencia: ~5-10 px sobre 9000 píxeles para tilts
moderados. Imperceptible visualmente.

Si después de ver el resultado querés que dibujemos el cuadrilátero
exacto en vez del AABB, te emitimos `bbox_quad: [[x,y]×4]` y lo render
con un `<polygon>` SVG (ya tenés la infra del SVG por la regla y el
ducto).

---

## Archivos que te paso

| Archivo | Tamaño | Para qué |
| --- | --- | --- |
| `tgp-half-9504.kmz` | 622 MB | KMZ HD nativo. Extraés y servís sus tiles como `photos_hd/<name>.webp`. |
| `tgp-half-3072.kmz` | 70 MB | (opcional) KMZ liviano para overlay del mapa. Mismas footprints. |
| `detections.geojson` | 22 KB | 26 detecciones con bboxes transformadas. Va en `data/report_<id>/`. |
| `crops/` | ~2 MB total, 44 archivos | Thumbnails de cada detección. Va en `data/report_<id>/crops/`. |
| `manifest.json` | 80 KB | (opcional, referencia) Si tu backend no genera uno o querés comparar. |

622 MB no entra por mail. Te conviene Drive con link compartido, o si
estás en oficina te lo mando por rsync/SCP a tu laptop.

---

## Lo que NO necesitás cambiar

* `visor-cliente-v8.html` queda tal cual está. Ya hace lo correcto:
  - Tu `renderBx()` consume `[x, y, w, h]` — los emitimos en ese shape.
  - Tu filtro `source_image === img` con strict equality — emitimos
    sin extensión.
  - Tu `compH()` de 4 puntos — el KMZ nuevo le da las esquinas
    correctas por construcción.
* No te paso ningún script Python que tengas que correr — todo lo
  resolví offline y te paso los archivos resultantes.

---

## Performance opcional (RAM del browser)

Esto es una observación, no un fix obligatorio. En mi setup local
encontré que MapLibre puede acumular muchísima RAM si cacheás muchas
fotos como `ImageSource`. Algunos ajustes que ayudan:

1. **Bajar `PCMAX`** en tu visor de 80 a ~20. Cada photo source decoded
   pesa ~25 MB en RAM/GPU; 80 cacheadas = 2 GB sin contar nada más.
2. **Cache-Control `no-store` en el endpoint de `photos_hd/*`**. Una
   foto HD pesa ~240 MB decoded en `<img>`. Sin `no-store` el browser
   las acumula en su disk-cache RAM aún después de cerrar el inspector.
   Con `no-store` libera al cerrar; re-fetch es trivial (~5 ms en LAN).
3. **En `closeInsp()` agregar `el.src = ""`** antes de remover la
   clase `open`. Fuerza al browser a liberar el bitmap HD inmediato.

Si tu setup ya anda bien, ignoralo. En mi laptop con 16 GB hacía falta
para sesiones largas.

---

## Status / Próximos pasos

* **Tu lado, ahora**: integrar el KMZ HD + `detections.geojson` +
  `crops/`. Validar que el ducto calza y las cajas aparecen sobre los
  vehículos.

* **Mi lado, próximamente**: hoy la transformación de bboxes la corro
  en un script offline. Pronto va a vivir directo en el pipeline del
  backend, así cuando llegue una foto nueva con detecciones, ya
  recibís `detections.geojson` actualizado sin intervención manual.
  Esto no cambia nada en tu código — seguís recibiendo el mismo shape
  de JSON.

* **Coordinar después**: si querés render del cuadrilátero exacto en
  vez del AABB para tilts fuertes, hablamos cuando veas el resultado.

Cualquier cosa rara cuando integres los archivos, me decís.
