/**
 * Converts a Bedrock entity geometry file (Mojang/bedrock-samples, the same box layouts and texture
 * nets the Java models use) into the PartDef list used by `src/entities/boxModel.ts`.
 *
 *   npx tsx tools/geo-to-model.ts .cache/geo/horse_v2.geo.json [geometry.name]
 *
 * Bedrock model space is y up with the feet at y 0; ours is Minecraft's y down with the feet at 24,
 * and box corners are relative to their part's pivot, so cubes are rebased here. Rotations are
 * degrees about the pivot; the y flip negates the x and z angles.
 */
import fs from 'node:fs';

interface Cube { origin: number[]; size: number[]; uv?: number[]; inflate?: number; mirror?: boolean }
interface Bone { name?: string; parent?: string; pivot?: number[]; rotation?: number[]; cubes?: Cube[] }

const file = process.argv[2];
if (!file) throw new Error('usage: geo-to-model <file.geo.json> [geometry name]');
const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
const wanted = process.argv[3];

// format 1.8.0 keys geometries by name; 1.12+ uses a "minecraft:geometry" array
const geos: { name: string; texW: number; texH: number; bones: Bone[] }[] = [];
if (Array.isArray(json['minecraft:geometry'])) {
  for (const g of json['minecraft:geometry'] as { description: Record<string, number | string>; bones: Bone[] }[]) {
    geos.push({ name: String(g.description.identifier), texW: Number(g.description.texture_width ?? 64), texH: Number(g.description.texture_height ?? 64), bones: g.bones });
  }
} else {
  for (const [k, v] of Object.entries(json)) {
    if (k === 'format_version' || typeof v !== 'object' || v === null) continue;
    const g = v as { texturewidth?: number; textureheight?: number; bones?: Bone[] };
    if (g.bones) geos.push({ name: k, texW: g.texturewidth ?? 64, texH: g.textureheight ?? 64, bones: g.bones });
  }
}

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));
const snake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

for (const g of geos) {
  if (wanted && g.name !== wanted) continue;
  console.log(`// ${g.name}: texW ${g.texW}, texH ${g.texH}`);
  console.log('parts: [');
  // parents must be built first: our loader attaches a child to whatever exists already
  const emitted = new Set<string>();
  const ordered: Bone[] = [];
  const pending = g.bones.slice();
  while (pending.length) {
    const next = pending.findIndex((b) => !b.parent || emitted.has(b.parent));
    const b = pending.splice(next === -1 ? 0 : next, 1)[0];
    emitted.add(b.name ?? '');
    ordered.push(b);
  }
  for (const b of ordered) {
    const pivot = b.pivot ?? [0, 0, 0];
    const [px, py, pz] = pivot;
    const boxes = (b.cubes ?? []).map((c) => {
      const [ox, oy, oz] = c.origin;
      const [w, h, d] = c.size;
      const box = [ox - px, py - oy - h, oz - pz, w, h, d].map(num).join(', ');
      const extra = `${c.inflate ? `, inflate: ${num(c.inflate)}` : ''}${c.mirror ? ', mirror: true' : ''}`;
      return `{ uv: [${(c.uv ?? [0, 0]).map(num).join(', ')}], box: [${box}]${extra} }`;
    });
    const rot = b.rotation && b.rotation.some((r) => r !== 0)
      ? `, rotation: [${[-b.rotation[0], -b.rotation[1], -b.rotation[2]].map((r) => num((r * Math.PI) / 180)).join(', ')}]`
      : '';
    const parent = b.parent ? `, parent: '${snake(b.parent)}'` : '';
    console.log(`  { name: '${snake(b.name ?? 'part')}'${parent}, pivot: [${num(px)}, ${num(24 - py)}, ${num(pz)}]${rot}, boxes: [${boxes.join(', ')}] },`);
  }
  console.log('],');
}
