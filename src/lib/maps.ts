/**
 * Reads a map position from the links people copy out of Google Maps:
 *   https://www.google.com/maps/place/.../@0.3536,32.6121,17z/...
 *   https://www.google.com/maps/...!3d0.3536!4d32.6121...
 *   https://maps.google.com/?q=0.3536,32.6121
 *   https://www.google.com/maps/search/?api=1&query=0.3536%2C32.6121
 *   or just "0.3536, 32.6121"
 * Short links (maps.app.goo.gl) do not contain the position, so they return
 * null and the owner is asked for the full link or their location instead.
 */
export function parseMapPosition(input: string): { lat: number; lng: number } | null {
  const text = decodeURIComponent(input.trim());
  const candidates = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // most precise: the place itself
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of candidates) {
    const m = pattern.exec(text);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: round(lat), lng: round(lng) };
    }
  }
  return null;
}

/** Six decimals is about 10 cm: plenty for a restaurant pin. */
function round(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
