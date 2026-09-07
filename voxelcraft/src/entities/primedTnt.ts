/** Primed TNT: a block that has been lit and is falling, hissing, towards its explosion. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { collisionBoxes } from '../blocks/collision.ts';

/** Vanilla lights TNT with an 80-tick fuse and gives it a small upward hop. */
export const TNT_FUSE = 80;

export class PrimedTnt {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  fuse = TNT_FUSE;
  dead = false;

  constructor(x: number, y: number, z: number, readonly mesh: THREE.Mesh, random: () => number = Math.random) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    // vanilla throws it up a little, in a random direction
    const angle = random() * Math.PI * 2;
    this.vel.set(-Math.sin(angle) * 0.02, 0.2, -Math.cos(angle) * 0.02);
    mesh.position.set(x, y, z);
  }

  tick(world: BlockSource): void {
    this.prev.copy(this.pos);
    this.vel.y -= 0.04;
    let ny = this.pos.y + this.vel.y;
    const bx = Math.floor(this.pos.x + this.vel.x);
    const bz = Math.floor(this.pos.z + this.vel.z);
    const floorY = Math.floor(ny);
    const below = world.getBlock(bx, floorY, bz);
    if (below !== 0 && collisionBoxes(below).length > 0 && ny < floorY + 1) {
      ny = floorY + 1;
      this.vel.y = 0;
      // friction on the ground, so it settles where it lands
      this.vel.x *= 0.7;
      this.vel.z *= 0.7;
    }
    this.pos.set(this.pos.x + this.vel.x, ny, this.pos.z + this.vel.z);
    this.vel.multiplyScalar(0.98);
    if (--this.fuse <= 0) this.dead = true;
  }

  updateMesh(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
    // the block flashes white as the fuse runs down; the renderer reads this from the mesh scale
    const flash = this.fuse % 10 < 5 ? 1.04 : 1;
    this.mesh.scale.setScalar(flash);
  }
}
