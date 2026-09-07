/**
 * World worker: owns the authoritative block and light data for loaded chunks, generates terrain,
 * decorates, lights and meshes them, and streams results to the main thread. Work is done in
 * time-sliced pumps so block edits from the player are handled with low latency.
 */
import { SECTION_COUNT, WORLD_MIN_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';
import { ChunkData } from './chunk.ts';
import { buildStructureSets } from './gen/structures.ts';
import { WorldGenerator, type StructureSpot } from './gen/generator.ts';
import { NetherGenerator } from './gen/nether.ts';
import { EndGenerator } from './gen/end.ts';
import type { TerrainGenerator } from './gen/terrain.ts';
import { LightEngine, sectionKey } from './light.ts';
import { ModelBaker } from './models.ts';
import { SectionMesher } from './mesher.ts';
import { AtlasIndex } from '../render/atlasIndex.ts';
import { packKey, type FromWorker, type GenRequest, type GenResult, type ToWorker } from './protocol.ts';

const ctx = self as unknown as Worker;
const post = (msg: FromWorker, transfer?: Transferable[]) => ctx.postMessage(msg, transfer ?? []);

const chunks = new Map<number, ChunkData>();
const provider = { getChunk: (cx: number, cz: number) => chunks.get(packKey(cx, cz)) };
let gen: TerrainGenerator;
let baker: ModelBaker;
let mesher: SectionMesher;
const light = new LightEngine(provider);

let viewCx = 0;
let viewCz = 0;
let distance = 8;
/** Answers from the main thread about saved chunk data (null = generate). */
const sources = new Map<number, { blocks: Uint16Array; biomes: Uint8Array | null } | null>();
const requested = new Set<number>();
/** Terrain generation pool: ports to genWorker.ts instances with their in-flight request counts. */
const genPool: { port: MessagePort; busy: number }[] = [];
const generating = new Set<number>();
/** Requests each generation worker may have queued; small so a moving view stays nearest-first. */
const GEN_INFLIGHT = 3;
const delivered = new Set<number>();
/** Sections needing a (re)mesh, keyed "cx,sy,cz". */
const dirty = new Set<string>();
/** Sections that currently have geometry on the main thread (so emptied ones get cleared). */
const meshedSections = new Set<string>();
let pumpScheduled = false;
let initialised = false;
let meshedCount = 0;

const BUDGET_MS = 12;

function schedulePump(): void {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setTimeout(pump, 0);
}

function chebyshev(cx: number, cz: number): number {
  return Math.max(Math.abs(cx - viewCx), Math.abs(cz - viewCz));
}

// ---------------------------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------------------------
/** Structure block entities waiting to be made, keyed by the chunk they landed in. */
const structureSpots = new Map<number, StructureSpot[]>();

function ensureTerrain(cx: number, cz: number): ChunkData | null {
  const key = packKey(cx, cz);
  let c = chunks.get(key);
  if (c) return c;
  if (!sources.has(key)) {
    requested.add(key);
    return null;
  }
  const src = sources.get(key);
  if (src) {
    sources.delete(key);
    c = new ChunkData(cx, cz, src.blocks, src.biomes ?? undefined);
    if (!src.biomes) {
      // biome map was not saved: regenerate it deterministically
      const tmp = new ChunkData(cx, cz);
      gen.generateTerrain(tmp);
      c.biomes.set(tmp.biomes);
    }
    c.status = 'decorated';
    c.modified = true;
    c.updateHeightmapAll();
  } else if (genPool.length) {
    // fresh terrain: hand it to the generation pool and come back when the result arrives
    requestTerrain(cx, cz, key);
    return null;
  } else {
    sources.delete(key);
    c = new ChunkData(cx, cz);
    gen.generateTerrain(c);
  }
  chunks.set(key, c);
  light.invalidateCache();
  return c;
}

/** Queues terrain generation on the least loaded pool worker; a no-op while in flight or saturated. */
function requestTerrain(cx: number, cz: number, key: number): void {
  if (generating.has(key)) return;
  let best: { port: MessagePort; busy: number } | null = null;
  for (const g of genPool) if (!best || g.busy < best.busy) best = g;
  if (!best || best.busy >= GEN_INFLIGHT) return;
  best.busy++;
  generating.add(key);
  const req: GenRequest = { type: 'gen', cx, cz };
  best.port.postMessage(req);
}

function onTerrain(msg: GenResult, g: { port: MessagePort; busy: number }): void {
  g.busy--;
  const key = packKey(msg.cx, msg.cz);
  generating.delete(key);
  sources.delete(key);
  if (!chunks.has(key) && chebyshev(msg.cx, msg.cz) <= distance + 4) {
    const c = new ChunkData(msg.cx, msg.cz, msg.blocks, msg.biomes);
    c.heightmap.set(msg.heightmap);
    c.status = 'terrain';
    chunks.set(key, c);
    light.invalidateCache();
  }
  schedulePump();
}

const patchBuffers = new Map<number, number[]>();

const decorateAccess = {
  get(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MIN_Y + 383) return 0;
    const c = chunks.get(packKey(x >> 4, z >> 4));
    return c ? c.get(x & 15, y, z & 15) : 0;
  },
  set(x: number, y: number, z: number, state: number): void {
    if (y < WORLD_MIN_Y || y > WORLD_MIN_Y + 383) return;
    const key = packKey(x >> 4, z >> 4);
    const c = chunks.get(key);
    if (!c) return;
    const lx = x & 15;
    const lz = z & 15;
    if (c.status === 'lit' || c.status === 'ready') {
      const old = c.set(lx, y, lz, state);
      if (old !== state) {
        light.onBlockChanged(x, y, z, old, state);
        for (const k of light.takeDirty()) dirty.add(k);
        if (c.modified) c.modified = true;
      }
    } else {
      c.set(lx, y, lz, state);
    }
    if (delivered.has(key)) {
      let list = patchBuffers.get(key);
      if (!list) patchBuffers.set(key, (list = []));
      list.push(lx, y, lz, state);
    }
  },
};

function flushPatches(): void {
  for (const [key, list] of patchBuffers) {
    const c = chunks.get(key);
    if (c) post({ type: 'patch', cx: c.cx, cz: c.cz, edits: Int32Array.from(list) });
  }
  patchBuffers.clear();
}

function ensureDecorated(cx: number, cz: number): ChunkData | null {
  let ok = true;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!ensureTerrain(cx + dx, cz + dz)) ok = false;
  if (!ok) return null;
  const c = chunks.get(packKey(cx, cz))!;
  if (c.status === 'terrain') {
    gen.decorate(c, decorateAccess);
    // a structure only ever writes into the chunk being decorated, so its chests and spawners belong
    // to this one; they are made on the main thread, where the loot tables and mobs live
    if (gen.structureSpots.length) structureSpots.set(packKey(cx, cz), gen.structureSpots.slice());
    c.updateHeightmapAll();
    flushPatches();
    // the step is over whether or not the generator says so, and the next one only runs on this
    c.status = 'decorated';
  }
  return c;
}

function ensureLit(cx: number, cz: number): ChunkData | null {
  let ok = true;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!ensureDecorated(cx + dx, cz + dz)) ok = false;
  if (!ok) return null;
  const c = chunks.get(packKey(cx, cz))!;
  if (c.status === 'decorated') {
    light.initChunk(c);
    c.status = 'lit';
    for (const k of light.takeDirty()) dirty.add(k);
  }
  return c;
}

function deliver(c: ChunkData): void {
  const key = packKey(c.cx, c.cz);
  if (delivered.has(key)) return;
  delivered.add(key);
  c.status = 'ready';
  const spots = structureSpots.get(key);
  structureSpots.delete(key);
  post({ type: 'chunk', cx: c.cx, cz: c.cz, blocks: c.blocks.slice(), biomes: c.biomes.slice(), light: c.light.slice(), ...(spots?.length ? { spots: JSON.stringify(spots) } : {}) });
}

function neighboursLit(cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = chunks.get(packKey(cx + dx, cz + dz));
      if (!n || (n.status !== 'lit' && n.status !== 'ready')) return false;
    }
  return true;
}

function meshSection(cx: number, sy: number, cz: number): void {
  const key = sectionKey(cx, sy, cz);
  const c = chunks.get(packKey(cx, cz));
  if (c && c.isSectionEmpty(sy) && !meshedSections.has(key)) return; // nothing to draw, nothing to clear
  const result = mesher.mesh(cx, sy, cz);
  if (result.solid || result.translucent) meshedSections.add(key);
  else if (!meshedSections.delete(key)) return;
  const transfer: Transferable[] = [];
  for (const b of [result.solid, result.translucent]) {
    if (!b) continue;
    // section-local y -> column-local y so the main thread can concatenate sections
    const off = sy * 16;
    for (let i = 1; i < b.position.length; i += 3) b.position[i] += off;
    transfer.push(b.position.buffer, b.uv.buffer, b.tile.buffer, b.color.buffer, b.light.buffer, b.index.buffer);
  }
  meshedCount++;
  post({ type: 'mesh', cx, sy, cz, solid: result.solid, translucent: result.translucent }, transfer);
}

function meshDirty(deadline: number): boolean {
  for (const key of dirty) {
    const [cx, sy, cz] = key.split(',').map(Number);
    const c = chunks.get(packKey(cx, cz));
    if (!c) {
      dirty.delete(key);
      continue;
    }
    if (chebyshev(cx, cz) > distance) continue;
    if (!neighboursLit(cx, cz)) continue;
    dirty.delete(key);
    if (!delivered.has(packKey(cx, cz))) deliver(c);
    meshSection(cx, sy, cz);
    if (performance.now() > deadline) return false;
  }
  return true;
}

function pump(): void {
  pumpScheduled = false;
  if (!initialised) return;
  const deadline = performance.now() + BUDGET_MS;
  let more = false;
  // 1. edits and light changes in already visible chunks
  if (!meshDirty(deadline)) more = true;
  // 2. bring chunks in, nearest first
  if (!more) {
    const order: [number, number, number][] = [];
    for (let dz = -distance; dz <= distance; dz++)
      for (let dx = -distance; dx <= distance; dx++) order.push([viewCx + dx, viewCz + dz, dx * dx + dz * dz]);
    order.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of order) {
      const key = packKey(cx, cz);
      const c = chunks.get(key);
      if (c && delivered.has(key) && c.status === 'ready') continue;
      const lit = ensureLit(cx, cz);
      if (lit) {
        // neighbours must be lit before the first mesh so borders are correct
        let allLit = true;
        for (let dz = -1; dz <= 1 && allLit; dz++) for (let dx = -1; dx <= 1; dx++) if (!ensureLit(cx + dx, cz + dz)) { allLit = false; break; }
        if (allLit) {
          deliver(lit);
          for (let sy = 0; sy < SECTION_COUNT; sy++) {
            const k = sectionKey(cx, sy, cz);
            if (dirty.has(k)) {
              dirty.delete(k);
              meshSection(cx, sy, cz);
            }
          }
        }
      }
      if (performance.now() > deadline) {
        more = true;
        break;
      }
    }
  }
  // 3. ask the main thread for saved data of chunks we could not build yet
  if (requested.size) {
    const keys: [number, number][] = [];
    for (const k of requested) {
      if (sources.has(k)) continue;
      keys.push([Math.floor(k / 65536) - 32768, (k % 65536) - 32768]);
    }
    requested.clear();
    if (keys.length) post({ type: 'needChunk', keys });
  }
  // 4. drop chunks far outside the view
  if (!more) {
    for (const [key, c] of chunks) {
      if (chebyshev(c.cx, c.cz) > distance + 4) {
        chunks.delete(key);
        for (let sy = 0; sy < SECTION_COUNT; sy++) {
          meshedSections.delete(sectionKey(c.cx, sy, c.cz));
          dirty.delete(sectionKey(c.cx, sy, c.cz));
        }
        structureSpots.delete(key);
        if (delivered.delete(key)) post({ type: 'unload', cx: c.cx, cz: c.cz });
      }
    }
    light.invalidateCache();
  }
  post({ type: 'stats', chunks: chunks.size, pending: dirty.size, meshed: meshedCount, generating: generating.size });
  if (more || dirty.size) schedulePump();
}

function applyEdit(x: number, y: number, z: number, state: number): void {
  if (y < WORLD_MIN_Y || y > WORLD_MIN_Y + 383) return;
  const c = chunks.get(packKey(x >> 4, z >> 4));
  if (!c) return;
  const old = c.set(x & 15, y, z & 15, state);
  c.modified = true;
  if (old === state) return;
  light.onBlockChanged(x, y, z, old, state);
  for (const k of light.takeDirty()) dirty.add(k);
  // the edited cell's own section must always be rebuilt
  const sy = (y - WORLD_MIN_Y) >> 4;
  dirty.add(sectionKey(x >> 4, sy, z >> 4));
  const lx = x & 15, lz = z & 15, ly = (y - WORLD_MIN_Y) & 15;
  if (lx === 0) dirty.add(sectionKey((x >> 4) - 1, sy, z >> 4));
  if (lx === 15) dirty.add(sectionKey((x >> 4) + 1, sy, z >> 4));
  if (lz === 0) dirty.add(sectionKey(x >> 4, sy, (z >> 4) - 1));
  if (lz === 15) dirty.add(sectionKey(x >> 4, sy, (z >> 4) + 1));
  if (ly === 0 && sy > 0) dirty.add(sectionKey(x >> 4, sy - 1, z >> 4));
  if (ly === 15 && sy < SECTION_COUNT - 1) dirty.add(sectionKey(x >> 4, sy + 1, z >> 4));
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      gen = msg.dimension === 'nether' ? new NetherGenerator(msg.seed) : msg.dimension === 'end' ? new EndGenerator(msg.seed) : new WorldGenerator(msg.seed);
      if (msg.structures) gen.structures = buildStructureSets(msg.structures.index, msg.structures.templates, msg.structures.pools);
      const atlas = new AtlasIndex(msg.atlas);
      baker = new ModelBaker(msg.models, atlas);
      mesher = new SectionMesher(provider, baker, atlas);
      for (const port of msg.genPorts ?? []) {
        const g = { port, busy: 0 };
        port.onmessage = (e: MessageEvent<GenResult>) => {
          if (e.data.type === 'terrain') onTerrain(e.data, g);
        };
        genPool.push(g);
      }
      initialised = true;
      post({ type: 'ready' });
      schedulePump();
      break;
    }
    case 'view':
      viewCx = msg.cx;
      viewCz = msg.cz;
      distance = msg.distance;
      schedulePump();
      break;
    case 'chunkSource':
      sources.set(packKey(msg.cx, msg.cz), msg.blocks ? { blocks: msg.blocks, biomes: msg.biomes } : null);
      schedulePump();
      break;
    case 'setBlock':
      applyEdit(msg.x, msg.y, msg.z, msg.state);
      meshDirty(performance.now() + 30);
      if (dirty.size) schedulePump();
      break;
    case 'setBlocks':
      for (let i = 0; i + 3 < msg.edits.length; i += 4) applyEdit(msg.edits[i], msg.edits[i + 1], msg.edits[i + 2], msg.edits[i + 3]);
      meshDirty(performance.now() + 30);
      if (dirty.size) schedulePump();
      break;
    case 'remeshAll':
      for (const c of chunks.values()) if (delivered.has(packKey(c.cx, c.cz))) for (let sy = 0; sy < SECTION_COUNT; sy++) dirty.add(sectionKey(c.cx, sy, c.cz));
      schedulePump();
      break;
  }
};

void blocks;
