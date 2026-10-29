const EARTH_RADIUS_KM = 6371;

export interface Point {
  lat: number;
  lon: number;
}

/**
 * Distancia en línea recta (Haversine) en km.
 * Supuesto documentado: el enunciado no define cómo medir el trayecto; no es distancia por calles.
 */
export function haversineKm(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(p: Partial<Point>): p is Point {
  return (
    typeof p.lat === 'number' && typeof p.lon === 'number' &&
    p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180
  );
}
