// Draws the Bean Baron home-screen icons without any image library: a cream
// bean on an espresso tile, rasterised pixel by pixel and written as PNG.
//   node tools/beanbaron_icons.js            -> icons/bean-180.png, bean-192.png, bean-512.png
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const crc = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x + 0.5, y + 0.5); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function icon(size) {
  const s = size, r = s * 0.22, tile = [43, 23, 13], tileLight = [74, 44, 26], cream = [246, 231, 207], ember = [217, 100, 42];
  // supersample 2x2 for smooth edges
  return (px, py) => {
    let acc = [0, 0, 0, 0];
    for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const x = px + dx, y = py + dy;
      // rounded tile
      const qx = Math.max(Math.abs(x - s / 2) - (s / 2 - r), 0), qy = Math.max(Math.abs(y - s / 2) - (s / 2 - r), 0);
      const inTile = Math.hypot(qx, qy) <= r;
      let c = [0, 0, 0, 0];
      if (inTile) {
        c = [...mix(tileLight, tile, y / s), 255];
        // bean: ellipse rotated 35 degrees, with a curved crease
        const cx = s / 2, cy = s / 2, ang = -35 * Math.PI / 180;
        const ux = (x - cx) * Math.cos(ang) - (y - cy) * Math.sin(ang), uy = (x - cx) * Math.sin(ang) + (y - cy) * Math.cos(ang);
        const a = s * 0.33, b = s * 0.23;
        const e = (ux * ux) / (a * a) + (uy * uy) / (b * b);
        if (e <= 1) {
          const crease = Math.abs(uy - Math.sin(ux / a * Math.PI) * b * 0.28) < s * 0.028 && Math.abs(ux) < a * 0.92;
          const edge = e > 0.86;
          c = crease ? [...ember, 255] : edge ? [...mix(cream, ember, 0.35), 255] : [...cream, 255];
        }
      }
      acc = acc.map((v, i) => v + c[i] / 4);
    }
    return acc.map(Math.round);
  };
}
const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [180, 192, 512]) { fs.writeFileSync(path.join(out, `bean-${size}.png`), png(size, icon(size))); console.log('icons/bean-' + size + '.png'); }
