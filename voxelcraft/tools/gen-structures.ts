/**
 * Converts Mojang's structure templates (`data/minecraft/structure/**.nbt` from the fetched client)
 * into the compact JSON the world generator stamps into chunks, and pulls each structure's spacing
 * out of its `worldgen/structure_set` file so placement matches vanilla.
 *
 *   npm run structures
 *
 * Output goes to `public/structures/` (gitignored, like every other Mojang-derived file): one file
 * per template plus an `index.json` describing which structures exist and how they are spread.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readNbt, type NbtTag, type NbtValue } from './nbt.ts';

const CACHE = '.cache';
const PUBLIC = 'public';

/**
 * Structures we place: which templates to convert, which structure set spreads them, and which
 * vanilla structure JSON names the biomes they belong in.
 */
const WANTED: { name: string; set: string; pieces: string[]; placement: 'surface' | 'ocean_floor'; structures: string[] }[] = [
  { name: 'igloo', set: 'igloos', pieces: ['igloo/top'], placement: 'surface', structures: ['igloo'] },
  { name: 'shipwreck', set: 'shipwrecks', pieces: [], placement: 'ocean_floor', structures: ['shipwreck', 'shipwreck_beached'] },
  { name: 'ruined_portal', set: 'ruined_portals', pieces: [], placement: 'surface', structures: ['ruined_portal', 'ruined_portal_desert', 'ruined_portal_jungle', 'ruined_portal_mountain', 'ruined_portal_swamp'] },
  { name: 'pillager_outpost', set: 'pillager_outposts', pieces: ['pillager_outpost/watchtower'], placement: 'surface', structures: ['pillager_outpost'] },
];

/** Reads a structure's biome list, following the `#minecraft:has_structure/...` tag it points at. */
function biomesFor(mcDir: string, names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const file = path.join(mcDir, 'data', 'minecraft', 'worldgen', 'structure', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const def = JSON.parse(fs.readFileSync(file, 'utf8')) as { biomes: string | string[] };
    const refs = Array.isArray(def.biomes) ? def.biomes : [def.biomes];
    for (const ref of refs) {
      if (!ref.startsWith('#')) {
        out.add(ref.replace('minecraft:', ''));
        continue;
      }
      // tags can point at other tags (`#minecraft:is_ocean`), so follow them
      const pending = [ref];
      const seen = new Set<string>();
      while (pending.length) {
        const cur = pending.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        const tag = path.join(mcDir, 'data', 'minecraft', 'tags', 'worldgen', 'biome', `${cur.slice(1).replace('minecraft:', '')}.json`);
        if (!fs.existsSync(tag)) continue;
        for (const v of (JSON.parse(fs.readFileSync(tag, 'utf8')) as { values: string[] }).values) {
          const name = String(v);
          if (name.startsWith('#')) pending.push(name);
          else out.add(name.replace('minecraft:', ''));
        }
      }
    }
  }
  return [...out].sort();
}

const versionDir = (): string => {
  const root = path.join(CACHE, 'mc');
  const versions = fs.existsSync(root) ? fs.readdirSync(root) : [];
  if (!versions.length) throw new Error('no fetched client data: run `npm run assets` first');
  return path.join(root, versions.sort().reverse()[0]);
};

const num = (v: NbtValue): number => Number(v as number);

interface Template { size: [number, number, number]; palette: string[]; blocks: number[] }

/** Turns a template's palette entry into our `id[prop=value,...]` state string. */
function stateString(entry: NbtTag): string {
  const name = String(entry.Name).replace('minecraft:', '');
  const props = entry.Properties as NbtTag | undefined;
  if (!props) return name;
  const parts = Object.entries(props).map(([k, v]) => `${k}=${String(v)}`).sort();
  return parts.length ? `${name}[${parts.join(',')}]` : name;
}

function convert(file: string): Template | null {
  const root = readNbt(fs.readFileSync(file));
  const size = (root.size as NbtValue[]).map(num) as [number, number, number];
  // some templates carry several palettes (block variants); vanilla picks one, we take the first
  const paletteTag = (root.palette ?? (root.palettes as NbtValue[] | undefined)?.[0]) as NbtTag[] | undefined;
  if (!paletteTag) return null;
  const palette = paletteTag.map(stateString);
  const blocks: number[] = [];
  for (const b of root.blocks as NbtTag[]) {
    const pos = (b.pos as NbtValue[]).map(num);
    const state = num(b.state);
    const id = palette[state];
    // structure voids and jigsaw markers are scaffolding, not blocks
    if (id.startsWith('structure_void') || id.startsWith('jigsaw') || id.startsWith('structure_block')) continue;
    blocks.push(pos[0], pos[1], pos[2], state);
  }
  return blocks.length ? { size, palette, blocks } : null;
}

const mc = versionDir();
const structureDir = path.join(mc, 'data', 'minecraft', 'structure');
const setDir = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure_set');
const outDir = path.join(PUBLIC, 'structures');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

interface IndexEntry { name: string; placement: string; spacing: number; separation: number; salt: number; pieces: string[]; biomes: string[] }
const index: IndexEntry[] = [];
let files = 0;
let bytes = 0;

for (const want of WANTED) {
  const setFile = path.join(setDir, `${want.set}.json`);
  if (!fs.existsSync(setFile)) {
    console.log(`skipping ${want.name}: no structure set ${want.set}.json`);
    continue;
  }
  const set = JSON.parse(fs.readFileSync(setFile, 'utf8')) as { placement: { spacing: number; separation: number; salt: number } };
  // an empty piece list means "every template in the structure's folder"
  const dir = path.join(structureDir, want.name);
  const pieces = want.pieces.length
    ? want.pieces
    : fs.readdirSync(dir).filter((f) => f.endsWith('.nbt')).map((f) => `${want.name}/${path.basename(f, '.nbt')}`);
  const written: string[] = [];
  for (const piece of pieces) {
    const file = path.join(structureDir, `${piece}.nbt`);
    if (!fs.existsSync(file)) continue;
    const template = convert(file);
    if (!template) continue;
    const out = path.join(outDir, `${piece.replace('/', '_')}.json`);
    const json = JSON.stringify(template);
    fs.writeFileSync(out, json);
    bytes += json.length;
    files++;
    written.push(piece.replace('/', '_'));
  }
  index.push({
    name: want.name, placement: want.placement,
    spacing: set.placement.spacing, separation: set.placement.separation, salt: set.placement.salt,
    pieces: written, biomes: biomesFor(mc, want.structures),
  });
}

fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`public/structures: ${files} templates, ${(bytes / 1024).toFixed(0)} KB`);
for (const e of index) console.log(`  ${e.name}: ${e.pieces.length} pieces, spacing ${e.spacing}/${e.separation}, ${e.biomes.length} biomes`);
