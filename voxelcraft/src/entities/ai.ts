/** AI goals for mobs (vanilla-style goal selector with priorities and exclusive flags). */
import * as THREE from 'three';
import { FLAG_LOOK, FLAG_MOVE, FLAG_TARGET, Mob, SHULKER_OPEN_TICKS, guardianAttackTicks, type ArrowEffect, type Goal, type MobWorld } from './mob.ts';
import { EQUINE_TYPES, inheritEquine } from './mobTypes.ts';
import { BEE_FLOWERS } from './beeFlowers.ts';
import { blocks } from '../blocks/registry.ts';
import { collisionBoxes } from '../blocks/collision.ts';

export function groundAt(w: MobWorld, x: number, y: number, z: number, clearance = 2, span = 3): number | null {
  // find a standable y within +-span of y with `clearance` air blocks above the floor
  for (let dy = span; dy >= -span; dy--) {
    const yy = y + dy;
    const below = w.getBlock(Math.floor(x), yy - 1, Math.floor(z));
    let clear = true;
    for (let k = 0; k < clearance && clear; k++) if (w.getBlock(Math.floor(x), yy + k, Math.floor(z)) !== 0) clear = false;
    if (below !== 0 && collisionBoxes(below).length && clear) {
      const bd = blocks.blockOf(below);
      if (bd.behavior === 'fluid' || bd.id === 'cactus' || bd.id === 'magma_block') return null;
      return yy;
    }
  }
  return null;
}

/** Float / jump when in water. */
export const floatGoal: Goal = {
  flags: 0,
  canUse: (m) => m.inWater,
  tick: (m, w) => {
    if (w.rng() < 0.8) m.vel.y += 0.04;
  },
};

/** Run away after being hurt (passive mobs). */
export const panicGoal = (speed = 1.25): Goal => {
  let until = 0;
  return {
    flags: FLAG_MOVE,
    canUse: (m) => m.age - m.lastHurtTime < 40 && m.lastHurtTime > 0,
    canContinue: (m) => m.age < until && !!m.moveTarget,
    start: (m, w) => {
      until = m.age + 60 + Math.floor(w.rng() * 40);
      const angle = w.rng() * Math.PI * 2;
      const dist = 4 + w.rng() * 6;
      const x = m.pos.x + Math.cos(angle) * dist;
      const z = m.pos.z + Math.sin(angle) * dist;
      const y = groundAt(w, x, Math.floor(m.pos.y), z);
      if (y !== null) {
        m.moveTarget = new THREE.Vector3(x, y, z);
        m.moveSpeed = speed;
        m.moveTimeout = 80;
      }
    },
    tick: () => {},
    stop: (m) => {
      m.moveTarget = null;
      m.moveSpeed = 1;
    },
  };
};

/** Random stroll on land. */
export const wanderGoal = (chance = 120, speed = 1, radius = 10): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => !m.moveTarget && w.rng() < 1 / chance,
  canContinue: (m) => !!m.moveTarget,
  start: (m, w) => {
    for (let i = 0; i < 10; i++) {
      const x = m.pos.x + (w.rng() * 2 - 1) * radius;
      const z = m.pos.z + (w.rng() * 2 - 1) * radius;
      const y = groundAt(w, x, Math.floor(m.pos.y), z);
      if (y === null) continue;
      m.moveTarget = new THREE.Vector3(x, y, z);
      m.moveSpeed = speed;
      m.moveTimeout = 100 + Math.floor(w.rng() * 60);
      return;
    }
  },
  tick: () => {},
  stop: (m) => {
    m.moveTarget = null;
  },
});

/** Look at the player when close. */
export const lookAtPlayerGoal = (range = 8, chance = 0.02): Goal => {
  let until = 0;
  return {
    flags: FLAG_LOOK,
    canUse: (m, w) => w.rng() < chance && m.distanceTo(w.playerPos()) < range,
    canContinue: (m, w) => m.age < until && m.distanceTo(w.playerPos()) < range,
    start: (m, w) => {
      until = m.age + 40 + Math.floor(w.rng() * 40);
    },
    tick: (m, w) => {
      m.lookTarget = w.playerEye();
    },
    stop: (m) => {
      m.lookTarget = null;
    },
  };
};

/** Glance around now and then. */
export const randomLookGoal: Goal = (() => {
  let until = 0;
  const target = new THREE.Vector3();
  return {
    flags: FLAG_LOOK,
    canUse: (m, w) => w.rng() < 0.02,
    canContinue: (m) => m.age < until,
    start: (m, w) => {
      until = m.age + 20 + Math.floor(w.rng() * 20);
      const a = w.rng() * Math.PI * 2;
      target.set(m.pos.x + Math.cos(a) * 4, m.pos.y + m.def.eyeHeight, m.pos.z + Math.sin(a) * 4);
      m.lookTarget = target.clone();
    },
    tick: () => {},
    stop: (m) => {
      m.lookTarget = null;
    },
  } as Goal;
})();

/** Whether the current target can still be attacked. */
export function targetAlive(m: Mob, w: MobWorld): boolean {
  if (m.target === 'player') return w.playerTargetable();
  return m.target !== null && !m.target.dead && !m.target.removed;
}
export function targetPos(m: Mob, w: MobWorld): THREE.Vector3 {
  return m.target === 'player' ? w.playerPos() : (m.target as Mob).pos;
}
export function targetEye(m: Mob, w: MobWorld): THREE.Vector3 {
  return m.target === 'player' ? w.playerEye() : (m.target as Mob).eyePos();
}
function hurtTarget(m: Mob, w: MobWorld, damage: number): void {
  if (m.target === 'player') w.hurtPlayer(damage, m.pos, m);
  else (m.target as Mob).hurt(damage, m.pos, 'other', 0.4);
}

/** Acquire the player as target when within range with line of sight (hostile mobs). */
export const targetPlayerGoal = (range: number, requireDark = false): Goal => ({
  flags: FLAG_TARGET,
  canUse: (m, w) => {
    if (m.target) return false;
    if (!w.playerTargetable()) return false;
    // vanilla shrinks a mob's sight of an invisible player to a fraction of its usual range
    const seen = range * (w.playerInvisible?.() ? 0.35 : 1);
    const d = m.distanceTo(w.playerPos());
    if (d > seen) return false;
    if (requireDark) {
      const light = Math.max(w.getBlockLight(Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z)), w.getSkyLight(Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z)) - w.skyDarken());
      if (light > 11 && m.age - m.lastHurtTime > 100) return false;
    }
    return w.lineOfSight(m.eyePos(), w.playerEye());
  },
  tick: (m) => {
    m.target = 'player';
  },
});

/** Chase and hit the target (the player, or another mob for wolves). */
export const meleeAttackGoal = (reachBonus = 0, onHit?: (m: Mob, w: MobWorld) => void): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => targetAlive(m, w),
  canContinue: (m, w) => targetAlive(m, w) && m.distanceTo(targetPos(m, w)) < m.def.followRange * 1.2,
  tick: (m, w) => {
    const p = targetPos(m, w);
    m.lookTarget = targetEye(m, w);
    const d = Math.hypot(p.x - m.pos.x, p.z - m.pos.z);
    if (d > 1.5) {
      if (!m.moveTarget || m.age % 10 === 0) {
        m.moveTarget = p.clone();
        m.moveSpeed = 1;
        m.moveTimeout = 40;
      }
    } else m.moveTarget = null;
    const reach = m.width / 2 + 0.8 + reachBonus;
    if (d <= reach + 0.3 && Math.abs(p.y - m.pos.y) < 2 && m.attackCooldown === 0) {
      hurtTarget(m, w, m.def.damage);
      if (m.target === 'player') {
        if (m.fireTicks > 0) w.ignitePlayer(80); // vanilla: 2 s × difficulty
        onHit?.(m, w);
      }
      m.attackCooldown = 20;
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
    m.target = null;
  },
});

/** Creeper: approach, swell for 30 ticks within 3 blocks, explode. */
export const creeperGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => m.target === 'player' && w.playerTargetable(),
  canContinue: (m, w) => m.target === 'player' && w.playerTargetable() && m.distanceTo(w.playerPos()) < 20,
  tick: (m, w) => {
    const p = w.playerPos();
    m.lookTarget = w.playerEye();
    const d = m.distanceTo(p);
    const swell = Number(m.extra.swell ?? 0);
    if (d < 3) {
      m.moveTarget = null;
      m.extra.swell = swell + 1;
      if (swell + 1 >= 30) {
        w.explode(m.pos.x, m.pos.y + 0.5, m.pos.z, 3, m);
        m.removed = true;
      }
    } else {
      if (d > 7) m.extra.swell = Math.max(0, swell - 1);
      if (!m.moveTarget || m.age % 10 === 0) {
        m.moveTarget = p.clone();
        m.moveSpeed = 1;
        m.moveTimeout = 40;
      }
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
    m.target = null;
    m.extra.swell = 0;
  },
});

/** Skeleton: keep distance, shoot arrows every 40 ticks (vanilla 20 on hard). */
export const bowAttackGoal = (effect?: ArrowEffect, weapon: 'bow' | 'crossbow' = 'bow'): Goal => {
  let strafeTicks = 0;
  return {
    flags: FLAG_MOVE | FLAG_LOOK,
    canUse: (m, w) => m.target === 'player' && w.playerTargetable(),
    canContinue: (m, w) => m.target === 'player' && w.playerTargetable() && m.distanceTo(w.playerPos()) < m.def.followRange * 1.2,
    tick: (m, w) => {
      const p = w.playerPos();
      const eye = w.playerEye();
      m.lookTarget = eye;
      const d = m.distanceTo(p);
      const los = w.lineOfSight(m.eyePos(), eye);
      if (d > 15 || !los) {
        if (!m.moveTarget || m.age % 10 === 0) {
          m.moveTarget = p.clone();
          m.moveSpeed = 1;
          m.moveTimeout = 40;
        }
      } else if (d < 6) {
        // back away
        if (--strafeTicks <= 0) {
          const dx = m.pos.x - p.x;
          const dz = m.pos.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          m.moveTarget = new THREE.Vector3(m.pos.x + (dx / len) * 4, m.pos.y, m.pos.z + (dz / len) * 4);
          m.moveSpeed = 1;
          m.moveTimeout = 20;
          strafeTicks = 20;
        }
      } else m.moveTarget = null;
      if (los && d <= 15 && m.attackCooldown === 0) {
        // vanilla aims a third of the way up the target, not at its eyes, and lets the arc do the rest
        const aim = p.clone();
        aim.y += 0.6;
        // vanilla crossbows hit harder and reload more slowly than a skeleton's bow
        w.shootArrow(m.eyePos(), aim, weapon === 'crossbow' ? 1.9 : 1.6, weapon === 'crossbow' ? 3 : 2, effect);
        m.attackCooldown = weapon === 'crossbow' ? 70 : 40;
        m.extra.aiming = 0;
      } else if (los && d <= 15) m.extra.aiming = 1;
    },
    stop: (m) => {
      m.moveTarget = null;
      m.lookTarget = null;
      m.target = null;
    },
  };
};

/** Drop the target when far away or the player is untargetable. */
export const loseTargetGoal = (): Goal => ({
  flags: 0,
  canUse: (m, w) => m.target !== null && (!targetAlive(m, w) || m.distanceTo(targetPos(m, w)) > m.def.followRange * 1.5),
  tick: (m) => {
    m.target = null;
  },
});

/** Slimes hop toward the player (or a random heading) and hurt on contact. */
export const slimeGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const hostile = m.target === 'player' && w.playerTargetable();
    const p = w.playerPos();
    let heading = typeof m.extra.heading === 'number' ? m.extra.heading : (m.extra.heading = w.rng() * Math.PI * 2);
    if (hostile) {
      heading = Math.atan2(-(p.x - m.pos.x), -(p.z - m.pos.z));
      m.lookTarget = w.playerEye();
    } else if (w.rng() < 1 / 60) m.extra.heading = heading = w.rng() * Math.PI * 2;
    m.yaw = m.bodyYaw = heading;
    if (m.onGround) {
      const delay = typeof m.extra.jumpDelay === 'number' ? m.extra.jumpDelay : 0;
      if (delay > 0) m.extra.jumpDelay = delay - 1;
      else {
        // vanilla: 10..30 ticks between hops, a third of that while chasing
        m.extra.jumpDelay = Math.floor((w.rng() * 20 + 10) / (hostile ? 3 : 1));
        m.vel.y = 0.42;
        const burst = m.def.speed * (hostile ? 1.5 : 1) * 1.4;
        m.vel.x += -Math.sin(heading) * burst;
        m.vel.z += -Math.cos(heading) * burst;
        w.playSound('slime', m.pos.x, m.pos.y, m.pos.z, 0.8 + w.rng() * 0.4);
      }
    }
    if (hostile && m.def.damage > 0 && m.attackCooldown === 0) {
      const a = m.aabb();
      const b = w.playerBox();
      if (a.minX < b.maxX + 0.2 && a.maxX > b.minX - 0.2 && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ + 0.2 && a.maxZ > b.minZ - 0.2) {
        w.hurtPlayer(m.def.damage, m.pos);
        m.attackCooldown = 20;
      }
    }
  },
  stop: (m) => {
    m.lookTarget = null;
  },
});

/** Vanilla `EnderMan.isLookingAtMe`: the player's view line passes within a small angle of the eyes. */
function staredAt(m: Mob, w: MobWorld): boolean {
  const eye = w.playerEye();
  const to = m.eyePos().sub(eye);
  const dist = to.length();
  if (dist > 64 || dist < 0.01) return false;
  to.divideScalar(dist);
  if (w.playerLookDir().dot(to) <= 1 - 0.025 / dist) return false;
  return w.lineOfSight(eye, m.eyePos());
}

/** Blinks a mob to a random standable spot within `range` blocks; returns whether it moved. */
export function teleportRandom(m: Mob, w: MobWorld, range: number, around: THREE.Vector3 = m.pos): boolean {
  const clearance = Math.ceil(m.def.height);
  for (let i = 0; i < 16; i++) {
    const x = around.x + (w.rng() * 2 - 1) * range;
    const z = around.z + (w.rng() * 2 - 1) * range;
    const y = groundAt(w, x, Math.floor(around.y) + Math.floor((w.rng() * 2 - 1) * 8), z, clearance, 8);
    if (y === null || !Mob.fits(w, m.def, x, y, z)) continue;
    w.playSound('enderman_teleport', m.pos.x, m.pos.y, m.pos.z);
    m.pos.set(x, y, z);
    m.prev.copy(m.pos);
    m.vel.set(0, 0, 0);
    m.moveTarget = null;
    w.playSound('enderman_teleport', x, y, z);
    return true;
  }
  return false;
}

/** Enderman: neutral until hit or stared at, hurt by water, blinks around. */
export const endermanGoal = (): Goal => ({
  flags: 0,
  canUse: () => true,
  tick: (m, w) => {
    if (m.inWater) {
      if (m.age % 10 === 0) m.hurt(1, null, 'other', 0);
      if (w.rng() < 0.3) teleportRandom(m, w, 32);
      return;
    }
    const provoked = m.lastHurtBy === 'player' && m.age - m.lastHurtTime < 100;
    if (m.target !== 'player' && w.playerTargetable() && (provoked || staredAt(m, w))) {
      m.target = 'player';
      w.playSound('enderman_scream', m.pos.x, m.pos.y + 2, m.pos.z);
    }
    if (m.target === 'player') {
      // dodge the hit that just landed, and close the distance on a far player
      if (m.age - m.lastHurtTime < 2 && w.rng() < 0.5) teleportRandom(m, w, 16);
      else if (m.distanceTo(w.playerPos()) > 16 && w.rng() < 0.05) teleportRandom(m, w, 10, w.playerPos());
    } else if (w.isDay() && w.rng() < 1 / 400 && w.getSkyLight(Math.floor(m.pos.x), Math.floor(m.pos.y + 1), Math.floor(m.pos.z)) >= 15) {
      // daylight makes them restless like vanilla
      teleportRandom(m, w, 32);
    }
  },
});

/** Animals in love walk to a partner of their kind and make a baby (vanilla BreedGoal). */
export const breedGoal = (): Goal => {
  let partner: Mob | null = null;
  return {
    flags: FLAG_MOVE | FLAG_LOOK,
    canUse: (m, w) => {
      if (m.isBaby || !(typeof m.extra.love === 'number' && m.extra.love > 0)) return false;
      partner = null;
      let best = Infinity;
      for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 8)) {
        if (o === m || !breedsWith(m.def.id, o.def.id) || o.isBaby || !(typeof o.extra.love === 'number' && o.extra.love > 0)) continue;
        const d = o.distanceTo(m.pos);
        if (d < best) { best = d; partner = o; }
      }
      return partner !== null;
    },
    canContinue: (m) => partner !== null && !partner.dead && typeof partner.extra.love === 'number' && partner.extra.love > 0 && typeof m.extra.love === 'number' && m.extra.love > 0,
    tick: (m, w) => {
      const o = partner!;
      m.lookTarget = o.eyePos();
      if (m.age % 10 === 0) {
        m.moveTarget = o.pos.clone();
        m.moveSpeed = 1;
        m.moveTimeout = 40;
      }
      if (m.distanceTo(o.pos) < 3) {
        // vanilla's turtles carry an egg home to the beach instead of having a calf on the spot
        const eggs = m.def.id === 'turtle';
        const baby = eggs ? null : w.spawnMob(offspringOf(m.def.id, o.def.id), (m.pos.x + o.pos.x) / 2, Math.max(m.pos.y, o.pos.y), (m.pos.z + o.pos.z) / 2, true);
        if (eggs) m.extra.hasEgg = true;
        if (baby && m.def.id === 'sheep') baby.extra.color = w.rng() < 0.5 ? m.extra.color ?? 'white' : o.extra.color ?? 'white';
        if (baby && EQUINE_TYPES.includes(baby.def.id)) inheritEquine(baby, m, o, w.rng);
        for (const a of [m, o]) {
          a.extra.love = 0;
          a.extra.cooldown = 6000;
          w.emitParticles('heart', a.pos.x, a.pos.y + a.height, a.pos.z, 7, a.width, 0.5);
        }
        w.giveXp(1 + Math.floor(w.rng() * 7), m.pos.x, m.pos.y, m.pos.z);
        m.moveTarget = null;
      }
    },
    stop: (m) => {
      m.moveTarget = null;
      m.lookTarget = null;
      partner = null;
    },
  };
};

/** Horses and donkeys interbreed into mules; every other animal only pairs with its own kind. */
export function breedsWith(a: string, b: string): boolean {
  if (a === b) return a !== 'mule'; // mules are sterile in vanilla
  return (a === 'horse' && b === 'donkey') || (a === 'donkey' && b === 'horse');
}

export function offspringOf(a: string, b: string): string {
  return a === b ? a : 'mule';
}

/** Babies keep close to the nearest adult of their kind. */
export const followParentGoal = (): Goal => {
  let parent: Mob | null = null;
  return {
    flags: FLAG_MOVE,
    canUse: (m, w) => {
      if (!m.isBaby || w.rng() > 0.1) return false;
      parent = null;
      let best = 16;
      for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 16)) {
        if (o === m || o.def.id !== m.def.id || o.isBaby) continue;
        const d = o.distanceTo(m.pos);
        if (d < best) { best = d; parent = o; }
      }
      return parent !== null && best > 3;
    },
    canContinue: (m) => parent !== null && !parent.dead && m.distanceTo(parent.pos) > 2 && m.distanceTo(parent.pos) < 16,
    tick: (m) => {
      if (parent && m.age % 10 === 0) {
        m.moveTarget = parent.pos.clone();
        m.moveSpeed = 1.1;
        m.moveTimeout = 40;
      }
    },
    stop: (m) => {
      m.moveTarget = null;
      parent = null;
    },
  };
};

/** Sheep graze: sheared sheep (and hungry lambs) eat the grass under them, which regrows wool and speeds growth. */
export const eatGrassGoal = (): Goal => {
  let eating = 0;
  return {
    flags: FLAG_MOVE | FLAG_LOOK,
    canUse: (m, w) => {
      const wants = m.extra.sheared === true || m.isBaby;
      if (!wants || w.rng() > (m.isBaby ? 1 / 50 : 1 / 1000)) return false;
      const x = Math.floor(m.pos.x), y = Math.floor(m.pos.y), z = Math.floor(m.pos.z);
      const at = w.getBlock(x, y, z);
      const below = w.getBlock(x, y - 1, z);
      return (at !== 0 && blocks.blockOf(at).id === 'short_grass') || (below !== 0 && blocks.blockOf(below).id === 'grass_block');
    },
    canContinue: () => eating > 0,
    start: () => { eating = 40; },
    tick: (m, w) => {
      m.moveTarget = null;
      m.headPitch = 0.6;
      if (--eating > 0) return;
      const x = Math.floor(m.pos.x), y = Math.floor(m.pos.y), z = Math.floor(m.pos.z);
      const at = w.getBlock(x, y, z);
      if (at !== 0 && blocks.blockOf(at).id === 'short_grass') w.setBlock(x, y, z, 0);
      else w.setBlock(x, y - 1, z, blocks.defaultState('dirt'));
      m.extra.sheared = false;
      if (m.isBaby && typeof m.extra.grow === 'number') m.extra.grow = Math.max(1, m.extra.grow - 1200);
      w.playSound('dig_grass', m.pos.x, m.pos.y, m.pos.z);
    },
    stop: () => { eating = 0; },
  };
};

// ---------------------------------------------------------------------------------------------
// Wolves
// ---------------------------------------------------------------------------------------------
const isTamed = (m: Mob) => m.extra.tamed === true;
const isSitting = (m: Mob) => isTamed(m) && m.extra.sitting === true;

/** A sitting tamed wolf holds the move slot so nothing walks it away. */
export const sitGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m) => isSitting(m),
  tick: (m) => {
    m.moveTarget = null;
  },
});

/**
 * Vanilla TemptGoal: the animal walks toward a player holding one of `items` and stops just short.
 * Cats and ocelots creep in slowly, which is how the player gets close enough to feed them.
 */
export const temptGoal = (items: string[], range = 10, speed = 0.6): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => {
    if (m.extra.sitting === true) return false;
    const held = w.playerHolding();
    return !!held && items.includes(held) && m.distanceTo(w.playerPos()) < range && w.playerTargetable();
  },
  tick: (m, w) => {
    const p = w.playerPos();
    m.lookTarget = w.playerEye();
    if (m.distanceTo(p) < 2.5) {
      m.moveTarget = null;
      return;
    }
    if (m.age % 10 === 0) {
      m.moveTarget = p.clone();
      m.moveSpeed = speed;
      m.moveTimeout = 40;
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
    m.moveSpeed = 1;
  },
});

/** Runs from a point, used by skittish animals (vanilla AvoidEntityGoal). */
function fleeFrom(m: Mob, w: MobWorld, from: THREE.Vector3, speed: number): void {
  const dx = m.pos.x - from.x;
  const dz = m.pos.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const x = m.pos.x + (dx / len) * 8;
  const z = m.pos.z + (dz / len) * 8;
  const y = groundAt(w, x, Math.floor(m.pos.y), z);
  if (y !== null) {
    m.moveTarget = new THREE.Vector3(x, y, z);
    m.moveSpeed = speed;
    m.moveTimeout = 60;
  }
}

/**
 * Ocelots keep their distance: vanilla has them flee any player within ten blocks until they have
 * been fed enough fish to trust one, and a trusting ocelot still refuses to be tamed.
 */
export const ocelotFleeGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => m.extra.trusting !== true && w.playerTargetable() && m.distanceTo(w.playerPos()) < 10 && w.playerHolding() === null,
  canContinue: (m, w) => m.extra.trusting !== true && m.distanceTo(w.playerPos()) < 12 && !!m.moveTarget,
  start: (m, w) => fleeFrom(m, w, w.playerPos(), 1.3),
  tick: (m, w) => {
    if (!m.moveTarget && m.age % 10 === 0) fleeFrom(m, w, w.playerPos(), 1.3);
  },
  stop: (m) => {
    m.moveTarget = null;
    m.moveSpeed = 1;
  },
});

/** Untamed cats keep their distance too, but only until they are tamed. */
export const catAvoidGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => m.extra.tamed !== true && w.playerTargetable() && m.distanceTo(w.playerPos()) < 8 && w.playerHolding() === null,
  canContinue: (m, w) => m.extra.tamed !== true && m.distanceTo(w.playerPos()) < 10 && !!m.moveTarget,
  start: (m, w) => fleeFrom(m, w, w.playerPos(), 1.2),
  tick: (m, w) => {
    if (!m.moveTarget && m.age % 10 === 0) fleeFrom(m, w, w.playerPos(), 1.2);
  },
  stop: (m) => {
    m.moveTarget = null;
    m.moveSpeed = 1;
  },
});

/** Creepers and phantoms keep away from cats and ocelots (vanilla avoid goals). */
export const avoidCatsGoal = (range = 6): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => w.mobsNear(m.pos.x, m.pos.y, m.pos.z, range).some((o) => o.def.id === 'cat' || o.def.id === 'ocelot'),
  tick: (m, w) => {
    const cat = w.mobsNear(m.pos.x, m.pos.y, m.pos.z, range).find((o) => o.def.id === 'cat' || o.def.id === 'ocelot');
    if (cat && m.age % 10 === 0) fleeFrom(m, w, cat.pos, 1.2);
  },
  stop: (m) => {
    m.moveTarget = null;
    m.moveSpeed = 1;
  },
});

/**
 * Bees: vanilla's pollination loop. A bee without nectar looks for a flower, hovers over it for a
 * couple of seconds, then flies home to its hive and goes inside, which raises the hive's honey.
 * An angered bee chases the player instead, stings once for poison and dies soon after.
 */
export const beeGoal = (): Goal => {
  const at = (p: { x: number; y: number; z: number }, dy = 0) => new THREE.Vector3(p.x + 0.5, p.y + dy, p.z + 0.5);
  return {
    flags: FLAG_MOVE | FLAG_LOOK,
    canUse: () => true,
    tick: (m, w) => {
      const e = m.extra;
      // stinging: an angry bee dives at the player and dies once it lands a hit
      if (m.target === 'player' && w.playerTargetable()) {
        const eye = w.playerEye();
        m.moveTarget = eye.clone();
        m.moveSpeed = 1.6;
        m.moveTimeout = 40;
        m.lookTarget = eye;
        if (m.distanceTo(w.playerPos()) < 1.6 && m.attackCooldown === 0) {
          w.hurtPlayer(m.def.damage, m.pos, m);
          w.addPlayerEffect('poison', 200); // vanilla: 10 seconds on normal difficulty
          m.attackCooldown = 20;
          e.stung = true;
          w.playSound('bee_sting', m.pos.x, m.pos.y, m.pos.z);
        }
        if (e.stung === true) {
          // a bee that has stung loses its stinger and dies moments later
          const fuse = typeof e.stingDeath === 'number' ? e.stingDeath - 1 : 30;
          e.stingDeath = fuse;
          if (fuse <= 0) m.hurt(20, null, 'other', 0);
        }
        return;
      }
      const home = typeof e.hiveX === 'number' ? { x: e.hiveX as number, y: e.hiveY as number, z: e.hiveZ as number } : null;
      const night = !w.isDay();
      // heading home: at night, in the rain or once the bee is carrying nectar
      if (home && (e.nectar === true || night)) {
        const target = at(home, 0.5);
        m.moveTarget = target;
        m.moveSpeed = 1.2;
        m.moveTimeout = 60;
        m.lookTarget = target;
        if (m.distanceTo(target) < 1.2 && w.enterHive?.(m, home.x, home.y, home.z)) return;
        return;
      }
      // pollinating: hover over a flower until the bee has nectar
      const flower = typeof e.flowerX === 'number' ? { x: e.flowerX as number, y: e.flowerY as number, z: e.flowerZ as number } : null;
      if (flower) {
        const target = at(flower, 1);
        m.moveTarget = target;
        m.moveSpeed = 1;
        m.moveTimeout = 60;
        m.lookTarget = at(flower, 0);
        if (m.distanceTo(target) < 1.4) {
          const ticks = typeof e.pollen === 'number' ? e.pollen + 1 : 1;
          e.pollen = ticks;
          if (m.age % 5 === 0) w.emitParticles('happy', m.pos.x, m.pos.y, m.pos.z, 1, 0.4, 0.3);
          if (ticks > 60) {
            e.nectar = true;
            delete e.pollen;
            delete e.flowerX;
            delete e.flowerY;
            delete e.flowerZ;
          }
        }
        return;
      }
      if (m.age % 40 === 0 && w.findBlock) {
        const found = w.findBlock(m.pos.x, m.pos.y, m.pos.z, 12, BEE_FLOWERS);
        if (found) {
          e.flowerX = found.x;
          e.flowerY = found.y;
          e.flowerZ = found.z;
          return;
        }
      }
      // nothing to do: drift around the hive (or wherever the bee is)
      if (!m.moveTarget || m.age % 60 === 0) {
        const base = home ? at(home, 1) : m.pos;
        m.moveTarget = new THREE.Vector3(base.x + (w.rng() - 0.5) * 12, base.y + (w.rng() - 0.5) * 4, base.z + (w.rng() - 0.5) * 12);
        m.moveSpeed = 0.8;
        m.moveTimeout = 80;
        m.lookTarget = null;
      }
    },
  };
};

/** Blocks a bee treats as a flower, filled in by the mob table so the goal stays data-driven. */

/** Illagers hunt villagers as well as the player (vanilla's raid target list, minus golems). */
export const targetVillagerGoal = (): Goal => ({
  flags: FLAG_TARGET,
  canUse: (m, w) => {
    if (m.target !== null) return false;
    return w.mobsNear(m.pos.x, m.pos.y, m.pos.z, m.def.followRange).some((o) => !o.dead && (o.def.id === 'villager' || o.def.id === 'wandering_trader'));
  },
  tick: (m, w) => {
    const victim = w.mobsNear(m.pos.x, m.pos.y, m.pos.z, m.def.followRange).find((o) => !o.dead && (o.def.id === 'villager' || o.def.id === 'wandering_trader'));
    if (victim) m.target = victim;
  },
});

/**
 * Evokers cast vanilla's two spells: a ring of vexes to fight for them, and a line of fangs that
 * erupts from the ground toward the target. Both take a moment of casting, arms raised.
 */
export const evokerGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => targetAlive(m, w),
  canContinue: (m, w) => targetAlive(m, w),
  tick: (m, w) => {
    const target = targetPos(m, w);
    m.lookTarget = targetEye(m, w);
    const d = m.distanceTo(target);
    // evokers keep their distance and never melee
    if (d < 8) {
      const dx = m.pos.x - target.x, dz = m.pos.z - target.z;
      const len = Math.hypot(dx, dz) || 1;
      if (m.age % 20 === 0) {
        m.moveTarget = new THREE.Vector3(m.pos.x + (dx / len) * 5, m.pos.y, m.pos.z + (dz / len) * 5);
        m.moveSpeed = 1;
        m.moveTimeout = 30;
      }
    } else if (d > 12 && m.age % 10 === 0) {
      m.moveTarget = target.clone();
      m.moveSpeed = 1;
      m.moveTimeout = 40;
    } else m.moveTarget = null;
    const casting = typeof m.extra.casting === 'number' ? m.extra.casting : 0;
    if (casting > 0) {
      m.extra.casting = casting - 1;
      if (casting === 1) {
        if (m.extra.spell === 'vexes') {
          // three vexes appear around the evoker (vanilla summons up to three at a time)
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            const vex = w.spawnMob('vex', m.pos.x + Math.cos(a) * 1.5, m.pos.y + 1, m.pos.z + Math.sin(a) * 1.5, false);
            if (vex) {
              vex.target = m.target;
              vex.extra.life = 1200; // vexes wither away after a minute or so
            }
          }
          w.playSound('evoker_cast', m.pos.x, m.pos.y, m.pos.z);
        } else {
          // a line of fangs walks from the evoker to the target, biting whatever stands in it
          const dx = target.x - m.pos.x, dz = target.z - m.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          for (let i = 1; i <= 8; i++) {
            const fx = m.pos.x + (dx / len) * i * 1.2;
            const fz = m.pos.z + (dz / len) * i * 1.2;
            const fy = groundAt(w, fx, Math.floor(m.pos.y), fz, 2, 4);
            if (fy === null) continue;
            w.emitParticles('angry', fx, fy + 0.3, fz, 2, 0.6, 0.4);
            if (Math.hypot(w.playerPos().x - fx, w.playerPos().z - fz) < 1.2 && Math.abs(w.playerPos().y - fy) < 2) w.hurtPlayer(6, m.pos, m);
          }
          w.playSound('evoker_fangs', m.pos.x, m.pos.y, m.pos.z);
        }
      }
      return;
    }
    if (m.attackCooldown === 0 && d < 16) {
      const vexes = w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 16).filter((o) => o.def.id === 'vex' && !o.dead).length;
      m.extra.spell = vexes < 3 && w.rng() < 0.4 ? 'vexes' : 'fangs';
      m.extra.casting = 40;
      m.attackCooldown = 200;
      w.playSound('evoker_prepare', m.pos.x, m.pos.y, m.pos.z);
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
    m.extra.casting = 0;
  },
});

/** Vexes dart at their target through walls and fade away after their summon time runs out. */
export const vexGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const life = typeof m.extra.life === 'number' ? m.extra.life - 1 : 1200;
    m.extra.life = life;
    if (life <= 0) {
      m.hurt(20, null, 'other', 0);
      return;
    }
    if (!targetAlive(m, w)) {
      if (!m.moveTarget || m.age % 40 === 0) {
        m.moveTarget = new THREE.Vector3(m.pos.x + (w.rng() - 0.5) * 8, m.pos.y + (w.rng() - 0.5) * 3, m.pos.z + (w.rng() - 0.5) * 8);
        m.moveSpeed = 1;
        m.moveTimeout = 60;
      }
      return;
    }
    const eye = targetEye(m, w);
    m.moveTarget = eye.clone();
    m.moveSpeed = 1.6;
    m.moveTimeout = 40;
    m.lookTarget = eye;
    if (m.distanceTo(targetPos(m, w)) < 1.6 && m.attackCooldown === 0) {
      hurtTarget(m, w, m.def.damage);
      m.attackCooldown = 20;
    }
  },
});

/** Villagers keep away from zombies and illagers (vanilla avoid goals with a wider radius). */
export const avoidMonstersGoal = (range = 8): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => w.mobsNear(m.pos.x, m.pos.y, m.pos.z, range).some((o) => !o.dead && o.def.disposition === 'hostile'),
  tick: (m, w) => {
    const foe = w.mobsNear(m.pos.x, m.pos.y, m.pos.z, range).find((o) => !o.dead && o.def.disposition === 'hostile');
    if (foe && m.age % 10 === 0) fleeFrom(m, w, foe.pos, 1.5);
  },
  stop: (m) => {
    m.moveTarget = null;
    m.moveSpeed = 1;
  },
});

/**
 * Unemployed villagers walk to a nearby job site block and take its profession, and employed ones
 * return to it to restock, which is what refills their trades (vanilla restocks twice a day).
 */
export const jobSiteGoal = (): Goal => {
  let site: { x: number; y: number; z: number; block: string } | null = null;
  return {
    flags: FLAG_MOVE | FLAG_LOOK,
    canUse: (m, w) => {
      if (m.def.id !== 'villager' || m.isBaby || m.extra.profession === 'nitwit') return false;
      if (m.age % 40 !== 0 && !site) return false;
      const needsJob = !m.extra.profession || m.extra.profession === 'none';
      const wantsRestock = m.extra.restock === true;
      if (!needsJob && !wantsRestock) return false;
      site = w.findJobSite ? w.findJobSite(m.pos.x, m.pos.y, m.pos.z, 12, needsJob ? null : String(m.extra.profession)) : null;
      return site !== null;
    },
    canContinue: (m) => site !== null && (!m.extra.profession || m.extra.profession === 'none' || m.extra.restock === true),
    tick: (m, w) => {
      if (!site) return;
      const target = new THREE.Vector3(site.x + 0.5, site.y, site.z + 0.5);
      m.lookTarget = target;
      if (m.distanceTo(target) < 2.2) {
        w.claimJobSite?.(m, site.block);
        site = null;
        m.moveTarget = null;
        return;
      }
      if (m.age % 10 === 0) {
        m.moveTarget = target;
        m.moveSpeed = 0.8;
        m.moveTimeout = 60;
      }
    },
    stop: (m) => {
      m.moveTarget = null;
      m.lookTarget = null;
      site = null;
    },
  };
};

/** Wild wolves fight back as a pack; tamed wolves fight whatever hurts or is hit by their owner. */
export const wolfDefendGoal = (): Goal => ({
  flags: 0,
  canUse: (m, w) => {
    if (m.target !== null || isSitting(m)) return false;
    if (isTamed(m)) {
      const foe = w.playerAttacker() ?? w.playerVictim();
      return !!foe && foe !== m && !foe.dead && foe.def.id !== 'wolf' && m.distanceTo(foe.pos) < 16;
    }
    return m.lastHurtBy === 'player' && m.age - m.lastHurtTime < 100 && w.playerTargetable();
  },
  tick: (m, w) => {
    if (isTamed(m)) {
      m.target = w.playerAttacker() ?? w.playerVictim();
      return;
    }
    m.target = 'player';
    for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 16)) if (o.def.id === 'wolf' && !isTamed(o) && o.target === null) o.target = 'player';
    w.playSound('wolf_growl', m.pos.x, m.pos.y, m.pos.z);
  },
});

/** Wild wolves hunt skeletons and sheep they notice (vanilla NonTameRandomTargetGoal). */
export const wolfHuntGoal = (): Goal => ({
  flags: 0,
  canUse: (m, w) => !isTamed(m) && m.target === null && w.rng() < 0.02,
  tick: (m, w) => {
    let best: Mob | null = null;
    let bestD = 16;
    for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 16)) {
      if (o === m || o.dead || (o.def.id !== 'sheep' && o.def.id !== 'skeleton' && o.def.id !== 'stray')) continue;
      const d = m.distanceTo(o.pos);
      if (d < bestD && w.lineOfSight(m.eyePos(), o.eyePos())) { bestD = d; best = o; }
    }
    if (best) m.target = best;
  },
});

/** Tamed wolves keep up with their owner and blink to them when left behind. */
export const followOwnerGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => isTamed(m) && !isSitting(m) && m.target === null && m.distanceTo(w.playerPos()) > 6,
  canContinue: (m, w) => isTamed(m) && !isSitting(m) && m.target === null && m.distanceTo(w.playerPos()) > 3,
  tick: (m, w) => {
    const p = w.playerPos();
    m.lookTarget = w.playerEye();
    if (m.distanceTo(p) > 12) {
      teleportRandom(m, w, 3, p);
      return;
    }
    if (m.age % 10 === 0) {
      m.moveTarget = p.clone();
      m.moveSpeed = 1.2;
      m.moveTimeout = 40;
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
  },
});

// ---------------------------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------------------------
const isWaterAt = (w: MobWorld, x: number, y: number, z: number) => {
  const s = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return s !== 0 && blocks.blockOf(s).id === 'water';
};

/** Fish wander to random water cells nearby and dart away when hurt. */
export const swimGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m) => m.inWater,
  tick: (m, w) => {
    const scared = m.age - m.lastHurtTime < 40;
    if (m.moveTarget && !scared && w.rng() > 0.02) return;
    for (let i = 0; i < 8; i++) {
      const x = m.pos.x + (w.rng() * 2 - 1) * 8;
      const y = m.pos.y + (w.rng() * 2 - 1) * 4;
      const z = m.pos.z + (w.rng() * 2 - 1) * 8;
      if (!isWaterAt(w, x, y, z) || !isWaterAt(w, x, y + 0.5, z)) continue;
      m.moveTarget = new THREE.Vector3(x, y, z);
      m.moveSpeed = scared ? 2 : 1;
      m.moveTimeout = 60;
      break;
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Bats, squid and dolphins
// ---------------------------------------------------------------------------------------------
/**
 * Vanilla's bat: it hangs from whatever it is under until a light or a player disturbs it, then
 * flutters about, picking a spot within a few blocks and beating over to it.
 */
export const batGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const e = m.extra;
    const head = Math.floor(m.pos.y + m.def.height + 0.5);
    const ceiling = w.getBlock(Math.floor(m.pos.x), head, Math.floor(m.pos.z)) !== 0;
    const at: [number, number, number] = [Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z)];
    const bright = Math.max(w.getSkyLight(...at), w.getBlockLight(...at)) > 7;
    const p = w.playerPos();
    const disturbed = bright || Math.hypot(p.x - m.pos.x, p.y - m.pos.y, p.z - m.pos.z) < 4;
    if (e.resting === true) {
      // vanilla wakes a hanging bat when the light comes up or somebody walks under it
      if (!disturbed && ceiling) {
        m.moveTarget = null;
        m.vel.set(0, 0, 0);
        return;
      }
      e.resting = false;
    }
    // it settles again once it is under a block and nothing is bothering it
    if (!disturbed && ceiling && w.rng() < 0.01) {
      e.resting = true;
      return;
    }
    if (m.moveTarget && m.distanceTo(m.moveTarget) > 1.2 && w.rng() > 0.02) return;
    m.moveTarget = new THREE.Vector3(
      m.pos.x + (w.rng() * 2 - 1) * 7,
      m.pos.y + (w.rng() * 2 - 1) * 6,
      m.pos.z + (w.rng() * 2 - 1) * 7,
    );
    m.moveSpeed = 0.6;
    m.moveTimeout = 80;
  },
});

/** Squid drift: vanilla pushes them along in slow pulses rather than steering them anywhere. */
export const squidGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: () => true,
  tick: (m, w) => {
    if (!m.inWater) {
      // out of the water a squid only flops, which is what vanilla leaves it doing
      m.moveTarget = null;
      return;
    }
    if (m.moveTarget && w.rng() > 0.03) return;
    for (let i = 0; i < 8; i++) {
      const x = m.pos.x + (w.rng() * 2 - 1) * 6;
      const y = m.pos.y + (w.rng() * 2 - 1) * 4;
      const z = m.pos.z + (w.rng() * 2 - 1) * 6;
      if (!isWaterAt(w, x, y, z)) continue;
      m.moveTarget = new THREE.Vector3(x, y, z);
      m.moveSpeed = m.age - m.lastHurtTime < 40 ? 1.4 : 0.5;
      m.moveTimeout = 80;
      break;
    }
  },
});

/**
 * Dolphins: they swim faster than anything else in the water, come up for air, and hand whoever is
 * swimming beside them vanilla's Dolphin's Grace.
 */
export const dolphinGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const p = w.playerPos();
    // vanilla grants the grace to a player swimming within about ten blocks of one
    if (m.inWater && m.distanceTo(p) < 10 && isWaterAt(w, p.x, p.y + 0.4, p.z)) w.addPlayerEffect('dolphins_grace', 100);
    if (!m.inWater) return;
    const air = m.age % 200 > 160;
    if (m.moveTarget && !air && w.rng() > 0.04) return;
    for (let i = 0; i < 10; i++) {
      // it makes for the surface when it wants a breath, and roams otherwise
      const x = m.pos.x + (w.rng() * 2 - 1) * 12;
      const y = air ? m.pos.y + 1 + w.rng() * 3 : m.pos.y + (w.rng() * 2 - 1) * 5;
      const z = m.pos.z + (w.rng() * 2 - 1) * 12;
      if (!isWaterAt(w, x, y, z)) continue;
      m.moveTarget = new THREE.Vector3(x, y, z);
      m.moveSpeed = 1.6;
      m.moveTimeout = 60;
      break;
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Turtles, foxes and goats
// ---------------------------------------------------------------------------------------------
/**
 * Vanilla's turtle: a bred one carries an egg back to the sand it hatched on and lays a clutch
 * there. `home` is the beach it remembers, which the game sets when it spawns or hatches.
 */
export const turtleLayGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m) => m.extra.hasEgg === true,
  tick: (m, w) => {
    const home = m.extra.home as unknown as { x: number; z: number } | undefined;
    if (!home) {
      m.extra.hasEgg = false;
      return;
    }
    const at = new THREE.Vector3(home.x + 0.5, m.pos.y, home.z + 0.5);
    if (m.pos.distanceTo(at) > 1.5) {
      m.moveTarget = at;
      m.moveSpeed = 0.7;
      m.moveTimeout = 120;
      return;
    }
    // it digs where it stands, so long as it is standing on sand
    const bx = Math.floor(m.pos.x);
    const bz = Math.floor(m.pos.z);
    const by = Math.floor(m.pos.y);
    const below = blocks.blockOf(w.getBlock(bx, by - 1, bz)).id;
    if (below !== 'sand' && below !== 'red_sand') return;
    if (w.getBlock(bx, by, bz) !== 0) return;
    // vanilla lays one to four eggs in the one block
    w.setBlock(bx, by, bz, blocks.stateWith('turtle_egg', { eggs: String(1 + Math.floor(w.rng() * 4)), hatch: '0' }));
    w.playSound('dig_sand', bx + 0.5, by, bz + 0.5, 0.9);
    m.extra.hasEgg = false;
    m.moveTarget = null;
  },
});

/** Vanilla's fox: it curls up and sleeps through the day unless something wakes it. */
export const foxSleepGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const p = w.playerPos();
    const disturbed = m.age - m.lastHurtTime < 100 || m.distanceTo(p) < 8;
    // vanilla sleeps a fox by day, out in the light, and wakes it for anything at all
    const sleepy = w.isDay() && w.getSkyLight(Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z)) > 8;
    const asleep = sleepy && !disturbed && m.onGround;
    if (asleep === (m.extra.sleeping === true)) return;
    m.extra.sleeping = asleep;
    if (asleep) {
      m.moveTarget = null;
      m.lookTarget = null;
      m.vel.x = 0;
      m.vel.z = 0;
    }
  },
});

/** Keeps a mob out of the player's way, which is how a fox behaves around one. */
export const avoidPlayerGoal = (range = 12, speed = 1.5): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => m.extra.sleeping !== true && m.distanceTo(w.playerPos()) < range,
  tick: (m, w) => {
    const p = w.playerPos();
    const away = m.pos.clone().sub(p);
    away.y = 0;
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize().multiplyScalar(range);
    m.moveTarget = m.pos.clone().add(away);
    m.moveSpeed = speed;
    m.moveTimeout = 40;
  },
});

/** How long a goat lines up a charge, and how far off it starts one, as vanilla times it. */
export const GOAT_RAM_COOLDOWN = 600;

/**
 * Vanilla's goat ram: it waits out a long cooldown, lowers its head at whatever is four to seven
 * blocks off, then charges, knocking back whatever it reaches.
 */
export const goatRamGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => {
    const cooldown = typeof m.extra.ramCooldown === 'number' ? m.extra.ramCooldown : 0;
    if (cooldown > 0) {
      m.extra.ramCooldown = cooldown - 1;
      return false;
    }
    if (m.isBaby || !w.playerTargetable()) return false;
    const d = m.distanceTo(w.playerPos());
    return d > 4 && d < 8;
  },
  tick: (m, w) => {
    const p = w.playerPos();
    m.lookTarget = p.clone();
    m.moveTarget = p.clone();
    m.moveSpeed = 2;
    m.moveTimeout = 40;
    m.extra.ramming = true;
    if (m.distanceTo(p) > 1.6 || m.attackCooldown > 0) return;
    // vanilla's ram throws the player rather than hurting them much
    w.hurtPlayer(m.def.damage, m.pos, m);
    m.attackCooldown = 20;
    m.extra.ramCooldown = GOAT_RAM_COOLDOWN;
    m.extra.ramming = false;
    m.moveTarget = null;
    w.playSound('sheep', m.pos.x, m.pos.y, m.pos.z, 0.7);
  },
});

// ---------------------------------------------------------------------------------------------
// Pandas, polar bears and llamas
// ---------------------------------------------------------------------------------------------
/** A lazy panda lies on its back for a while at a time, which is all vanilla's laziest gene does. */
export const pandaLieGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: (m, w) => m.extra.gene === 'lazy' && !m.isBaby && w.rng() < 0.005,
  canContinue: (m, w) => w.rng() > 0.005,
  tick: (m) => {
    m.extra.lying = true;
    m.moveTarget = null;
    m.vel.x = 0;
    m.vel.z = 0;
  },
  stop: (m) => {
    m.extra.lying = false;
  },
});

/**
 * Vanilla's polar bear: it leaves everyone alone until a cub of its own is hurt, and then it comes
 * for whoever did it.
 */
export const bearDefendGoal = (): Goal => ({
  flags: 0,
  canUse: (m, w) => {
    if (m.isBaby) return false;
    // its own hurt, or a cub's within a dozen blocks, sets it off
    const cubHurt = w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 12).some((o) => o.def.id === 'polar_bear' && o.isBaby && o.age - o.lastHurtTime < 40);
    return (cubHurt || m.age - m.lastHurtTime < 40) && w.playerTargetable();
  },
  tick: (m) => {
    m.target = 'player';
  },
});

/** How hard a llama's spit hits, which is the damage vanilla gives it. */
export const LLAMA_SPIT_DAMAGE = 1;

/** Vanilla's llama: it spits at whatever hurt it rather than walking over to bite. */
export const llamaSpitGoal = (): Goal => ({
  flags: FLAG_LOOK,
  canUse: (m, w) => m.age - m.lastHurtTime < 100 && w.playerTargetable() && m.distanceTo(w.playerPos()) < 16,
  tick: (m, w) => {
    const eye = w.playerEye();
    m.lookTarget = eye;
    if (m.attackCooldown > 0) return;
    m.attackCooldown = 40;
    w.shootArrow(m.eyePos(), eye, 1.5, LLAMA_SPIT_DAMAGE);
    w.playSound('bow', m.pos.x, m.pos.y, m.pos.z, 0.7);
  },
});

// ---------------------------------------------------------------------------------------------
// Golems
// ---------------------------------------------------------------------------------------------
/** What an iron golem counts as an enemy: the monsters, and never a creeper, which vanilla spares. */
const GOLEM_TARGETS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'wither_skeleton', 'spider', 'cave_spider', 'witch', 'slime', 'slime_medium', 'slime_big', 'pillager', 'vindicator', 'evoker', 'vex', 'ravager', 'silverfish', 'endermite', 'zoglin']);

/** An iron golem goes for whatever monster is nearest, and turns on a player who hits it. */
export const targetMonsterGoal = (range = 16): Goal => ({
  flags: 0,
  canUse: (m, w) => {
    if (m.target) return false;
    // a golem that has been hit comes for whoever hit it, as vanilla's does
    if (m.age - m.lastHurtTime < 100 && w.playerTargetable()) {
      m.target = 'player';
      return false;
    }
    let best: Mob | null = null;
    let bestDist = range;
    for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, range)) {
      if (o === m || o.dead || !GOLEM_TARGETS.has(o.def.id)) continue;
      const d = o.distanceTo(m.pos);
      if (d < bestDist) { bestDist = d; best = o; }
    }
    if (!best) return false;
    m.target = best;
    return false;
  },
  tick: () => {},
});

/**
 * Vanilla's snow golem: it throws snowballs at whatever it can see, which do no damage but push
 * things about, and it leaves a trail of snow behind it where the ground is cold enough.
 */
export const snowGolemGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    // it lays a layer of snow wherever it walks, as vanilla's does
    const bx = Math.floor(m.pos.x);
    const by = Math.floor(m.pos.y);
    const bz = Math.floor(m.pos.z);
    if (m.age % 10 === 0 && w.getBlock(bx, by, bz) === 0 && blocks.blockOf(w.getBlock(bx, by - 1, bz)).solid) {
      w.setBlock(bx, by, bz, blocks.stateWith('snow', { layers: '1' }));
    }
    let target: Mob | null = null;
    let best = 16;
    for (const o of w.mobsNear(m.pos.x, m.pos.y, m.pos.z, 16)) {
      if (o === m || o.dead || !GOLEM_TARGETS.has(o.def.id)) continue;
      const d = o.distanceTo(m.pos);
      if (d < best) { best = d; target = o; }
    }
    if (!target) return;
    m.lookTarget = target.eyePos();
    if (m.attackCooldown > 0) return;
    m.attackCooldown = 20;
    // vanilla's snowball does no damage to most things: it is the knock that matters
    w.shootArrow(m.eyePos(), target.eyePos(), 1.6, 0);
    w.playSound('bow', m.pos.x, m.pos.y, m.pos.z, 1.6);
  },
});

// ---------------------------------------------------------------------------------------------
// Phantoms
// ---------------------------------------------------------------------------------------------
/** Phantoms circle high above the player and swoop at their head (vanilla PhantomCircleAroundAnchorGoal / SweepAttackGoal). */
export const phantomGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const p = w.playerPos();
    const e = m.extra;
    let angle = typeof e.angle === 'number' ? e.angle : (e.angle = w.rng() * Math.PI * 2);
    let mode = typeof e.mode === 'string' ? e.mode : (e.mode = 'circle');
    let timer = typeof e.timer === 'number' ? e.timer : (e.timer = 60 + Math.floor(w.rng() * 140));
    // vanilla: a cat within sixteen blocks of the player keeps phantoms from swooping
    const catGuard = w.mobsNear(p.x, p.y, p.z, 16).some((o) => o.def.id === 'cat' || o.def.id === 'ocelot');
    const canAttack = w.playerTargetable() && m.fireTicks === 0 && !catGuard;
    if (mode === 'swoop' && (!canAttack || timer <= 0)) mode = 'circle';
    if (mode === 'circle') {
      angle += 0.06;
      const radius = 6 + Math.sin(m.age * 0.01) * 4;
      const height = m.fireTicks > 0 ? 30 : 20 + Math.sin(m.age * 0.007) * 6;
      m.moveTarget = new THREE.Vector3(p.x + Math.cos(angle) * radius, p.y + height, p.z + Math.sin(angle) * radius);
      m.moveSpeed = 1.2;
      m.moveTimeout = 40;
      m.lookTarget = null;
      if (--timer <= 0 && canAttack) {
        mode = 'swoop';
        timer = 100;
        w.playSound('phantom', m.pos.x, m.pos.y, m.pos.z);
      }
    } else {
      const eye = w.playerEye();
      m.moveTarget = eye.clone();
      m.moveSpeed = 1.8;
      m.moveTimeout = 40;
      m.lookTarget = eye;
      timer--;
      if (m.distanceTo(eye) < 1.6 && m.attackCooldown === 0) {
        w.hurtPlayer(m.def.damage, m.pos, m);
        m.attackCooldown = 20;
        mode = 'circle';
        timer = 80 + Math.floor(w.rng() * 120);
      }
    }
    e.angle = angle;
    e.mode = mode;
    e.timer = timer;
  },
});

// ---------------------------------------------------------------------------------------------
// Witches
// ---------------------------------------------------------------------------------------------
export const POTION_COLORS: Record<string, number> = { slowness: 0x5a6c81, poison: 0x4e9331, weakness: 0x484d48, instant_damage: 0x430a09, instant_health: 0xf82423 };

/** Vanilla Witch.performRangedAttack potion selection. */
export function witchPotionFor(distance: number, targetHealth: number, has: (id: string) => boolean, rng: () => number): ArrowEffect {
  if (distance >= 8 && !has('slowness')) return { id: 'slowness', ticks: 1800 };
  if (targetHealth >= 8 && !has('poison')) return { id: 'poison', ticks: 900 };
  if (distance <= 3 && !has('weakness') && rng() < 0.25) return { id: 'weakness', ticks: 1800 };
  return { id: 'instant_damage', ticks: 1, amplifier: 0 };
}

/** Witch: keeps within ten blocks, throws a splash potion every 60 ticks, drinks healing when hurt. */
export const witchGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => m.target === 'player' && w.playerTargetable(),
  canContinue: (m, w) => m.target === 'player' && w.playerTargetable() && m.distanceTo(w.playerPos()) < m.def.followRange * 1.2,
  tick: (m, w) => {
    const e = m.extra;
    const drinking = typeof e.drinking === 'number' ? e.drinking : 0;
    if (drinking > 0) {
      m.moveTarget = null;
      e.drinking = drinking - 1;
      if (drinking === 1) {
        if (m.fireTicks > 0) m.fireTicks = 0;
        else m.health = Math.min(m.maxHealth, m.health + 4);
        w.playSound('burp', m.pos.x, m.pos.y + 1, m.pos.z);
      }
      return;
    }
    if ((m.health < m.maxHealth || m.fireTicks > 0) && w.rng() < 0.05) {
      e.drinking = 32;
      w.playSound('eat', m.pos.x, m.pos.y + 1, m.pos.z);
      return;
    }
    const p = w.playerPos();
    const eye = w.playerEye();
    m.lookTarget = eye;
    const d = m.distanceTo(p);
    const los = w.lineOfSight(m.eyePos(), eye);
    if (d > 10 || !los) {
      if (!m.moveTarget || m.age % 10 === 0) {
        m.moveTarget = p.clone();
        m.moveSpeed = 1;
        m.moveTimeout = 40;
      }
    } else m.moveTarget = null;
    if (los && d <= 10 && m.attackCooldown === 0) {
      const effect = witchPotionFor(d, w.playerHealth(), (id) => w.playerHasEffect(id), w.rng);
      w.throwPotion(m.eyePos(), eye, effect, POTION_COLORS[effect.id] ?? 0xffffff);
      m.attackCooldown = 60;
    }
  },
  stop: (m) => {
    m.moveTarget = null;
    m.lookTarget = null;
    m.target = null;
  },
});

// ---------------------------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------------------------
/**
 * Vanilla's guardian: it holds still while the beam charges, and the beam only lands if the
 * guardian keeps sight of what it is aiming at for the whole charge. Out of water it flops, and
 * with nothing to shoot it drifts around the monument the way a fish does.
 */
export const guardianGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const elder = m.def.id === 'elder_guardian';
    const charging = typeof m.extra.beam === 'number' ? m.extra.beam : 0;
    const hasTarget = m.target !== null && targetAlive(m, w) && m.inWater;
    if (!hasTarget) {
      if (charging) stopBeam(m);
      swimAbout(m, w);
      return;
    }
    const eye = targetEye(m, w);
    const from = m.eyePos();
    if (!w.lineOfSight(from, eye) || m.distanceTo(eye) > m.def.followRange) {
      if (charging) stopBeam(m);
      swimAbout(m, w);
      return;
    }
    // the beam is aimed, so the guardian stops where it is and its spikes come out
    m.lookTarget = eye;
    m.moveTarget = null;
    const ticks = charging + 1;
    if (charging === 0) w.playSound('guardian_attack', m.pos.x, m.pos.y, m.pos.z);
    m.extra.beam = ticks;
    m.extra.beamX = eye.x;
    m.extra.beamY = eye.y;
    m.extra.beamZ = eye.z;
    if (ticks < guardianAttackTicks(elder)) return;
    // the charge is full: the beam lands for the guardian's own attack damage
    if (m.target === 'player') w.hurtPlayer(m.def.damage, m.pos, m);
    else (m.target as Mob).hurt(m.def.damage, m.pos, 'other', 0);
    w.playSound('guardian_hurt', m.pos.x, m.pos.y, m.pos.z, 1.4);
    stopBeam(m);
    m.target = null;
  },
});

function stopBeam(m: Mob): void {
  delete m.extra.beam;
  delete m.extra.beamX;
  delete m.extra.beamY;
  delete m.extra.beamZ;
}

/** Guardians drift through the water they live in, and flap uselessly on land. */
function swimAbout(m: Mob, w: MobWorld): void {
  if (!m.inWater) {
    m.moveTarget = null;
    return;
  }
  if (m.moveTarget && w.rng() > 0.02) return;
  for (let i = 0; i < 8; i++) {
    const x = m.pos.x + (w.rng() * 2 - 1) * 8;
    const y = m.pos.y + (w.rng() * 2 - 1) * 4;
    const z = m.pos.z + (w.rng() * 2 - 1) * 8;
    if (!isWaterAt(w, x, y, z)) continue;
    m.moveTarget = new THREE.Vector3(x, y, z);
    m.moveSpeed = 1;
    m.moveTimeout = 80;
    break;
  }
}

/**
 * The elder guardian's curse: every sixty seconds every player within fifty blocks is given five
 * minutes of Mining Fatigue III, as vanilla does on its own 1200-tick beat.
 */
export const elderCurseGoal = (): Goal => ({
  flags: 0,
  canUse: (m) => m.age > 0 && m.age % 1200 === 0,
  tick: (m, w) => {
    if (m.distanceTo(w.playerPos()) > 50) return;
    w.addPlayerEffect('mining_fatigue', 6000, 2);
    w.playSound('elder_guardian_curse', m.pos.x, m.pos.y, m.pos.z);
  },
});

// ---------------------------------------------------------------------------------------------
// Nether mobs
// ---------------------------------------------------------------------------------------------
/**
 * Vanilla's blaze: it hangs in the air over its fortress, and once it has a target it charges three
 * fireballs, pausing between rounds. It cannot be knocked out of the sky and it never lands.
 */
export const blazeGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    if (!targetAlive(m, w) || m.target === null) {
      // drifting: vanilla's blaze bobs about where it spawned
      if (!m.moveTarget || w.rng() < 0.02) {
        m.moveTarget = new THREE.Vector3(m.pos.x + (w.rng() * 2 - 1) * 6, m.pos.y + (w.rng() * 2 - 1) * 3, m.pos.z + (w.rng() * 2 - 1) * 6);
        m.moveSpeed = 0.8;
        m.moveTimeout = 80;
      }
      m.extra.charge = 0;
      return;
    }
    const eye = targetEye(m, w);
    m.lookTarget = eye;
    const d = m.distanceTo(eye);
    // it keeps its distance and only shoots what it can see
    if (d > 12) {
      m.moveTarget = eye.clone();
      m.moveSpeed = 1;
      m.moveTimeout = 40;
    } else if (d < 5) {
      m.moveTarget = m.pos.clone().add(m.pos.clone().sub(eye).setLength(4));
      m.moveSpeed = 1;
      m.moveTimeout = 20;
    } else m.moveTarget = null;
    if (!w.lineOfSight(m.eyePos(), eye)) return;
    const charge = (typeof m.extra.charge === 'number' ? m.extra.charge : 0) + 1;
    m.extra.charge = charge;
    // vanilla: a round of three fireballs, six ticks apart, then a long pause
    const round = charge % 60;
    if (round === 20 || round === 26 || round === 32) {
      w.shootArrow(m.eyePos(), eye, 0.9, m.def.damage, undefined);
      w.playSound('blaze_shoot', m.pos.x, m.pos.y, m.pos.z);
    }
  },
});

/**
 * Vanilla's ghast: it drifts high up and spits a fireball every few seconds at whatever it can see,
 * charging with an audible warning first.
 */
export const ghastGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    if (!m.moveTarget || w.rng() < 0.01) {
      m.moveTarget = new THREE.Vector3(m.pos.x + (w.rng() * 2 - 1) * 16, m.pos.y + (w.rng() * 2 - 1) * 6, m.pos.z + (w.rng() * 2 - 1) * 16);
      m.moveSpeed = 0.6;
      m.moveTimeout = 120;
    }
    if (!targetAlive(m, w) || m.target === null) {
      m.extra.charge = 0;
      return;
    }
    const eye = targetEye(m, w);
    m.lookTarget = eye;
    if (m.distanceTo(eye) > 64 || !w.lineOfSight(m.eyePos(), eye)) {
      m.extra.charge = 0;
      return;
    }
    // vanilla charges for twenty ticks, howls, then lets the fireball go
    const charge = (typeof m.extra.charge === 'number' ? m.extra.charge : 0) + 1;
    m.extra.charge = charge;
    if (charge === 1) w.playSound('ghast_warn', m.pos.x, m.pos.y, m.pos.z);
    if (charge < 40) return;
    m.extra.charge = 0;
    w.shootArrow(m.eyePos(), eye, 0.6, 6, undefined);
    w.playSound('ghast_shoot', m.pos.x, m.pos.y, m.pos.z);
  },
});

/**
 * Piglins and hoglins: piglins leave a player wearing gold alone, as vanilla's do, and hoglins keep
 * away from warped fungus. Both charge whatever they have decided to hate.
 */
export const piglinAngerGoal = (): Goal => ({
  flags: FLAG_TARGET,
  canUse: (m, w) => {
    if (m.target) return false;
    if (!w.playerTargetable()) return false;
    if (m.distanceTo(w.playerPos()) > m.def.followRange) return false;
    // vanilla: gold armour keeps a piglin calm unless it has already been hit
    if (m.age - m.lastHurtTime > 100 && w.playerWearsGold?.()) return false;
    return w.lineOfSight(m.eyePos(), w.playerEye());
  },
  tick: (m) => {
    m.target = 'player';
  },
});

/**
 * Striders walk on lava and shiver on land, as vanilla's do: they wander over the sea they live on
 * and head back to it if they end up ashore.
 */
export const striderGoal = (): Goal => ({
  flags: FLAG_MOVE,
  canUse: () => true,
  tick: (m, w) => {
    const onLava = isLavaAt(w, m.pos.x, m.pos.y - 0.2, m.pos.z);
    m.extra.cold = !onLava;
    if (m.moveTarget && w.rng() > 0.02) return;
    for (let i = 0; i < 10; i++) {
      const x = m.pos.x + (w.rng() * 2 - 1) * 8;
      const z = m.pos.z + (w.rng() * 2 - 1) * 8;
      // a strider looks for more of its lava sea, and settles for anything solid when ashore
      if (!isLavaAt(w, x, m.pos.y - 0.2, z) && onLava) continue;
      m.moveTarget = new THREE.Vector3(x, m.pos.y, z);
      m.moveSpeed = onLava ? 1 : 0.6;
      m.moveTimeout = 100;
      return;
    }
  },
});

const isLavaAt = (w: MobWorld, x: number, y: number, z: number) => {
  const s = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return s !== 0 && blocks.blockOf(s).id === 'lava';
};

// ---------------------------------------------------------------------------------------------
// The Wither
// ---------------------------------------------------------------------------------------------
/** Vanilla holds the Wither still and invulnerable for this long, then it goes off. */
export const WITHER_SPAWN_TICKS = 220;
/** Below half its health vanilla gives it armour and sends it charging. */
export const witherArmoured = (m: Mob): boolean => m.health <= m.maxHealth / 2;

/**
 * Vanilla's Wither: it hangs over the fight, keeps its distance and throws skulls, three heads at a
 * time. While it is being summoned it cannot be hurt and does nothing; when the count runs out it
 * blows a hole where it was born.
 */
export const witherGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const spawning = typeof m.extra.spawning === 'number' ? m.extra.spawning : 0;
    if (spawning > 0) {
      // the summoning: it hangs there gathering itself, and nothing can touch it
      m.extra.spawning = spawning - 1;
      m.invulnerable = 20;
      m.moveTarget = null;
      m.vel.set(0, 0, 0);
      if (spawning === 1) {
        w.explode(m.pos.x, m.pos.y + 1, m.pos.z, 7, m);
        w.playSound('wither_spawn', m.pos.x, m.pos.y, m.pos.z);
      }
      return;
    }
    if (!targetAlive(m, w) || m.target === null) {
      if (w.playerTargetable() && m.distanceTo(w.playerPos()) < m.def.followRange) m.target = 'player';
      return;
    }
    const eye = targetEye(m, w);
    m.lookTarget = eye;
    const d = m.distanceTo(eye);
    // vanilla keeps it above and away from what it is fighting, and charges once it is armoured
    const charging = witherArmoured(m);
    if (charging && d > 3) {
      m.moveTarget = eye.clone();
      m.moveSpeed = 1.4;
      m.moveTimeout = 40;
    } else if (d > 16 || d < 6) {
      // back off when it is crowded, close in when it is far; a zero-length gap would give no
      // direction at all, so it drifts sideways instead
      const gap = m.pos.clone().sub(eye);
      if (gap.lengthSq() < 1e-6) gap.set(1, 0, 0);
      const away = d < 6 ? gap.setLength(10) : gap.setLength(0);
      m.moveTarget = eye.clone().add(away).setY(eye.y + 5);
      m.moveSpeed = 1;
      m.moveTimeout = 40;
    } else m.moveTarget = null;
    if (!w.lineOfSight(m.eyePos(), eye)) return;
    // three heads, each firing on its own beat, as vanilla staggers them
    const t = (typeof m.extra.fire === 'number' ? m.extra.fire : 0) + 1;
    m.extra.fire = t;
    for (const [head, beat] of [[0, 0], [1, 15], [2, 30]] as [number, number][]) {
      if (t % 45 !== beat) continue;
      const from = m.eyePos();
      from.x += (head - 1) * 1.2;
      w.shootArrow(from, eye, 0.8, 5, { id: 'wither', ticks: 200 });
      w.playSound('wither_shoot', m.pos.x, m.pos.y, m.pos.z);
    }
  },
});

// ---------------------------------------------------------------------------------------------
// The shulker
// ---------------------------------------------------------------------------------------------
const SHULKER_RANGE = 16;

/**
 * Vanilla's shulker: it never moves. It opens its lid when a player comes within sixteen blocks and
 * it can see them, and while it is open it fires a bullet every few seconds — the shot that leaves
 * whoever it hits drifting upward.
 */
export const shulkerGoal = (): Goal => ({
  flags: FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    // it is a block with a lid: nothing about it moves, however hard it is pushed
    m.moveTarget = null;
    m.vel.set(0, 0, 0);
    const p = w.playerPos();
    const eye = w.playerEye();
    const near = m.pos.distanceTo(p) < SHULKER_RANGE && w.playerTargetable() && w.lineOfSight(m.eyePos(), eye);
    const open = typeof m.extra.open === 'number' ? m.extra.open : 0;
    m.extra.open = Math.max(0, Math.min(SHULKER_OPEN_TICKS, open + (near ? 1 : -1)));
    if (!near || m.extra.open < SHULKER_OPEN_TICKS) return;
    m.lookTarget = eye;
    // vanilla counts down one to five and a half seconds between shots, and its bullet leaves
    // whoever it hits drifting upward
    const wait = (typeof m.extra.shot === 'number' ? m.extra.shot : 0) - 1;
    if (wait > 0) {
      m.extra.shot = wait;
      return;
    }
    m.extra.shot = 20 + Math.floor(w.rng() * 10) * 10;
    w.shootArrow(m.eyePos(), eye, 0.7, m.def.damage, { id: 'levitation', ticks: 200 });
    w.playSound('shulker_shoot', m.pos.x, m.pos.y, m.pos.z);
  },
});

// ---------------------------------------------------------------------------------------------
// The Ender Dragon
// ---------------------------------------------------------------------------------------------
/** The circle vanilla flies the dragon around, and the height it holds. */
const DRAGON_RADIUS = 45;
export const DRAGON_HEIGHT = 78;

/**
 * Vanilla's dragon: it circles the middle island, dives at whoever is down there, and comes back to
 * perch over the portal. While a crystal is still standing it heals, which is what makes the
 * crystals the fight rather than the dragon.
 */
export const dragonGoal = (): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: () => true,
  tick: (m, w) => {
    const angle = (typeof m.extra.angle === 'number' ? m.extra.angle : (m.extra.angle = 0)) + 0.02;
    m.extra.angle = angle;
    // the crystals still standing heal it, one health every ten ticks each, as vanilla does
    const crystals = w.mobsNear(0, DRAGON_HEIGHT, 0, 128).filter((o) => o.def.id === 'end_crystal' && !o.dead);
    m.extra.crystals = crystals.length;
    if (crystals.length && m.age % 10 === 0) m.health = Math.min(m.maxHealth, m.health + 1);
    // vanilla draws a beam from every crystal that is healing it, which is how a player finds them
    for (const c of crystals) {
      c.extra.beam = 2;
      c.extra.beamX = m.pos.x;
      c.extra.beamY = m.pos.y + 1;
      c.extra.beamZ = m.pos.z;
    }
    const p = w.playerPos();
    const near = Math.hypot(p.x, p.z) < DRAGON_RADIUS + 20 && w.playerTargetable();
    const diving = near && crystals.length === 0 && Math.sin(angle * 3) > 0.6;
    if (diving) {
      // a pass at the player, low over the island
      m.moveTarget = new THREE.Vector3(p.x, p.y + 3, p.z);
      m.moveSpeed = 1.6;
      m.moveTimeout = 40;
      m.lookTarget = w.playerEye();
      const a = m.aabb();
      const b = w.playerBox();
      if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ && m.attackCooldown === 0) {
        w.hurtPlayer(m.def.damage, m.pos, m);
        m.attackCooldown = 20;
      }
      return;
    }
    // the circle: vanilla keeps it turning around the middle of the island
    const x = Math.cos(angle) * DRAGON_RADIUS;
    const z = Math.sin(angle) * DRAGON_RADIUS;
    m.moveTarget = new THREE.Vector3(x, DRAGON_HEIGHT + Math.sin(angle * 2) * 6, z);
    m.moveSpeed = 1.2;
    m.moveTimeout = 60;
    // it faces the way it is going, which is what makes the circling read as flight
    m.lookTarget = new THREE.Vector3(Math.cos(angle + 0.4) * DRAGON_RADIUS, DRAGON_HEIGHT, Math.sin(angle + 0.4) * DRAGON_RADIUS);
  },
});

/** Whether anything is still healing the dragon: vanilla lets nothing hurt it while one stands. */
export const dragonShielded = (m: Mob): boolean => (typeof m.extra.crystals === 'number' ? m.extra.crystals : 0) > 0;

export { FLAG_MOVE as _FLAG_MOVE };
