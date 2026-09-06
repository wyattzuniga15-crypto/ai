/** AI goals for mobs (vanilla-style goal selector with priorities and exclusive flags). */
import * as THREE from 'three';
import { FLAG_LOOK, FLAG_MOVE, FLAG_TARGET, Mob, type ArrowEffect, type Goal, type MobWorld } from './mob.ts';
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

/** Chase and hit the player. */
export const meleeAttackGoal = (reachBonus = 0, onHit?: (m: Mob, w: MobWorld) => void): Goal => ({
  flags: FLAG_MOVE | FLAG_LOOK,
  canUse: (m, w) => m.target === 'player' && w.playerTargetable(),
  canContinue: (m, w) => m.target === 'player' && w.playerTargetable() && m.distanceTo(w.playerPos()) < m.def.followRange * 1.2,
  tick: (m, w) => {
    const p = w.playerPos();
    m.lookTarget = w.playerEye();
    const d = Math.hypot(p.x - m.pos.x, p.z - m.pos.z);
    if (d > 1.5) {
      if (!m.moveTarget || m.age % 10 === 0) {
        m.moveTarget = p.clone();
        m.moveSpeed = 1;
        m.moveTimeout = 40;
      }
    } else m.moveTarget = null;
    const reach = m.def.width / 2 + 0.8 + reachBonus;
    if (d <= reach + 0.3 && Math.abs(p.y - m.pos.y) < 2 && m.attackCooldown === 0) {
      w.hurtPlayer(m.def.damage, m.pos);
      onHit?.(m, w);
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
  canUse: (m, w) => m.target === 'player' && (!w.playerTargetable() || m.distanceTo(w.playerPos()) > m.def.followRange * 1.5),
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

export { FLAG_MOVE as _FLAG_MOVE };
