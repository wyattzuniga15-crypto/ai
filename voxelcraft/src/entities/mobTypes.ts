/** Mob definitions: vanilla box models (classic layouts) on the entity textures, stats from data/mobs.json, AI goal lists. */
import mobsJson from '../../data/mobs.json';
import type { ModelDef } from './boxModel.ts';
import type { Goal, Mob, MobStats } from './mob.ts';
import { BEE_FLOWER_IDS, avoidCatsGoal, avoidMonstersGoal, beeGoal, bowAttackGoal, jobSiteGoal, breedGoal, catAvoidGoal, creeperGoal, eatGrassGoal, endermanGoal, floatGoal, followOwnerGoal, followParentGoal, lookAtPlayerGoal, loseTargetGoal, meleeAttackGoal, panicGoal, phantomGoal, ocelotFleeGoal, randomLookGoal, sitGoal, temptGoal, slimeGoal, swimGoal, targetPlayerGoal, wanderGoal, witchGoal, wolfDefendGoal, wolfHuntGoal } from './ai.ts';
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

const wolfModel: ModelDef = {
  texture: 'wolf/wolf.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [-1, 13.5, -7], boxes: [{ uv: [0, 0], box: [-2, -3, -2, 6, 6, 4] }, { uv: [16, 14], box: [-2, -5, 0, 2, 2, 1] }, { uv: [16, 14], box: [2, -5, 0, 2, 2, 1] }, { uv: [0, 10], box: [-0.5, 0, -5, 3, 3, 4] }] },
    { name: 'body', pivot: [0, 14, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [18, 14], box: [-3, -2, -3, 6, 9, 6] }] },
    { name: 'mane', pivot: [-1, 14, -3], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [21, 0], box: [-3, -3, -3, 8, 6, 7] }] },
    { name: 'right_hind_leg', pivot: [-2.5, 16, 7], boxes: [{ uv: [0, 18], box: [0, 0, 0, 2, 8, 2] }] },
    { name: 'left_hind_leg', pivot: [0.5, 16, 7], boxes: [{ uv: [0, 18], box: [0, 0, 0, 2, 8, 2] }] },
    { name: 'right_front_leg', pivot: [-2.5, 16, -4], boxes: [{ uv: [0, 18], box: [0, 0, 0, 2, 8, 2] }] },
    { name: 'left_front_leg', pivot: [0.5, 16, -4], boxes: [{ uv: [0, 18], box: [0, 0, 0, 2, 8, 2] }] },
    { name: 'tail', pivot: [-1, 12, 8], rotation: [1.0, 0, 0], boxes: [{ uv: [9, 18], box: [0, 0, 0, 2, 8, 2] }] },
    // collar layer (tinted with the collar dye, shown when tamed)
    { name: 'collar', parent: 'mane', pivot: [-1, 14, -3], texture: 'wolf/wolf_collar.png', hidden: true, boxes: [{ uv: [21, 0], box: [-3, -3, -3, 8, 6, 7], inflate: 0.15 }] },
  ],
};

const codModel: ModelDef = {
  texture: 'fish/cod.png', texW: 32, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 22, 0], boxes: [{ uv: [0, 0], box: [-1, -2, 0, 2, 4, 7] }] },
    { name: 'head', pivot: [0, 22, 0], boxes: [{ uv: [11, 0], box: [-1, -2, -3, 2, 4, 3] }] },
    { name: 'nose', pivot: [0, 22, -3], boxes: [{ uv: [0, 0], box: [-1, -2, -1, 2, 3, 1] }] },
    { name: 'right_fin', pivot: [-1, 23, 0], rotation: [0, 0, -0.7854], boxes: [{ uv: [22, 1], box: [-2, 0, -1, 2, 0, 2] }] },
    { name: 'left_fin', pivot: [1, 23, 0], rotation: [0, 0, 0.7854], boxes: [{ uv: [22, 1], box: [0, 0, -1, 2, 0, 2] }] },
    { name: 'tail_fin', pivot: [0, 22, 7], boxes: [{ uv: [20, 1], box: [0, -2, 0, 0, 4, 6] }] },
  ],
};

const salmonModel: ModelDef = {
  texture: 'fish/salmon.png', texW: 32, texH: 32,
  parts: [
    { name: 'body_front', pivot: [0, 20, 0], boxes: [{ uv: [0, 0], box: [-1.5, -2.5, 0, 3, 5, 8] }] },
    { name: 'body_back', pivot: [0, 20, 8], boxes: [{ uv: [0, 13], box: [-1.5, -2.5, 0, 3, 5, 8] }] },
    { name: 'head', pivot: [0, 20, 0], boxes: [{ uv: [22, 0], box: [-1, -2, -3, 2, 4, 3] }] },
    { name: 'tail_fin', parent: 'body_back', pivot: [0, 20, 16], boxes: [{ uv: [20, 10], box: [0, -2.5, 0, 0, 5, 6] }] },
  ],
};

const phantomModel: ModelDef = {
  texture: 'phantom.png', texW: 64, texH: 64,
  // vanilla PhantomModel raised 20 px so the body hovers just above the entity position
  parts: [
    { name: 'body', pivot: [0, 20, 0], rotation: [-0.1, 0, 0], boxes: [{ uv: [0, 8], box: [-3, -2, -8, 5, 3, 9] }] },
    { name: 'tail1', pivot: [0, 18, 1], boxes: [{ uv: [3, 20], box: [-2, 0, 0, 3, 2, 6] }] },
    { name: 'tail2', parent: 'tail1', pivot: [0, 18.5, 7], boxes: [{ uv: [4, 29], box: [-1, 0, 0, 1, 1, 6] }] },
    { name: 'left_wing_base', pivot: [2, 18, -8], rotation: [0, 0, 0.1], boxes: [{ uv: [23, 12], box: [0, 0, 0, 6, 2, 9] }] },
    { name: 'left_wing_tip', parent: 'left_wing_base', pivot: [8, 18, -8], rotation: [0, 0, 0.1], boxes: [{ uv: [16, 24], box: [0, 0, 0, 13, 1, 9] }] },
    { name: 'right_wing_base', pivot: [-3, 18, -8], rotation: [0, 0, -0.1], boxes: [{ uv: [23, 12], box: [-6, 0, 0, 6, 2, 9], mirror: true }] },
    { name: 'right_wing_tip', parent: 'right_wing_base', pivot: [-9, 18, -8], rotation: [0, 0, -0.1], boxes: [{ uv: [16, 24], box: [-13, 0, 0, 13, 1, 9], mirror: true }] },
    { name: 'head', pivot: [0, 21, -7], rotation: [0.2, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -2, -5, 7, 3, 5] }] },
  ],
};

const witchModel: ModelDef = {
  texture: 'witch.png', texW: 64, texH: 128,
  parts: [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -10, -4, 8, 10, 8] }] },
    { name: 'hat', parent: 'head', pivot: [-5, -10.03, -5], boxes: [{ uv: [0, 64], box: [0, 0, 0, 10, 2, 10] }] },
    { name: 'hat2', parent: 'hat', pivot: [-3.25, -14.03, -3], rotation: [-0.05236, 0, 0.02618], boxes: [{ uv: [0, 76], box: [0, 0, 0, 7, 4, 7] }] },
    { name: 'hat3', parent: 'hat2', pivot: [-1.5, -18.03, -1], rotation: [-0.10472, 0, 0.05236], boxes: [{ uv: [0, 87], box: [0, 0, 0, 4, 4, 4] }] },
    { name: 'hat4', parent: 'hat3', pivot: [0.25, -20.03, 1], rotation: [-0.20944, 0, 0.10472], boxes: [{ uv: [0, 95], box: [0, 0, 0, 1, 2, 1], inflate: 0.25 }] },
    { name: 'nose', parent: 'head', pivot: [0, -2, 0], boxes: [{ uv: [24, 0], box: [-1, -1, -6, 2, 4, 2] }, { uv: [0, 0], box: [0, 3, -6.75, 1, 1, 1], inflate: -0.25 }] },
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [16, 20], box: [-4, 0, -3, 8, 12, 6] }, { uv: [0, 38], box: [-4, 0, -3, 8, 18, 6], inflate: 0.5 }] },
    { name: 'arms', pivot: [0, 2, 0], rotation: [-0.75, 0, 0], boxes: [{ uv: [44, 22], box: [-8, -2, -2, 4, 8, 4] }, { uv: [44, 22], box: [4, -2, -2, 4, 8, 4], mirror: true }, { uv: [40, 38], box: [-4, 2, -2, 8, 4, 4] }] },
    { name: 'right_leg', pivot: [-2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_leg', pivot: [2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
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

/**
 * Vanilla equine model (horse, donkey, mule and their saddle and chest layers), converted from the
 * shipped box layout with `tools/geo-to-model.ts`. `ears` picks the short horse ears or the long
 * mule ones; the markings layer is a second skin like the drowned's outer layer.
 */
/** Texture layers the equine model is built with; the mob swaps them per variant and equipment. */
export const HORSE_MARKING_LAYER = 'horse/horse_markings_white.png';
export const HORSE_ARMOR_LAYER = 'equipment/horse_body/iron.png';

/** Vanilla 1.21 horse armour textures and armour points, one per material. */
export const HORSE_ARMOR: Record<string, { texture: string; points: number }> = {
  leather_horse_armor: { texture: 'leather', points: 3 },
  copper_horse_armor: { texture: 'copper', points: 4 },
  iron_horse_armor: { texture: 'iron', points: 5 },
  golden_horse_armor: { texture: 'gold', points: 7 },
  diamond_horse_armor: { texture: 'diamond', points: 11 },
  netherite_horse_armor: { texture: 'netherite', points: 12 },
};

export function horseArmorTexture(item: string): string | null {
  const a = HORSE_ARMOR[item];
  return a ? `equipment/horse_body/${a.texture}.png` : null;
}

export function horseArmorPoints(item: string): number {
  return HORSE_ARMOR[item]?.points ?? 0;
}

const equineModel = (texture: string, ears: 'horse' | 'mule', markings: string | null = HORSE_MARKING_LAYER, saddle = 'equipment/horse_saddle/saddle.png', armor = false): ModelDef => {
  // vanilla groups neck, head, mouth, ears and mane into one "head parts" assembly that tilts as a
  // unit and carries the look rotation, so they all live in the `head` part here
  const parts: ModelDef['parts'] = [
    { name: 'body', pivot: [0, 11, 9], boxes: [{ uv: [0, 32], box: [-5, -8, -20, 10, 10, 22] }] },
    { name: 'head', pivot: [0, 7, -8], rotation: [0.5236, 0, 0], boxes: [{ uv: [0, 35], box: [-2, -11, -3, 4, 12, 7] }, { uv: [0, 13], box: [-3, -16, -3, 6, 5, 7] }, { uv: [0, 25], box: [-2, -16, -8, 4, 5, 5] }] },
    { name: 'mane', parent: 'head', pivot: [0, 7, -8], boxes: [{ uv: [56, 36], box: [-1, -16, 4, 2, 16, 2] }] },
    { name: 'tail', parent: 'body', pivot: [0, 4, 11], rotation: [0.5236, 0, 0], boxes: [{ uv: [42, 36], box: [-1.5, 0, -2, 3, 14, 4] }] },
    { name: 'left_hind_leg', pivot: [3, 13, 9], boxes: [{ uv: [48, 21], box: [-2, 0, -2, 4, 11, 4], mirror: true }] },
    { name: 'right_hind_leg', pivot: [-3, 13, 9], boxes: [{ uv: [48, 21], box: [-2, 0, -2, 4, 11, 4] }] },
    { name: 'left_front_leg', pivot: [3, 13, -9], boxes: [{ uv: [48, 21], box: [-2, 0, -2, 4, 11, 4], mirror: true }] },
    { name: 'right_front_leg', pivot: [-3, 13, -9], boxes: [{ uv: [48, 21], box: [-2, 0, -2, 4, 11, 4] }] },
  ];
  const skin = parts.slice();
  if (ears === 'horse') {
    parts.push({ name: 'left_ear', parent: 'head', pivot: [0, 7, -8], rotation: [0, 0, -0.0873], boxes: [{ uv: [19, 16], box: [-0.5, -18, 2.99, 2, 3, 1], mirror: true }] });
    parts.push({ name: 'right_ear', parent: 'head', pivot: [0, 7, -8], rotation: [0, 0, 0.0873], boxes: [{ uv: [19, 16], box: [-1.5, -18, 2.99, 2, 3, 1] }] });
  } else {
    parts.push({ name: 'left_ear', parent: 'head', pivot: [0, 7, -8], rotation: [0, 0, -0.2618], boxes: [{ uv: [0, 12], box: [-3, -22, 2.99, 2, 7, 1], mirror: true }] });
    parts.push({ name: 'right_ear', parent: 'head', pivot: [0, 7, -8], rotation: [0, 0, 0.2618], boxes: [{ uv: [0, 12], box: [1, -22, 2.99, 2, 7, 1] }] });
  }
  // saddle, bridle and reins, shown once a saddle is equipped
  parts.push(
    { name: 'saddle', parent: 'body', pivot: [0, 2, 2], texture: saddle, hidden: true, boxes: [{ uv: [26, 0], box: [-5, 1, -5.5, 10, 9, 9], inflate: 0.5 }] },
    { name: 'head_saddle', parent: 'head', pivot: [0, 7, -8], texture: saddle, hidden: true, boxes: [{ uv: [19, 0], box: [-2, -16, -5, 4, 5, 2], inflate: 0.25 }, { uv: [0, 0], box: [-3, -16, -3, 6, 5, 7], inflate: 0.25 }] },
    { name: 'left_bit', parent: 'head_saddle', pivot: [0, 7, -8], texture: saddle, hidden: true, boxes: [{ uv: [29, 5], box: [2, -14, -6, 1, 2, 2] }] },
    { name: 'right_bit', parent: 'head_saddle', pivot: [0, 7, -8], texture: saddle, hidden: true, boxes: [{ uv: [29, 5], box: [-3, -14, -6, 1, 2, 2] }] },
    { name: 'left_rein', parent: 'head', pivot: [0, 7, -8], texture: saddle, hidden: true, boxes: [{ uv: [32, 2], box: [3.1, -10, -11.5, 0, 3, 16] }] },
    { name: 'right_rein', parent: 'head', pivot: [0, 7, -8], texture: saddle, hidden: true, boxes: [{ uv: [32, 2], box: [-3.1, -10, -11.5, 0, 3, 16] }] },
    // chest bags (donkeys and mules carrying a chest)
    { name: 'left_bag', pivot: [-5, 3, 11], rotation: [0, 1.5708, 0], hidden: true, boxes: [{ uv: [26, 21], box: [-9, 0, 0, 8, 8, 3] }] },
    { name: 'right_bag', pivot: [5, 3, 11], rotation: [0, -1.5708, 0], hidden: true, boxes: [{ uv: [26, 21], box: [1, 0, 0, 8, 8, 3], mirror: true }] },
  );
  // markings layer: only horses carry one, drawn on the coat's own boxes like vanilla's overlay
  if (markings) {
    for (const p of skin) {
      parts.push({ name: `${p.name}_marking`, parent: p.name, pivot: p.pivot, texture: markings, boxes: p.boxes.map((b) => ({ ...b, inflate: (b.inflate ?? 0) + 0.02 })) });
    }
  }
  // horse armour is the same body drawn slightly larger in the armour material's texture
  if (armor) {
    for (const p of skin) {
      parts.push({ name: `${p.name}_armor`, parent: p.name, pivot: p.pivot, hidden: true, texture: HORSE_ARMOR_LAYER, boxes: p.boxes.map((b) => ({ ...b, inflate: (b.inflate ?? 0) + 0.1 })) });
    }
  }
  return { texture, texW: 64, texH: 64, parts };
};

/** Vanilla horse coats and marking overlays (Variant and Markings). */
export const HORSE_COATS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'];
export const HORSE_MARKINGS = ['none', 'white', 'whitefield', 'whitedots', 'blackdots'];

export function horseCoatTexture(coat: string): string {
  return `horse/horse_${HORSE_COATS.includes(coat) ? coat : 'white'}.png`;
}

export function horseMarkingTexture(marking: string): string | null {
  return marking && marking !== 'none' ? `horse/horse_markings_${marking}.png` : null;
}

/**
 * Vanilla AbstractHorse attribute rolls: health 15–30, movement speed 0.1125–0.3375 and jump
 * strength 0.4–1.0, each the average of three rolls so extremes are rare.
 */
export function horseAttributes(rng: () => number): { health: number; speed: number; jump: number } {
  return {
    health: 15 + Math.floor(rng() * 9) + Math.floor(rng() * 9),
    speed: (0.44999998807907104 + rng() * 0.3 + rng() * 0.3 + rng() * 0.3) * 0.25,
    jump: 0.4 + rng() * 0.2 + rng() * 0.2 + rng() * 0.2,
  };
}

/** Vanilla horse foods: healing, growth, temper and whether they can start breeding. */
export const HORSE_FOODS: Record<string, { heal: number; grow: number; temper: number; breeds?: boolean }> = {
  wheat: { heal: 2, grow: 20, temper: 3 },
  sugar: { heal: 1, grow: 30, temper: 3 },
  apple: { heal: 3, grow: 60, temper: 3 },
  hay_block: { heal: 20, grow: 180, temper: 0 },
  golden_carrot: { heal: 4, grow: 60, temper: 5, breeds: true },
  golden_apple: { heal: 10, grow: 240, temper: 10, breeds: true },
  enchanted_golden_apple: { heal: 10, grow: 240, temper: 10, breeds: true },
};

/**
 * Vanilla cat and ocelot model (converted from the shipped geometry): the body and tail carry the
 * rest rotations Java bakes into `OcelotModel`, and cats add a dyeable collar layer.
 */
const catModel = (texture: string, collar = false): ModelDef => {
  const parts: ModelDef['parts'] = [
    { name: 'body', pivot: [0, 17, 1], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [20, 0], box: [-2, -8, -3, 4, 16, 6] }] },
    { name: 'head', pivot: [0, 15, -9], boxes: [{ uv: [0, 0], box: [-2.5, -2, -3, 5, 4, 5] }, { uv: [0, 24], box: [-1.5, 0, -4, 3, 2, 2] }, { uv: [0, 10], box: [-2, -3, 0, 1, 1, 2] }, { uv: [6, 10], box: [1, -3, 0, 1, 1, 2] }] },
    { name: 'tail', pivot: [0, 15, 8], rotation: [0.9, 0, 0], boxes: [{ uv: [0, 15], box: [-0.5, 0, 0, 1, 8, 1] }] },
    { name: 'tail_tip', pivot: [0, 20, 14], rotation: [0.9, 0, 0], boxes: [{ uv: [4, 15], box: [-0.5, 0, 0, 1, 8, 1] }] },
    { name: 'left_hind_leg', pivot: [1.1, 18, 7], boxes: [{ uv: [8, 13], box: [-1, 0, -1, 2, 6, 2] }] },
    { name: 'right_hind_leg', pivot: [-1.1, 18, 7], boxes: [{ uv: [8, 13], box: [-1, 0, -1, 2, 6, 2] }] },
    { name: 'left_front_leg', pivot: [1.2, 14, -4], boxes: [{ uv: [40, 0], box: [-1, -0.2, -1, 2, 10, 2] }] },
    { name: 'right_front_leg', pivot: [-1.2, 14, -4], boxes: [{ uv: [40, 0], box: [-1, -0.2, -1, 2, 10, 2] }] },
  ];
  if (collar) parts.push({ name: 'collar', parent: 'head', pivot: [0, 15, -9], texture: CAT_COLLAR_LAYER, hidden: true, boxes: [{ uv: [0, 0], box: [-2.5, -2, -3, 5, 4, 5], inflate: 0.05 }] });
  return { texture, texW: 64, texH: 32, parts };
};

/** Collar layer texture for tamed cats. */
export const CAT_COLLAR_LAYER = 'cat/cat_collar.png';

/** Vanilla cat variants; witch huts spawn only the all-black one. */
export const CAT_VARIANTS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie'];

export function catTexture(variant: string): string {
  return `cat/${CAT_VARIANTS.includes(variant) || variant === 'all_black' ? variant : 'tabby'}.png`;
}

/** Raw fish tames a cat and wins an ocelot's trust (vanilla `Cat`/`Ocelot` temptation items). */
export const CAT_FOODS = ['cod', 'salmon'];

/**
 * Vanilla villager model (converted from the shipped geometry). Villagers are drawn as three
 * layered skins: the biome type, the profession clothes and the level badge, so the model carries
 * an overlay copy of every part for each layer, like vanilla's `VillagerProfessionLayer`.
 */
const villagerModel = (texture: string, layers = true): ModelDef => {
  const skin: ModelDef['parts'] = [
    { name: 'body', pivot: [0, 24, 0], boxes: [{ uv: [16, 20], box: [-4, -24, -3, 8, 12, 6] }, { uv: [0, 38], box: [-4, -24, -3, 8, 18, 6], inflate: 0.5 }] },
    { name: 'head', parent: 'body', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -10, -4, 8, 10, 8] }] },
    { name: 'hat', parent: 'head', pivot: [0, 0, 0], boxes: [{ uv: [32, 0], box: [-4, -10, -4, 8, 10, 8], inflate: 0.5 }] },
    { name: 'brim', parent: 'head', pivot: [0, 0, 0], hidden: true, boxes: [{ uv: [30, 47], box: [-8, -8, -6, 16, 16, 1], inflate: 0.1 }] },
    { name: 'nose', parent: 'head', pivot: [0, -2, 0], boxes: [{ uv: [24, 0], box: [-1, -1, -6, 2, 4, 2] }] },
    { name: 'arms', parent: 'body', pivot: [0, 2, 0], boxes: [{ uv: [40, 38], box: [-4, 2, -2, 8, 4, 4] }, { uv: [44, 22], box: [-8, -2, -2, 4, 8, 4] }, { uv: [44, 22], box: [4, -2, -2, 4, 8, 4], mirror: true }] },
    { name: 'right_leg', parent: 'body', pivot: [-2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_leg', parent: 'body', pivot: [2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ];
  const parts = skin.slice();
  if (layers) {
    for (const [suffix, layer, inflate] of [['_type', VILLAGER_TYPE_LAYER, 0.02], ['_job', VILLAGER_PROFESSION_LAYER, 0.04], ['_badge', VILLAGER_LEVEL_LAYER, 0.06]] as const) {
      for (const p of skin) {
        parts.push({ name: `${p.name}${suffix}`, parent: p.name, pivot: p.pivot, texture: layer, hidden: true, boxes: p.boxes.map((b) => ({ ...b, inflate: (b.inflate ?? 0) + inflate })) });
      }
    }
  }
  return { texture, texW: 64, texH: 64, parts };
};

/**
 * Layer textures the villager model is built with; swapped per villager at render time. Vanilla
 * stacks four skins: the bare villager, the biome outfit, the profession clothes and the level badge.
 */
export const VILLAGER_TYPE_LAYER = 'villager/type/plains.png';
export const VILLAGER_PROFESSION_LAYER = 'villager/profession/farmer.png';
export const VILLAGER_LEVEL_LAYER = 'villager/profession_level/stone.png';

/** Vanilla villager biome types, chosen by where the villager spawned. */
export const VILLAGER_TYPES = ['plains', 'desert', 'jungle', 'savanna', 'snow', 'swamp', 'taiga'];

/** Professions whose texture paints a brimmed hat (farmer, fisherman and shepherd, per the skins). */
const BRIMMED = new Set(['farmer', 'fisherman', 'shepherd']);

export function villagerTypeTexture(type: string): string {
  return `villager/type/${VILLAGER_TYPES.includes(type) ? type : 'plains'}.png`;
}

export function villagerProfessionTexture(profession: string): string | null {
  return profession && profession !== 'none' ? `villager/profession/${profession}.png` : null;
}

export function villagerBadgeTexture(level: number): string | null {
  const badge = ['stone', 'iron', 'gold', 'emerald', 'diamond'][Math.max(0, Math.min(4, level - 1))];
  return badge ? `villager/profession_level/${badge}.png` : null;
}

export function villagerWearsBrim(profession: string): boolean {
  return BRIMMED.has(profession);
}

/** Biome type a villager born in this biome takes (vanilla VillagerType.byBiome). */
export function villagerTypeFor(biomeId: string): string {
  if (biomeId.includes('desert') || biomeId.includes('badlands')) return 'desert';
  if (biomeId.includes('jungle')) return 'jungle';
  if (biomeId.includes('savanna')) return 'savanna';
  if (biomeId.includes('snowy') || biomeId.includes('frozen') || biomeId.includes('ice')) return 'snow';
  if (biomeId.includes('swamp') || biomeId.includes('mangrove')) return 'swamp';
  if (biomeId.includes('taiga') || biomeId.includes('grove')) return 'taiga';
  return 'plains';
}

/** Vanilla bee model (converted from the shipped geometry); the wings beat as the bee flies. */
const beeModel: ModelDef = {
  texture: 'bee/bee.png', texW: 64, texH: 64,
  parts: [
    { name: 'body', pivot: [0.5, 19, 0], boxes: [{ uv: [0, 0], box: [-3.5, -4, -5, 7, 7, 10] }, { uv: [2, 0], box: [1.5, -4, -8, 1, 2, 3] }, { uv: [2, 3], box: [-2.5, -4, -8, 1, 2, 3] }] },
    { name: 'stinger', parent: 'body', pivot: [0.5, 18, 1], boxes: [{ uv: [26, 7], box: [0, 0, 4, 0, 1, 2] }] },
    { name: 'right_wing', parent: 'body', pivot: [-1, 15, -3], rotation: [-0.2618, 0.2618, 0], boxes: [{ uv: [0, 18], box: [-9, 0, 0, 9, 0, 6] }] },
    { name: 'left_wing', parent: 'body', pivot: [2, 15, -3], rotation: [-0.2618, -0.2618, 0], boxes: [{ uv: [9, 24], box: [0, 0, 0, 9, 0, 6] }] },
    { name: 'leg_front', parent: 'body', pivot: [2, 22, -2], boxes: [{ uv: [26, 1], box: [-5, 0, 0, 7, 2, 0] }] },
    { name: 'leg_mid', parent: 'body', pivot: [2, 22, 0], boxes: [{ uv: [26, 3], box: [-5, 0, 0, 7, 2, 0] }] },
    { name: 'leg_back', parent: 'body', pivot: [2, 22, 2], boxes: [{ uv: [26, 5], box: [-5, 0, 0, 7, 2, 0] }] },
  ],
};

/** Bee skins: angry and nectar-carrying bees swap texture like vanilla's four variants. */
export function beeTexture(angry: boolean, nectar: boolean): string {
  return `bee/bee${angry ? '_angry' : ''}${nectar ? '_nectar' : ''}.png`;
}

/** Flowers a bee will pollinate and breed with (vanilla's `#minecraft:flowers`, small ones). */
export const BEE_FLOWERS = [
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'sunflower',
  'lilac', 'rose_bush', 'peony', 'pink_petals', 'flowering_azalea', 'flowering_azalea_leaves', 'cherry_leaves',
  'open_eyeblossom', 'closed_eyeblossom',
];

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
  aquatic?: boolean;
  flying?: boolean;
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

/** Meat a wolf eats (heals a hurt tamed wolf, otherwise breeds). */
export const WOLF_FOODS = ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'rotten_flesh'];
BREEDING_FOODS.wolf = WOLF_FOODS;
BREEDING_FOODS.cat = ['cod', 'salmon'];
BREEDING_FOODS.bee = BEE_FLOWERS;
BEE_FLOWER_IDS.push(...BEE_FLOWERS);
BREEDING_FOODS.ocelot = ['cod', 'salmon'];
for (const e of ['horse', 'donkey', 'mule']) BREEDING_FOODS[e] = ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'];

/** Vanilla 1.20.5 wolf variants by spawn biome; null where wolves do not spawn naturally. */
export function wolfVariantFor(biomeId: string): string | null {
  if (biomeId === 'taiga') return 'pale';
  if (biomeId === 'snowy_taiga') return 'ashen';
  if (biomeId === 'old_growth_pine_taiga') return 'black';
  if (biomeId === 'old_growth_spruce_taiga') return 'chestnut';
  if (biomeId === 'grove') return 'snowy';
  if (biomeId === 'forest') return 'woods';
  if (biomeId.includes('jungle')) return 'rusty';
  if (biomeId.includes('savanna')) return 'spotted';
  if (biomeId.includes('badlands')) return 'striped';
  return null;
}

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
  creeper: { model: creeperModel, animation: 'creeper', eyeHeight: 1.445, followRange: 16, goals: () => [floatGoal, avoidCatsGoal(), loseTargetGoal(), targetPlayerGoal(16), creeperGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
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
  wolf: { model: wolfModel, animation: 'quadruped', eyeHeight: 0.68, followRange: 16, goals: () => [floatGoal, sitGoal(), wolfDefendGoal(), wolfHuntGoal(), loseTargetGoal(), meleeAttackGoal(), followOwnerGoal(), breedGoal(), followParentGoal(), wanderGoal(120, 1, 10), lookAtPlayerGoal(8), randomLookGoal] },
  cod: { model: codModel, animation: 'fish', eyeHeight: 0.195, followRange: 8, aquatic: true, goals: () => [swimGoal(), panicGoal(2)] },
  // vanilla phantom attack damage is 6
  phantom: { model: phantomModel, animation: 'phantom', eyeHeight: 0.33, followRange: 64, flying: true, burnsInSun: true, override: { damage: 6 }, goals: () => [phantomGoal()] },
  witch: { model: witchModel, animation: 'biped', eyeHeight: 1.62, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), witchGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  salmon: { model: salmonModel, animation: 'fish', eyeHeight: 0.26, followRange: 8, aquatic: true, goals: () => [swimGoal(), panicGoal(2)] },
  // cats and ocelots share the vanilla model; ocelots only ever grow to trust the player
  cat: { model: catModel('cat/tabby.png', true), animation: 'quadruped', eyeHeight: 0.35, followRange: 16, override: { height: 0.7, width: 0.6 }, goals: () => [floatGoal, sitGoal(), catAvoidGoal(), temptGoal(CAT_FOODS, 10), breedGoal(), followParentGoal(), followOwnerGoal(), wanderGoal(120, 0.8, 10), lookAtPlayerGoal(8), randomLookGoal] },
  ocelot: { model: catModel('cat/ocelot.png'), animation: 'quadruped', eyeHeight: 0.35, followRange: 16, override: { height: 0.7, width: 0.6 }, goals: () => [floatGoal, ocelotFleeGoal(), temptGoal(CAT_FOODS, 10), breedGoal(), followParentGoal(), wanderGoal(120, 0.8, 10), lookAtPlayerGoal(8), randomLookGoal] },
  // bees fly between flowers and their hive; vanilla stats are 10 health and a 2-damage sting
  bee: { model: beeModel, animation: 'bee', eyeHeight: 0.45, followRange: 48, flying: true, goals: () => [beeGoal()] },
  // villagers keep a profession, level and trade list in `extra`; the wandering trader is unlayered
  villager: { model: villagerModel('villager/villager.png'), animation: 'biped', eyeHeight: 1.62, followRange: 16, goals: () => villagerGoals() },
  wandering_trader: { model: villagerModel('wandering_trader.png', false), animation: 'biped', eyeHeight: 1.62, followRange: 16, data: 'villager', loot: 'wandering_trader', goals: () => villagerGoals() },
  // equines: attributes are rolled per animal, so the table values are only the vanilla averages
  horse: { model: equineModel('horse/horse_white.png', 'horse', HORSE_MARKING_LAYER, 'equipment/horse_saddle/saddle.png', true), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
  donkey: { model: equineModel('horse/donkey.png', 'mule', null, 'equipment/donkey_saddle/saddle.png'), animation: 'horse', eyeHeight: 1.425, followRange: 16, goals: () => equineGoals() },
  mule: { model: equineModel('horse/mule.png', 'mule', null, 'equipment/mule_saddle/saddle.png'), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
};

/** Villagers wander, watch the player, flee monsters and look for a job site block. */
const villagerGoals = (): Goal[] => [floatGoal, panicGoal(1.3), avoidMonstersGoal(), jobSiteGoal(), wanderGoal(120, 0.6, 8), lookAtPlayerGoal(8), randomLookGoal];

/** Equines wander and panic like other animals but never follow the player for food. */
const equineGoals = (): Goal[] => [floatGoal, panicGoal(1.2), breedGoal(), followParentGoal(), wanderGoal(120, 0.7, 10), lookAtPlayerGoal(6), randomLookGoal];

/**
 * Rolls a new equine's attributes and coat: vanilla gives every horse its own health, speed and
 * jump strength, plus one of seven coats and five marking overlays; donkeys and mules have none.
 */
export function initEquine(m: Mob, rng: () => number): void {
  const a = horseAttributes(rng);
  m.extra.speedAttr = a.speed;
  m.extra.jumpAttr = a.jump;
  m.maxHealth = a.health;
  m.health = a.health;
  m.extra.maxHealth = a.health;
  if (m.def.id === 'horse') {
    m.extra.coat = HORSE_COATS[Math.floor(rng() * HORSE_COATS.length)];
    m.extra.marking = HORSE_MARKINGS[Math.floor(rng() * HORSE_MARKINGS.length)];
  }
}

/**
 * Vanilla foal attributes: each stat is the average of both parents and one fresh roll, so a foal
 * can beat its parents but rarely by much. Foals of tamed parents are born tamed.
 */
export function inheritEquine(baby: Mob, a: Mob, b: Mob, rng: () => number): void {
  const fresh = horseAttributes(rng);
  const stat = (key: 'speedAttr' | 'jumpAttr', roll: number): number => {
    const av = typeof a.extra[key] === 'number' ? (a.extra[key] as number) : roll;
    const bv = typeof b.extra[key] === 'number' ? (b.extra[key] as number) : roll;
    return (av + bv + roll) / 3;
  };
  baby.extra.speedAttr = stat('speedAttr', fresh.speed);
  baby.extra.jumpAttr = stat('jumpAttr', fresh.jump);
  const health = Math.round((a.maxHealth + b.maxHealth + fresh.health) / 3);
  baby.maxHealth = health;
  baby.health = health;
  baby.extra.maxHealth = health;
  if (baby.def.id === 'horse') {
    // vanilla picks each parent's coat or a fresh one at random
    const parent = rng() < 0.5 ? a : b;
    baby.extra.coat = typeof parent.extra.coat === 'string' && rng() < 0.9 ? parent.extra.coat : HORSE_COATS[Math.floor(rng() * HORSE_COATS.length)];
    baby.extra.marking = typeof parent.extra.marking === 'string' && rng() < 0.9 ? parent.extra.marking : HORSE_MARKINGS[Math.floor(rng() * HORSE_MARKINGS.length)];
  }
  if (a.extra.tamed === true && b.extra.tamed === true) {
    baby.extra.tamed = true;
    baby.extra.temper = 100;
  }
  baby.persistent = true;
}

/** Horse-family mobs the player can ride; donkeys and mules also carry chests. */
export const EQUINE_TYPES = ['horse', 'donkey', 'mule'];
export const CHESTED_EQUINES = ['donkey', 'mule'];


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
    aquatic: spec.aquatic,
    flying: spec.flying,
    model: spec.model,
    animation: spec.animation,
    scale: spec.scale,
  };
}

export const HOSTILE_TYPES = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman'];
/** Vanilla overworld monster spawn weights. */
const HOSTILE_WEIGHTS: [string, number][] = [['zombie', 95], ['skeleton', 100], ['creeper', 100], ['spider', 100], ['enderman', 10], ['witch', 5]];
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

/** Vanilla PhantomSpawner: no phantoms before three sleepless days, then odds grow with insomnia. */
export function phantomSpawnChance(timeSinceRest: number): number {
  if (timeSinceRest < 72000) return 0;
  return Math.min(1, (timeSinceRest - 72000) / 24000 + 0.05);
}
