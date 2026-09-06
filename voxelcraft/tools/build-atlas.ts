/**
 * Packs the block and item textures from assets/textures/{block,item} into two atlases in
 * public/atlas/. Animated textures (vertical strips with a .mcmeta file) are split into frames,
 * each frame gets its own atlas rectangle, and the tile records the playback sequence.
 *
 * Tile 0 of every atlas is the missing-texture checker so an unknown texture name never crashes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ASSETS, PUBLIC } from './lib/paths.ts';
import { ensureDir, listFiles, writeJson } from './lib/fs.ts';

export interface AtlasTile {
  /** Texture name as models reference it, e.g. "block/stone" or "item/diamond_sword". */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Atlas positions of each animation frame (frame 0 == x,y). Absent for static tiles. */
  frames?: [number, number][];
  /** Playback sequence as [frameIndex, ticks] pairs. */
  seq?: [number, number][];
  interpolate?: boolean;
}

export interface AtlasJson {
  width: number;
  height: number;
  tiles: AtlasTile[];
}

interface Source {
  name: string;
  w: number;
  h: number;
  /** RGBA pixels per frame. */
  frames: Uint8Array[];
  seq?: [number, number][];
  interpolate?: boolean;
}

interface McMeta {
  animation?: {
    frametime?: number;
    interpolate?: boolean;
    width?: number;
    height?: number;
    frames?: (number | { index: number; time?: number })[];
  };
}

function missingTexture(): Source {
  const px = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const magenta = (x < 8) === (y < 8);
      const i = (y * 16 + x) * 4;
      px[i] = magenta ? 248 : 0;
      px[i + 1] = 0;
      px[i + 2] = magenta ? 248 : 0;
      px[i + 3] = 255;
    }
  return { name: 'missingno', w: 16, h: 16, frames: [px] };
}

function readSource(dir: string, prefix: string, file: string): Source | null {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const name = `${prefix}/${file.slice(0, -4)}`;
  const metaFile = path.join(dir, `${file}.mcmeta`);
  let meta: McMeta | null = null;
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as McMeta;
    } catch {
      meta = null;
    }
  }
  const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  if (!meta?.animation) {
    return { name, w: png.width, h: png.height, frames: [data] };
  }
  const anim = meta.animation;
  const fw = anim.width ?? png.width;
  const fh = anim.height ?? (anim.width ? png.height : png.width);
  const count = Math.max(1, Math.floor(png.height / fh));
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) frames.push(data.subarray(i * fh * png.width * 4, (i + 1) * fh * png.width * 4));
  const frametime = anim.frametime ?? 1;
  let seq: [number, number][];
  if (anim.frames && anim.frames.length) {
    seq = anim.frames.map((f) => (typeof f === 'number' ? [f, frametime] : [f.index, f.time ?? frametime]));
  } else {
    seq = frames.map((_, i) => [i, frametime]);
  }
  return { name, w: fw, h: fh, frames, seq, interpolate: anim.interpolate === true };
}

/** Simple shelf packer: rows of equal height, sorted tallest first. */
function pack(sources: Source[], width: number): { placements: Map<Source, [number, number][]>; height: number } {
  const rects: { src: Source; frame: number; w: number; h: number }[] = [];
  for (const s of sources) s.frames.forEach((_, i) => rects.push({ src: s, frame: i, w: s.w, h: s.h }));
  // Keep insertion order stable within equal sizes so atlas layouts are reproducible.
  rects.sort((a, b) => b.h - a.h || b.w - a.w);
  const placements = new Map<Source, [number, number][]>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const r of rects) {
    if (r.w > width) throw new Error(`texture ${r.src.name} is wider (${r.w}) than the atlas (${width})`);
    if (x + r.w > width) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    let list = placements.get(r.src);
    if (!list) placements.set(r.src, (list = []));
    list[r.frame] = [x, y];
    x += r.w;
    rowH = Math.max(rowH, r.h);
  }
  return { placements, height: y + rowH };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function buildAtlas(name: string, sources: Source[]): { json: AtlasJson; png: Buffer } {
  const totalArea = sources.reduce((a, s) => a + s.w * s.h * s.frames.length, 0);
  let width = 512;
  while (width * width < totalArea * 1.15 && width < 8192) width *= 2;
  let packed = pack(sources, width);
  while (packed.height > width && width < 8192) {
    width *= 2;
    packed = pack(sources, width);
  }
  const height = nextPow2(packed.height);
  const png = new PNG({ width, height });
  png.data.fill(0);
  const tiles: AtlasTile[] = [];
  for (const s of sources) {
    const places = packed.placements.get(s)!;
    for (let f = 0; f < s.frames.length; f++) {
      const [px, py] = places[f];
      const frame = s.frames[f];
      for (let row = 0; row < s.h; row++) {
        const srcOff = row * s.w * 4;
        const dstOff = ((py + row) * width + px) * 4;
        png.data.set(frame.subarray(srcOff, srcOff + s.w * 4), dstOff);
      }
    }
    const tile: AtlasTile = { name: s.name, x: places[0][0], y: places[0][1], w: s.w, h: s.h };
    if (s.frames.length > 1 || s.seq) {
      tile.frames = places;
      tile.seq = s.seq;
      if (s.interpolate) tile.interpolate = true;
    }
    tiles.push(tile);
  }
  return { json: { width, height, tiles }, png: PNG.sync.write(png) };
}

export function buildAtlases(): { name: string; tiles: number; width: number; height: number }[] {
  const out: { name: string; tiles: number; width: number; height: number }[] = [];
  const outDir = path.join(PUBLIC, 'atlas');
  ensureDir(outDir);
  for (const cat of ['block', 'item']) {
    const dir = path.join(ASSETS, 'textures', cat);
    if (!fs.existsSync(dir)) throw new Error(`${dir} missing – run \`npm run assets\` first`);
    const sources: Source[] = [missingTexture()];
    for (const f of listFiles(dir, '.png')) {
      const s = readSource(dir, cat, f);
      if (s) sources.push(s);
    }
    const { json, png } = buildAtlas(cat, sources);
    fs.writeFileSync(path.join(outDir, `${cat}s.png`), png);
    writeJson(path.join(outDir, `${cat}s.json`), json);
    out.push({ name: `${cat}s`, tiles: json.tiles.length, width: json.width, height: json.height });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  for (const r of buildAtlases()) console.log(`${r.name}: ${r.tiles} tiles, ${r.width}x${r.height}`);
}
