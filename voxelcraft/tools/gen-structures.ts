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
/** Ocean ruin pieces: the warm ones are sandstone, everything else is the cold stone brick set. */
const RUIN_KINDS = ['brick', 'cracked', 'mossy'];
const ruinPieces = (warm: boolean): string[] => {
  const out: string[] = [];
  for (let i = 1; i <= 8; i++) {
    if (warm) {
      out.push(`underwater_ruin/warm_${i}`);
      if (i >= 4 && i <= 7) out.push(`underwater_ruin/big_warm_${i}`);
      continue;
    }
    for (const kind of RUIN_KINDS) {
      out.push(`underwater_ruin/${kind}_${i}`);
      if (i <= 3 || i === 8) out.push(`underwater_ruin/big_${kind}_${i}`);
    }
  }
  return out;
};

const WANTED: { name: string; set: string; pieces: string[]; placement: 'surface' | 'ocean_floor' | 'mansion'; structures: string[]; main?: string[] }[] = [
  // the igloo's basement pieces are stamped by the generator under the top, never on their own
  { name: 'igloo', set: 'igloos', pieces: ['igloo/top', 'igloo/middle', 'igloo/bottom'], main: ['igloo_top'], placement: 'surface', structures: ['igloo'] },
  { name: 'shipwreck', set: 'shipwrecks', pieces: [], placement: 'ocean_floor', structures: ['shipwreck', 'shipwreck_beached'] },
  { name: 'ruined_portal', set: 'ruined_portals', pieces: [], placement: 'surface', structures: ['ruined_portal', 'ruined_portal_desert', 'ruined_portal_jungle', 'ruined_portal_mountain', 'ruined_portal_swamp'] },
  { name: 'pillager_outpost', set: 'pillager_outposts', pieces: ['pillager_outpost/watchtower'], placement: 'surface', structures: ['pillager_outpost'] },
  // every mansion template; the generator lays them out on vanilla's eight-block grid
  { name: 'mansion', set: 'woodland_mansions', pieces: [], placement: 'mansion', structures: ['mansion'] },
  // the two ocean ruin sets share one spread, so a start lands in whichever of them the biome allows
  { name: 'ocean_ruin_warm', set: 'ocean_ruins', pieces: ruinPieces(true), placement: 'ocean_floor', structures: ['ocean_ruin_warm'] },
  { name: 'ocean_ruin_cold', set: 'ocean_ruins', pieces: ruinPieces(false), placement: 'ocean_floor', structures: ['ocean_ruin_cold'] },
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
interface MobSpot { pos: [number, number, number]; id: string }
interface Template { size: [number, number, number]; palette: string[]; blocks: number[]; jigsaws?: Jigsaw[]; loot?: LootSpot[]; mobs?: MobSpot[]; spawners?: MobSpot[] }

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
function markerTable(structure: string, piece: string, meta: string): string | null {
  if (CHEST_FACING[meta]) return structure === 'mansion' ? 'chests/woodland_mansion' : null;
  if (meta !== 'chest') return DATA_TABLES[meta] ?? null;
  if (structure === 'igloo') return 'chests/igloo_chest';
  if (structure.startsWith('ocean_ruin')) return piece.includes('big_') ? 'chests/underwater_ruin_big' : 'chests/underwater_ruin_small';
  return null;
}

/** Mobs a DATA marker stands for: the drowned of an ocean ruin, the illagers of a mansion. */
const DATA_MOBS: Record<string, string> = { drowned: 'drowned', Mage: 'evoker', Warrior: 'vindicator' };

/** Chest markers that also say which way the chest faces (a mansion marks its chests this way). */
const CHEST_FACING: Record<string, string> = { Chest: 'north', ChestNorth: 'north', ChestSouth: 'south', ChestEast: 'east', ChestWest: 'west' };

/** Turns a template's palette entry into our `id[prop=value,...]` state string. */
function stateString(entry: NbtTag): string {
  const name = String(entry.Name).replace('minecraft:', '');
  const props = entry.Properties as NbtTag | undefined;
  if (!props) return name;
  const parts = Object.entries(props).map(([k, v]) => `${k}=${String(v)}`).sort();
  return parts.length ? `${name}[${parts.join(',')}]` : name;
}

function convert(file: string, structure: string, piece: string): Template | null {
  const root = readNbt(fs.readFileSync(file));
  const size = (root.size as NbtValue[]).map(num) as [number, number, number];
  const jigsaws: Jigsaw[] = [];
  const loot: LootSpot[] = [];
  const mobs: MobSpot[] = [];
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
    // data markers are instructions, not blocks
    if (id.startsWith('structure_block')) {
      const meta = String((b.nbt as NbtTag | undefined)?.metadata ?? '');
      if (!meta) continue;
      if (DATA_MOBS[meta]) {
        mobs.push({ pos: pos as [number, number, number], id: DATA_MOBS[meta] });
        continue;
      }
      const marked = markerTable(structure, piece, meta);
      if (!marked) continue;
      // an ocean ruin or a mansion marks where its chest goes; everywhere else it is below the marker
      if (structure.startsWith('ocean_ruin') || CHEST_FACING[meta]) {
        const chest = `chest[facing=${CHEST_FACING[meta] ?? 'north'},type=single,waterlogged=false]`;
        let entry = palette.indexOf(chest);
        if (entry < 0) entry = palette.push(chest) - 1;
        blocks.push(pos[0], pos[1], pos[2], entry);
        loot.push({ pos: pos as [number, number, number], table: marked });
      } else {
        loot.push({ pos: [pos[0], pos[1] - 1, pos[2]], table: marked });
      }
      continue;
    }
    // chests and barrels carry the loot table they should be filled from
    const table = (b.nbt as NbtTag | undefined)?.LootTable;
    if (table) loot.push({ pos: pos as [number, number, number], table: String(table).replace('minecraft:', '') });
    blocks.push(pos[0], pos[1], pos[2], state);
  }
  // a trial chamber's spawner piece is named after the mob it turns, and holds one trial spawner
  const spawners: MobSpot[] = [];
  const spawnerMob = /spawner\/(?:[a-z_]+)\/([a-z_]+)$/.exec(piece)?.[1];
  if (spawnerMob) {
    for (let i = 0; i < blocks.length; i += 4) {
      if (!palette[blocks[i + 3]].startsWith('trial_spawner')) continue;
      spawners.push({ pos: [blocks[i], blocks[i + 1], blocks[i + 2]], id: spawnerMob });
    }
  }
  return blocks.length || jigsaws.length
    ? {
      size, palette, blocks,
      ...(jigsaws.length ? { jigsaws } : {}),
      ...(loot.length ? { loot } : {}),
      ...(mobs.length ? { mobs } : {}),
      ...(spawners.length ? { spawners } : {}),
    }
    : null;
}

/** Structures assembled from template pools (villages); every reachable piece is converted. */
const JIGSAW: { name: string; set: string; only?: string }[] = [
  { name: 'village', set: 'villages' },
  { name: 'ancient_city', set: 'ancient_cities' },
  { name: 'trial_chambers', set: 'trial_chambers' },
  // the nether complexes hold two structures on one spread: the bastion is the jigsaw half of it
  { name: 'bastion_remnant', set: 'nether_complexes', only: 'bastion_remnant' },
];

/**
 * Pool aliases: a trial chamber decides once per chamber which mobs its spawners hold, by pointing
 * an alias name (`spawner/contents/melee`) at a real pool (`spawner/melee/husk`).
 */
type PoolAlias =
  | { type: 'random'; alias: string; targets: { target: string; weight: number }[] }
  | { type: 'random_group'; groups: { weight: number; entries: { alias: string; target: string }[] }[] };

function readAliases(def: { pool_aliases?: Record<string, unknown>[] }): PoolAlias[] {
  const out: PoolAlias[] = [];
  const strip = (v: string) => v.replace('minecraft:', '');
  for (const raw of def.pool_aliases ?? []) {
    const kind = String(raw.type).replace('minecraft:', '');
    if (kind === 'random') {
      const targets = (raw.targets as { data: string; weight: number }[]).map((t) => ({ target: strip(t.data), weight: t.weight ?? 1 }));
      out.push({ type: 'random', alias: strip(String(raw.alias)), targets });
    } else if (kind === 'random_group') {
      const groups = (raw.groups as { weight: number; data: { alias: string; target: string }[] }[]).map((g) => ({
        weight: g.weight ?? 1,
        entries: g.data.map((d) => ({ alias: strip(d.alias), target: strip(d.target) })),
      }));
      out.push({ type: 'random_group', groups });
    }
  }
  return out;
}

const mc = versionDir();
const structureDir = path.join(mc, 'data', 'minecraft', 'structure');
const setDir = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure_set');
const outDir = path.join(PUBLIC, 'structures');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

interface Variant { start: string; weight: number; biomes: string[] }
interface IndexEntry { name: string; placement: string; spacing: number; separation: number; salt: number; share?: { before: number; weight: number; total: number }; frequency?: number; count?: number; distance?: number; spread?: number; cluster?: number; maxDistance?: number; startY?: number; startYMax?: number | null; aliases?: PoolAlias[]; pieces: string[]; biomes: string[]; main?: string[]; variants?: Variant[]; maxDepth?: number }
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
  const dir = path.join(structureDir, want.name === 'mansion' ? 'woodland_mansion' : want.name);
  const folder = path.basename(dir);
  const pieces = want.pieces.length
    ? want.pieces
    : fs.readdirSync(dir).filter((f) => f.endsWith('.nbt')).map((f) => `${folder}/${path.basename(f, '.nbt')}`);
  const written: string[] = [];
  const bundle: Record<string, Template> = {};
  for (const piece of pieces) {
    const file = path.join(structureDir, `${piece}.nbt`);
    if (!fs.existsSync(file)) continue;
    const template = convert(file, want.name, piece);
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
    // vanilla scatters more small ruins round the one it starts with
    ...(want.name.startsWith('ocean_ruin') ? { cluster: 24 } : {}),
  });
}

// jigsaw structures: walk the template pools from each start pool and convert what they reach
const pools: Record<string, { location: string; weight: number; projection: string }[]> = {};
for (const want of JIGSAW) {
  const setFile = path.join(setDir, `${want.set}.json`);
  if (!fs.existsSync(setFile)) continue;
  const set = JSON.parse(fs.readFileSync(setFile, 'utf8')) as {
    placement: { spacing: number; separation: number; salt: number };
    structures: { structure: string; weight: number }[];
  };
  // one structure set holds all five village types, each with its own start pool and biomes
  const variants: Variant[] = [];
  const biomes = new Set<string>();
  const queue: string[] = [];
  let depth = 6;
  let maxDistance = 80;
  const aliases: PoolAlias[] = [];
  let startY: number | null = null;
  let startYMax: number | null = null;
  for (const entry of set.structures) {
    const name = entry.structure.replace('minecraft:', '');
    if (want.only && name !== want.only) continue;
    const file = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const def = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      start_pool: string;
      size: number;
      max_distance_from_center?: number;
      project_start_to_heightmap?: string;
      start_height?: { absolute?: number; min_inclusive?: { absolute: number }; max_inclusive?: { absolute: number } };
      pool_aliases?: Record<string, unknown>[];
    };
    if (!def.start_pool) continue; // a structure in the set that is not a jigsaw one (the fortress)
    const start = def.start_pool.replace('minecraft:', '');
    const own = biomesFor(mc, [name]);
    variants.push({ start, weight: entry.weight ?? 1, biomes: own });
    queue.push(start);
    for (const b of own) biomes.add(b);
    depth = Math.max(depth, def.size ?? 6);
    for (const alias of readAliases(def)) {
      aliases.push(alias);
      // the pools an alias can point at are only reachable through it, so queue them by hand
      if (alias.type === 'random') for (const t of alias.targets) queue.push(t.target);
      else for (const g of alias.groups) for (const e of g.entries) queue.push(e.target);
    }
    maxDistance = Math.max(maxDistance, def.max_distance_from_center ?? 80);
    // a structure built underground says where it starts; one projected to a heightmap follows the ground
    const h = def.project_start_to_heightmap ? undefined : def.start_height;
    if (h) {
      startY = h.absolute ?? h.min_inclusive?.absolute ?? null;
      startYMax = h.absolute ?? h.max_inclusive?.absolute ?? startY;
    }
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
        const template = convert(file, want.name, loc);
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
  const total = set.structures.reduce((n, e) => n + (e.weight ?? 1), 0);
  const own = set.structures.filter((e) => !want.only || e.structure.replace('minecraft:', '') === want.only).reduce((n, e) => n + (e.weight ?? 1), 0);
  index.push({
    name: want.name, placement: 'jigsaw',
    spacing: set.placement.spacing, separation: set.placement.separation, salt: set.placement.salt,
    // structures sharing one spread (the fortress and the bastion) split its starts by weight
    ...(want.only ? { share: { before: 0, weight: own, total } } : {}),
    pieces, biomes: [...biomes].sort(), variants, maxDepth: depth, maxDistance,
    ...(startY !== null ? { startY, startYMax } : {}),
    ...(aliases.length ? { aliases } : {}),
  });
}

/**
 * Structures vanilla builds in code rather than from templates. Only their placement comes out of
 * the data files: the spread, the per-chunk frequency and each variant's biome list.
 */
const PROCEDURAL: { name: string; set: string; only?: string }[] = [
  { name: 'mineshaft', set: 'mineshafts' },
  { name: 'desert_pyramid', set: 'desert_pyramids' },
  { name: 'jungle_temple', set: 'jungle_temples' },
  { name: 'swamp_hut', set: 'swamp_huts' },
  { name: 'stronghold', set: 'strongholds' },
  { name: 'buried_treasure', set: 'buried_treasures' },
  { name: 'monument', set: 'ocean_monuments' },
  { name: 'fortress', set: 'nether_complexes', only: 'fortress' },
];

for (const want of PROCEDURAL) {
  const setFile = path.join(setDir, `${want.set}.json`);
  if (!fs.existsSync(setFile)) continue;
  const set = JSON.parse(fs.readFileSync(setFile, 'utf8')) as {
    placement: { spacing?: number; separation?: number; salt: number; frequency?: number; count?: number; distance?: number; spread?: number };
    structures: { structure: string; weight: number }[];
  };
  const variants: Variant[] = [];
  const biomes = new Set<string>();
  for (const entry of set.structures) {
    const name = entry.structure.replace('minecraft:', '');
    if (want.only && name !== want.only) continue;
    const file = path.join(mc, 'data', 'minecraft', 'worldgen', 'structure', `${name}.json`);
    if (!fs.existsSync(file)) continue;
    // the mineshaft's own JSON says which kind of shaft it builds (normal timbers or mesa's dark oak)
    const def = JSON.parse(fs.readFileSync(file, 'utf8')) as { mineshaft_type?: string };
    const own = biomesFor(mc, [name]);
    variants.push({ start: def.mineshaft_type ?? name, weight: entry.weight ?? 1, biomes: own });
    for (const b of own) biomes.add(b);
  }
  const shareTotal = set.structures.reduce((n, e) => n + (e.weight ?? 1), 0);
  const shareOwn = set.structures.filter((e) => !want.only || e.structure.replace('minecraft:', '') === want.only).reduce((n, e) => n + (e.weight ?? 1), 0);
  index.push({
    name: want.name, placement: want.name,
    // strongholds are spread in rings round the origin rather than on a grid
    spacing: set.placement.spacing ?? 1, separation: set.placement.separation ?? 0, salt: set.placement.salt,
    // the fortress takes its share of the nether complexes' starts, the bastion the rest
    ...(want.only ? { share: { before: shareTotal - shareOwn, weight: shareOwn, total: shareTotal } } : {}),
    frequency: set.placement.frequency, pieces: [], biomes: [...biomes].sort(), variants,
    ...(set.placement.count ? { count: set.placement.count, distance: set.placement.distance, spread: set.placement.spread } : {}),
  });
  console.log(`  ${want.name}: built in code, ${set.placement.count ? `${set.placement.count} in rings` : `frequency ${set.placement.frequency}`}, ${biomes.size} biomes`);
}

/**
 * Fossils are a feature in vanilla rather than a structure, but they are templates buried in the
 * ground like everything else here, so they come through the same pipeline: the biomes are the ones
 * whose feature lists mention them, and the rarity is vanilla's one chunk in 64.
 */
const FOSSILS = ['spine_1', 'spine_2', 'spine_3', 'spine_4', 'skull_1', 'skull_2', 'skull_3', 'skull_4'];
{
  const biomeDir = path.join(mc, 'data', 'minecraft', 'worldgen', 'biome');
  const biomes: string[] = [];
  for (const file of fs.existsSync(biomeDir) ? fs.readdirSync(biomeDir) : []) {
    const def = JSON.parse(fs.readFileSync(path.join(biomeDir, file), 'utf8')) as { features?: string[][] };
    if ((def.features ?? []).some((step) => step.some((f) => f.includes('fossil')))) biomes.push(path.basename(file, '.json'));
  }
  const bundle: Record<string, Template> = {};
  const written: string[] = [];
  for (const name of FOSSILS) {
    for (const piece of [`fossil/${name}`, `fossil/${name}_coal`]) {
      const template = convert(path.join(structureDir, `${piece}.nbt`), 'fossil', piece);
      if (!template) continue;
      bundle[piece.replace('/', '_')] = template;
      written.push(piece.replace('/', '_'));
      files++;
    }
  }
  const bundleJson = JSON.stringify({ pieces: bundle });
  fs.writeFileSync(path.join(outDir, 'fossil.json'), bundleJson);
  bytes += bundleJson.length;
  index.push({
    name: 'fossil', placement: 'fossil', spacing: 1, separation: 0, salt: 0x055170,
    frequency: 1 / 64, pieces: written, biomes: biomes.sort(),
    main: written.filter((k) => !k.endsWith('_coal')),
  });
  console.log(`  fossil: ${written.length} pieces, one chunk in 64, ${biomes.length} biomes`);
}

fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`public/structures: ${files} templates, ${(bytes / 1024).toFixed(0)} KB`);
for (const e of index) console.log(`  ${e.name}: ${e.pieces.length} pieces, spacing ${e.spacing}/${e.separation}, ${e.biomes.length} biomes`);
