/** IndexedDB persistence for worlds, chunks and players, plus zip export/import. */
import { deflateSync, inflateSync, unzipSync, zipSync } from 'fflate';
import type { Dimension } from '../world/protocol.ts';
import type { PlayerSave } from '../entities/player.ts';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  created: number;
  lastPlayed: number;
  time: number;
  day: number;
  gamemode: 'survival' | 'creative';
  player: PlayerSave | null;
  version: number;
  /** Chunks that already received their initial animal spawn. */
  animalChunks?: string[];
  /** Maps the player has made, as base64 colours. */
  maps?: { id: number; scale: number; cx: number; cz: number; locked?: boolean; colors: string }[];
  /** The state of the sky: whether it is raining, and how long until it changes. */
  weather?: { rainTime: number; thunderTime: number; raining: boolean; thundering: boolean; rainLevel: number; thunderLevel: number };
  /** Set once the Ender Dragon has been beaten, so the End never puts another one up. */
  dragonKilled?: boolean;
  /** The level the End's exit portal stands at, kept as vanilla keeps the fight's portal position. */
  endPodiumY?: number;
  /** Which world the player logged out in, and where they stood in the ones they have left. */
  dimension?: Dimension;
  dimensionSpots?: Partial<Record<Dimension, [number, number, number]>>;
}

interface ChunkRecord {
  key: string;
  world: string;
  /** Which of the world's dimensions the chunk belongs to; absent means the overworld. */
  dimension?: string;
  cx: number;
  cz: number;
  blocks: Uint8Array;
  biomes: Uint8Array | null;
  /** JSON of block entities (containers, furnaces) keyed "x,y,z" in chunk-local coordinates. */
  entities?: string | null;
  /** JSON list of mobs inside the chunk. */
  mobs?: string | null;
}

const DB_NAME = 'voxelcraft';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: 'key' });
        s.createIndex('world', 'world', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

/**
 * A chunk's key. The overworld keeps the plain key it always had, so old saves still load; another
 * dimension's chunks hang off the same world under their own name.
 */
export const chunkRecordKey = (world: string, cx: number, cz: number, dimension = 'overworld') =>
  (dimension === 'overworld' ? `${world}:${cx},${cz}` : `${world}/${dimension}:${cx},${cz}`);

export class SaveManager {
  async listWorlds(): Promise<WorldMeta[]> {
    const all = await tx<WorldMeta[]>('worlds', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldMeta | undefined> {
    return tx<WorldMeta | undefined>('worlds', 'readonly', (s) => s.get(id));
  }

  async saveWorld(meta: WorldMeta): Promise<void> {
    await tx('worlds', 'readwrite', (s) => s.put(meta));
  }

  async createWorld(name: string, seed: number, seedText: string, gamemode: 'survival' | 'creative'): Promise<WorldMeta> {
    const meta: WorldMeta = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      seed,
      seedText,
      created: Date.now(),
      lastPlayed: Date.now(),
      time: 1000,
      day: 0,
      gamemode,
      player: null,
      version: 1,
    };
    await this.saveWorld(meta);
    return meta;
  }

  async deleteWorld(id: string): Promise<void> {
    const keys = await this.chunkKeys(id);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['worlds', 'chunks'], 'readwrite');
      t.objectStore('worlds').delete(id);
      const cs = t.objectStore('chunks');
      for (const k of keys) cs.delete(k);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  private async chunkKeys(world: string): Promise<string[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('chunks', 'readonly').objectStore('chunks').index('world').getAllKeys(IDBKeyRange.only(world));
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  }

  async loadChunk(world: string, cx: number, cz: number, dimension = 'overworld'): Promise<{ blocks: Uint16Array; biomes: Uint8Array | null; entities: string | null; mobs: string | null } | null> {
    const rec = await tx<ChunkRecord | undefined>('chunks', 'readonly', (s) => s.get(chunkRecordKey(world, cx, cz, dimension)));
    if (!rec) return null;
    const raw = inflateSync(rec.blocks);
    return { blocks: new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2).slice(), biomes: rec.biomes ? rec.biomes.slice() : null, entities: rec.entities ?? null, mobs: rec.mobs ?? null };
  }

  async saveChunks(world: string, chunks: { cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array; entities?: string | null; mobs?: string | null }[], dimension = 'overworld'): Promise<void> {
    if (!chunks.length) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('chunks', 'readwrite');
      const s = t.objectStore('chunks');
      for (const c of chunks) {
        const rec: ChunkRecord = {
          key: chunkRecordKey(world, c.cx, c.cz, dimension),
          world,
          ...(dimension === 'overworld' ? {} : { dimension }),
          cx: c.cx,
          cz: c.cz,
          blocks: deflateSync(new Uint8Array(c.blocks.buffer, c.blocks.byteOffset, c.blocks.byteLength), { level: 6 }),
          biomes: c.biomes.slice(),
          entities: c.entities ?? null,
          mobs: c.mobs ?? null,
        };
        s.put(rec);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async chunkCount(world: string): Promise<number> {
    return (await this.chunkKeys(world)).length;
  }

  /** Packs the world into a zip: level.json + chunks/<cx>.<cz>.bin (deflated blocks) + biomes. */
  async exportWorld(id: string): Promise<Blob> {
    const meta = await this.getWorld(id);
    if (!meta) throw new Error('world not found');
    const db = await openDb();
    const recs = await new Promise<ChunkRecord[]>((resolve, reject) => {
      const req = db.transaction('chunks', 'readonly').objectStore('chunks').index('world').getAll(IDBKeyRange.only(id));
      req.onsuccess = () => resolve(req.result as ChunkRecord[]);
      req.onerror = () => reject(req.error);
    });
    const files: Record<string, Uint8Array> = {};
    files['level.json'] = new TextEncoder().encode(JSON.stringify(meta, null, 2));
    for (const r of recs) {
      // the overworld keeps the flat layout old exports use; another dimension goes in its own folder
      const dir = r.dimension && r.dimension !== 'overworld' ? `chunks/${r.dimension}` : 'chunks';
      files[`${dir}/${r.cx}.${r.cz}.bin`] = r.blocks;
      if (r.biomes) files[`${dir}/${r.cx}.${r.cz}.biomes`] = r.biomes;
      if (r.entities) files[`${dir}/${r.cx}.${r.cz}.entities.json`] = new TextEncoder().encode(r.entities);
      if (r.mobs) files[`${dir}/${r.cx}.${r.cz}.mobs.json`] = new TextEncoder().encode(r.mobs);
    }
    const zip = zipSync(files, { level: 0 });
    return new Blob([zip as unknown as BlobPart], { type: 'application/zip' });
  }

  async importWorld(data: ArrayBuffer): Promise<WorldMeta> {
    const files = unzipSync(new Uint8Array(data));
    const levelRaw = files['level.json'];
    if (!levelRaw) throw new Error('not a Voxelcraft world: level.json missing');
    const meta = JSON.parse(new TextDecoder().decode(levelRaw)) as WorldMeta;
    meta.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    meta.lastPlayed = Date.now();
    await this.saveWorld(meta);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('chunks', 'readwrite');
      const s = t.objectStore('chunks');
      for (const [name, bytes] of Object.entries(files)) {
        const m = /^chunks\/(?:([a-z_]+)\/)?(-?\d+)\.(-?\d+)\.bin$/.exec(name);
        if (!m) continue;
        const dimension = m[1] ?? 'overworld';
        const cx = Number(m[2]);
        const cz = Number(m[3]);
        const dir = dimension === 'overworld' ? 'chunks' : `chunks/${dimension}`;
        const biomes = files[`${dir}/${cx}.${cz}.biomes`] ?? null;
        const ent = files[`${dir}/${cx}.${cz}.entities.json`];
        const mobs = files[`${dir}/${cx}.${cz}.mobs.json`];
        s.put({
          key: chunkRecordKey(meta.id, cx, cz, dimension), world: meta.id, cx, cz, blocks: bytes, biomes,
          ...(dimension === 'overworld' ? {} : { dimension }),
          entities: ent ? new TextDecoder().decode(ent) : null, mobs: mobs ? new TextDecoder().decode(mobs) : null,
        } satisfies ChunkRecord);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    return meta;
  }
}

export interface Options {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  guiScale: number;
  gamma: number;
  volume: number;
  /** Terrain generation worker count; unset = cores minus two (1..4), 0 = generate in the world worker. */
  genWorkers?: number;
  /** Key binding overrides by action (see `DEFAULT_BINDINGS`); missing actions use the defaults. */
  bindings?: Partial<Record<string, string>>;
}

export const DEFAULT_OPTIONS: Options = { renderDistance: 8, fov: 70, sensitivity: 1, guiScale: 3, gamma: 0.5, volume: 1 };

export function loadOptions(): Options {
  try {
    const raw = localStorage.getItem('voxelcraft.options');
    if (raw) return { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<Options>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_OPTIONS };
}

export function saveOptions(o: Options): void {
  try {
    localStorage.setItem('voxelcraft.options', JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
