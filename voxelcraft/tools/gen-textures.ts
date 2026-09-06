/**
 * Generates original 16×16 placeholder textures for every texture the game references but does
 * not have on disk (or for everything with --force), so a checkout without the fetched Mojang
 * assets still renders recognisable blocks instead of the magenta checker. Output is fully
 * deterministic per texture name.
 *
 *   tsx tools/gen-textures.ts [--out assets/textures] [--force] [--sheet preview.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ASSETS, DATA, PUBLIC } from './lib/paths.ts';
import { ensureDir, readJson } from './lib/fs.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(opt('--out') ?? path.join(ASSETS, 'textures'));
const FORCE = args.includes('--force');
const SHEET = opt('--sheet');
const SIZE = 16;

// ------------------------------------------------------------------------------------------------
// Deterministic helpers
// ------------------------------------------------------------------------------------------------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
type RGB = [number, number, number];
function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const shade = (c: RGB, f: number): RGB => [Math.max(0, Math.min(255, Math.round(c[0] * f))), Math.max(0, Math.min(255, Math.round(c[1] * f))), Math.max(0, Math.min(255, Math.round(c[2] * f)))];

// ------------------------------------------------------------------------------------------------
// Which textures are needed
// ------------------------------------------------------------------------------------------------
function neededTextures(): string[] {
  const names = new Set<string>();
  const models = path.join(PUBLIC, 'models.json');
  if (fs.existsSync(models)) {
    const walk = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'textures' && v && typeof v === 'object') {
          for (const t of Object.values(v as Record<string, unknown>)) if (typeof t === 'string' && !t.startsWith('#')) names.add(t);
        } else walk(v);
      }
    };
    walk(readJson(models));
  } else {
    for (const b of readJson<{ id: string }[]>(path.join(DATA, 'blocks.json'))) names.add(`block/${b.id}`);
    for (const i of readJson<{ id: string; block?: boolean }[]>(path.join(DATA, 'items.json'))) if (!i.block) names.add(`item/${i.id}`);
  }
  // missingno is the runtime checker; trim overlays are tinted at runtime from palettes
  return [...names].filter((n) => n !== 'missingno' && !n.startsWith('trims/')).sort();
}

// ------------------------------------------------------------------------------------------------
// Pattern families
// ------------------------------------------------------------------------------------------------
type Family = 'noise' | 'planks' | 'log' | 'bricks' | 'ore' | 'leaves' | 'plant' | 'liquid' | 'glass' | 'item' | 'tool';
const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));
function family(name: string): Family {
  const id = name.replace(/^(block|item|entity|environment|gui|misc|mob_effect|painting|particle|font|colormap|map|models|trims)\//, '');
  if (name.startsWith('item/')) return has(id, 'sword', 'pickaxe', '_axe', 'shovel', 'hoe', 'stick', 'rod', 'brush', 'trident', 'mace') ? 'tool' : 'item';
  if (has(id, 'leaves')) return 'leaves';
  if (has(id, 'planks')) return 'planks';
  if (has(id, '_log', 'stem', '_wood', 'hyphae', 'bamboo_block')) return 'log';
  if (id.endsWith('_ore') || has(id, 'raw_') && has(id, 'block')) return 'ore';
  if (has(id, 'water', 'lava')) return 'liquid';
  if (has(id, 'glass', 'ice')) return 'glass';
  if (has(id, 'bricks', 'tiles')) return 'bricks';
  if (has(id, 'sapling', 'flower', 'grass', 'fern', 'mushroom', 'fungus', 'roots', 'vine', 'bush', 'tulip', 'orchid', 'dandelion', 'poppy', 'wheat', 'carrots', 'potatoes', 'beetroot', 'sprout', 'seagrass', 'kelp', 'lily', 'petals', 'crop', 'berr')) return 'plant';
  return 'noise';
}

function paint(name: string): Uint8Array {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const seed = hash(name);
  const r = rng(seed);
  const fam = family(name);
  const hue = (seed % 360);
  const set = (x: number, y: number, c: RGB, a = 255) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  };
  const fill = (base: RGB, variance: number, alpha = 255) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, shade(base, 1 - variance + r() * variance * 2), alpha);
  };
  switch (fam) {
    case 'noise': fill(hsl(hue, 0.25, 0.45), 0.12); break;
    case 'planks': {
      const base = hsl(30 + (seed % 25), 0.45, 0.45 + (seed % 3) * 0.08);
      fill(base, 0.06);
      for (let y = 3; y < SIZE; y += 4) for (let x = 0; x < SIZE; x++) set(x, y, shade(base, 0.6));
      for (let b = 0; b < 4; b++) set((b * 7 + (seed >> 4)) % SIZE, b * 4 + 1, shade(base, 0.6));
      break;
    }
    case 'log': {
      const base = hsl(25 + (seed % 20), 0.4, 0.3 + (seed % 4) * 0.06);
      fill(base, 0.1);
      for (let x = 0; x < SIZE; x++) if ((x + (seed % 3)) % 4 === 0) for (let y = 0; y < SIZE; y++) set(x, y, shade(base, 0.65 + r() * 0.1));
      break;
    }
    case 'bricks': {
      const base = hsl(hue, 0.3, 0.45);
      fill(shade(base, 0.7), 0.04);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let col = -1; col < 3; col++) for (let y = row * 4; y < row * 4 + 3; y++) for (let x = col * 8 + off; x < col * 8 + off + 7; x++) set(x, y, shade(base, 0.92 + r() * 0.16));
      }
      break;
    }
    case 'ore': {
      const stone: RGB = name.includes('deepslate') ? [78, 78, 82] : name.includes('nether') ? [110, 50, 50] : [125, 125, 125];
      fill(stone, 0.1);
      const gem = hsl(hue, 0.7, 0.55);
      for (let i = 0; i < 7; i++) {
        const x = Math.floor(r() * 14), y = Math.floor(r() * 14);
        set(x, y, gem); set(x + 1, y, shade(gem, 0.8)); set(x, y + 1, shade(gem, 0.8)); set(x + 1, y + 1, shade(gem, 1.15));
      }
      break;
    }
    case 'leaves': {
      const base = hsl(95 + (seed % 40), 0.5, 0.3);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, shade(base, 0.7 + r() * 0.6), r() < 0.18 ? 0 : 255);
      break;
    }
    case 'plant': {
      const green = hsl(100 + (seed % 30), 0.55, 0.35);
      const cx = 7 + Math.floor(r() * 2);
      const top = 2 + Math.floor(r() * 5);
      for (let y = top; y < SIZE; y++) set(cx, y, shade(green, 0.8 + r() * 0.4));
      for (let i = 0; i < 6; i++) {
        const y = top + 2 + Math.floor(r() * (SIZE - top - 3));
        const dir = r() < 0.5 ? -1 : 1;
        const len = 1 + Math.floor(r() * 3);
        for (let k = 1; k <= len; k++) set(cx + dir * k, y - Math.floor(k / 2), shade(green, 0.9 + r() * 0.3));
      }
      if (has(name, 'flower', 'tulip', 'orchid', 'dandelion', 'poppy', 'rose', 'lilac', 'peony', 'daisy', 'bluet', 'allium', 'cornflower', 'lily_of', 'torchflower', 'petals')) {
        const head = hsl(hue, 0.8, 0.6);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) < 2) set(cx + dx, top + dy, head);
      }
      break;
    }
    case 'liquid': {
      const base: RGB = name.includes('lava') ? [215, 90, 20] : [45, 90, 205];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, shade(base, 0.85 + 0.2 * Math.sin((x + y * 2 + (seed % 7)) * 0.7)), name.includes('lava') ? 255 : 200);
      break;
    }
    case 'glass': {
      const tint = hsl(hue, 0.5, 0.75);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
        set(x, y, edge ? shade(tint, 1.15) : tint, edge ? 255 : has(name, 'stained', 'tinted') ? 140 : 40);
      }
      for (let k = 2; k < 7; k++) set(k, 8 - k, [255, 255, 255], 200);
      break;
    }
    case 'tool': {
      const wood: RGB = [120, 80, 40];
      const head = hsl(hue, 0.5, 0.55);
      for (let k = 0; k < 8; k++) set(3 + k, 12 - k, wood);
      for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 2; dx++) set(11 + dx, 4 + dy, shade(head, 0.85 + r() * 0.3));
      set(9, 5, shade(head, 0.7)); set(10, 4, shade(head, 0.7));
      break;
    }
    case 'item': {
      const base = hsl(hue, 0.55, 0.5);
      const rx = 4 + (seed % 3), ry = 4 + ((seed >> 3) % 3);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const d = ((x - 7.5) / rx) ** 2 + ((y - 7.5) / ry) ** 2;
        if (d <= 1) set(x, y, shade(base, d > 0.7 ? 0.6 : 0.9 + r() * 0.25));
      }
      set(6, 5, shade(base, 1.4)); set(7, 5, shade(base, 1.4)); set(6, 6, shade(base, 1.3));
      break;
    }
  }
  return px;
}

// ------------------------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------------------------
const needed = neededTextures();
const generated: { name: string; px: Uint8Array }[] = [];
let skipped = 0;
for (const name of needed) {
  const file = path.join(OUT, `${name}.png`);
  if (!FORCE && fs.existsSync(file)) {
    skipped++;
    continue;
  }
  const px = paint(name);
  const png = new PNG({ width: SIZE, height: SIZE });
  png.data = Buffer.from(px);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, PNG.sync.write(png));
  generated.push({ name, px });
}
if (SHEET && generated.length) {
  const scale = 3;
  const cols = 32;
  const rows = Math.ceil(generated.length / cols);
  const sheet = new PNG({ width: cols * (SIZE * scale + 1), height: rows * (SIZE * scale + 1) });
  sheet.data.fill(0);
  generated.forEach(({ px }, i) => {
    const ox = (i % cols) * (SIZE * scale + 1), oy = Math.floor(i / cols) * (SIZE * scale + 1);
    for (let y = 0; y < SIZE * scale; y++) for (let x = 0; x < SIZE * scale; x++) {
      const s = ((Math.floor(y / scale) * SIZE) + Math.floor(x / scale)) * 4;
      const d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = px[s]; sheet.data[d + 1] = px[s + 1]; sheet.data[d + 2] = px[s + 2]; sheet.data[d + 3] = px[s + 3];
    }
  });
  ensureDir(path.dirname(path.resolve(SHEET)));
  fs.writeFileSync(SHEET, PNG.sync.write(sheet));
}
console.log(`${needed.length} textures needed, ${generated.length} generated into ${path.relative(process.cwd(), OUT) || '.'}, ${skipped} already present`);
