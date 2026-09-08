/** Arrow projectiles (skeleton and later player bows). */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { collisionBoxes } from '../blocks/collision.ts';
import { aabbIntersects, type AABB } from './physics.ts';
import { entityTexture } from './boxModel.ts';

/** ThrowableProjectile.getGravity: a snowball drops more slowly than an arrow. */
export const THROWN_GRAVITY = 0.03;

/** The speed vanilla throws a snowball, an egg, a pearl or a wind charge at. */
export const THROW_SPEED = 1.5;

export class Arrow {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  stuck = false;
  /** Told where the arrow stuck, which is how a target block learns it was hit. */
  onHitBlock: ((x: number, y: number, z: number, point: THREE.Vector3) => void) | null = null;
  age = 0;
  removed = false;
  readonly mesh: THREE.Mesh;
  /** True when shot by the player (can hurt mobs, never the player). */
  fromPlayer: boolean;
  /** Status effects left on what it hits: a stray's slowness, a spectral arrow's glow, a tip's potion. */
  effects: { id: string; ticks: number; amplifier?: number }[] = [];
  /** Ticks of fire the arrow sets what it hits alight for (Flame). */
  fire = 0;
  /** Extra knockback from Punch. */
  knockback = 0;
  /** How many more mobs a Piercing bolt goes through before it stops. */
  pierce = 0;
  /** What it has already gone through, so one bolt never hits the same mob twice. */
  readonly pierced: unknown[] = [];
  /** Splash potions burst on anything they touch instead of sticking; a trident comes back. */
  kind: 'arrow' | 'potion' | 'trident' | 'thrown' = 'arrow';
  /** Which thrown item this is, so a snowball can sting a blaze and nothing else. */
  thrownId = '';
  /** Ticks before it bursts of its own accord, or 0 for one that flies until it hits something. */
  life = 0;
  /** An eye of ender goes through the world rather than into it. */
  ghost = false;

  /** The trident that was thrown, handed back when it lands. */
  onLanded: ((pos: THREE.Vector3, hitMob: boolean) => void) | null = null;
  onSplash: ((pos: THREE.Vector3) => void) | null = null;

  constructor(base: string, from: THREE.Vector3, dir: THREE.Vector3, speed: number, readonly damage: number, fromPlayer = false) {
    this.pos.copy(from);
    this.prev.copy(from);
    this.vel.copy(dir).normalize().multiplyScalar(speed);
    this.fromPlayer = fromPlayer;
    const geo = new THREE.BoxGeometry(0.5, 0.08, 0.08);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    // shaft texture is the 16x5 strip at the top-left of arrow.png (32x32)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 16) / 32, 1 - (uv.getY(i) * 5) / 32);
    const mat = new THREE.MeshBasicMaterial({ map: entityTexture(base, 'projectiles/arrow.png'), transparent: true, alphaTest: 0.1 });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  tick(world: BlockSource, playerBox: AABB | null, hurtPlayer: (amount: number, from: THREE.Vector3) => void, hitMob?: (box: AABB) => boolean): void {
    this.prev.copy(this.pos);
    this.age++;
    if (this.stuck) {
      if (this.age > 1200) this.removed = true;
      return;
    }
    if (this.age > 1200) {
      this.removed = true;
      return;
    }
    // an eye of ender is not stopped by anything: it flies its span and then bursts where it is
    if (this.life > 0 && this.age >= this.life) {
      this.onSplash?.(this.pos.clone());
      this.removed = true;
      return;
    }
    const next = this.pos.clone().add(this.vel);
    // step along the path checking blocks
    const steps = Math.ceil(this.vel.length() / 0.25) || 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = this.pos.x + this.vel.x * t;
      const py = this.pos.y + this.vel.y * t;
      const pz = this.pos.z + this.vel.z * t;
      const box: AABB = { minX: px - 0.05, minY: py - 0.05, minZ: pz - 0.05, maxX: px + 0.05, maxY: py + 0.05, maxZ: pz + 0.05 };
      if (!this.fromPlayer && playerBox && aabbIntersects(box, [playerBox.minX, playerBox.minY, playerBox.minZ, playerBox.maxX, playerBox.maxY, playerBox.maxZ])) {
        if (this.kind === 'potion' || this.kind === 'thrown') this.onSplash?.(new THREE.Vector3(px, py, pz));
        else hurtPlayer(Math.max(1, Math.ceil(this.damage * this.vel.length())), this.pos);
        this.removed = true;
        return;
      }
      if (this.fromPlayer && hitMob && hitMob(box)) {
        // a Piercing bolt carries on through what it hit, as vanilla's does
        if (this.pierce > 0) {
          this.pierce--;
          continue;
        }
        this.pos.set(px, py, pz);
        // a thrown thing bursts on whatever it hits, mob or not
        if (this.kind === 'thrown') this.onSplash?.(this.pos.clone());
        else this.onLanded?.(this.pos.clone(), true);
        this.removed = true;
        return;
      }
      const s = this.ghost ? 0 : world.getBlock(Math.floor(px), Math.floor(py), Math.floor(pz));
      if (s !== 0) {
        for (const b of collisionBoxes(s)) {
          if (aabbIntersects(box, [Math.floor(px) + b[0], Math.floor(py) + b[1], Math.floor(pz) + b[2], Math.floor(px) + b[3], Math.floor(py) + b[4], Math.floor(pz) + b[5]])) {
            this.pos.set(px, py, pz);
            if (this.kind === 'potion' || this.kind === 'thrown') {
              this.onSplash?.(this.pos.clone());
              this.removed = true;
              return;
            }
            this.stuck = true;
            this.vel.set(0, 0, 0);
            this.age = 900;
            this.onHitBlock?.(Math.floor(px), Math.floor(py), Math.floor(pz), this.pos.clone());
            // a trident is not left in the ground: it is given back where it fell
            if (this.kind === 'trident') {
              this.onLanded?.(this.pos.clone(), false);
              this.removed = true;
            }
            return;
          }
        }
      }
    }
    this.pos.copy(next);
    this.vel.multiplyScalar(0.99);
    // vanilla's throwables fall at 0.03 a tick; an arrow and a trident at 0.05
    this.vel.y -= this.kind === 'thrown' ? THROWN_GRAVITY : 0.05;
  }

  /** Turns the projectile into a thrown trident, which is drawn longer and spins as it flies. */
  asTrident(texture: THREE.Texture): this {
    this.kind = 'trident';
    this.mesh.geometry.dispose();
    const geo = new THREE.PlaneGeometry(1.4, 0.5);
    this.mesh.geometry = geo;
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map = texture;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
    return this;
  }

  /**
   * Turns the projectile into a thrown item: a snowball, an egg, a pearl or a bottle. Vanilla's
   * throwables fall more slowly than an arrow and burst on the first thing they touch, whatever it
   * is, so the potion path is reused for the impact.
   */
  asThrown(texture: THREE.Texture, size: number, onImpact: (pos: THREE.Vector3) => void): this {
    this.kind = 'thrown';
    this.onSplash = onImpact;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(size, size);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map = texture;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
    return this;
  }

  /** Turns the projectile into a tumbling splash-potion bottle. */
  asPotion(texture: THREE.Texture, color: number, onSplash: (pos: THREE.Vector3) => void): this {
    this.kind = 'potion';
    this.onSplash = onSplash;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(0.4, 0.4);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map = texture;
    mat.color.setHex(color).lerp(new THREE.Color(0xffffff), 0.4);
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
    return this;
  }

  render(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
    if (this.kind === 'potion') {
      this.mesh.rotation.z += 0.3; // tumbling bottle
      return;
    }
    if (!this.stuck && this.vel.lengthSq() > 1e-6) {
      const dir = this.vel.clone().normalize();
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    }
  }
}
