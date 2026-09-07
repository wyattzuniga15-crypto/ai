/** AI goals for mobs (vanilla-style goal selector with priorities and exclusive flags). */
import * as THREE from 'three';
import { FLAG_LOOK, FLAG_MOVE, FLAG_TARGET, Mob, type ArrowEffect, type Goal, type MobWorld } from './mob.ts';
import { EQUINE_TYPES, inheritEquine } from './mobTypes.ts';
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
    const d = m.distanceTo(w.playerPos());
    if (d > range) return false;
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
export const bowAttackGoal = (effect?: ArrowEffect): Goal => {
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
        w.shootArrow(m.eyePos(), eye, 1.6, 2, effect);
        m.attackCooldown = 40;
      }
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
        const baby = w.spawnMob(offspringOf(m.def.id, o.def.id), (m.pos.x + o.pos.x) / 2, Math.max(m.pos.y, o.pos.y), (m.pos.z + o.pos.z) / 2, true);
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

export { FLAG_MOVE as _FLAG_MOVE };
