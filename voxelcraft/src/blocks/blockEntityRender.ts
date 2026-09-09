/**
 * Blocks vanilla draws with a block entity renderer rather than a block model: beds, banners,
 * shulker boxes, skulls and the conduit. Their block models are empty, so without this they are
 * invisible. The geometry is vanilla's own, from the model layers in `ModelLayers`, and each kind
 * carries the transform vanilla's renderer applies to it.
 */
import * as THREE from 'three';
import { blocks } from './registry.ts';
import { buildModel, type ModelDef } from '../entities/boxModel.ts';
import { DYE_COLORS } from '../ui/specialIcons.ts';
import type { BannerLayer } from '../items/banners.ts';
import { statueModel } from './copperStatue.ts';

/** Yaw for a model built facing north, which is the way the box-model net puts a front on -z. */
const FACING_YAW: Record<string, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

export interface PlacedModel {
  model: ModelDef;
  /** Parts drawn with this texture take the colour, which is how a banner gets its dye. */
  tint?: { texture: string; color: number };
  /** Several tinted textures at once: the layers woven onto a banner. */
  tints?: { texture: string; color: number }[];
  yaw: number;
  offset: [number, number, number];
  scale: number;
}

const COLORS = Object.keys(DYE_COLORS);

/** `red_bed` → `red`, for the coloured families. */
function colorOf(id: string, suffix: string): string | null {
  if (!id.endsWith(`_${suffix}`)) return id === suffix ? '' : null;
  const c = id.slice(0, -(suffix.length + 1));
  return COLORS.includes(c) ? c : null;
}

/** Vanilla's bed: two flat pieces on four legs, drawn once from the head end. */
function bedModel(color: string): ModelDef {
  const leg = (name: string, x: number, z: number, uv: [number, number]) => ({
    name, pivot: [0, 0, 0] as [number, number, number],
    boxes: [{ uv, box: [x, 21, z, 3, 3, 3] as [number, number, number, number, number, number] }],
  });
  return {
    texture: `bed/${color}.png`, texW: 64, texH: 64,
    parts: [
      { name: 'head', pivot: [0, 21, -8], rotation: [-Math.PI / 2, 0, 0], boxes: [{ uv: [0, 0], box: [-8, 0, -6, 16, 16, 6] }] },
      { name: 'foot', pivot: [0, 21, 8], rotation: [-Math.PI / 2, 0, 0], boxes: [{ uv: [0, 22], box: [-8, 0, -6, 16, 16, 6] }] },
      leg('leg1', -8, -8, [50, 0]), leg('leg2', 5, -8, [50, 6]), leg('leg3', -8, 5, [50, 12]), leg('leg4', 5, 5, [50, 18]),
    ],
  };
}

/** The shulker box: a base and the lid that sits on it, in the colour of the box. */
function shulkerModel(color: string): ModelDef {
  return {
    texture: `shulker/shulker${color ? `_${color}` : ''}.png`, texW: 64, texH: 64,
    parts: [
      { name: 'lid', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-8, 8, -8, 16, 12, 16] }] },
      { name: 'base', pivot: [0, 0, 0], boxes: [{ uv: [0, 28], box: [-8, 16, -8, 16, 8, 16] }] },
    ],
  };
}

/** A banner: the cloth, its pole and the bar it hangs from. A wall banner keeps only the cloth. */
function bannerModel(onWall: boolean, layers: BannerLayer[]): ModelDef {
  const flag = (texture: string, i: number): ModelDef['parts'][number] => ({
    name: `flag${i}`, pivot: [0, -32, 0], texture,
    boxes: [{ uv: [0, 0], box: [-10, 0, -2 - i * 0.06, 20, 40, 1] }],
  });
  const parts: ModelDef['parts'] = [flag('banner/base.png', 0)];
  // each woven pattern is its own piece of cloth, a hair in front of the last
  layers.forEach((l, i) => parts.push(flag(`banner/${l.pattern}.png`, i + 1)));
  parts.push({ name: 'bar', pivot: [0, 0, 0], boxes: [{ uv: [0, 42], box: [-10, -32, -1, 20, 2, 2] }] });
  if (!onWall) parts.push({ name: 'pole', pivot: [0, 0, 0], boxes: [{ uv: [44, 0], box: [-1, -30, -1, 2, 42, 2] }] });
  return { texture: 'banner_base.png', texW: 64, texH: 64, parts };
}

/** Skulls and heads, with the wide dragon and piglin faces vanilla gives their own boxes. */
const HEADS: Record<string, { texture: string; texH: number; hat?: boolean }> = {
  skeleton: { texture: 'skeleton/skeleton.png', texH: 32 },
  wither_skeleton: { texture: 'skeleton/wither_skeleton.png', texH: 32 },
  zombie: { texture: 'zombie/zombie.png', texH: 64 },
  creeper: { texture: 'creeper/creeper.png', texH: 32 },
  player: { texture: 'player/wide/steve.png', texH: 64, hat: true },
  piglin: { texture: 'piglin/piglin.png', texH: 64 },
};

function headModel(kind: string): ModelDef | null {
  const head = HEADS[kind];
  if (!head) return null;
  const boxes: ModelDef['parts'][number]['boxes'] = [{ uv: [0, 0], box: [-4, 0, -4, 8, 8, 8] }];
  if (head.hat) boxes.push({ uv: [32, 0], box: [-4, 0, -4, 8, 8, 8], inflate: 0.25 });
  return { texture: head.texture, texW: 64, texH: head.texH, parts: [{ name: 'head', pivot: [0, 16, 0], boxes }] };
}

/**
 * The model and transform for a block vanilla draws itself, or null when the block is drawn the
 * ordinary way. Beds are drawn once, from the head end, since one model covers both halves.
 */
export function placedModel(state: number, layers: BannerLayer[] = []): PlacedModel | null {
  if (state === 0) return null;
  const def = blocks.blockOf(state);
  const id = def.id;
  const facing = blocks.prop(state, 'facing') ?? 'north';
  const rotation = Number(blocks.prop(state, 'rotation') ?? '0');

  const bed = colorOf(id, 'bed');
  if (bed) {
    // the head half carries the whole bed; the foot draws nothing
    if (blocks.prop(state, 'part') !== 'head') return null;
    return { model: bedModel(bed), yaw: FACING_YAW[facing] ?? 0, offset: [0, 0, 1], scale: 1 };
  }

  const shulker = colorOf(id, 'shulker_box');
  if (shulker !== null) {
    // vanilla turns the box so its lid opens the way it faces
    const yaw = FACING_YAW[facing] ?? 0;
    const pitch = facing === 'up' ? 0 : facing === 'down' ? Math.PI : Math.PI / 2;
    return { model: shulkerModel(shulker), yaw, offset: [0, 0, 0], scale: 1, pitch } as PlacedModel & { pitch: number };
  }

  const banner = colorOf(id, 'banner') ?? colorOf(id, 'wall_banner');
  if (banner) {
    const onWall = id.endsWith('_wall_banner');
    // vanilla draws banners at two thirds scale, the standing one turned by its sixteenth
    const yaw = onWall ? (FACING_YAW[facing] ?? 0) + Math.PI : Math.PI - (rotation * Math.PI) / 8;
    // vanilla hangs a wall banner about a block lower than a standing one and back against the wall
    const offset: [number, number, number] = onWall ? [0, -1.4792, -0.4375] : [0, -0.5, 0];
    return {
      model: bannerModel(onWall, layers),
      tints: [
        { texture: 'banner/base.png', color: DYE_COLORS[banner] ?? 0xffffff },
        ...layers.map((l) => ({ texture: `banner/${l.pattern}.png`, color: DYE_COLORS[l.color] ?? 0xffffff })),
      ],
      yaw, offset, scale: 2 / 3,
    };
  }

  const skull = id.replace(/_wall_head$|_wall_skull$|_head$|_skull$/, '');
  if (id.endsWith('_head') || id.endsWith('_skull')) {
    const model = headModel(skull);
    if (!model) return null;
    const onWall = id.includes('_wall_');
    const yaw = onWall ? (FACING_YAW[facing] ?? 0) + Math.PI : Math.PI - (rotation * Math.PI) / 8;
    const offset: [number, number, number] = onWall
      ? [(FACING_STEP[facing]?.[0] ?? 0) * -0.25, 0.25, (FACING_STEP[facing]?.[1] ?? 0) * -0.25]
      : [0, 0, 0];
    return { model, yaw, offset, scale: 1 };
  }

  if (id.endsWith('copper_golem_statue')) {
    const model = statueModel(id, blocks.prop(state, 'copper_golem_pose') ?? 'standing');
    // the statue stands on the floor of its block and, like the golem, wears its rod above it
    return model ? { model, yaw: FACING_YAW[facing] ?? 0, offset: [0, 0, 0], scale: 1 } : null;
  }

  if (id === 'conduit') {
    return {
      model: { texture: 'conduit/base.png', texW: 32, texH: 16, parts: [{ name: 'shell', pivot: [0, 16, 0], boxes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6] }] }] },
      yaw: 0, offset: [0, 0, 0], scale: 1,
    };
  }
  return null;
}

const FACING_STEP: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/** The blocks this renderer draws, as a lookup over every state. */
export const drawnStates: Uint8Array = (() => {
  const table = new Uint8Array(blocks.maxState + 1);
  for (const def of blocks.defs) {
    const drawn = colorOf(def.id, 'bed') !== null || colorOf(def.id, 'shulker_box') !== null
      || colorOf(def.id, 'banner') !== null || colorOf(def.id, 'wall_banner') !== null
      || def.id.endsWith('_head') || def.id.endsWith('_skull') || def.id === 'conduit'
      || def.id.endsWith('copper_golem_statue');
    if (!drawn) continue;
    for (let s = def.min; s <= def.max; s++) table[s] = 1;
  }
  return table;
})();

/** Meshes for the block entities in the loaded world, kept in step by the game. */
export class BlockEntityRenderer {
  private readonly meshes = new Map<string, { group: THREE.Group; key: string; spin: boolean }>();

  constructor(private readonly scene: THREE.Scene, private readonly base: string) {}

  update(x: number, y: number, z: number, state: number, layers: BannerLayer[] = []): void {
    const placed = placedModel(state, layers);
    const at = `${x},${y},${z}`;
    const existing = this.meshes.get(at);
    if (!placed) {
      if (existing) this.remove(x, y, z);
      return;
    }
    const key = `${state}|${layers.map((l) => `${l.pattern}/${l.color}`).join(',')}`;
    if (existing && existing.key === key) return;
    if (existing) this.remove(x, y, z);
    const built = buildModel(placed.model, this.base);
    if (placed.tint) {
      const material = built.layers.get(placed.tint.texture);
      if (material) material.color.setHex(placed.tint.color);
    }
    for (const t of placed.tints ?? []) {
      const material = built.layers.get(t.texture);
      if (material) material.color.setHex(t.color);
    }
    const group = new THREE.Group();
    built.group.scale.setScalar(placed.scale);
    group.add(built.group);
    built.group.position.set(placed.offset[0], placed.offset[1], placed.offset[2]);
    group.position.set(x + 0.5, y, z + 0.5);
    group.rotation.y = placed.yaw;
    const pitch = (placed as PlacedModel & { pitch?: number }).pitch;
    if (pitch) built.group.rotation.x = pitch;
    this.scene.add(group);
    this.meshes.set(at, { group, key, spin: blocks.blockOf(state).id === 'conduit' });
  }

  /** The conduit turns on the spot, which is the only animation any of these have. */
  animate(time: number): void {
    for (const m of this.meshes.values()) if (m.spin) m.group.rotation.y = time * 0.03;
  }

  remove(x: number, y: number, z: number): void {
    const at = `${x},${y},${z}`;
    const m = this.meshes.get(at);
    if (!m) return;
    this.scene.remove(m.group);
    m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.meshes.delete(at);
  }

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

/**
 * Beacon beams. Vanilla draws a bright inner column and a softer outer one all the way to the sky,
 * tinted by the stained glass the light passes through.
 */
export class BeaconBeamRenderer {
  private readonly beams = new Map<string, { group: THREE.Group; key: string }>();
  private texture: THREE.Texture | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly base: string) {}

  /** Shows or hides the beam over a beacon; `color` is the dye the glass above it gives. */
  update(x: number, y: number, z: number, on: boolean, color: number): void {
    const at = `${x},${y},${z}`;
    const existing = this.beams.get(at);
    const key = `${on}:${color.toString(16)}`;
    if (existing && existing.key === key) return;
    if (existing) this.remove(x, y, z);
    if (!on) return;
    if (!this.texture) {
      this.texture = new THREE.TextureLoader().load(`${this.base}textures/entity/beacon_beam.png`);
      this.texture.wrapS = THREE.RepeatWrapping;
      this.texture.wrapT = THREE.RepeatWrapping;
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.colorSpace = THREE.NoColorSpace;
      this.texture.repeat.set(1, 64);
    }
    const group = new THREE.Group();
    const height = 128;
    const beam = (width: number, opacity: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, width),
        new THREE.MeshBasicMaterial({ map: this.texture, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.position.y = height / 2;
      mesh.renderOrder = 5;
      return mesh;
    };
    group.add(beam(0.2, 0.9), beam(0.35, 0.28));
    group.position.set(x + 0.5, y + 1, z + 0.5);
    this.scene.add(group);
    this.beams.set(at, { group, key });
  }

  /** The beam's texture slides upward, which is what makes it look like it is pouring out. */
  animate(time: number): void {
    if (this.texture) this.texture.offset.y = -time * 0.02;
  }

  remove(x: number, y: number, z: number): void {
    const at = `${x},${y},${z}`;
    const m = this.beams.get(at);
    if (!m) return;
    this.scene.remove(m.group);
    m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.beams.delete(at);
  }

  prune(seen: Set<string>): void {
    for (const key of [...this.beams.keys()]) {
      if (seen.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      this.remove(x, y, z);
    }
  }

  get count(): number {
    return this.beams.size;
  }
}
