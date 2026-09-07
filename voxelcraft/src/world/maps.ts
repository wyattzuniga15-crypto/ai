/**
 * Maps. A map is a square of colours a hundred and twenty-eight across, centred on a multiple of its
 * own scale the way vanilla centres one, filled in as whoever carries it walks about.
 */

/** Width and height of every map, as vanilla fixes it. */
export const MAP_SIZE = 128;

export interface MapData {
  id: number;
  /** 0 to 4: each step doubles how many blocks a pixel covers. */
  scale: number;
  /** Block position of the middle of the map. */
  cx: number;
  cz: number;
  /** 0xRRGGBB per pixel, or -1 where nothing has been drawn yet. */
  colors: Int32Array;
  /** A locked map stops filling in, which is what a cartography table's glass pane does. */
  locked: boolean;
}

/** Blocks to a pixel at a scale. */
export const blocksPerPixel = (scale: number): number => 1 << scale;

/** Where vanilla centres a new map: on the middle of the square the player is standing in. */
export function mapCenter(x: number, z: number, scale: number): { cx: number; cz: number } {
  const span = blocksPerPixel(scale) * MAP_SIZE;
  const round = (v: number): number => Math.floor((v + span / 2) / span) * span - span / 2 + Math.floor(span / 2);
  return { cx: round(x), cz: round(z) };
}

export function createMap(id: number, x: number, z: number, scale = 0): MapData {
  const { cx, cz } = mapCenter(x, z, scale);
  return { id, scale, cx, cz, colors: new Int32Array(MAP_SIZE * MAP_SIZE).fill(-1), locked: false };
}

/** The pixel a world position falls on, or null when it is off the map. */
export function pixelFor(map: MapData, x: number, z: number): { px: number; pz: number } | null {
  const per = blocksPerPixel(map.scale);
  const px = Math.floor((x - map.cx) / per) + MAP_SIZE / 2;
  const pz = Math.floor((z - map.cz) / per) + MAP_SIZE / 2;
  if (px < 0 || pz < 0 || px >= MAP_SIZE || pz >= MAP_SIZE) return null;
  return { px, pz };
}

/** The world position a pixel covers, at its top-left corner. */
export function worldFor(map: MapData, px: number, pz: number): { x: number; z: number } {
  const per = blocksPerPixel(map.scale);
  return { x: map.cx + (px - MAP_SIZE / 2) * per, z: map.cz + (pz - MAP_SIZE / 2) * per };
}

/** Everything a map needs to know about a column of the world to draw it. */
export interface MapSample {
  /** The colour of the top block of a column, or -1 when the column is not loaded. */
  color(x: number, z: number): number;
  /** How high that block is, for the shading. */
  height(x: number, z: number): number;
}

/**
 * Fills in the pixels around a position. Vanilla shades a pixel by how its column compares with the
 * one to the north: a step up is bright, a step down is dark.
 */
export function fillAround(map: MapData, sample: MapSample, x: number, z: number, radius: number, shade: (color: number, level: number) => number): number {
  if (map.locked) return 0;
  const per = blocksPerPixel(map.scale);
  const centre = pixelFor(map, x, z);
  if (!centre) return 0;
  const span = Math.max(1, Math.ceil(radius / per));
  let drawn = 0;
  for (let dz = -span; dz <= span; dz++) {
    for (let dx = -span; dx <= span; dx++) {
      const px = centre.px + dx;
      const pz = centre.pz + dz;
      if (px < 0 || pz < 0 || px >= MAP_SIZE || pz >= MAP_SIZE) continue;
      const at = worldFor(map, px, pz);
      const color = sample.color(at.x, at.z);
      if (color < 0) continue;
      const here = sample.height(at.x, at.z);
      const north = sample.height(at.x, at.z - per);
      const level = north === here ? 1 : north < here ? 2 : here - north < -2 ? 3 : 0;
      const next = shade(color, level);
      if (map.colors[pz * MAP_SIZE + px] === next) continue;
      map.colors[pz * MAP_SIZE + px] = next;
      drawn++;
    }
  }
  return drawn;
}

/** Maps are saved as base64, three bytes a pixel, which keeps a world file honest about its size. */
export function serializeMap(map: MapData): { id: number; scale: number; cx: number; cz: number; locked: boolean; colors: string } {
  const bytes = new Uint8Array(MAP_SIZE * MAP_SIZE * 3);
  for (let i = 0; i < map.colors.length; i++) {
    const c = map.colors[i];
    if (c < 0) continue;
    bytes[i * 3] = (c >> 16) & 255;
    bytes[i * 3 + 1] = (c >> 8) & 255;
    bytes[i * 3 + 2] = c & 255;
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { id: map.id, scale: map.scale, cx: map.cx, cz: map.cz, locked: map.locked, colors: btoa(binary) };
}

export function deserializeMap(saved: { id: number; scale: number; cx: number; cz: number; locked?: boolean; colors: string }): MapData {
  const map = createMap(saved.id, 0, 0, saved.scale);
  map.cx = saved.cx;
  map.cz = saved.cz;
  map.locked = !!saved.locked;
  const binary = atob(saved.colors);
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
    const r = binary.charCodeAt(i * 3);
    const g = binary.charCodeAt(i * 3 + 1);
    const b = binary.charCodeAt(i * 3 + 2);
    map.colors[i] = r === 0 && g === 0 && b === 0 ? -1 : (r << 16) | (g << 8) | b;
  }
  return map;
}
