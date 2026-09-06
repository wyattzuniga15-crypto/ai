/** Mob definitions: vanilla box models (classic layouts) on the entity textures, stats from data/mobs.json, AI goal lists. */
import mobsJson from '../../data/mobs.json';
import type { ModelDef } from './boxModel.ts';
import type { Goal, MobStats } from './mob.ts';
import { bowAttackGoal, breedGoal, creeperGoal, eatGrassGoal, endermanGoal, floatGoal, followParentGoal, lookAtPlayerGoal, loseTargetGoal, meleeAttackGoal, panicGoal, randomLookGoal, slimeGoal, targetPlayerGoal, wanderGoal } from './ai.ts';
import type { BiomeDef } from '../world/biomes.ts';

interface MobJson {
  id: string; name: string; width: number; height: number; health?: number; damage?: number; speed?: number; xp?: number; disposition?: string;
}
const mobData = new Map<string, MobJson>((mobsJson as MobJson[]).map((m) => [m.id, m]));

const HALF_PI = Math.PI / 2;

/** Humanoid model; `overlay` adds a second skin layer (drowned outer layer, stray overlay) on every part. */
const biped = (texture: string, texH: number, thin = false, overlay?: string): ModelDef => {
  const parts: ModelDef['parts'] = [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }, ...(texH === 64 ? [{ uv: [32, 0] as [number, number], box: [-4, -8, -4, 8, 8, 8] as [number, number, number, number, number, number], inflate: 0.5 }] : [])] },
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [16, 16], box: [-4, 0, -2, 8, 12, 4] }] },
    { name: 'right_arm', pivot: [-5, 2, 0], boxes: [thin ? { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2] } : { uv: [40, 16], box: [-3, -2, -2, 4, 12, 4] }] },
    { name: 'left_arm', pivot: [5, 2, 0], boxes: [thin ? { uv: [40, 16], box: [-1, -2, -1, 2, 12, 2], mirror: true } : texH === 64 ? { uv: [32, 48], box: [-1, -2, -2, 4, 12, 4] } : { uv: [40, 16], box: [-1, -2, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_leg', pivot: [thin ? -2 : -1.9, 12, 0], boxes: [thin ? { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2] } : { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_leg', pivot: [thin ? 2 : 1.9, 12, 0], boxes: [thin ? { uv: [0, 16], box: [-1, 0, -1, 2, 12, 2], mirror: true } : texH === 64 ? { uv: [16, 48], box: [-2, 0, -2, 4, 12, 4] } : { uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ];
  if (overlay) {
    for (const p of parts.slice()) {
      parts.push({ name: `${p.name}_overlay`, parent: p.name, pivot: p.pivot, texture: overlay, boxes: p.boxes.filter((b) => !b.inflate).map((b) => ({ ...b, inflate: p.name === 'head' ? 0.5 : 0.25 })) });
    }
  }
  return { texture, texW: 64, texH, parts };
};

const slimeModel = (): ModelDef => ({
  texture: 'slime/slime.png', texW: 64, texH: 32,
  // pivots at the feet so the squish animation scales around the ground
  parts: [
    { name: 'cube', pivot: [0, 24, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }] },
    { name: 'inner', pivot: [0, 24, 0], boxes: [{ uv: [0, 16], box: [-3, -7, -3, 6, 6, 6] }] },
    { name: 'right_eye', pivot: [0, 24, 0], boxes: [{ uv: [32, 0], box: [-3.25, -6, -3.5, 2, 2, 2] }] },
    { name: 'left_eye', pivot: [0, 24, 0], boxes: [{ uv: [32, 4], box: [1.25, -6, -3.5, 2, 2, 2] }] },
    { name: 'mouth', pivot: [0, 24, 0], boxes: [{ uv: [32, 8], box: [0, -3, -3.5, 1, 1, 1] }] },
  ],
});

const endermanModel: ModelDef = {
  texture: 'enderman/enderman.png', texW: 64, texH: 32,
  // vanilla humanoid parts raised so the 30 px limbs put the feet on the ground
  parts: [
    { name: 'head', pivot: [0, -18, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }, { uv: [0, 16], box: [-4, -8, -4, 8, 8, 8], inflate: -0.5 }] },
    { name: 'eyes', parent: 'head', pivot: [0, -18, 0], texture: 'enderman/enderman_eyes.png', boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], inflate: 0.05 }] },
    { name: 'body', pivot: [0, -18, 0], boxes: [{ uv: [32, 16], box: [-4, 0, -2, 8, 12, 4] }] },
    { name: 'right_arm', pivot: [-5, -16, 0], boxes: [{ uv: [56, 0], box: [-1, -2, -1, 2, 30, 2] }] },
    { name: 'left_arm', pivot: [5, -16, 0], boxes: [{ uv: [56, 0], box: [-1, -2, -1, 2, 30, 2], mirror: true }] },
    { name: 'right_leg', pivot: [-2, -6, 0], boxes: [{ uv: [56, 0], box: [-1, 0, -1, 2, 30, 2] }] },
    { name: 'left_leg', pivot: [2, -6, 0], boxes: [{ uv: [56, 0], box: [-1, 0, -1, 2, 30, 2], mirror: true }] },
  ],
};

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

const spiderModel = (texture = 'spider/spider.png'): ModelDef => ({
  texture, texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 15, -3], boxes: [{ uv: [32, 4], box: [-4, -4, -8, 8, 8, 8] }] },
    { name: 'neck', pivot: [0, 15, 0], boxes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6] }] },
    { name: 'body', pivot: [0, 15, 9], boxes: [{ uv: [0, 12], box: [-5, -4, -6, 10, 8, 12] }] },
    ...[2, 1, 0, -1].flatMap((z, i) => [
      { name: `right_leg${i}`, pivot: [-4, 15, z] as [number, number, number], boxes: [{ uv: [18, 0] as [number, number], box: [-15, -1, -1, 16, 2, 2] as [number, number, number, number, number, number] }] },
      { name: `left_leg${i}`, pivot: [4, 15, z] as [number, number, number], boxes: [{ uv: [18, 0] as [number, number], box: [-1, -1, -1, 16, 2, 2] as [number, number, number, number, number, number], mirror: true }] },
    ]),
  ],
});

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
  scale?: number;
  /** mobs.json entry to read stats from when it differs from the spec id (slime sizes). */
  data?: string;
  override?: Partial<Pick<MobStats, 'health' | 'damage' | 'width' | 'height' | 'xp' | 'speed'>>;
}

const passiveGoals = (panicSpeed = 1.25, extra: Goal[] = []) => [floatGoal, panicGoal(panicSpeed), breedGoal(), followParentGoal(), ...extra, wanderGoal(120, 1, 10), lookAtPlayerGoal(6), randomLookGoal];

/** Vanilla breeding items per animal. */
export const BREEDING_FOODS: Record<string, string[]> = {
  cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'],
};
export const isBreedingFood = (mob: string, item: string): boolean => BREEDING_FOODS[mob]?.includes(item) ?? false;

/** Vanilla Sheep.getRandomSheepColor: 5% black, gray and light gray, 3% brown, 0.16% pink, else white. */
export function randomSheepColor(rng: () => number): string {
  const i = Math.floor(rng() * 100);
  if (i < 5) return 'black';
  if (i < 10) return 'gray';
  if (i < 15) return 'light_gray';
  if (i < 18) return 'brown';
  return Math.floor(rng() * 500) === 0 ? 'pink' : 'white';
}

export const MOB_SPECS: Record<string, MobSpec> = {
  zombie: { model: biped('zombie/zombie.png', 64), animation: 'biped', eyeHeight: 1.74, followRange: 35, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(35), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  skeleton: { model: biped('skeleton/skeleton.png', 32, true), animation: 'biped', eyeHeight: 1.74, followRange: 16, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), bowAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  creeper: { model: creeperModel, animation: 'creeper', eyeHeight: 1.445, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), creeperGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  spider: { model: spiderModel(), animation: 'spider', eyeHeight: 0.65, followRange: 16, climbs: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16, true), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // hunger for 7 s on hit (vanilla scales with difficulty; normal)
  husk: { model: biped('zombie/husk.png', 64), animation: 'biped', eyeHeight: 1.74, followRange: 35, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(35), meleeAttackGoal(0, (_m, w) => w.addPlayerEffect('hunger', 140)), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  drowned: { model: biped('zombie/drowned.png', 64, false, 'zombie/drowned_outer_layer.png'), animation: 'biped', eyeHeight: 1.74, followRange: 35, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(35), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // stray arrows carry 30 s of slowness
  stray: { model: biped('skeleton/stray.png', 32, true, 'skeleton/stray_overlay.png'), animation: 'biped', eyeHeight: 1.74, followRange: 16, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), bowAttackGoal({ id: 'slowness', ticks: 600 }), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // wither for 10 s on hit; rendered at 1.2× like vanilla
  wither_skeleton: { model: biped('skeleton/wither_skeleton.png', 32, true), animation: 'biped', eyeHeight: 2.1, followRange: 16, scale: 1.2, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(0.2, (_m, w) => w.addPlayerEffect('wither', 200)), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // poison for 7 s on hit
  cave_spider: { model: spiderModel('spider/cave_spider.png'), animation: 'spider', eyeHeight: 0.45, followRange: 16, climbs: true, scale: 0.7, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16, true), meleeAttackGoal(0, (_m, w) => w.addPlayerEffect('poison', 140)), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // slime sizes 1, 2 and 4: health size², damage size (none for the smallest), only the smallest drops slimeballs
  slime: { model: slimeModel(), animation: 'slime', eyeHeight: 0.325, followRange: 16, scale: 1, override: { width: 0.51, height: 0.51, health: 1, damage: 0, xp: 1 }, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
  slime_medium: { model: slimeModel(), animation: 'slime', eyeHeight: 0.65, followRange: 16, scale: 2, data: 'slime', loot: 'slime_medium', override: { width: 1.02, height: 1.02, health: 4, damage: 2, xp: 2 }, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
  slime_big: { model: slimeModel(), animation: 'slime', eyeHeight: 1.3, followRange: 16, scale: 4, data: 'slime', loot: 'slime_big', override: { width: 2.04, height: 2.04, health: 16, damage: 4, xp: 4 }, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
  enderman: { model: endermanModel, animation: 'biped', eyeHeight: 2.55, followRange: 64, goals: () => [endermanGoal(), loseTargetGoal(), meleeAttackGoal(0.3), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  cow: { model: cowModel, animation: 'quadruped', eyeHeight: 1.3, followRange: 16, goals: () => passiveGoals() },
  pig: { model: pigModel, animation: 'quadruped', eyeHeight: 0.8, followRange: 16, goals: () => passiveGoals() },
  sheep: { model: sheepModel, animation: 'quadruped', eyeHeight: 1.2, followRange: 16, goals: () => passiveGoals(1.25, [eatGrassGoal()]) },
  chicken: { model: chickenModel, animation: 'chicken', eyeHeight: 0.644, followRange: 16, flapping: true, goals: () => passiveGoals(1.4) },
};

export function mobStats(id: string): MobStats | null {
  const spec = MOB_SPECS[id];
  const data = mobData.get(spec?.data ?? id);
  if (!spec || !data) return null;
  const o = spec.override ?? {};
  return {
    id,
    name: data.name,
    width: o.width ?? data.width,
    height: o.height ?? data.height,
    health: o.health ?? data.health ?? 10,
    damage: o.damage ?? data.damage ?? 0,
    speed: o.speed ?? data.speed ?? 0.25,
    xp: o.xp ?? data.xp ?? 0,
    disposition: (data.disposition as MobStats['disposition']) ?? 'passive',
    followRange: spec.followRange,
    eyeHeight: spec.eyeHeight,
    loot: spec.loot ?? id,
    burnsInSun: spec.burnsInSun,
    climbs: spec.climbs,
    flapping: spec.flapping,
    model: spec.model,
    animation: spec.animation,
    scale: spec.scale,
  };
}

export const HOSTILE_TYPES = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman'];
/** Vanilla overworld monster spawn weights. */
const HOSTILE_WEIGHTS: [string, number][] = [['zombie', 95], ['skeleton', 100], ['creeper', 100], ['spider', 100], ['enderman', 10]];
const SLIME_SIZES = ['slime', 'slime_medium', 'slime_big'];

/**
 * Java's `Random(seed).nextInt(10) == 0` over vanilla's slime-chunk seed mix, with the int32
 * overflow of the chunk products reproduced.
 */
export function isSlimeChunk(cx: number, cz: number, seed: number): boolean {
  const mask = (1n << 48n) - 1n;
  const mixed = (BigInt(seed) + BigInt(Math.imul(Math.imul(cx, cx), 0x4c1906)) + BigInt(Math.imul(cx, 0x5ac0db)) + BigInt(Math.imul(Math.imul(cz, cz), 0x4307a7)) + BigInt(Math.imul(cz, 0x5f24f))) ^ 0x3ad8025fn;
  let state = (mixed ^ 0x5deece66dn) & mask;
  for (;;) {
    state = (state * 0x5deece66dn + 0xbn) & mask;
    const bits = Number(state >> 17n);
    const val = bits % 10;
    if (bits - val + 9 < 2 ** 31) return val === 0;
  }
}

/** Picks a monster for a natural spawn attempt following vanilla biome rules. */
export function pickHostile(rng: () => number, biome: BiomeDef | undefined, y: number, slimeChunk: boolean): string {
  if (slimeChunk && y < 40 && rng() < 0.5) return SLIME_SIZES[Math.floor(rng() * 3)];
  if (biome?.category === 'swamp' && y >= 50 && y <= 70 && rng() < 0.5) return SLIME_SIZES[Math.floor(rng() * 3)];
  let total = 0;
  for (const [, w] of HOSTILE_WEIGHTS) total += w;
  let r = rng() * total;
  let type = 'zombie';
  for (const [t, w] of HOSTILE_WEIGHTS) {
    r -= w;
    if (r < 0) { type = t; break; }
  }
  // deserts spawn husks and snowy biomes strays in place of most zombies and skeletons
  if (type === 'zombie' && biome?.category === 'desert' && rng() < 0.8) return 'husk';
  if (type === 'skeleton' && biome?.precipitation === 'snow' && rng() < 0.8) return 'stray';
  return type;
}
export const ANIMAL_TYPES = ['cow', 'pig', 'sheep', 'chicken'];
