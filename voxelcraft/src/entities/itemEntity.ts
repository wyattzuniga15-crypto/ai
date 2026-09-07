/** Dropped item stacks: small bobbing sprites with gravity that the player picks up. */
import * as THREE from 'three';
import type { ItemStack } from '../items/inventory.ts';
import type { BlockSource } from './physics.ts';
import { sweep, type AABB } from './physics.ts';
import { blocks } from '../blocks/registry.ts';

const textureCache = new Map<string, THREE.Texture>();

/**
 * The items vanilla marks fire-immune: everything netherite, and the debris it comes out of. They
 * float in lava rather than burning up, which is what makes a netherite pickaxe worth carrying.
 */
export function fireproofItem(id: string): boolean {
  return id.startsWith('netherite_') || id === 'ancient_debris' || id === 'netherite_upgrade_smithing_template';
}

export class ItemEntity {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = 0;
  pickupDelay = 10;
  /** Ticks left of a throw, during which water does not slow it down. */
  thrown = 0;
  dead = false;
  onGround = false;
  readonly sprite: THREE.Sprite;

  constructor(readonly stack: ItemStack, x: number, y: number, z: number, iconUrl: string, isBlock: boolean) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    let tex = textureCache.get(iconUrl);
    if (!tex) {
      tex = new THREE.TextureLoader().load(iconUrl);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      textureCache.set(iconUrl, tex);
    }
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: true });
    this.sprite = new THREE.Sprite(mat);
    const s = isBlock ? 0.35 : 0.3;
    this.sprite.scale.set(s, s, s);
    this.sprite.position.copy(this.pos);
  }

  aabb(): AABB {
    return { minX: this.pos.x - 0.125, minY: this.pos.y, minZ: this.pos.z - 0.125, maxX: this.pos.x + 0.125, maxY: this.pos.y + 0.25, maxZ: this.pos.z + 0.125 };
  }

  tick(world: BlockSource): void {
    this.prev.copy(this.pos);
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    if (this.age > 6000) this.dead = true;
    const here = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    const hereId = here === 0 ? 'air' : blocks.blockOf(here).id;
    const inWater = hereId === 'water';
    // vanilla burns a dropped item up in lava or fire, and netherite is what survives it
    if ((hereId === 'lava' || hereId === 'fire' || hereId === 'soul_fire') && !fireproofItem(this.stack.id)) {
      this.dead = true;
      return;
    }
    // a thrown item keeps its speed for a moment, which is what carries a catch back to the angler
    if (this.thrown > 0) {
      this.thrown--;
      this.vel.y -= inWater ? 0.02 : 0.04;
    } else if (inWater) {
      this.vel.y += 0.01;
      this.vel.multiplyScalar(0.9);
    } else {
      this.vel.y -= 0.04;
    }
    const box = this.aabb();
    // pop out of solid blocks
    const inside = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    if (inside !== 0 && blocks.stateOpaque[inside]) {
      this.vel.y = 0.1;
    }
    const r = sweep(world, box, this.vel.x, this.vel.y, this.vel.z, 0);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    this.onGround = r.onGround === 1 || (r.hitY && this.vel.y < 0);
    if (r.hitY) this.vel.y = 0;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    const friction = this.onGround ? 0.6 * 0.98 : 0.98;
    this.vel.x *= friction;
    this.vel.z *= friction;
    if (this.onGround) this.vel.y *= -0.5;
  }

  updateSprite(alpha: number, time: number): void {
    this.sprite.position.copy(this.prev).lerp(this.pos, alpha);
    this.sprite.position.y += 0.15 + Math.sin((time + this.age * 0.15) * 2) * 0.05;
  }
}
