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
const WANTED: { name: string; set: string; pieces: string[]; placement: 'surface' | 'ocean_floor'; structures: string[]; main?: string[] }[] = [
  // the igloo's basement pieces are stamped by the generator under the top, never on their own
  { name: 'igloo', set: 'igloos', pieces: ['igloo/top', 'igloo/middle', 'igloo/bottom'], main: ['igloo_top'], placement: 'surface', structures: ['igloo'] },
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

interface Jigsaw { pos: [number, number, number]; orientation: string; name: string; target: string; pool: string; final: string }
interface LootSpot { pos: [number, number, number]; table: string }
interface Template { size: [number, number, number]; palette: string[]; blocks: number[]; jigsaws?: Jigsaw[]; loot?: LootSpot[] }

/**
 * Vanilla marks some chests with a `structure_block` in DATA mode sitting one block above the chest
 * instead of a `LootTable` tag; each structure's piece code reads the marker's metadata and fills the
 * chest below it (`ShipwreckPieces.handleDataMarker`, `IglooPieces.handleDataMarker`).
 */
const DATA_TABLES: Record<string, string> = {
  supply_chest: 'chests/shipwreck_supply',
  map_chest: 'chests/shipwreck_map',
  treasure_chest: 'chests/shipwreck_treasure',
};

/** Loot table a DATA marker stands for; plain `chest` means different things per structure. */
function markerTable(structure: string, meta: string): string | null {
  if (meta === 'chest') return structure === 'igloo' ? 'chests/igloo_chest' : null;
  return DATA_TABLES[meta] ?? null;
}

/** Turns a template's palette entry into our `id[prop=value,...]` state string. */
function stateString(entry: NbtTag): string {
  const name = String(entry.Name).replace('minecraft:', '');
  const props = entry.Properties as NbtTag | undefined;
  if (!props) return name;
  const parts = Object.entries(props).map(([k, v]) => `${k}=${String(v)}`).sort();
  return parts.length ? `${name}[${parts.join(',')}]` : name;
}

function convert(file: string, structure: string): Template | null {
  const root = readNbt(fs.readFileSync(file));
  const size = (root.size as NbtValue[]).map(num) as [number, number, number];
  const jigsaws: Jigsaw[] = [];
  const loot: LootSpot[] = [];
  // some templates carry several palettes (block variants); vanilla picks one, we take the first
  const paletteTag = (root.palette ?? (root.palettes as NbtValue[] | undefined)?.[0]) as NbtTag[] | undefined;
  if (!paletteTag) return null;
  const palette = paletteTag.map(stateString);
  const blocks: number[] = [];
  for (const b of root.blocks as NbtTag[]) {
    const pos = (b.pos as NbtValue[]).map(num);
    const state = num(b.state);
    const id = palette[state];
    // jigsaw blocks are connection points, kept as data rather than placed
    if (id.startsWith('jigsaw')) {
      const nbt = b.nbt as NbtTag | undefined;
      if (nbt) {
        jigsaws.push({
          pos: pos as [number, number, number],
          orientation: /orientation=([a-z_]+)/.exec(id)?.[1] ?? 'north_up',
          name: String(nbt.name ?? '').replace('minecraft:', ''),
          target: String(nbt.target ?? '').replace('minecraft:', ''),
          pool: String(nbt.pool ?? '').replace('minecraft:', ''),
          final: String(nbt.final_state ?? 'air').replace('minecraft:', ''),
        });
      }
      continue;
    }
    // structure voids leave whatever is already there
    if (id.startsWith('structure_void')) continue;
    // data markers are instructions, not blocks: the chest they fill sits one block below
    if (id.startsWith('structure_block')) {
      const meta = String((b.nbt as NbtTag | undefined)?.metadata ?? '');
      const marked = meta ? markerTable(structure, meta) : null;
      if (marked) loot.push({ pos: [pos[0], pos[1] - 1, pos[2]], table: marked });
      continue;
    }
    // chests and barrels carry the loot table they should be filled from
    const table = (b.nbt as NbtTag | undefined)?.LootTable;
    if (table) loot.push({ pos: pos as [number, number, number], table: String(table).replace('minecraft:', '') });
    blocks.push(pos[0], pos[1], pos[2], state);
  }
  return blocks.length || jigsaws.length
    ? { size, palette, blocks, ...(jigsaws.length ? { jigsaws } : {}), ...(loot.length ? { loot } : {}) }
    : null;
}

/** Structures assembled from template pools (villages); every reachable piece is converted. */
const JIGSAW: { name: string; set: string; structures: string[] }[] = [
  { name: 'village', set: 'villages', structures: ['village_plains', 'village_desert', 'village_savanna', 'village_snowy', 'village_taiga'] },
];

const mc = versionDir();
const structureDir = path.join(mc, 'data', 'minecraft', 'structure');
const setDir = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure_set');
const outDir = path.join(PUBLIC, 'structures');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

interface IndexEntry { name: string; placement: string; spacing: number; separation: number; salt: number; pieces: string[]; biomes: string[]; main?: string[]; starts?: string[]; maxDepth?: number }
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
  const bundle: Record<string, Template> = {};
  for (const piece of pieces) {
    const file = path.join(structureDir, `${piece}.nbt`);
    if (!fs.existsSync(file)) continue;
    const template = convert(file, want.name);
    if (!template) continue;
    bundle[piece.replace('/', '_')] = template;
    files++;
    written.push(piece.replace('/', '_'));
  }
  const bundleJson = JSON.stringify({ pieces: bundle });
  fs.writeFileSync(path.join(outDir, `${want.name}.json`), bundleJson);
  bytes += bundleJson.length;
  index.push({
    name: want.name, placement: want.placement,
    spacing: set.placement.spacing, separation: set.placement.separation, salt: set.placement.salt,
    pieces: written, biomes: biomesFor(mc, want.structures),
    ...(want.main ? { main: want.main.filter((m) => written.includes(m)) } : {}),
  });
}

// jigsaw structures: walk the template pools from each start pool and convert what they reach
const pools: Record<string, { location: string; weight: number; projection: string }[]> = {};
for (const want of JIGSAW) {
  const setFile = path.join(setDir, `${want.set}.json`);
  if (!fs.existsSync(setFile)) continue;
  const set = JSON.parse(fs.readFileSync(setFile, 'utf8')) as { placement: { spacing: number; separation: number; salt: number } };
  const starts: string[] = [];
  const biomes = new Set<string>();
  const queue: string[] = [];
  for (const name of want.structures) {
    const file = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const def = JSON.parse(fs.readFileSync(file, 'utf8')) as { start_pool: string; size: number };
    const start = def.start_pool.replace('minecraft:', '');
    starts.push(start);
    queue.push(start);
    for (const b of biomesFor(mc, [name])) biomes.add(b);
  }
  const pieces: string[] = [];
  const bundle: Record<string, Template> = {};
  const seenPools = new Set<string>();
  while (queue.length) {
    const poolName = queue.pop()!;
    if (seenPools.has(poolName)) continue;
    seenPools.add(poolName);
    const poolFile = path.join(mc, 'data', 'minecraft', 'worldgen', 'template_pool', `${poolName}.json`);
    if (!fs.existsSync(poolFile)) continue;
    const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8')) as { elements: { element: { location?: string; projection?: string; element_type: string }; weight: number }[] };
    const entries: { location: string; weight: number; projection: string }[] = [];
    for (const e of pool.elements) {
      const loc = e.element.location?.replace('minecraft:', '');
      if (!loc) continue; // empty pool elements and feature pools are skipped
      entries.push({ location: loc, weight: e.weight ?? 1, projection: e.element.projection ?? 'rigid' });
      const file = path.join(structureDir, `${loc}.nbt`);
      if (!fs.existsSync(file)) continue;
      const key = loc.replace(/\//g, '_');
      if (!pieces.includes(key)) {
        const template = convert(file, want.name);
        if (template) {
          bundle[key] = template;
          files++;
          pieces.push(key);
          for (const j of template.jigsaws ?? []) if (j.pool && !seenPools.has(j.pool)) queue.push(j.pool);
        }
      }
    }
    pools[poolName] = entries;
  }
  const bundleJson = JSON.stringify({ pieces: bundle, pools });
  fs.writeFileSync(path.join(outDir, `${want.name}.json`), bundleJson);
  bytes += bundleJson.length;
  index.push({
    name: want.name, placement: 'jigsaw',
    spacing: set.placement.spacing, separation: set.placement.separation, salt: set.placement.salt,
    pieces, biomes: [...biomes].sort(), starts, maxDepth: 6,
  });
}

fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`public/structures: ${files} templates, ${(bytes / 1024).toFixed(0)} KB`);
for (const e of index) console.log(`  ${e.name}: ${e.pieces.length} pieces, spacing ${e.spacing}/${e.separation}, ${e.biomes.length} biomes`);
