/**
 * Where a job is, for its map pin: GeoJSON [lng, lat] from the API → { latitude, longitude }, or
 * null when there is no usable point (missing, the 0,0 placeholder, out of range). Pure; checked
 * by jobPoint.check.mjs.
 */
export function jobPoint(coordinates?: [number, number] | number[] | null) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}
