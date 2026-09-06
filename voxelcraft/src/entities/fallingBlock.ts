/** Sand, gravel, concrete powder and anvils falling as entities until they land. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { blocks } from '../blocks/registry.ts';
import { collisionBoxes } from '../blocks/collision.ts';

export class FallingBlockEntity {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  vy = 0;
  dead = false;
  /** Set when the block landed: where it should be placed (or null when it broke). */
  landed: { x: number; y: number; z: number } | null = null;
  age = 0;

  constructor(readonly state: number, x: number, y: number, z: number, readonly mesh: THREE.Mesh) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    mesh.position.set(x, y, z);
  }

  tick(world: BlockSource): void {
    this.prev.copy(this.pos);
    this.age++;
    this.vy -= 0.04;
    this.vy *= 0.98;
    let ny = this.pos.y + this.vy;
    const bx = Math.floor(this.pos.x);
    const bz = Math.floor(this.pos.z);
    // land on the first block with collision below
    const floorY = Math.floor(ny);
    const below = world.getBlock(bx, floorY, bz);
    if (below !== 0 && collisionBoxes(below).length > 0 && ny < floorY + 1) {
      ny = floorY + 1;
      this.landed = { x: bx, y: floorY + 1, z: bz };
      this.dead = true;
    } else if (ny < -70) {
      this.dead = true;
    }
    this.pos.y = ny;
    if (this.age > 600) this.dead = true;
  }

  updateMesh(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
  }
}

export function isFallingBlock(state: number): boolean {
  return blocks.blockOf(state).behavior === 'falling';
}
