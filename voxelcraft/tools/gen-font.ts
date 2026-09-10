/**
 * Builds a font file out of Mojang's own `ascii.png`, so every word the game draws is in the shape
 * Minecraft draws it in rather than in whatever the system happens to have.
 *
 *   npm run font
 *
 * The atlas is a sixteen by sixteen grid of eight by eight glyphs; the provider that names them
 * gives the baseline as seven pixels down. A glyph is as wide as its last inked column plus one,
 * which is exactly how vanilla measures a string. Output goes to `public/font/` — gitignored, like
 * everything else derived from Mojang's files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import opentype from 'opentype.js';
import { ASSETS, PUBLIC } from './lib/paths.ts';
import { ensureDir } from './lib/fs.ts';

/** The characters `ascii.png` carries, row by row, as Mojang's own font provider lists them. */
const ROWS = [
  '                ',
  '                ',
  ' !"#$%&\'()*+,-./',
  '0123456789:;<=>?',
  '@ABCDEFGHIJKLMNO',
  'PQRSTUVWXYZ[\\]^_',
  '`abcdefghijklmno',
  'pqrstuvwxyz{|}~ ',
];

const CELL = 8;
/** Font units per pixel: a round number keeps every edge exactly on a unit boundary. */
const UNIT = 128;
/** Mojang's provider puts the baseline seven pixels below the top of the cell. */
const ASCENT = 7;

const png = PNG.sync.read(fs.readFileSync(path.join(ASSETS, 'textures', 'font', 'ascii.png')));
const inked = (x: number, y: number): boolean => png.data[(y * png.width + x) * 4 + 3] > 16;

/** One glyph: the inked pixels of its cell, run by run, and the advance vanilla would measure. */
function glyphFor(char: string, col: number, row: number): opentype.Glyph {
  const x0 = col * CELL;
  const y0 = row * CELL;
  const outline = new opentype.Path();
  let widest = 0;
  for (let y = 0; y < CELL; y++) {
    let run = -1;
    for (let x = 0; x <= CELL; x++) {
      const on = x < CELL && inked(x0 + x, y0 + y);
      if (on && run < 0) run = x;
      if (on) widest = Math.max(widest, x + 1);
      if (!on && run >= 0) {
        // y counts down the cell; the baseline is ASCENT pixels down, and font units count up
        const top = (ASCENT - y) * UNIT;
        const bottom = top - UNIT;
        outline.moveTo(run * UNIT, bottom);
        outline.lineTo(x * UNIT, bottom);
        outline.lineTo(x * UNIT, top);
        outline.lineTo(run * UNIT, top);
        outline.close();
        run = -1;
      }
    }
  }
  // vanilla measures a character as its last inked column plus one, and leaves a pixel between
  const advance = (char === ' ' ? 4 : widest + 1) * UNIT;
  const code = char.codePointAt(0)!;
  return new opentype.Glyph({ name: `uni${code.toString(16).padStart(4, '0')}`, unicode: code, advanceWidth: advance, path: outline });
}

const glyphs: opentype.Glyph[] = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 4 * UNIT, path: new opentype.Path() })];
for (let row = 0; row < ROWS.length; row++) {
  for (let col = 0; col < 16; col++) {
    const char = ROWS[row][col];
    if (!char || char === ' ') continue;
    glyphs.push(glyphFor(char, col, row));
  }
}
// the space vanilla's own provider gives, four pixels wide with nothing in it
glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 4 * UNIT, path: new opentype.Path() }));

const font = new opentype.Font({
  familyName: 'Minecraft',
  styleName: 'Regular',
  unitsPerEm: CELL * UNIT,
  ascender: ASCENT * UNIT,
  descender: -(CELL - ASCENT) * UNIT,
  glyphs,
});

const out = path.join(PUBLIC, 'font');
ensureDir(out);
const buffer = Buffer.from(font.toArrayBuffer());
fs.writeFileSync(path.join(out, 'minecraft.ttf'), buffer);
console.log(`[font] public/font/minecraft.ttf: ${glyphs.length - 1} glyphs, ${(buffer.length / 1024).toFixed(1)} kB`);
