/**
 * Main-thread world: keeps block copies of loaded chunks for physics and interaction, drives the
 * world worker, and turns section meshes into per-column Three.js geometry (one draw call per
 * column per layer).
 */
import * as THREE from 'three';
import { CHUNK_SIZE, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';
import { chunkKey } from './chunk.ts';
import type { MeshBuffers } from './mesher.ts';
import type { Dimension, FromWorker, GenInit, ToWorker } from './protocol.ts';
import type { ModelsJson } from './models.ts';
import type { StructureBundle } from './protocol.ts';
import type { AtlasJson } from '../render/atlasIndex.ts';
import { collisionBoxes } from '../blocks/collision.ts';
import { deserializeEntities, entityKey, serializeEntities, type BlockEntity } from '../blocks/blockEntity.ts';

export interface LoadedChunk {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  biomes: Uint8Array;
  light: Uint8Array;
  modified: boolean;
  sections: (MeshBuffers | null)[];
  translucentSections: (MeshBuffers | null)[];
  solidMesh: THREE.Mesh | null;
  translucentMesh: THREE.Mesh | null;
  dirtyGeometry: boolean;
  /** Block entities keyed by world "x,y,z". */
  entities: Map<string, BlockEntity>;
  /** Saved mobs (JSON) waiting to be restored by the entity manager. */
  pendingMobs: string | null;
  /** Structure chests and spawners to make on first load (JSON from the generator). */
  pendingSpots: string | null;
}

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  state: number;
  /** Direction index of the face hit (0 down .. 5 east). */
  face: number;
  distance: number;
  point: THREE.Vector3;
}

export interface WorldOptions {
  seed: number;
  renderDistance: number;
  scene: THREE.Scene;
  solidMaterial: THREE.Material;
  translucentMaterial: THREE.Material;
  models: ModelsJson;
  atlas: AtlasJson;
  /** Vanilla structure templates, if `npm run structures` has produced them. */
  structures?: StructureBundle;
  /** Terrain generation workers to start (default: cores minus two, 1..4). */
  genWorkers?: number;
  /** Which world to generate; the overworld unless told otherwise. */
  dimension?: Dimension;
  /** Supplies saved chunk data, or null to generate. */
  loadChunk: (cx: number, cz: number) => Promise<{ blocks: Uint16Array; biomes: Uint8Array | null; entities?: string | null; mobs?: string | null } | null>;
}

const FACE_NORMALS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/** How quiet a column has to go before its geometry is rebuilt, and how long that may be put off. */
const COLUMN_QUIET_MS = 80;
const COLUMN_WAIT_MS = 500;
/** How much of a frame column rebuilds may take before the rest wait for the next one. */
const COLUMN_BUDGET_MS = 4;

export class World {
  readonly chunks = new Map<string, LoadedChunk>();
  private readonly worker: Worker;
  private readonly genWorkers: Worker[] = [];
  private readonly scene: THREE.Scene;
  private readonly solidMaterial: THREE.Material;
  private readonly translucentMaterial: THREE.Material;
  private viewCx = NaN;
  private viewCz = NaN;
  renderDistance: number;
  readonly seed: number;
  readonly dimension: Dimension;
  ready = false;
  stats = { chunks: 0, pending: 0, meshed: 0, drawn: 0, generating: 0 };
  onChunkLoaded: ((cx: number, cz: number) => void) | null = null;
  onBlockChanged: ((x: number, y: number, z: number, oldState: number, newState: number) => void) | null = null;
  onChunkUnloaded: ((c: LoadedChunk) => void) | null = null;
  /** Blocks written into a chunk the main thread already holds, by world generation next door. */
  onChunkPatched: ((cx: number, cz: number) => void) | null = null;
  private pendingEdits: number[] = [];
  private readonly pendingMobs = new Map<string, string | null>();
  private readonly loadChunk: WorldOptions['loadChunk'];
  /**
   * Columns waiting for their geometry to be rebuilt, with when they were first marked and when
   * the last section arrived: a chunk being meshed sends its two dozen sections one at a time, and
   * rebuilding the whole column for each of them is most of what the main thread does while
   * chunks are streaming in.
   */
  private readonly dirtyColumns = new Map<string, { since: number; last: number }>();
  private readonly pendingEntities = new Map<string, string | null>();

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.dimension = opts.dimension ?? 'overworld';
    this.renderDistance = opts.renderDistance;
    this.scene = opts.scene;
    this.solidMaterial = opts.solidMaterial;
    this.translucentMaterial = opts.translucentMaterial;
    this.loadChunk = opts.loadChunk;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    // Terrain generation pool: leave a core for the main thread and one for the world worker.
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const poolSize = opts.genWorkers ?? Math.max(1, Math.min(4, cores - 2));
    const genPorts: MessagePort[] = [];
    for (let i = 0; i < poolSize; i++) {
      const w = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
      const channel = new MessageChannel();
      w.postMessage({ type: 'init', seed: opts.seed, port: channel.port2, structures: opts.structures, dimension: this.dimension } satisfies GenInit, [channel.port2]);
      this.genWorkers.push(w);
      genPorts.push(channel.port1);
    }
    this.send({ type: 'init', seed: opts.seed, models: opts.models, atlas: opts.atlas, genPorts, structures: opts.structures, dimension: this.dimension }, genPorts);
  }

  private send(msg: ToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(msg, transfer ?? []);
  }

  dispose(): void {
    this.worker.terminate();
    for (const w of this.genWorkers) w.terminate();
    this.genWorkers.length = 0;
    for (const c of this.chunks.values()) this.removeMeshes(c);
    this.chunks.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Block access
  // ---------------------------------------------------------------------------------------------
  getChunk(cx: number, cz: number): LoadedChunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.blocks[((y - WORLD_MIN_Y) * CHUNK_SIZE + (z & 15)) * CHUNK_SIZE + (x & 15)];
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y > WORLD_MAX_Y) return 15;
    if (y < WORLD_MIN_Y) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.light[((y - WORLD_MIN_Y) * CHUNK_SIZE + (z & 15)) * CHUNK_SIZE + (x & 15)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.light[((y - WORLD_MIN_Y) * CHUNK_SIZE + (z & 15)) * CHUNK_SIZE + (x & 15)] & 15;
  }

  getBiome(x: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.biomes[(z & 15) * 16 + (x & 15)] : 0;
  }

  /** Writes a block locally and in the worker (which relights and remeshes). */
  setBlock(x: number, y: number, z: number, state: number): boolean {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return false;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return false;
    const i = ((y - WORLD_MIN_Y) * CHUNK_SIZE + (z & 15)) * CHUNK_SIZE + (x & 15);
    const old = c.blocks[i];
    if (old === state) return false;
    c.blocks[i] = state;
    c.modified = true;
    if (old !== 0 && c.entities.size && blocks.stateBlock[old] !== blocks.stateBlock[state]) c.entities.delete(`${x},${y},${z}`);
    this.pendingEdits.push(x, y, z, state);
    if (this.pendingEdits.length >= 4 * 512) this.flush();
    this.onBlockChanged?.(x, y, z, old, state);
    return true;
  }

  /** Sends batched edits to the worker; called every tick and frame. */
  flush(): void {
    if (!this.pendingEdits.length) return;
    const edits = Int32Array.from(this.pendingEdits);
    this.pendingEdits = [];
    this.send({ type: 'setBlocks', edits }, [edits.buffer]);
  }

  /** Combined light level with the sky contribution darkened at night (vanilla raw brightness). */
  getLight(x: number, y: number, z: number, skyDarken = 0): number {
    return Math.max(this.getBlockLight(x, y, z), this.getSkyLight(x, y, z) - skyDarken);
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntity | undefined {
    return this.chunks.get(chunkKey(x >> 4, z >> 4))?.entities.get(entityKey(x, y, z));
  }

  setBlockEntity(x: number, y: number, z: number, e: BlockEntity | null): void {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return;
    if (e) c.entities.set(entityKey(x, y, z), e);
    else c.entities.delete(entityKey(x, y, z));
    c.modified = true;
  }

  /** Flags the chunk holding (x, z) for saving (container contents changed). */
  markModifiedAt(x: number, z: number): void {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (c) c.modified = true;
  }

  forEachBlockEntity(cb: (x: number, y: number, z: number, e: BlockEntity) => void): void {
    for (const c of this.chunks.values()) {
      for (const [k, e] of c.entities) {
        const [x, y, z] = k.split(',').map(Number);
        cb(x, y, z, e);
      }
    }
  }

  serializeEntities(c: LoadedChunk): string | null {
    return serializeEntities(c.entities);
  }

  /** Highest non-air block in a column, or WORLD_MIN_Y - 1. */
  topBlock(x: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return WORLD_MIN_Y - 1;
    for (let y = WORLD_MAX_Y; y >= WORLD_MIN_Y; y--) {
      if (c.blocks[((y - WORLD_MIN_Y) * CHUNK_SIZE + (z & 15)) * CHUNK_SIZE + (x & 15)] !== 0) return y;
    }
    return WORLD_MIN_Y - 1;
  }

  /** Voxel DDA ray march against block collision shapes. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, fluids = false): RaycastHit | null {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
    let t = 0;
    let face = -1;
    const point = new THREE.Vector3();
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const state = this.getBlock(x, y, z);
      if (state !== 0) {
        const def = blocks.blockOf(state);
        const isFluid = def.behavior === 'fluid';
        if (!isFluid || fluids) {
          // precise test against the block's collision boxes (full block for shapeless blocks)
          const boxes = isFluid ? [[0, 0, 0, 1, 1, 1]] : collisionBoxes(state, true);
          let best = Infinity;
          let bestFace = face;
          for (const b of boxes) {
            const hit = rayBox(origin, dir, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
            if (hit && hit.t < best && hit.t <= maxDist) {
              best = hit.t;
              bestFace = hit.face;
            }
          }
          if (best < Infinity) {
            point.copy(origin).addScaledVector(dir, best);
            return { x, y, z, state, face: bestFace, distance: best, point };
          }
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        face = stepX > 0 ? 4 : 5;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        face = stepY > 0 ? 0 : 1;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        face = stepZ > 0 ? 2 : 3;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Streaming
  // ---------------------------------------------------------------------------------------------
  /** Call every frame with the player position. */
  update(px: number, pz: number): void {
    this.flush();
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    if (cx !== this.viewCx || cz !== this.viewCz) {
      this.viewCx = cx;
      this.viewCz = cz;
      this.send({ type: 'view', cx, cz, distance: this.renderDistance });
    }
    // rebuild column geometry for chunks that received new sections, once their sections have
    // stopped arriving — or after a moment, so nothing waits on a worker that never goes quiet
    const now = performance.now();
    const deadline = now + COLUMN_BUDGET_MS;
    for (const [key, t] of this.dirtyColumns) {
      if (now - t.last < COLUMN_QUIET_MS && now - t.since < COLUMN_WAIT_MS) continue;
      const c = this.chunks.get(key);
      this.dirtyColumns.delete(key);
      if (c) this.rebuildColumn(c);
      // a frame is sixteen milliseconds: what is left over waits for the next one
      if (performance.now() > deadline) break;
    }
  }

  setRenderDistance(d: number): void {
    this.renderDistance = d;
    this.viewCx = NaN;
    for (const c of this.chunks.values()) {
      if (Math.max(Math.abs(c.cx - this.viewCx), Math.abs(c.cz - this.viewCz)) > d) this.setVisible(c, false);
    }
  }

  private setVisible(c: LoadedChunk, v: boolean): void {
    if (c.solidMesh) c.solidMesh.visible = v;
    if (c.translucentMesh) c.translucentMesh.visible = v;
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        break;
      case 'chunk': {
        const key = chunkKey(msg.cx, msg.cz);
        let c = this.chunks.get(key);
        if (!c) {
          c = { cx: msg.cx, cz: msg.cz, blocks: msg.blocks, biomes: msg.biomes, light: msg.light, modified: false, sections: new Array(SECTION_COUNT).fill(null), translucentSections: new Array(SECTION_COUNT).fill(null), solidMesh: null, translucentMesh: null, dirtyGeometry: false, entities: deserializeEntities(this.pendingEntities.get(key)), pendingMobs: this.pendingMobs.get(key) ?? null, pendingSpots: msg.spots ?? null };
          this.pendingEntities.delete(key);
          this.pendingMobs.delete(key);
          this.chunks.set(key, c);
        } else {
          c.blocks = msg.blocks;
          c.biomes = msg.biomes;
          c.light = msg.light;
          if (msg.spots) c.pendingSpots = msg.spots;
        }
        this.onChunkLoaded?.(msg.cx, msg.cz);
        break;
      }
      case 'mesh': {
        const key = chunkKey(msg.cx, msg.cz);
        const c = this.chunks.get(key);
        if (!c) return;
        c.sections[msg.sy] = msg.solid;
        c.translucentSections[msg.sy] = msg.translucent;
        const now = performance.now();
        const pending = this.dirtyColumns.get(key);
        if (pending) pending.last = now;
        else this.dirtyColumns.set(key, { since: now, last: now });
        break;
      }
      case 'patch': {
        const c = this.chunks.get(chunkKey(msg.cx, msg.cz));
        if (!c) return;
        const e = msg.edits;
        for (let i = 0; i + 3 < e.length; i += 4) {
          c.blocks[((e[i + 1] - WORLD_MIN_Y) * CHUNK_SIZE + e[i + 2]) * CHUNK_SIZE + e[i]] = e[i + 3];
        }
        this.onChunkPatched?.(msg.cx, msg.cz);
        break;
      }
      case 'light': {
        const c = this.chunks.get(chunkKey(msg.cx, msg.cz));
        if (c) c.light = msg.light;
        break;
      }
      case 'lightPatch': {
        // one section's worth of light, which is what an edit or a torch changes
        const c = this.chunks.get(chunkKey(msg.cx, msg.cz));
        if (c) c.light.set(msg.light, msg.sy * 16 * CHUNK_SIZE * CHUNK_SIZE);
        break;
      }
      case 'unload': {
        const key = chunkKey(msg.cx, msg.cz);
        const c = this.chunks.get(key);
        if (c) {
          this.onChunkUnloaded?.(c);
          this.removeMeshes(c);
          this.chunks.delete(key);
        }
        break;
      }
      case 'needChunk':
        for (const [cx, cz] of msg.keys) {
          this.loadChunk(cx, cz).then((data) => {
            if (data?.entities) this.pendingEntities.set(chunkKey(cx, cz), data.entities);
            if (data?.mobs) this.pendingMobs.set(chunkKey(cx, cz), data.mobs);
            this.send({ type: 'chunkSource', cx, cz, blocks: data?.blocks ?? null, biomes: data?.biomes ?? null }, data ? [data.blocks.buffer] : []);
          });
        }
        break;
      case 'stats':
        this.stats.chunks = msg.chunks;
        this.stats.pending = msg.pending;
        this.stats.meshed = msg.meshed;
        this.stats.generating = msg.generating;
        break;
    }
  }

  /** Marks a chunk as unmodified after it has been saved. */
  markSaved(c: LoadedChunk): void {
    c.modified = false;
  }

  private removeMeshes(c: LoadedChunk): void {
    for (const m of [c.solidMesh, c.translucentMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    c.solidMesh = null;
    c.translucentMesh = null;
  }

  private rebuildColumn(c: LoadedChunk): void {
    c.solidMesh = this.rebuildLayer(c, c.sections, c.solidMesh, this.solidMaterial, 0);
    c.translucentMesh = this.rebuildLayer(c, c.translucentSections, c.translucentMesh, this.translucentMaterial, 10);
  }

  private rebuildLayer(c: LoadedChunk, sections: (MeshBuffers | null)[], existing: THREE.Mesh | null, material: THREE.Material, renderOrder: number): THREE.Mesh | null {
    let verts = 0;
    let idx = 0;
    for (const s of sections) {
      if (!s) continue;
      verts += s.tile.length;
      idx += s.index.length;
    }
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
    }
    if (verts === 0) return null;
    const position = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const tile = new Float32Array(verts);
    const color = new Uint8Array(verts * 4);
    const light = new Uint8Array(verts * 2);
    const index = new Uint32Array(idx);
    let v = 0;
    let i = 0;
    for (const s of sections) {
      if (!s) continue;
      position.set(s.position, v * 3);
      uv.set(s.uv, v * 2);
      tile.set(s.tile, v);
      color.set(s.color, v * 4);
      light.set(s.light, v * 2);
      for (let k = 0; k < s.index.length; k++) index[i + k] = s.index[k] + v;
      v += s.tile.length;
      i += s.index.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('tile', new THREE.BufferAttribute(tile, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 4, true));
    geo.setAttribute('light', new THREE.BufferAttribute(light, 2, false));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    // Only the sections that hold anything are worth drawing: a bound around those lets the whole
    // column be skipped when it is out of view, which a bound around the whole world height never is.
    let lowest = SECTION_COUNT;
    let highest = -1;
    sections.forEach((sec, sy) => {
      if (!sec) return;
      lowest = Math.min(lowest, sy);
      highest = Math.max(highest, sy);
    });
    // a block's model may reach a little past its own cell, so the bound is given a block of slack
    const y0 = lowest * 16 - 1;
    const y1 = (highest + 1) * 16 + 1;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, y0, 0), new THREE.Vector3(16, y1, 16));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, (y0 + y1) / 2, 8), Math.hypot(8, (y1 - y0) / 2, 8));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(c.cx * 16, WORLD_MIN_Y, c.cz * 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    return mesh;
  }
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): { t: number; face: number } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let face = -1;
  const axes: [number, number, number, number, number, number][] = [
    [o.x, d.x, x1, x2, 4, 5],
    [o.y, d.y, y1, y2, 0, 1],
    [o.z, d.z, z1, z2, 2, 3],
  ];
  for (const [oo, dd, lo, hi, fLo, fHi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    let f1 = fLo;
    let f2 = fHi;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      [f1, f2] = [f2, f1];
    }
    if (t1 > tmin) {
      tmin = t1;
      face = f1;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
    void f2;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, face: face < 0 ? 1 : face };
  return { t: tmin, face };
}

export { FACE_NORMALS };
