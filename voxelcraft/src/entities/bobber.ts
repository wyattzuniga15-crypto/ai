/**
 * The fishing bobber. Vanilla's `FishingHook` is thrown from the rod, falls until it meets water,
 * floats there while a fish is lured, and dips when one bites; reeling in during the dip is the
 * catch. The timings below are vanilla's: a wait of 100 to 600 ticks, cut by 100 a level of Lure,
 * and a bite that lasts between one and two seconds.
 */
import * as THREE from 'three';
import { blocks } from '../blocks/registry.ts';
import { entityTexture } from './boxModel.ts';

export interface BobberWorld {
  getBlock(x: number, y: number, z: number): number;
}

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);
const isWater = (state: number): boolean => idOf(state) === 'water';
const isAirish = (state: number): boolean => state === 0 || !blocks.blockOf(state).solid;

export class FishingBobber {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** True once it has landed in water and can start fishing. */
  inWater = false;
  /** True when it has come to rest on the ground, where nothing will ever bite. */
  stuck = false;
  /** Ticks until a fish comes; counted down only while floating. */
  wait = 0;
  /** Ticks left of the bite, during which reeling in catches something. */
  nibble = 0;
  dead = false;
  age = 0;

  constructor(x: number, y: number, z: number, dir: THREE.Vector3, readonly lure: number, readonly mesh: THREE.Object3D, private readonly random: () => number = Math.random) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    this.vel.copy(dir).normalize().multiplyScalar(1.5);
    mesh.position.copy(this.pos);
  }

  /** Vanilla's wait: a hundred to six hundred ticks, a hundred less for each level of Lure. */
  private resetWait(): void {
    this.wait = Math.max(20, 100 + Math.floor(this.random() * 500) - this.lure * 100);
    this.nibble = 0;
  }

  tick(w: BobberWorld): void {
    this.prev.copy(this.pos);
    this.age++;
    if (this.stuck) return;
    if (!this.inWater) {
      // in the air it falls the way vanilla throws it, slowing as it goes
      this.vel.y -= 0.03;
      this.vel.multiplyScalar(0.92);
      this.pos.add(this.vel);
      const here = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
      if (isWater(here)) {
        // it settles at the surface of whatever it landed in
        let surface = Math.floor(this.pos.y);
        while (isWater(w.getBlock(Math.floor(this.pos.x), surface + 1, Math.floor(this.pos.z)))) surface++;
        this.pos.y = surface + 0.9;
        this.vel.set(0, 0, 0);
        this.inWater = true;
        this.resetWait();
        return;
      }
      if (!isAirish(here)) {
        this.pos.copy(this.prev);
        this.vel.set(0, 0, 0);
        this.stuck = true;
      }
      return;
    }
    // floating: it bobs on the water while the fish takes its time
    if (this.nibble > 0) {
      this.nibble--;
      this.pos.y -= 0.02;
      if (this.nibble === 0) this.resetWait();
      return;
    }
    this.pos.y += Math.sin(this.age * 0.15) * 0.002;
    if (--this.wait <= 0) this.nibble = 20 + Math.floor(this.random() * 20);
  }

  /** True while a fish has hold of the line, which is the moment reeling in catches it. */
  get biting(): boolean {
    return this.nibble > 0;
  }

  /**
   * Vanilla's open-water test: the five-by-five of columns around the bobber has to be nothing but
   * water at its level, with air above and water below, or the treasure pool is out.
   */
  openWater(w: BobberWorld): boolean {
    const bx = Math.floor(this.pos.x);
    const by = Math.floor(this.pos.y);
    const bz = Math.floor(this.pos.z);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (!isWater(w.getBlock(bx + dx, by - 1, bz + dz))) return false;
        const at = w.getBlock(bx + dx, by, bz + dz);
        if (!isWater(at) && at !== 0) return false;
        if (!isAirish(w.getBlock(bx + dx, by + 1, bz + dz))) return false;
      }
    }
    return true;
  }

  updateMesh(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
  }
}

/** The bobber itself: vanilla draws it as a flat sprite that always faces the player. */
export function bobberMesh(base: string): THREE.Object3D {
  const map = entityTexture(base, 'fishing_hook.png');
  const material = new THREE.SpriteMaterial({ map, transparent: true, alphaTest: 0.1 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.25);
  return sprite;
}
