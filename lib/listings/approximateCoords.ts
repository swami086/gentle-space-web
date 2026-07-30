/** Stable display coords for browse map pins (~150–300 m from true). */
export function approximateCoords(
  lat: number,
  lng: number,
  seed: string,
): { lat: number; lng: number } {
  const hash = fnv1a(seed);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const meters = 150 + (hash % 151); // 150..300
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + dLat * Math.sin(angle),
    lng: lng + dLng * Math.cos(angle),
  };
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
