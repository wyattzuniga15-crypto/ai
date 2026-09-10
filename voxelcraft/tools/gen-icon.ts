/**
 * Draws the game's icon: a grass block, the way Minecraft's own icon is a grass block.
 *
 *   npm run icon
 *
 * Three faces of a cube in the two-to-one isometric the game's inventory icons use, mapped straight
 * off Mojang's own block textures with the grass top tinted the colour a plains biome tints it, and
 * each face shaded the way vanilla shades that side. Output is `public/icon.png` — gitignored, like
 * everything else drawn from Mojang's files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ASSETS, PUBLIC } from './lib/paths.ts';
import { ensureDir } from './lib/fs.ts';

const SIZE = 512;
/** Vanilla's plains grass colour, which is what the top of a grass block is tinted with. */
const GRASS = [0x91, 0xbd, 0x59];
/** Vanilla's face shading: full for the top, and the two sides darker. */
const SHADE = { top: 1, right: 0.8, left: 0.62 };

function read(name: string): PNG {
  return PNG.sync.read(fs.readFileSync(path.join(ASSETS, 'textures', 'block', name)));
}

const top = read('grass_block_top.png');
const side = read('grass_block_side.png');
const T = top.width;
const s = SIZE / (2 * T);
const cx = SIZE / 2;

/** A face of the cube: where it starts on screen and the two directions it runs in. */
interface Face { p0: [number, number]; u: [number, number]; v: [number, number]; tex: PNG; shade: number }

const ex: [number, number] = [s * T, (s * T) / 2];
const ey: [number, number] = [-s * T, (s * T) / 2];
const ez: [number, number] = [0, s * T];
const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];
const A: [number, number] = [cx, 0];

const faces: Face[] = [
  { p0: A, u: ex, v: ey, tex: top, shade: SHADE.top },
  { p0: add(A, ex), u: ey, v: ez, tex: side, shade: SHADE.right },
  { p0: add(A, ey), u: ex, v: ez, tex: side, shade: SHADE.left },
];

const out = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    out.data[i + 3] = 0;
    // the middle of the pixel, so a face's edge lands where the eye expects it
    const px = x + 0.5;
    const py = y + 0.5;
    for (const face of faces) {
      const det = face.u[0] * face.v[1] - face.u[1] * face.v[0];
      if (!det) continue;
      const dx = px - face.p0[0];
      const dy = py - face.p0[1];
      const a = (dx * face.v[1] - dy * face.v[0]) / det;
      const b = (face.u[0] * dy - face.u[1] * dx) / det;
      if (a < 0 || a >= 1 || b < 0 || b >= 1) continue;
      const tx = Math.min(face.tex.width - 1, Math.floor(a * face.tex.width));
      const ty = Math.min(face.tex.height - 1, Math.floor(b * face.tex.height));
      const t = (ty * face.tex.width + tx) * 4;
      const tint = face.tex === top ? GRASS : [255, 255, 255];
      for (let c = 0; c < 3; c++) {
        out.data[i + c] = Math.round((face.tex.data[t + c] / 255) * (tint[c] / 255) * face.shade * 255);
      }
      out.data[i + 3] = face.tex.data[t + 3];
      break;
    }
  }
}

ensureDir(PUBLIC);
fs.writeFileSync(path.join(PUBLIC, 'icon.png'), PNG.sync.write(out));
console.log(`[icon] public/icon.png: ${SIZE}x${SIZE} grass block`);
