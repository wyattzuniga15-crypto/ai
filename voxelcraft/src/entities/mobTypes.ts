/** Mob definitions: vanilla box models (classic layouts) on the entity textures, stats from data/mobs.json, AI goal lists. */
import mobsJson from '../../data/mobs.json';
import type { ModelDef } from './boxModel.ts';
import type { Goal, MobStats } from './mob.ts';
import { bowAttackGoal, creeperGoal, floatGoal, lookAtPlayerGoal, loseTargetGoal, meleeAttackGoal, panicGoal, randomLookGoal, targetPlayerGoal, wanderGoal } from './ai.ts';

interface MobJson {
  id: string; name: string; width: number; height: number; health?: number; damage?: number; speed?: number; xp?: number; disposition?: string;
}
const mobData = new Map<string, MobJson>((mobsJson as MobJson[]).map((m) => [m.id, m]));

const HALF_PI = Math.PI / 2;

const biped = (texture: string, texH: number, thin = false): ModelDef => ({
  texture,
  texW: 64,
  texH,
  parts: [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }, ...(texH === 64 ? [{ uv: [32, 0] as [number, number], box: [-4, -8, -4, 8, 8, 8] as [number, number, number, number, number, number], inflate: 0.5 }] : [])] },
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [16, 16], box: [-4, 0, -2, 8, 12, 4] }] },
    { name: 'right_arm', pivot: [-5, 2, 0], boxes: [thin ? { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2] } : { uv: [40, 16], box: [-3, -2, -2, 4, 12, 4] }] },
    { name: 'left_arm', pivot: [5, 2, 0], boxes: [thin ? { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2], mirror: true } : texH === 64 ? { uv: [32, 48], box: [-1, -2, -2, 4, 12, 4] } : { uv: [40, 16], box: [-1, -2, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_leg', pivot: [thin ? -2 : -1.9, 12, 0], boxes: [thin ? { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2] } : { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_leg', pivot: [thin ? 2 : 1.9, 12, 0], boxes: [thin ? { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2], mirror: true } : texH === 64 ? { uv: [16, 48], box: [-2, 0, -2, 4, 12, 4] } : { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ],
});

const creeperModel: ModelDef = {
  texture: 'creeper/creeper.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 6, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }] },
    { name: 'body', pivot: [0, 6, 0], boxes: [{ uv: [16, 16], box: [-4, 0, -2, 8, 12, 4] }] },
    { name: 'leg0', pivot: [-2, 18, 4], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
    { name: 'leg1', pivot: [2, 18, 4], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
    { name: 'leg2', pivot: [-2, 18, -4], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
    { name: 'leg3', pivot: [2, 18, -4], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
  ],
};

const spiderModel: ModelDef = {
  texture: 'spider/spider.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 15, -3], boxes: [{ uv: [32, 4], box: [-4, -4, -8, 8, 8, 8] }] },
    { name: 'neck', pivot: [0, 15, 0], boxes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6] }] },
    { name: 'body', pivot: [0, 15, 9], boxes: [{ uv: [0, 12], box: [-5, -4, -6, 10, 8, 12] }] },
    ...[2, 1, 0, -1].flatMap((z, i) => [
      { name: `right_leg${i}`, pivot: [-4, 15, z] as [number, number, number], boxes: [{ uv: [18, 0] as [number, number], box: [-15, -1, -1, 16, 2, 2] as [number, number, number, number, number, number] }] },
      { name: `left_leg${i}`, pivot: [4, 15, z] as [number, number, number], boxes: [{ uv: [18, 0] as [number, number], box: [-1, -1, -1, 16, 2, 2] as [number, number, number, number, number, number], mirror: true }] },
    ]),
  ],
};

const cowModel: ModelDef = {
  texture: 'cow/temperate_cow.png', texW: 64, texH: 64,
  parts: [
    { name: 'head', pivot: [0, 4, -8], boxes: [{ uv: [0, 0], box: [-4, -4, -6, 8, 8, 6] }, { uv: [22, 0], box: [-5, -5, -4, 1, 3, 1] }, { uv: [22, 0], box: [4, -5, -4, 1, 3, 1] }] },
    { name: 'body', pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [18, 4], box: [-6, -10, -7, 12, 18, 10] }, { uv: [52, 0], box: [-2, 2, -8, 4, 6, 1] }] },
    { name: 'right_hind_leg', pivot: [-4, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_hind_leg', pivot: [4, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_front_leg', pivot: [-4, 12, -6], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_front_leg', pivot: [4, 12, -6], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ],
};

const pigModel: ModelDef = {
  texture: 'pig/temperate_pig.png', texW: 64, texH: 64,
  parts: [
    { name: 'head', pivot: [0, 12, -6], boxes: [{ uv: [0, 0], box: [-4, -4, -8, 8, 8, 8] }, { uv: [16, 16], box: [-2, 0, -9, 4, 3, 1] }] },
    { name: 'body', pivot: [0, 11, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [28, 8], box: [-5, -10, -7, 10, 16, 8] }] },
    { name: 'right_hind_leg', pivot: [-3, 18, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
    { name: 'left_hind_leg', pivot: [3, 18, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], mirror: true }] },
    { name: 'right_front_leg', pivot: [-3, 18, -5], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4] }] },
    { name: 'left_front_leg', pivot: [3, 18, -5], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], mirror: true }] },
  ],
};

const sheepModel: ModelDef = {
  texture: 'sheep/sheep.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 6, -8], boxes: [{ uv: [0, 0], box: [-3, -4, -6, 6, 6, 8] }] },
    { name: 'body', pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [28, 8], box: [-4, -10, -7, 8, 16, 6] }] },
    { name: 'right_hind_leg', pivot: [-3, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_hind_leg', pivot: [3, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_front_leg', pivot: [-3, 12, -5], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_front_leg', pivot: [3, 12, -5], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
    // wool layer
    { name: 'wool_head', parent: 'head', pivot: [0, 6, -8], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [0, 0], box: [-3, -4, -6, 6, 6, 6], inflate: 0.6 }] },
    { name: 'wool_body', parent: 'body', pivot: [0, 5, 2], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [28, 8], box: [-4, -10, -7, 8, 16, 6], inflate: 1.75 }] },
    { name: 'wool_rhl', parent: 'right_hind_leg', pivot: [-3, 12, 7], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], inflate: 0.5 }] },
    { name: 'wool_lhl', parent: 'left_hind_leg', pivot: [3, 12, 7], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], inflate: 0.5, mirror: true }] },
    { name: 'wool_rfl', parent: 'right_front_leg', pivot: [-3, 12, -5], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], inflate: 0.5 }] },
    { name: 'wool_lfl', parent: 'left_front_leg', pivot: [3, 12, -5], texture: 'sheep/sheep_wool.png', boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 6, 4], inflate: 0.5, mirror: true }] },
  ],
};

const chickenModel: ModelDef = {
  texture: 'chicken/temperate_chicken.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 15, -4], boxes: [{ uv: [0, 0], box: [-2, -6, -2, 4, 6, 3] }, { uv: [14, 0], box: [-2, -4, -4, 4, 2, 2] }, { uv: [14, 4], box: [-1, -2, -3, 2, 2, 2] }] },
    { name: 'body', pivot: [0, 16, 0], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [0, 9], box: [-3, -4, -3, 6, 8, 6] }] },
    { name: 'right_leg', pivot: [-2, 19, 1], boxes: [{ uv: [26, 0], box: [-1, 0, -3, 3, 5, 3] }] },
    { name: 'left_leg', pivot: [1, 19, 1], boxes: [{ uv: [26, 0], box: [-1, 0, -3, 3, 5, 3], mirror: true }] },
    { name: 'right_wing', pivot: [-4, 13, 0], boxes: [{ uv: [24, 13], box: [0, 0, -3, 1, 4, 6] }] },
    { name: 'left_wing', pivot: [4, 13, 0], boxes: [{ uv: [24, 13], box: [-1, 0, -3, 1, 4, 6], mirror: true }] },
  ],
};

interface MobSpec {
  model: ModelDef;
  animation: MobStats['animation'];
  eyeHeight: number;
  followRange: number;
  goals: () => Goal[];
  burnsInSun?: boolean;
  climbs?: boolean;
  flapping?: boolean;
  loot?: string;
}

const passiveGoals = (panicSpeed = 1.25) => [floatGoal, panicGoal(panicSpeed), wanderGoal(120, 1, 10), lookAtPlayerGoal(6), randomLookGoal];

export const MOB_SPECS: Record<string, MobSpec> = {
  zombie: { model: biped('zombie/zombie.png', 64), animation: 'biped', eyeHeight: 1.74, followRange: 35, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(35), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  skeleton: { model: biped('skeleton/skeleton.png', 32, true), animation: 'biped', eyeHeight: 1.74, followRange: 16, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), bowAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  creeper: { model: creeperModel, animation: 'creeper', eyeHeight: 1.445, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), creeperGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  spider: { model: spiderModel, animation: 'spider', eyeHeight: 0.65, followRange: 16, climbs: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16, true), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  cow: { model: cowModel, animation: 'quadruped', eyeHeight: 1.3, followRange: 16, goals: () => passiveGoals() },
  pig: { model: pigModel, animation: 'quadruped', eyeHeight: 0.8, followRange: 16, goals: () => passiveGoals() },
  sheep: { model: sheepModel, animation: 'quadruped', eyeHeight: 1.2, followRange: 16, goals: () => passiveGoals() },
  chicken: { model: chickenModel, animation: 'chicken', eyeHeight: 0.644, followRange: 16, flapping: true, goals: () => passiveGoals(1.4) },
};

export function mobStats(id: string): MobStats | null {
  const spec = MOB_SPECS[id];
  const data = mobData.get(id);
  if (!spec || !data) return null;
  return {
    id,
    name: data.name,
    width: data.width,
    height: data.height,
    health: data.health ?? 10,
    damage: data.damage ?? 0,
    speed: data.speed ?? 0.25,
    xp: data.xp ?? 0,
    disposition: (data.disposition as MobStats['disposition']) ?? 'passive',
    followRange: spec.followRange,
    eyeHeight: spec.eyeHeight,
    loot: spec.loot ?? id,
    burnsInSun: spec.burnsInSun,
    climbs: spec.climbs,
    flapping: spec.flapping,
    model: spec.model,
    animation: spec.animation,
  };
}

export const HOSTILE_TYPES = ['zombie', 'skeleton', 'creeper', 'spider'];
export const ANIMAL_TYPES = ['cow', 'pig', 'sheep', 'chicken'];
