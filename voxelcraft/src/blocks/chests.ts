/**
 * Chests. Vanilla draws them with a block entity renderer rather than a block model — the block's
 * own model is empty — so this builds the same three boxes (bottom, lid and the lock on the front)
 * from `ChestModel`, on the chest textures, and opens the lid while someone is looking inside.
 */
import * as THREE from 'three';
import { blocks } from './registry.ts';
import { boxGeometry, entityTexture, type BoxDef } from '../entities/boxModel.ts';

/** Every block drawn this way, single or double. */
export function isChestBlock(id: string): boolean {
  return id.endsWith('_chest') || id === 'chest';
}

/** The model is built facing north, the way the box net puts a front on -z. */
const YAW: Record<string, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

/** 1 for every state that is drawn as a chest, so a chunk can be swept for them quickly. */
export const chestStates: Uint8Array = (() => {
  const table = new Uint8Array(blocks.maxState + 1);
  for (const def of blocks.defs) {
    if (!isChestBlock(def.id)) continue;
    for (let s = def.min; s <= def.max; s++) table[s] = 1;
  }
  return table;
})();

/** Vanilla shows the wrapped chests over Christmas; the date is the only thing that decides it. */
function christmas(now = new Date()): boolean {
  return now.getMonth() === 11 && now.getDate() >= 24 && now.getDate() <= 26;
}

/** The texture a chest wears, following vanilla's `ChestRenderer` material lists. */
export function chestTexture(id: string, type: string, now = new Date()): string {
  const half = type === 'left' ? '_left' : type === 'right' ? '_right' : '';
  if (id === 'ender_chest') return 'chest/ender.png';
  if (id === 'trapped_chest') return `chest/trapped${half}.png`;
  if (id.endsWith('copper_chest')) {
    const age = id.includes('oxidized') ? '_oxidized' : id.includes('weathered') ? '_weathered' : id.includes('exposed') ? '_exposed' : '';
    return `chest/copper${age}${half}.png`;
  }
  return christmas(now) ? `chest/christmas${half}.png` : `chest/normal${half}.png`;
}

/**
 * The three boxes, as vanilla's `ChestModel` gives them: the builder mirrors x and y, which turns
 * the model half a turn and lands it the right way up with its front on -z. A single chest is
 * fourteen wide; the halves of a double chest are fifteen and meet in the middle, each carrying
 * half of the lock.
 */
function boxesFor(type: string): { bottom: BoxDef; lid: BoxDef; lock: BoxDef } {
  if (type === 'left') {
    return {
      bottom: { uv: [0, 19], box: [1, -10, 1, 15, 10, 14] },
      lid: { uv: [0, 0], box: [1, -14, 1, 15, 5, 14] },
      lock: { uv: [0, 0], box: [15, -11, 0, 1, 4, 1] },
    };
  }
  if (type === 'right') {
    return {
      bottom: { uv: [0, 19], box: [0, -10, 1, 15, 10, 14] },
      lid: { uv: [0, 0], box: [0, -14, 1, 15, 5, 14] },
      lock: { uv: [0, 0], box: [0, -11, 0, 1, 4, 1] },
    };
  }
  return {
    bottom: { uv: [0, 19], box: [1, -10, 1, 14, 10, 14] },
    lid: { uv: [0, 0], box: [1, -14, 1, 14, 5, 14] },
    lock: { uv: [0, 0], box: [7, -11, 0, 2, 4, 1] },
  };
}

/**
 * The three boxes as one group: the body from the block's corner, the lid and its lock turning
 * together on the hinge that runs along the back edge.
 */
export function buildChest(material: THREE.Material, type = 'single'): { group: THREE.Group; lid: THREE.Group } {
  const boxes = boxesFor(type);
  const group = new THREE.Group();
  // the model is drawn in Minecraft's sixteenths, laid over the block from its corner
  const body = new THREE.Group();
  body.position.set(0.5, 0, -0.5);
  body.scale.setScalar(1 / 16);
  body.add(new THREE.Mesh(boxGeometry(boxes.bottom, 64, 64), material));
  const lid = new THREE.Group();
  lid.position.set(0, 9, 15);
  const lidMesh = new THREE.Mesh(boxGeometry(boxes.lid, 64, 64), material);
  lidMesh.position.set(0, -9, -15);
  const lockMesh = new THREE.Mesh(boxGeometry(boxes.lock, 64, 64), material);
  lockMesh.position.set(0, -9, -15);
  lid.add(lidMesh, lockMesh);
  body.add(lid);
  group.add(body);
  return { group, lid };
}

/** A chest to sit in something else, such as the one a chest minecart carries. */
export function chestModel(base: string, id = 'chest'): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ map: entityTexture(base, chestTexture(id, 'single')), transparent: true, alphaTest: 0.1 });
  return buildChest(material).group;
}

interface ChestMesh {
  group: THREE.Group;
  lid: THREE.Group;
  key: string;
  /** How far the lid stands open, 0 to 1, the way vanilla eases it. */
  open: number;
  wanted: number;
}

/** Chest meshes for the loaded world, kept in step with the blocks by the game. */
export class ChestRenderer {
  private readonly meshes = new Map<string, ChestMesh>();
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(private readonly scene: THREE.Scene, private readonly base: string) {}

  private material(texture: string): THREE.MeshBasicMaterial {
    const existing = this.materials.get(texture);
    if (existing) return existing;
    const m = new THREE.MeshBasicMaterial({ map: entityTexture(this.base, texture), transparent: true, alphaTest: 0.1 });
    this.materials.set(texture, m);
    return m;
  }

  /** Builds or refreshes the chest at a position; cheap to call again with the same state. */
  update(x: number, y: number, z: number, state: number): void {
    const def = blocks.blockOf(state);
    const type = blocks.prop(state, 'type') ?? 'single';
    const facing = blocks.prop(state, 'facing') ?? 'north';
    const texture = chestTexture(def.id, type);
    const key = `${texture}|${type}|${facing}`;
    const at = `${x},${y},${z}`;
    const existing = this.meshes.get(at);
    if (existing && existing.key === key) return;
    if (existing) this.remove(x, y, z);

    const { group, lid } = buildChest(this.material(texture), type);
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = YAW[facing] ?? 0;
    this.scene.add(group);
    this.meshes.set(at, { group, lid, key, open: 0, wanted: 0 });
  }

  /** Says which chest is open, so its lid can swing up while someone is looking inside. */
  setOpen(at: string | null): void {
    for (const [key, m] of this.meshes) m.wanted = key === at ? 1 : 0;
  }

  /** Eases every lid toward where it should be, as vanilla does over its ten-tick open. */
  animate(): void {
    for (const m of this.meshes) {
      const mesh = m[1];
      if (mesh.open === mesh.wanted) continue;
      mesh.open += (mesh.wanted - mesh.open) * 0.12; // vanilla takes about half a second
      if (Math.abs(mesh.wanted - mesh.open) < 0.01) mesh.open = mesh.wanted;
      // vanilla eases the angle, and the lid stands 90 degrees short of upright when fully open
      const t = 1 - (1 - mesh.open) * (1 - mesh.open) * (1 - mesh.open);
      mesh.lid.rotation.x = t * Math.PI * 0.5;
    }
  }

  remove(x: number, y: number, z: number): void {
    const at = `${x},${y},${z}`;
    const m = this.meshes.get(at);
    if (!m) return;
    this.scene.remove(m.group);
    m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.meshes.delete(at);
  }

  /** Drops the meshes for chests that are no longer there. */
  prune(seen: Set<string>): void {
    for (const key of [...this.meshes.keys()]) {
      if (seen.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      this.remove(x, y, z);
    }
  }

  get count(): number {
    return this.meshes.size;
  }
}
