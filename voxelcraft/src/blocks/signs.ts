/** Sign block entities and their in-world text/board rendering. */
import * as THREE from 'three';
import { blocks } from './registry.ts';
import { buildModel, type BuiltModel } from '../entities/boxModel.ts';

import type { SignEntity } from './blockEntity.ts';
export type { SignEntity };

export const SIGN_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped', 'pale_oak'];

export function isSignBlock(id: string): boolean {
  return id.endsWith('_sign') && !id.includes('hanging');
}

export function signWood(id: string): string {
  return id.replace(/_wall_sign$|_sign$/, '');
}

export function createSignEntity(): SignEntity {
  return { type: 'sign', lines: ['', '', '', ''] };
}

/** Standing and wall sign meshes with a canvas text plane. */
export class SignRenderer {
  private readonly meshes = new Map<string, { group: THREE.Group; text: THREE.Mesh; lines: string; built: BuiltModel }>();

  constructor(private readonly scene: THREE.Scene, private readonly base: string) {}

  /** Creates/updates the mesh for a sign; call when a sign entity changes. */
  update(x: number, y: number, z: number, state: number, entity: SignEntity): void {
    const key = `${x},${y},${z}`;
    const def = blocks.blockOf(state);
    const wood = signWood(def.id);
    const wall = def.id.endsWith('_wall_sign');
    const lines = [...entity.lines, '|', ...(entity.backLines ?? [])].join('\n');
    let m = this.meshes.get(key);
    if (m && m.lines === lines) return;
    if (m) this.remove(x, y, z);
    const built = buildModel({
      texture: `signs/${wood}.png`,
      texW: 64,
      texH: 32,
      parts: [
        { name: 'board', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-12, -14, -1, 24, 12, 2] }] },
        ...(wall ? [] : [{ name: 'stick', pivot: [0, 0, 0] as [number, number, number], boxes: [{ uv: [0, 14] as [number, number], box: [-1, -2, -1, 2, 14, 2] as [number, number, number, number, number, number] }] }]),
      ],
    }, this.base);
    const group = new THREE.Group();
    // The box builder scales MC pixels by 1/16 and raises mobs so their feet sit at MC y=24; signs
    // use the vanilla SignRenderer transform instead: origin at the block centre, scale 2/3.
    (built.group.children[0] as THREE.Group).position.y = 0;
    built.group.scale.setScalar(2 / 3);
    group.add(built.group);
    const text = this.makeText(entity.lines, entity.color ?? 'black');
    const px = (2 / 3) / 16; // one model pixel in blocks
    if (wall) {
      const facing = blocks.prop(state, 'facing') ?? 'north';
      const dir: Record<string, [number, number, number]> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
      const [dx, , dz] = dir[facing];
      const yaw = facing === 'north' ? 0 : facing === 'south' ? Math.PI : facing === 'west' ? Math.PI / 2 : -Math.PI / 2;
      // vanilla: translate(0.5, 0.5, 0.5), rotate, translate(0, -0.3125, -0.4375)
      group.position.set(x + 0.5 - dx * 0.4375, y + 0.5 - 0.3125, z + 0.5 - dz * 0.4375);
      group.rotation.y = yaw;
    } else {
      const rot = Number(blocks.prop(state, 'rotation') ?? 0);
      group.position.set(x + 0.5, y + 0.5, z + 0.5);
      group.rotation.y = -(rot * Math.PI) / 8 + Math.PI;
    }
    // board spans MC y -14..-2 (8 px above the origin at its centre) and z -1..1
    text.position.set(0, 8 * px, -px - 0.005);
    text.rotation.y = Math.PI;
    group.add(text);
    if (!wall && entity.backLines?.some((l) => l)) {
      // built fresh rather than cloned: cloning the rotated front plane keeps its quaternion
      const back = this.makeText(entity.backLines, entity.color ?? 'black');
      back.position.set(0, 8 * px, px + 0.005);
      group.add(back);
    }
    this.scene.add(group);
    this.meshes.set(key, { group, text, lines, built });
  }

  private makeText(lines: string[], color: string): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 96;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, 192, 96);
    g.fillStyle = color === 'black' ? '#000' : color;
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.slice(0, 4).forEach((l, i) => g.fillText(l.slice(0, 15), 96, 14 + i * 20));
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), mat);
    return mesh;
  }

  remove(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    const m = this.meshes.get(key);
    if (!m) return;
    this.scene.remove(m.group);
    this.meshes.delete(key);
  }

  has(x: number, y: number, z: number): boolean {
    return this.meshes.has(`${x},${y},${z}`);
  }

  clear(): void {
    for (const m of this.meshes.values()) this.scene.remove(m.group);
    this.meshes.clear();
  }

  /** Removes meshes for signs that no longer exist. */
  prune(keep: Set<string>): void {
    for (const [key, m] of this.meshes) {
      if (keep.has(key)) continue;
      this.scene.remove(m.group);
      this.meshes.delete(key);
    }
  }
}
