// Math pura — homografía de 4 puntos + distancia haversine. Sin DOM,
// sin estado, exportable como librería. Reutilizable en cualquier
// contexto donde se necesite proyectar entre dos planos vía 4 corners.
//
// El uso en el visor: mapear coordenadas geográficas (footprint) a
// coordenadas pixel de una foto rectificada, y viceversa. Eso permite
// dibujar el ducto sobre la foto y medir distancias geográficas
// clickeando pixels en la foto.

// Resuelve A·x = b por eliminación gaussiana con pivot parcial.
// `A` es matriz cuadrada (Array de Arrays), `b` es vector.
export function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[mx][i])) mx = k;
    }
    [M[i], M[mx]] = [M[mx], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// Calcula la homografía H 3×3 que mapea 4 puntos `src` a 4 puntos
// `dst`. Devuelve la matriz como Array de 3 Arrays con h22 fijo a 1.
// Convención: src[i] y dst[i] son [x, y] correspondientes.
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < src.length; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]); b.push(dy);
  }
  const h = solveLinear(A, b);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// Aplica la homografía a un punto [x, y]. Devuelve [x', y'].
export function applyHomography(H, [x, y]) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [
    (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  ];
}

// Distancia great-circle en metros entre dos puntos [lon, lat].
export function haversineMeters([lo1, la1], [lo2, la2]) {
  const R = 6371000;
  const d = Math.PI / 180;
  const a =
    Math.sin((la2 - la1) * d / 2) ** 2 +
    Math.cos(la1 * d) * Math.cos(la2 * d) *
    Math.sin((lo2 - lo1) * d / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Formatea metros a string legible (cm / m / km).
export function formatDistance(m) {
  if (m < 1) return `${(m * 100).toFixed(1)} cm`;
  if (m < 1000) return `${m.toFixed(1)} m`;
  return `${(m / 1000).toFixed(3)} km`;
}

// Aproxima un círculo geográfico como polígono de `segments` lados.
// Usamos la fórmula chica (válida para radios chicos vs radio terrestre):
// 1 grado de latitud ≈ 111320 m; longitud escala con cos(lat).
// El último punto se duplica para cerrar el polígono GeoJSON.
export function geoCircleToPolygon([lng, lat], radiusMeters, segments = 64) {
  const out = [];
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    out.push([
      lng + (radiusMeters / 111320) * Math.cos(a) / cosLat,
      lat + (radiusMeters / 111320) * Math.sin(a),
    ]);
  }
  out.push(out[0]);
  return out;
}
