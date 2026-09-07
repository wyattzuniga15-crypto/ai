/**
 * A firework rocket in flight. Vanilla's `FireworkRocketEntity`: it leaves the hand rising slowly,
 * speeds up as it climbs, and goes off after a life drawn from the number of gunpowder that went
 * into it — ten ticks a charge, plus a little.
 */
import * as THREE from 'three';
import type { FireworkExplosion } from '../items/inventory.ts';

export class Firework {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  age = 0;
  dead = false;
  readonly sprite: THREE.Sprite;

  constructor(
    texture: THREE.Texture,
    x: number, y: number, z: number,
    /** How long it flies before it goes off, in ticks. */
    readonly lifetime: number,
    readonly explosions: FireworkExplosion[],
    /** The way it was pointed when it was let go, which a rocket shot at an angle follows. */
    aim: THREE.Vector3 | null = null,
    random: () => number = Math.random,
  ) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    // vanilla starts it barely moving and lets the climb build up
    if (aim) this.vel.copy(aim).normalize().multiplyScalar(0.25);
    else this.vel.set((random() - 0.5) * 0.0046, 0.05, (random() - 0.5) * 0.0046);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1 }));
    this.sprite.scale.setScalar(0.35);
    this.sprite.position.copy(this.pos);
  }

  /** One tick. Returns true when it has gone off and should be taken away. */
  tick(): boolean {
    this.prev.copy(this.pos);
    // vanilla speeds the rocket up sideways and adds a flat forty thousandths to its climb a tick
    this.vel.x *= 1.15;
    this.vel.z *= 1.15;
    this.vel.y += 0.04;
    this.pos.add(this.vel);
    if (++this.age < this.lifetime) return false;
    this.dead = true;
    return true;
  }

  render(alpha: number): void {
    this.sprite.position.lerpVectors(this.prev, this.pos, alpha);
  }
}

/** Vanilla's own life for a rocket: ten ticks a charge, and two small rolls on top. */
export function fireworkLifetime(flight: number, random: () => number = Math.random): number {
  return 10 * (1 + flight) + Math.floor(random() * 6) + Math.floor(random() * 7);
}
