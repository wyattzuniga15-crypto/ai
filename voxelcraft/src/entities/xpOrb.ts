/** Experience orbs: drift toward the player and add XP on pickup. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { sweep, type AABB } from './physics.ts';
import { entityTexture } from './boxModel.ts';

/** Vanilla split of an XP amount into orb values. */
export function splitXp(total: number): number[] {
  const sizes = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  const out: number[] = [];
  let left = Math.max(0, Math.floor(total));
  while (left > 0) {
    const v = sizes.find((s) => s <= left) ?? 1;
    out.push(v);
    left -= v;
  }
  return out;
}

export class XpOrb {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = 0;
  dead = false;
  readonly sprite: THREE.Sprite;

  constructor(base: string, readonly value: number, x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    const tex = entityTexture(base, 'experience_orb.png').clone();
    tex.repeat.set(0.25, 0.25);
    tex.offset.set(0, 0.75);
    tex.needsUpdate = true;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1, color: 0xffffff }));
    this.sprite.scale.setScalar(0.35);
    this.vel.set((Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2);
  }

  aabb(): AABB {
    return { minX: this.pos.x - 0.125, minY: this.pos.y, minZ: this.pos.z - 0.125, maxX: this.pos.x + 0.125, maxY: this.pos.y + 0.25, maxZ: this.pos.z + 0.125 };
  }

  /** Returns the XP value when picked up this tick, else 0. */
  tick(world: BlockSource, player: THREE.Vector3 | null): number {
    this.prev.copy(this.pos);
    this.age++;
    if (this.age > 6000) {
      this.dead = true;
      return 0;
    }
    this.vel.y -= 0.03;
    if (player) {
      const dx = player.x - this.pos.x;
      const dy = player.y + 0.9 - this.pos.y;
      const dz = player.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 8) {
        const f = (1 - d / 8) * 0.1;
        this.vel.x += (dx / d) * f;
        this.vel.y += (dy / d) * f;
        this.vel.z += (dz / d) * f;
      }
      if (d < 1.2 && this.age > 2) {
        this.dead = true;
        return this.value;
      }
    }
    const box = this.aabb();
    const r = sweep(world, box, this.vel.x, this.vel.y, this.vel.z, 0);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    if (r.hitY) this.vel.y *= -0.3;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    const friction = r.onGround ? 0.6 * 0.98 : 0.98;
    this.vel.x *= friction;
    this.vel.z *= friction;
    return 0;
  }

  render(alpha: number, time: number): void {
    this.sprite.position.copy(this.prev).lerp(this.pos, alpha);
    this.sprite.position.y += 0.15;
    const hue = (time * 0.5 + this.age * 0.02) % 1;
    (this.sprite.material as THREE.SpriteMaterial).color.setHSL(0.2 + Math.sin(hue * Math.PI * 2) * 0.1, 1, 0.6);
  }
}
