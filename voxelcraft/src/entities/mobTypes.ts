/** Mob definitions: vanilla box models (classic layouts) on the entity textures, stats from data/mobs.json, AI goal lists. */
import mobsJson from '../../data/mobs.json';
import { BEE_FLOWERS } from './beeFlowers.ts';
import type { ModelDef } from './boxModel.ts';
import type { Goal, Mob, MobStats } from './mob.ts';
import { avoidCatsGoal, batGoal, squidGoal, dolphinGoal, turtleLayGoal, foxSleepGoal, avoidPlayerGoal, goatRamGoal, pandaLieGoal, bearDefendGoal, llamaSpitGoal, blazeGoal, dragonGoal, shulkerGoal, witherGoal, elderCurseGoal, ghastGoal, guardianGoal, piglinAngerGoal, striderGoal, avoidMonstersGoal, beeGoal, evokerGoal, targetVillagerGoal, vexGoal, bowAttackGoal, jobSiteGoal, breedGoal, catAvoidGoal, creeperGoal, eatGrassGoal, endermanGoal, floatGoal, followOwnerGoal, followParentGoal, lookAtPlayerGoal, loseTargetGoal, meleeAttackGoal, panicGoal, phantomGoal, ocelotFleeGoal, randomLookGoal, sitGoal, temptGoal, slimeGoal, swimGoal, targetPlayerGoal, wanderGoal, witchGoal, wolfDefendGoal, wolfHuntGoal } from './ai.ts';
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


/** Bedrock's own bat geometry, converted; vanilla hangs it upside down while it rests. */
const batModel: ModelDef = {
  texture: 'bat.png', texW: 64, texH: 64,
  parts: [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6] }] },
    { name: 'right_ear', parent: 'head', pivot: [0, 0, 0], boxes: [{ uv: [24, 0], box: [-4, -6, -2, 3, 4, 1] }] },
    { name: 'left_ear', parent: 'head', pivot: [0, 0, 0], boxes: [{ uv: [24, 0], box: [1, -6, -2, 3, 4, 1] }] },
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [0, 16], box: [-3, 4, -3, 6, 12, 6] }, { uv: [0, 34], box: [-5, 16, 0, 10, 16, 1] }] },
    { name: 'right_wing', parent: 'body', pivot: [0, 0, 0], boxes: [{ uv: [42, 0], box: [-12, 1, 1.5, 10, 16, 1] }] },
    { name: 'right_wing_tip', parent: 'right_wing', pivot: [-12, 1, 1.5], boxes: [{ uv: [24, 16], box: [-8, 1, 0, 8, 12, 1] }] },
    { name: 'left_wing', parent: 'body', pivot: [0, 0, 0], boxes: [{ uv: [42, 0], box: [2, 1, 1.5, 10, 16, 1] }] },
    { name: 'left_wing_tip', parent: 'left_wing', pivot: [12, 1, 1.5], boxes: [{ uv: [24, 16], box: [0, 1, 0, 8, 12, 1] }] },
  ],
};

/** The squid, whose eight tentacles hang off the bell and curl as it swims. */
const squidModel = (texture = 'squid/squid.png'): ModelDef => ({
  texture, texW: 64, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 20, 0], boxes: [{ uv: [0, 0], box: [-6, -8, -6, 12, 16, 12] }] },
    ...[
      [5, 0, -Math.PI / 2], [3.5, 3.5, -Math.PI / 4], [0, 5, 0], [-3.5, 3.5, Math.PI / 4],
      [-5, 0, Math.PI / 2], [-3.5, -3.5, (3 * Math.PI) / 4], [0, -5, Math.PI], [3.5, -3.5, (5 * Math.PI) / 4],
    ].map(([x, z, r], i) => ({
      name: `tentacle${i + 1}`,
      parent: 'body',
      pivot: [x, 27, z] as [number, number, number],
      rotation: [0, r, 0] as [number, number, number],
      boxes: [{ uv: [48, 0] as [number, number], box: [-1, 0, -1, 2, 18, 2] as [number, number, number, number, number, number] }],
    })),
  ],
});

/** Bedrock's dolphin geometry, converted. */
const dolphinModel: ModelDef = {
  texture: 'dolphin.png', texW: 64, texH: 64,
  parts: [
    { name: 'body', pivot: [0, 24, -3], boxes: [{ uv: [0, 13], box: [-4, -7, 0, 8, 7, 13] }] },
    { name: 'head', parent: 'body', pivot: [0, 24, -3], boxes: [{ uv: [0, 0], box: [-4, -7, -6, 8, 7, 6] }] },
    { name: 'nose', parent: 'head', pivot: [0, 24, -13], boxes: [{ uv: [0, 13], box: [-1, -2, 0, 2, 2, 4] }] },
    { name: 'tail', parent: 'body', pivot: [0, 21.5, 11], boxes: [{ uv: [0, 33], box: [-2, -2.5, -1, 4, 5, 11] }] },
    { name: 'tail_fin', parent: 'tail', pivot: [0, 21.5, 20], boxes: [{ uv: [0, 49], box: [-5, -0.5, -1, 10, 1, 6] }] },
    { name: 'back_fin', parent: 'body', pivot: [0, 17, 2], rotation: [0.5236, 0, 0], boxes: [{ uv: [29, 0], box: [-0.5, -4.25, -1, 1, 5, 4] }] },
    { name: 'left_fin', parent: 'body', pivot: [3, 23, -1], rotation: [0, 0.4363, -0.3491], boxes: [{ uv: [40, 0], box: [0, -1, -1.5, 8, 1, 4] }] },
    { name: 'right_fin', parent: 'body', pivot: [-3, 23, -1], rotation: [0, -0.4363, 0.3491], boxes: [{ uv: [40, 6], box: [-8, -1, -1.5, 8, 1, 4] }] },
  ],
};


/**
 * The turtle, converted from Mojang's geometry with its flippers renamed to the legs our quadruped
 * animation swings. Vanilla's model carries an egg belly that only a turtle carrying one shows.
 */
const turtleModel: ModelDef = {
  texture: 'turtle/big_sea_turtle.png', texW: 128, texH: 64,
  parts: [
    // vanilla lays the shell flat with a quarter turn, and hangs nothing off it: the head and the
    // four flippers are parts of their own, the way its quadruped model keeps them
    { name: 'body', pivot: [0, 11, -10], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [6, 37], box: [-9.5, 3, -10, 19, 20, 6] }, { uv: [30, 1], box: [-5.5, 3, -13, 11, 18, 3] }] },
    { name: 'eggbelly', pivot: [0, 11, -10], rotation: [HALF_PI, 0, 0], hidden: true, boxes: [{ uv: [70, 33], box: [-4.5, 3, -14, 9, 18, 1] }] },
    { name: 'head', pivot: [0, 19, -10], boxes: [{ uv: [2, 0], box: [-3, -1, -3, 6, 5, 6] }] },
    { name: 'right_hind_leg', pivot: [-3.5, 22, 11], boxes: [{ uv: [0, 23], box: [-2, 0, 0, 4, 1, 10] }] },
    { name: 'left_hind_leg', pivot: [3.5, 22, 11], boxes: [{ uv: [0, 12], box: [-2, 0, 0, 4, 1, 10] }] },
    { name: 'right_front_leg', pivot: [-5, 21, -4], boxes: [{ uv: [26, 30], box: [-13, 0, -2, 13, 1, 5] }] },
    { name: 'left_front_leg', pivot: [5, 21, -4], boxes: [{ uv: [26, 24], box: [0, 0, -2, 13, 1, 5] }] },
  ],
};

/** The fox, whose sleeping head is a second skin vanilla swaps in when it curls up. */
const foxModel = (texture = 'fox/fox.png'): ModelDef => ({
  texture, texW: 64, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 16, 0], boxes: [{ uv: [30, 15], box: [-3, -3, -3, 6, 11, 6] }] },
    { name: 'head', parent: 'body', pivot: [0, 16, -3], boxes: [{ uv: [0, 0], box: [-4, -2, -6, 8, 6, 6] }, { uv: [0, 0], box: [-4, -4, -5, 2, 2, 1] }, { uv: [22, 0], box: [2, -4, -5, 2, 2, 1] }, { uv: [0, 24], box: [-2, 2, -9, 4, 2, 3] }] },
    { name: 'right_hind_leg', parent: 'body', pivot: [-3, 18, 6], boxes: [{ uv: [14, 24], box: [-0.005, 0, -1, 2, 6, 2] }] },
    { name: 'left_hind_leg', parent: 'body', pivot: [1, 18, 6], boxes: [{ uv: [22, 24], box: [0.005, 0, -1, 2, 6, 2] }] },
    { name: 'right_front_leg', parent: 'body', pivot: [-3, 18, -1], boxes: [{ uv: [14, 24], box: [-0.005, 0, -1, 2, 6, 2] }] },
    { name: 'left_front_leg', parent: 'body', pivot: [1, 18, -1], boxes: [{ uv: [22, 24], box: [0.005, 0, -1, 2, 6, 2] }] },
    { name: 'tail', parent: 'body', pivot: [0, 16, 7], boxes: [{ uv: [28, 0], box: [-2, 1, -2.25, 4, 9, 5] }] },
  ],
});

/** The goat, horns and all. */
const goatModel: ModelDef = {
  texture: 'goat/goat.png', texW: 64, texH: 64,
  parts: [
    { name: 'body', pivot: [0, 24, 0], boxes: [{ uv: [1, 1], box: [-4, -17, -7, 9, 11, 16] }, { uv: [0, 28], box: [-5, -18, -8, 11, 14, 11] }] },
    { name: 'head', pivot: [0.5, 7, -8], boxes: [{ uv: [34, 46], box: [-2.5, -5, -8, 5, 7, 10] }, { uv: [2, 61], box: [2.5, -4, -2, 3, 2, 1], mirror: true }, { uv: [2, 61], box: [-5.5, -4, -2, 3, 2, 1] }, { uv: [23, 52], box: [0, 4, -6, 0, 7, 5] }] },
    { name: 'right_horn', parent: 'head', pivot: [1, 6, -8], boxes: [{ uv: [12, 55], box: [-2.99, -8, -2, 2, 7, 2] }] },
    { name: 'left_horn', parent: 'head', pivot: [1, 6, -8], boxes: [{ uv: [12, 55], box: [-0.01, -8, -2, 2, 7, 2] }] },
    { name: 'left_hind_leg', pivot: [1, 14, 4], boxes: [{ uv: [36, 29], box: [0, 4, 0, 3, 6, 3] }] },
    { name: 'right_hind_leg', pivot: [-3, 14, 4], boxes: [{ uv: [49, 29], box: [0, 4, 0, 3, 6, 3] }] },
    { name: 'right_front_leg', pivot: [-3, 14, -6], boxes: [{ uv: [49, 2], box: [0, 0, 0, 3, 10, 3] }] },
    { name: 'left_front_leg', pivot: [1, 14, -6], boxes: [{ uv: [35, 2], box: [0, 0, 0, 3, 10, 3] }] },
  ],
};


/** The rabbit, whose haunches and ears vanilla animates as it hops. */
const rabbitModel = (texture = 'rabbit/brown.png'): ModelDef => ({
  texture, texW: 64, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 19, 8], boxes: [{ uv: [0, 0], box: [-3, -2, -10, 6, 5, 10] }] },
    { name: 'left_hind_leg', parent: 'body', pivot: [3, 17.5, 3.7], boxes: [{ uv: [8, 24], box: [-1, 5.5, -3.7, 2, 1, 7] }, { uv: [16, 15], box: [-1, 0, 0, 2, 4, 5] }] },
    { name: 'right_hind_leg', parent: 'body', pivot: [-3, 17.5, 3.7], boxes: [{ uv: [26, 24], box: [-1, 5.5, -3.7, 2, 1, 7] }, { uv: [30, 15], box: [-1, 0, 0, 2, 4, 5] }] },
    { name: 'left_front_leg', parent: 'body', pivot: [3, 17, -1], boxes: [{ uv: [8, 15], box: [-1, 0, -1, 2, 7, 2] }] },
    { name: 'right_front_leg', parent: 'body', pivot: [-3, 17, -1], boxes: [{ uv: [0, 15], box: [-1, 0, -1, 2, 7, 2] }] },
    { name: 'head', parent: 'body', pivot: [0, 16, -1], boxes: [{ uv: [32, 0], box: [-2.5, -4, -5, 5, 4, 5] }, { uv: [58, 0], box: [-2.5, -9, -1, 2, 5, 1] }, { uv: [52, 0], box: [0.5, -9, -1, 2, 5, 1] }, { uv: [32, 9], box: [-0.5, -2.5, -5.5, 1, 1, 1] }] },
    { name: 'tail', parent: 'body', pivot: [0, 20, 7], boxes: [{ uv: [52, 6], box: [-1.5, -1.5, 0, 3, 3, 2] }] },
  ],
});

/** The panda, whose skin says which way it was born. */
const pandaModel = (texture = 'panda/panda.png'): ModelDef => ({
  texture, texW: 64, texH: 64,
  parts: [
    { name: 'body', pivot: [0, 10, 0], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [0, 25], box: [-9.5, -13, -6.5, 19, 26, 13] }] },
    { name: 'head', pivot: [0, 11.5, -17], boxes: [{ uv: [0, 6], box: [-6.5, -5, -4, 13, 10, 9] }, { uv: [45, 16], box: [-3.5, 0, -6, 7, 5, 2] }, { uv: [52, 25], box: [-8.5, -8, -1, 5, 4, 1] }, { uv: [52, 25], box: [3.5, -8, -1, 5, 4, 1] }] },
    { name: 'right_hind_leg', pivot: [-5.5, 15, 9], boxes: [{ uv: [40, 0], box: [-3, 0, -3, 6, 9, 6] }] },
    { name: 'left_hind_leg', pivot: [5.5, 15, 9], boxes: [{ uv: [40, 0], box: [-3, 0, -3, 6, 9, 6] }] },
    { name: 'right_front_leg', pivot: [-5.5, 15, -9], boxes: [{ uv: [40, 0], box: [-3, 0, -3, 6, 9, 6] }] },
    { name: 'left_front_leg', pivot: [5.5, 15, -9], boxes: [{ uv: [40, 0], box: [-3, 0, -3, 6, 9, 6] }] },
  ],
});

/** The polar bear. */
const polarBearModel: ModelDef = {
  texture: 'bear/polarbear.png', texW: 128, texH: 64,
  parts: [
    { name: 'body', pivot: [-2, 9, 12], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [0, 19], box: [-5, -13, -7, 14, 14, 11] }, { uv: [39, 0], box: [-4, -25, -7, 12, 12, 10] }] },
    { name: 'head', pivot: [0, 10, -16], boxes: [{ uv: [0, 0], box: [-3.5, -3, -3, 7, 7, 7] }, { uv: [0, 44], box: [-2.5, 1, -6, 5, 3, 3] }, { uv: [26, 0], box: [-4.5, -4, -1, 2, 2, 1] }, { uv: [26, 0], box: [2.5, -4, -1, 2, 2, 1] }] },
    { name: 'right_hind_leg', pivot: [-4.5, 14, 6], boxes: [{ uv: [50, 22], box: [-2, 0, -2, 4, 10, 8] }] },
    { name: 'left_hind_leg', pivot: [4.5, 14, 6], boxes: [{ uv: [50, 22], box: [-2, 0, -2, 4, 10, 8] }] },
    { name: 'right_front_leg', pivot: [-3.5, 14, -8], boxes: [{ uv: [50, 40], box: [-2, 0, -2, 4, 10, 6] }] },
    { name: 'left_front_leg', pivot: [3.5, 14, -8], boxes: [{ uv: [50, 40], box: [-2, 0, -2, 4, 10, 6] }] },
  ],
};

/** The llama, chests and all; a trader's llama is the same animal in its own coat. */
const llamaModel = (texture = 'llama/creamy.png'): ModelDef => ({
  texture, texW: 128, texH: 64,
  parts: [
    { name: 'body', pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [29, 0], box: [-6, -10, -7, 12, 18, 10] }] },
    { name: 'head', pivot: [0, 7, -6], boxes: [{ uv: [0, 0], box: [-2, -14, -10, 4, 4, 9] }, { uv: [0, 14], box: [-4, -16, -6, 8, 18, 6] }, { uv: [17, 0], box: [-4, -19, -4, 3, 3, 2] }, { uv: [17, 0], box: [1, -19, -4, 3, 3, 2] }] },
    { name: 'chest_right', pivot: [-8.5, 3, 3], rotation: [0, -HALF_PI, 0], hidden: true, boxes: [{ uv: [45, 28], box: [-3, 0, 0, 8, 8, 3] }] },
    { name: 'chest_left', pivot: [5.5, 3, 3], rotation: [0, -HALF_PI, 0], hidden: true, boxes: [{ uv: [45, 41], box: [-3, 0, 0, 8, 8, 3] }] },
    { name: 'right_hind_leg', pivot: [-3.5, 10, 6], boxes: [{ uv: [29, 29], box: [-2, 0, -2, 4, 14, 4] }] },
    { name: 'left_hind_leg', pivot: [3.5, 10, 6], boxes: [{ uv: [29, 29], box: [-2, 0, -2, 4, 14, 4] }] },
    { name: 'right_front_leg', pivot: [-3.5, 10, -5], boxes: [{ uv: [29, 29], box: [-2, 0, -2, 4, 14, 4] }] },
    { name: 'left_front_leg', pivot: [3.5, 10, -5], boxes: [{ uv: [29, 29], box: [-2, 0, -2, 4, 14, 4] }] },
  ],
});


/** The silverfish, a stack of body segments that ripple as it scuttles. */
const silverfishModel: ModelDef = {
  texture: 'silverfish.png', texW: 64, texH: 32,
  parts: [
    { name: 'body_part_2', pivot: [0, 20, 1], boxes: [{ uv: [0, 9], box: [-3, 0, -1.5, 6, 4, 3] }] },
    { name: 'body_part_0', pivot: [0, 22, -3.5], boxes: [{ uv: [0, 0], box: [-1.5, 0, -1, 3, 2, 2] }] },
    { name: 'body_part_1', pivot: [0, 21, -1.5], boxes: [{ uv: [0, 4], box: [-2, 0, -1, 4, 3, 2] }] },
    { name: 'body_part_3', pivot: [0, 21, 4], boxes: [{ uv: [0, 16], box: [-1.5, 0, -1.5, 3, 3, 3] }] },
    { name: 'body_part_4', pivot: [0, 22, 7], boxes: [{ uv: [0, 22], box: [-1, 0, -1.5, 2, 2, 3] }] },
    { name: 'body_part_5', pivot: [0, 23, 9.5], boxes: [{ uv: [11, 0], box: [-1, 0, -1, 2, 1, 2] }] },
    { name: 'body_part_6', pivot: [0, 23, 11.5], boxes: [{ uv: [13, 4], box: [-0.5, 0, -1, 1, 1, 2] }] },
    { name: 'body_layer_0', pivot: [0, 16, 1], boxes: [{ uv: [20, 0], box: [-5, 0, -1.5, 10, 8, 3] }] },
    { name: 'body_layer_1', pivot: [0, 20, 7], boxes: [{ uv: [20, 11], box: [-3, 0, -1.5, 6, 4, 3] }] },
    { name: 'body_layer_2', pivot: [0, 19, -1.5], boxes: [{ uv: [20, 18], box: [-3, 0, -1.5, 6, 5, 2] }] },
  ],
};

/** The endermite, four little sections of the same purple as the enderman that dropped it. */
const endermiteModel: ModelDef = {
  texture: 'endermite.png', texW: 64, texH: 32,
  parts: [
    { name: 'section_2', pivot: [0, 24, 2.5], boxes: [{ uv: [0, 14], box: [-1.5, -3, 0, 3, 3, 1] }] },
    { name: 'section_0', pivot: [0, 24, 0], boxes: [{ uv: [0, 0], box: [-2, -3, -4.4, 4, 3, 2] }] },
    { name: 'section_1', pivot: [0, 24, 0], boxes: [{ uv: [0, 5], box: [-3, -4, -2.4, 6, 4, 5] }] },
    { name: 'section_3', pivot: [0, 24, 0], boxes: [{ uv: [0, 18], box: [-0.5, -2, 3.5, 1, 2, 1] }] },
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

const cowModel = (texture = 'cow/temperate_cow.png'): ModelDef => ({
  texture, texW: 64, texH: 64,
  parts: [
    { name: 'head', pivot: [0, 4, -8], boxes: [{ uv: [0, 0], box: [-4, -4, -6, 8, 8, 6] }, { uv: [22, 0], box: [-5, -5, -4, 1, 3, 1] }, { uv: [22, 0], box: [4, -5, -4, 1, 3, 1] }] },
    { name: 'body', pivot: [0, 5, 2], rotation: [HALF_PI, 0, 0], boxes: [{ uv: [18, 4], box: [-6, -10, -7, 12, 18, 10] }, { uv: [52, 0], box: [-2, 2, -8, 4, 6, 1] }] },
    { name: 'right_hind_leg', pivot: [-4, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_hind_leg', pivot: [4, 12, 7], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_front_leg', pivot: [-4, 12, -6], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_front_leg', pivot: [4, 12, -6], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ],
});

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

/**
 * Vanilla guardian model. The body is the 12x12x16 core with a side plate each way and a plate top
 * and bottom, which is why the core's own side, top and bottom faces are transparent but for a
 * two-pixel border. Twelve spikes ring it — four on top, four at the corners of its middle, four
 * underneath — and the tail is three shrinking segments ending in a fin.
 */
const GUARDIAN_SPIKES: { pivot: [number, number, number]; rotation: [number, number, number] }[] = [
  // top ring, one to a face, tilted out and up
  { pivot: [0, 8, -8], rotation: [-Math.PI / 4, 0, 0] },
  { pivot: [0, 8, 8], rotation: [Math.PI / 4, 0, 0] },
  { pivot: [-8, 8, 0], rotation: [0, 0, Math.PI / 4] },
  { pivot: [8, 8, 0], rotation: [0, 0, -Math.PI / 4] },
  // middle ring, out at the four corners
  { pivot: [-8, 16, -8], rotation: [Math.PI / 2, Math.PI / 4, 0] },
  { pivot: [8, 16, -8], rotation: [Math.PI / 2, -Math.PI / 4, 0] },
  { pivot: [8, 16, 8], rotation: [Math.PI / 2, Math.PI * 1.25, 0] },
  { pivot: [-8, 16, 8], rotation: [Math.PI / 2, Math.PI * 0.75, 0] },
  // bottom ring, one to a face, tilted out and down
  { pivot: [0, 24, -8], rotation: [Math.PI / 4, 0, 0] },
  { pivot: [0, 24, 8], rotation: [-Math.PI / 4, 0, 0] },
  { pivot: [-8, 24, 0], rotation: [0, 0, -Math.PI / 4] },
  { pivot: [8, 24, 0], rotation: [0, 0, Math.PI / 4] },
];

function guardianModel(texture: string): ModelDef {
  return {
    texture, texW: 64, texH: 64,
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [
        { uv: [0, 0], box: [-6, 10, -8, 12, 12, 16] },
        { uv: [0, 28], box: [-8, 10, -6, 2, 12, 12] },
        { uv: [0, 28], box: [6, 10, -6, 2, 12, 12], mirror: true },
        { uv: [16, 40], box: [-6, 8, -6, 12, 2, 12] },
        { uv: [16, 40], box: [-6, 22, -6, 12, 2, 12] },
      ] },
      // the eye slides over the front of the body to watch what the guardian is aiming at
      { name: 'eye', pivot: [0, 0, 0], boxes: [{ uv: [8, 0], box: [-1, 15, -8.1, 2, 2, 1] }] },
      ...GUARDIAN_SPIKES.map((sp, i) => ({
        name: `spike${i}`,
        pivot: sp.pivot,
        rotation: sp.rotation,
        boxes: [{ uv: [0, 0] as [number, number], box: [-1, -4.5, -1, 2, 9, 2] as [number, number, number, number, number, number] }],
      })),
      { name: 'tail0', pivot: [0, 0, 0], boxes: [{ uv: [40, 0], box: [-2, 14, 7, 4, 4, 8] }] },
      { name: 'tail1', parent: 'tail0', pivot: [0, 0, 15], boxes: [{ uv: [0, 54], box: [-1.5, 14.5, 0, 3, 3, 7] }] },
      { name: 'tail2', parent: 'tail1', pivot: [0, 0, 22], boxes: [
        { uv: [41, 32], box: [-1, 15, 0, 2, 2, 6] },
        { uv: [25, 19], box: [-0.5, 11, 4, 1, 9, 9] },
      ] },
    ],
  };
}

/**
 * Vanilla's piglin: a biped with its own wide head, snout, tusks and the two ears that flap as it
 * walks. Piglin brutes and zombified piglins are the same model on their own skins.
 */
function piglinModel(texture: string): ModelDef {
  return {
    texture, texW: 64, texH: 64,
    parts: [
      { name: 'head', pivot: [0, 0, 0], boxes: [
        { uv: [0, 0], box: [-5, -8, -4, 10, 8, 8] },
        { uv: [31, 1], box: [-2, -4, -5, 4, 4, 1] }, // the snout
        { uv: [2, 4], box: [2, -2, -6, 1, 2, 1] }, // and its tusks
        { uv: [2, 0], box: [-3, -2, -6, 1, 2, 1] },
      ] },
      { name: 'right_ear', parent: 'head', pivot: [-4.5, -6, 0], rotation: [0, 0, -0.5236], boxes: [{ uv: [39, 6], box: [-1, 0, -2, 1, 5, 4] }] },
      { name: 'left_ear', parent: 'head', pivot: [4.5, -6, 0], rotation: [0, 0, 0.5236], boxes: [{ uv: [50, 6], box: [0, 0, -2, 1, 5, 4] }] },
      { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [16, 16], box: [-4, 0, -2, 8, 12, 4] }] },
      { name: 'right_arm', pivot: [-5, 2, 0], boxes: [{ uv: [40, 16], box: [-3, -2, -2, 4, 12, 4] }] },
      { name: 'left_arm', pivot: [5, 2, 0], boxes: [{ uv: [40, 16], box: [-1, -2, -2, 4, 12, 4], mirror: true }] },
      { name: 'right_leg', pivot: [-1.9, 12, 0], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }] },
      { name: 'left_leg', pivot: [1.9, 12, 0], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
    ],
  };
}

/** The blaze: a head with twelve rods turning around it in three rings, as vanilla arranges them. */
const blazeModel: ModelDef = {
  texture: 'blaze.png', texW: 64, texH: 32,
  parts: [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -4, -4, 8, 8, 8] }] },
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `rod${i}`,
      pivot: [0, 0, 0] as [number, number, number],
      boxes: [{ uv: [0, 16] as [number, number], box: [0, 0, 0, 2, 8, 2] as [number, number, number, number, number, number] }],
    })),
  ],
};

/** The magma cube: vanilla's eight flat slices around a small core, which part as it hops. */
const magmaCubeModel: ModelDef = {
  texture: 'slime/magmacube.png', texW: 64, texH: 64,
  parts: [
    ...Array.from({ length: 8 }, (_, i) => ({
      name: `slice${i}`,
      pivot: [0, 0, 0] as [number, number, number],
      boxes: [{ uv: [(i % 2) * 32, Math.floor(i / 2) * 9] as [number, number], box: [-4, 16 + i, -4, 8, 1, 8] as [number, number, number, number, number, number] }],
    })),
    { name: 'core', pivot: [0, 0, 0], boxes: [{ uv: [24, 40], box: [-2, 18, -2, 4, 4, 4] }] },
  ],
};

/** The ghast: a cube with nine tentacles of vanilla's own lengths hanging off it. */
const GHAST_TENTACLES = [11, 9, 14, 8, 12, 10, 13, 9, 11];
const ghastModel: ModelDef = {
  texture: 'ghast/ghast.png', texW: 64, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 17.6, 0], boxes: [{ uv: [0, 0], box: [-8, -8, -8, 16, 16, 16] }] },
    ...GHAST_TENTACLES.map((len, i) => ({
      name: `tentacle${i}`,
      pivot: [((i % 3) - 1) * 5, 24.6, (Math.floor(i / 3) - 1) * 5] as [number, number, number],
      boxes: [{ uv: [0, 0] as [number, number], box: [-1, 0, -1, 2, len, 2] as [number, number, number, number, number, number] }],
    })),
  ],
};

/** The hoglin and the zoglin it turns into: vanilla's boxy body, wide head, ears and four thick legs. */
function hoglinModel(texture: string): ModelDef {
  return {
    texture, texW: 128, texH: 64,
    parts: [
      { name: 'body', pivot: [0, 7, 0], boxes: [{ uv: [1, 1], box: [-8, -7, -13, 16, 14, 26] }] },
      { name: 'head', pivot: [0, 2, -12], boxes: [{ uv: [61, 1], box: [-7, -3, -19, 14, 6, 19] }] },
      { name: 'right_ear', parent: 'head', pivot: [-6, 0, -15], rotation: [0, 0, -0.6981], boxes: [{ uv: [1, 1], box: [-6, -1, -2, 6, 1, 4] }] },
      { name: 'left_ear', parent: 'head', pivot: [6, 0, -15], rotation: [0, 0, 0.6981], boxes: [{ uv: [1, 6], box: [0, -1, -2, 6, 1, 4] }] },
      { name: 'right_front_leg', pivot: [-4, 10, -8], boxes: [{ uv: [42, 42], box: [-3, 0, -3, 6, 14, 6] }] },
      { name: 'left_front_leg', pivot: [4, 10, -8], boxes: [{ uv: [42, 42], box: [-3, 0, -3, 6, 14, 6], mirror: true }] },
      { name: 'right_hind_leg', pivot: [-5.5, 10, 8], boxes: [{ uv: [66, 42], box: [-2.5, 0, -2.5, 5, 14, 5] }] },
      { name: 'left_hind_leg', pivot: [5.5, 10, 8], boxes: [{ uv: [66, 42], box: [-2.5, 0, -2.5, 5, 14, 5], mirror: true }] },
    ],
  };
}

/** The strider: a fuzzy body on two long legs, which is the whole of it. */
const striderModel: ModelDef = {
  texture: 'strider/strider.png', texW: 64, texH: 128,
  parts: [
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-8, -8, -8, 16, 14, 16] }] },
    { name: 'right_leg', pivot: [-4, 6, 0], boxes: [{ uv: [0, 32], box: [-2, 0, -2, 4, 18, 4] }] },
    { name: 'left_leg', pivot: [4, 6, 0], boxes: [{ uv: [0, 55], box: [-2, 0, -2, 4, 18, 4] }] },
  ],
};

/**
 * The Wither: vanilla's three skulls on a bar of shoulders, with the ribcage and tail hanging under
 * them. The texture net confirms the heads and the shoulders; the rest is vanilla's own geometry.
 */
const witherModel: ModelDef = {
  texture: 'wither/wither.png', texW: 64, texH: 64,
  parts: [
    { name: 'shoulders', pivot: [0, 0, 0], boxes: [{ uv: [0, 16], box: [-10, 3.9, -0.5, 20, 3, 3] }] },
    { name: 'ribcage', pivot: [0, 0, 0], boxes: [
      { uv: [0, 22], box: [-2, 6.9, -0.5, 4, 9, 3] },
      { uv: [0, 22], box: [0, 10.9, -0.5, 3, 2, 3] },
      { uv: [0, 22], box: [-3, 10.9, -0.5, 3, 2, 3] },
    ] },
    { name: 'tail', pivot: [0, 0, 0], boxes: [{ uv: [12, 22], box: [-1, 15.9, -0.5, 2, 6, 2] }] },
    { name: 'head', pivot: [0, 4, 0], boxes: [{ uv: [0, 0], box: [-4, -4, -4, 8, 8, 8] }] },
    { name: 'left_head', pivot: [10, 4.4, 0], boxes: [{ uv: [32, 0], box: [-4, -4, -4, 6, 6, 6] }] },
    { name: 'right_head', pivot: [-10, 4.4, 0], boxes: [{ uv: [32, 0], box: [-2, -4, -4, 6, 6, 6] }] },
  ],
};

/**
 * The shulker: a box that clings to a wall, with a lid that slides up over a head when it opens.
 * Vanilla draws all three around the block it is stuck to.
 */
const shulkerModel: ModelDef = {
  texture: 'shulker/shulker.png', texW: 64, texH: 64,
  parts: [
    { name: 'base', pivot: [0, 24, 0], boxes: [{ uv: [0, 28], box: [-8, -8, -8, 16, 8, 16] }] },
    { name: 'lid', pivot: [0, 24, 0], boxes: [{ uv: [0, 0], box: [-8, -16, -8, 16, 12, 16] }] },
    { name: 'head', pivot: [0, 12, 0], boxes: [{ uv: [0, 52], box: [-3, 0, -3, 6, 6, 6] }] },
  ],
};

/**
 * The end crystal: a glass cage around a core, standing on its base. Mojang doubled the texture's
 * resolution at some point, so the boxes here are twice vanilla's numbers on a 128x64 sheet, which
 * comes to the same size in the world.
 */
const endCrystalModel: ModelDef = {
  texture: 'end_crystal/end_crystal.png', texW: 128, texH: 64,
  parts: [
    { name: 'base', pivot: [0, 24, 0], boxes: [{ uv: [0, 32], box: [-12, -8, -12, 24, 8, 24] }] },
    { name: 'glass', pivot: [0, 12, 0], boxes: [{ uv: [0, 0], box: [-8, -8, -8, 16, 16, 16] }] },
    { name: 'core', pivot: [0, 12, 0], boxes: [{ uv: [0, 0], box: [-6, -6, -6, 12, 12, 12] }] },
  ],
};

/** Vanilla draws the dragon around its middle; ours stands it on its feet. */
const DRAGON_LIFT = -61;

/**
 * The Ender Dragon, transcribed from vanilla's model: the long body with its ridge of scales, the
 * neck and head with their upper lip and jaw, the two wings in two joints each, and four legs of
 * three joints. The wing membranes are flat quads hanging off the bones, as vanilla draws them.
 */
const dragonModel: ModelDef = {
  texture: 'enderdragon/dragon.png', texW: 256, texH: 256,
  parts: [
    // vanilla's own part offsets, lifted by DRAGON_LIFT so the hind feet come down on the ground
    { name: 'body', pivot: [0, 4 + DRAGON_LIFT, 8], boxes: [
      { uv: [0, 0], box: [-12, 0, -16, 24, 24, 64] },
      { uv: [220, 53], box: [-1, -6, -10, 2, 6, 12] },
      { uv: [220, 53], box: [-1, -6, 10, 2, 6, 12] },
      { uv: [220, 53], box: [-1, -6, 30, 2, 6, 12] },
    ] },
    { name: 'neck', pivot: [0, DRAGON_LIFT, -8], boxes: [
      { uv: [192, 104], box: [-5, -5, -5, 10, 10, 10] },
      { uv: [48, 0], box: [-1, -9, -3, 2, 4, 6] },
    ] },
    { name: 'head', pivot: [0, DRAGON_LIFT, -20], boxes: [
      { uv: [176, 44], box: [-6, -1, -24, 12, 5, 16] },
      { uv: [112, 30], box: [-8, -8, -10, 16, 16, 16] },
      { uv: [0, 0], box: [-5, -12, -4, 2, 4, 6] },
      { uv: [0, 0], box: [3, -12, -4, 2, 4, 6], mirror: true },
      { uv: [112, 0], box: [-5, -3, -22, 2, 2, 4] },
      { uv: [112, 0], box: [3, -3, -22, 2, 2, 4], mirror: true },
    ] },
    { name: 'jaw', parent: 'head', pivot: [0, 4 + DRAGON_LIFT, -28], boxes: [{ uv: [176, 65], box: [-6, 0, -16, 12, 4, 16] }] },
    { name: 'left_wing', pivot: [12, 5 + DRAGON_LIFT, 2], boxes: [
      { uv: [112, 88], box: [0, -4, -4, 56, 8, 8], mirror: true },
      { uv: [64, 88], box: [0, 0, 2, 56, 0, 56], mirror: true },
    ] },
    { name: 'left_wing_tip', parent: 'left_wing', pivot: [68, 5 + DRAGON_LIFT, 2], boxes: [
      { uv: [112, 136], box: [0, -2, -2, 56, 4, 4], mirror: true },
      { uv: [64, 88], box: [0, 0, 2, 56, 0, 56], mirror: true },
    ] },
    { name: 'right_wing', pivot: [-12, 5 + DRAGON_LIFT, 2], boxes: [
      { uv: [112, 88], box: [-56, -4, -4, 56, 8, 8] },
      { uv: [64, 88], box: [-56, 0, 2, 56, 0, 56] },
    ] },
    { name: 'right_wing_tip', parent: 'right_wing', pivot: [-68, 5 + DRAGON_LIFT, 2], boxes: [
      { uv: [112, 136], box: [-56, -2, -2, 56, 4, 4] },
      { uv: [64, 88], box: [-56, 0, 2, 56, 0, 56] },
    ] },
    ...([1, -1] as const).flatMap((m) => {
      const side = m === 1 ? 'left' : 'right';
      return [
        { name: `${side}_front_leg`, pivot: [m * 12, 20 + DRAGON_LIFT, 2] as [number, number, number], boxes: [{ uv: [112, 104] as [number, number], box: [-4, -4, -4, 8, 24, 8] as [number, number, number, number, number, number] }] },
        { name: `${side}_front_leg_tip`, parent: `${side}_front_leg`, pivot: [m * 12, 40 + DRAGON_LIFT, 1] as [number, number, number], boxes: [{ uv: [226, 138] as [number, number], box: [-3, -1, -3, 6, 24, 6] as [number, number, number, number, number, number] }] },
        { name: `${side}_front_foot`, parent: `${side}_front_leg_tip`, pivot: [m * 12, 63 + DRAGON_LIFT, 1] as [number, number, number], boxes: [{ uv: [144, 104] as [number, number], box: [-4, 0, -12, 8, 4, 16] as [number, number, number, number, number, number] }] },
        { name: `${side}_hind_leg`, pivot: [m * 16, 16 + DRAGON_LIFT, 42] as [number, number, number], boxes: [{ uv: [196, 0] as [number, number], box: [-8, -4, -8, 16, 32, 16] as [number, number, number, number, number, number] }] },
        { name: `${side}_hind_leg_tip`, parent: `${side}_hind_leg`, pivot: [m * 16, 48 + DRAGON_LIFT, 38] as [number, number, number], boxes: [{ uv: [0, 0] as [number, number], box: [-6, -2, 0, 12, 32, 12] as [number, number, number, number, number, number] }] },
        { name: `${side}_hind_foot`, parent: `${side}_hind_leg_tip`, pivot: [m * 16, 79 + DRAGON_LIFT, 42] as [number, number, number], boxes: [{ uv: [112, 0] as [number, number], box: [-9, 0, -20, 18, 6, 24] as [number, number, number, number, number, number] }] },
      ];
    }),
  ],
};

/** Bee skins: angry and nectar-carrying bees swap texture like vanilla's four variants. */
export function beeTexture(angry: boolean, nectar: boolean): string {
  return `bee/bee${angry ? '_angry' : ''}${nectar ? '_nectar' : ''}.png`;
}

/** Flowers a bee will pollinate and breed with (vanilla's `#minecraft:flowers`, small ones). */

/**
 * Illagers share the villager body with free arms (converted from the shipped geometry). The
 * crossed `arms` block is what vanilla shows while an illager walks with nothing to do, and the
 * separate arms take over when it attacks or aims.
 */
const illagerModel = (texture: string): ModelDef => ({
  texture, texW: 64, texH: 64,
  parts: [
    { name: 'body', pivot: [0, 24, 0], boxes: [{ uv: [16, 20], box: [-4, -24, -3, 8, 12, 6] }, { uv: [0, 38], box: [-4, -24, -3, 8, 18, 6], inflate: 0.5 }] },
    { name: 'head', parent: 'body', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -10, -4, 8, 10, 8] }] },
    { name: 'nose', parent: 'head', pivot: [0, -2, 0], boxes: [{ uv: [24, 0], box: [-1, -1, -6, 2, 4, 2] }] },
    { name: 'arms', parent: 'body', pivot: [0, 2, 0], hidden: true, boxes: [{ uv: [44, 22], box: [-8, -2, -2, 4, 8, 4] }, { uv: [44, 22], box: [4, -2, -2, 4, 8, 4], mirror: true }, { uv: [40, 38], box: [-4, 2, -2, 8, 4, 4] }] },
    { name: 'right_arm', parent: 'body', pivot: [-5, 2, 0], boxes: [{ uv: [40, 46], box: [-3, -2, -2, 4, 12, 4] }] },
    { name: 'left_arm', parent: 'body', pivot: [5, 2, 0], boxes: [{ uv: [40, 46], box: [-1, -2, -2, 4, 12, 4], mirror: true }] },
    { name: 'right_leg', parent: 'body', pivot: [-2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4] }] },
    { name: 'left_leg', parent: 'body', pivot: [2, 12, 0], boxes: [{ uv: [0, 22], box: [-2, 0, -2, 4, 12, 4], mirror: true }] },
  ],
});

/** Vex: a small winged illager familiar (converted from the shipped geometry). */
const vexModel: ModelDef = {
  texture: 'illager/vex.png', texW: 32, texH: 32,
  parts: [
    { name: 'body', pivot: [0, 22, 0], boxes: [{ uv: [0, 10], box: [-1.5, -4, -1, 3, 4, 2] }, { uv: [0, 16], box: [-1.5, -3, -1, 3, 5, 2], inflate: -0.2 }] },
    { name: 'head', parent: 'body', pivot: [0, 18, 0], boxes: [{ uv: [0, 0], box: [-2.5, -5, -2.5, 5, 5, 5] }] },
    { name: 'right_arm', parent: 'body', pivot: [-1.75, 18.25, 0], boxes: [{ uv: [23, 0], box: [-1.25, -0.5, -1, 2, 4, 2], inflate: -0.1 }] },
    { name: 'left_arm', parent: 'body', pivot: [1.75, 18.25, 0], boxes: [{ uv: [23, 6], box: [-0.75, -0.5, -1, 2, 4, 2], inflate: -0.1 }] },
    { name: 'left_wing', parent: 'body', pivot: [0.5, 19, 1], boxes: [{ uv: [16, 22], box: [0, 0, 0, 8, 5, 0], mirror: true }] },
    { name: 'right_wing', parent: 'body', pivot: [-0.5, 19, 1], boxes: [{ uv: [16, 22], box: [-8, 0, 0, 8, 5, 0] }] },
  ],
};

/** Ravager: the illagers' beast (converted from the shipped geometry). */
const ravagerModel: ModelDef = {
  texture: 'illager/ravager.png', texW: 128, texH: 128,
  parts: [
    { name: 'body', pivot: [0, 5, 2], rotation: [-1.5708, 0, 0], boxes: [{ uv: [0, 55], box: [-7, -7, -4, 14, 16, 20] }, { uv: [0, 91], box: [-6, 9, -4, 12, 13, 18] }] },
    { name: 'neck', pivot: [0, 4, -20], boxes: [{ uv: [68, 73], box: [-5, -11, 10, 10, 10, 18] }] },
    { name: 'head', parent: 'neck', pivot: [0, -4, -10], boxes: [{ uv: [0, 0], box: [-8, -6, -14, 16, 20, 16] }, { uv: [0, 0], box: [-2, 8, -18, 4, 8, 4] }] },
    { name: 'mouth', parent: 'head', pivot: [0, 9, -10], boxes: [{ uv: [0, 36], box: [-8, -1, -14, 16, 3, 16] }] },
    { name: 'horns', parent: 'head', pivot: [-5, -3, -19], rotation: [-1.0472, 0, 0], boxes: [{ uv: [74, 55], box: [-5, -14, -1, 2, 14, 4] }, { uv: [74, 55], box: [13, -14, -1, 2, 14, 4] }] },
    { name: 'right_hind_leg', pivot: [-12, -6, 22], boxes: [{ uv: [96, 0], box: [0, -7, -5, 8, 37, 8] }] },
    { name: 'left_hind_leg', pivot: [4, -6, 22], boxes: [{ uv: [96, 0], box: [0, -7, -5, 8, 37, 8] }] },
    { name: 'right_front_leg', pivot: [-4, -2, -4], boxes: [{ uv: [64, 0], box: [-8, -11, -4, 8, 37, 8] }] },
    { name: 'left_front_leg', pivot: [-4, -2, -4], boxes: [{ uv: [64, 0], box: [8, -11, -4, 8, 37, 8] }] },
  ],
};

/** Illagers, and the mobs they bring along. */
export const ILLAGER_TYPES = ['pillager', 'vindicator', 'evoker', 'vex', 'ravager'];

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
  fireproof?: boolean;
  walksOnLava?: boolean;
  flying?: boolean;
  /** mobs.json entry to read stats from when it differs from the spec id (slime sizes). */
  data?: string;
  override?: Partial<Pick<MobStats, 'health' | 'damage' | 'width' | 'height' | 'xp' | 'speed'>>;
}

const passiveGoals = (panicSpeed = 1.25, extra: Goal[] = []) => [floatGoal, panicGoal(panicSpeed), breedGoal(), followParentGoal(), ...extra, wanderGoal(120, 1, 10), lookAtPlayerGoal(6), randomLookGoal];

/** Turtles crawl on land and swim well, and go home to the sand they hatched on to lay. */
const turtleGoals = (): Goal[] => [floatGoal, panicGoal(1.2), breedGoal(), turtleLayGoal(), followParentGoal(), wanderGoal(160, 0.5, 8), lookAtPlayerGoal(6), randomLookGoal];

/** Foxes sleep out the day, keep away from players, and hunt nothing here yet. */
const foxGoals = (): Goal[] => [floatGoal, foxSleepGoal(), panicGoal(1.6), avoidPlayerGoal(12), breedGoal(), followParentGoal(), wanderGoal(120, 1, 10), lookAtPlayerGoal(6), randomLookGoal];

/** Goats wander the peaks and lower their heads at whatever has stood too close for too long. */
const goatGoals = (): Goal[] => [floatGoal, panicGoal(1.4), goatRamGoal(), breedGoal(), followParentGoal(), wanderGoal(120, 1, 10), lookAtPlayerGoal(6), randomLookGoal];

/** A lazy panda lies down where it is; the rest amble about the jungle. */
const pandaGoals = (): Goal[] => [floatGoal, pandaLieGoal(), panicGoal(1.2), loseTargetGoal(), meleeAttackGoal(), breedGoal(), followParentGoal(), wanderGoal(160, 0.7, 8), lookAtPlayerGoal(6), randomLookGoal];

/** A polar bear minds its own business until somebody touches its cub. */
const bearGoals = (): Goal[] => [floatGoal, bearDefendGoal(), loseTargetGoal(), meleeAttackGoal(), breedGoal(), followParentGoal(), wanderGoal(120, 0.9, 10), lookAtPlayerGoal(6), randomLookGoal];

/** Llamas keep to their herd and spit at whatever hurts them. */
const llamaGoals = (): Goal[] => [floatGoal, llamaSpitGoal(), panicGoal(1.2), breedGoal(), followParentGoal(), wanderGoal(120, 0.8, 10), lookAtPlayerGoal(6), randomLookGoal];

/** Vanilla breeding items per animal. */
export const BREEDING_FOODS: Record<string, string[]> = {
  cow: ['wheat'], mooshroom: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'],
  turtle: ['seagrass'], goat: ['wheat'], fox: ['sweet_berries', 'glow_berries'],
  rabbit: ['carrot', 'golden_carrot', 'dandelion'], panda: ['bamboo'], llama: ['hay_block'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'],
};
export const isBreedingFood = (mob: string, item: string): boolean => BREEDING_FOODS[mob]?.includes(item) ?? false;

/** Meat a wolf eats (heals a hurt tamed wolf, otherwise breeds). */
export const WOLF_FOODS = ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'rotten_flesh'];
BREEDING_FOODS.wolf = WOLF_FOODS;
BREEDING_FOODS.cat = ['cod', 'salmon'];
BREEDING_FOODS.bee = BEE_FLOWERS;
BREEDING_FOODS.ocelot = ['cod', 'salmon'];
for (const e of ['horse', 'donkey', 'mule']) BREEDING_FOODS[e] = ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'];

/**
 * Vanilla `Rabbit.getRandomRabbitType`: snowy biomes give white rabbits (one in five splotched),
 * the desert gives gold ones, and everywhere else rolls brown, salt or black.
 */
export function rabbitVariantFor(biomeId: string, rng: () => number): string {
  const i = Math.floor(rng() * 100);
  if (biomeId.startsWith('snowy') || biomeId.includes('frozen') || biomeId === 'grove' || biomeId.includes('peaks')) return i < 80 ? 'white' : 'white_splotched';
  if (biomeId === 'desert' || biomeId === 'badlands') return 'gold';
  return i < 50 ? 'brown' : i < 90 ? 'salt' : 'black';
}

/** Vanilla's panda genes, with the two recessive ones only showing when both parents carry them. */
export const PANDA_GENES = ['normal', 'lazy', 'worried', 'playful', 'aggressive', 'weak', 'brown'];

/** One rolled gene, on vanilla's own weights: the plain one most of the time. */
export function pandaGene(rng: () => number): string {
  const r = rng();
  if (r < 0.45) return 'normal';
  if (r < 0.6) return 'lazy';
  if (r < 0.72) return 'worried';
  if (r < 0.84) return 'playful';
  if (r < 0.92) return 'aggressive';
  if (r < 0.97) return 'weak';
  return 'brown';
}

/** Vanilla's llama coats. */
export const LLAMA_COATS = ['creamy', 'white', 'brown', 'gray'];

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
  cow: { model: cowModel(), animation: 'quadruped', eyeHeight: 1.3, followRange: 16, goals: () => passiveGoals() },
  // the mooshroom is a cow in a red skin with mushrooms growing on its back; only mushroom fields have it
  mooshroom: { model: cowModel('cow/red_mooshroom.png'), animation: 'quadruped', eyeHeight: 1.3, followRange: 16, goals: () => passiveGoals() },
  pig: { model: pigModel, animation: 'quadruped', eyeHeight: 0.8, followRange: 16, goals: () => passiveGoals() },
  sheep: { model: sheepModel, animation: 'quadruped', eyeHeight: 1.2, followRange: 16, goals: () => passiveGoals(1.25, [eatGrassGoal()]) },
  chicken: { model: chickenModel, animation: 'chicken', eyeHeight: 0.644, followRange: 16, flapping: true, goals: () => passiveGoals(1.4) },
  wolf: { model: wolfModel, animation: 'quadruped', eyeHeight: 0.68, followRange: 16, goals: () => [floatGoal, sitGoal(), wolfDefendGoal(), wolfHuntGoal(), loseTargetGoal(), meleeAttackGoal(), followOwnerGoal(), breedGoal(), followParentGoal(), wanderGoal(120, 1, 10), lookAtPlayerGoal(8), randomLookGoal] },
  cod: { model: codModel, animation: 'fish', eyeHeight: 0.195, followRange: 8, aquatic: true, goals: () => [swimGoal(), panicGoal(2)] },
  // the cave's own: a bat hangs from the ceiling until something disturbs it
  // vanilla draws the bat at just over a third of its model size, which is what makes it small
  bat: { model: batModel, animation: 'bat', eyeHeight: 0.45, followRange: 16, flying: true, scale: 0.35, goals: () => [batGoal()] },
  // squid drift through the water in slow pulses; the glow squid is the same animal in the dark
  squid: { model: squidModel(), animation: 'squid', eyeHeight: 0.4, followRange: 16, aquatic: true, goals: () => [squidGoal()] },
  glow_squid: { model: squidModel('squid/glow_squid.png'), animation: 'squid', eyeHeight: 0.4, followRange: 16, aquatic: true, goals: () => [squidGoal()] },
  dolphin: { model: dolphinModel, animation: 'fish', eyeHeight: 0.3, followRange: 16, aquatic: true, goals: () => [dolphinGoal(), loseTargetGoal(), meleeAttackGoal()] },
  // the beach, the taiga and the mountains: a turtle that lays its eggs where it hatched, a fox that
  // sleeps out the day, and a goat that rams whatever stands still long enough
  turtle: { model: turtleModel, animation: 'quadruped', eyeHeight: 0.25, followRange: 16, goals: () => turtleGoals() },
  fox: { model: foxModel(), animation: 'quadruped', eyeHeight: 0.55, followRange: 16, goals: () => foxGoals() },
  goat: { model: goatModel, animation: 'quadruped', eyeHeight: 1.2, followRange: 16, goals: () => goatGoals() },
  // and the rest of the overworld's animals: a rabbit that hops, a panda born one way or another,
  // a polar bear that turns on whoever touches its cub, and a llama that spits
  rabbit: { model: rabbitModel(), animation: 'rabbit', eyeHeight: 0.4, followRange: 16, goals: () => passiveGoals(2.2) },
  panda: { model: pandaModel(), animation: 'quadruped', eyeHeight: 1.1, followRange: 16, goals: () => pandaGoals() },
  polar_bear: { model: polarBearModel, animation: 'quadruped', eyeHeight: 1.3, followRange: 32, goals: () => bearGoals() },
  llama: { model: llamaModel(), animation: 'quadruped', eyeHeight: 1.75, followRange: 32, goals: () => llamaGoals() },
  // a wandering trader's pair of llamas: the same animal in the coat vanilla gives them
  trader_llama: { model: llamaModel('llama/brown.png'), animation: 'quadruped', eyeHeight: 1.75, followRange: 32, data: 'trader_llama', loot: 'trader_llama', goals: () => llamaGoals() },
  // the two little ones that come out of a broken block and an enderman's teleport
  silverfish: { model: silverfishModel, animation: 'silverfish', eyeHeight: 0.13, followRange: 16, goals: () => [loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(), wanderGoal(80, 1, 6), randomLookGoal] },
  endermite: { model: endermiteModel, animation: 'silverfish', eyeHeight: 0.13, followRange: 16, goals: () => [loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(), wanderGoal(80, 1, 6), randomLookGoal] },
  // the undead horses, which are the same animal in a rotted or bleached coat
  skeleton_horse: { model: equineModel('horse/horse_skeleton.png', 'horse', null, 'equipment/horse_saddle/saddle.png', true), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
  zombie_horse: { model: equineModel('horse/horse_zombie.png', 'horse', null, 'equipment/horse_saddle/saddle.png', true), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
  // and the villager the plague took, which cures back into one given time and a golden apple
  zombie_villager: { model: villagerModel('zombie_villager/zombie_villager.png'), animation: 'biped', eyeHeight: 1.74, followRange: 35, burnsInSun: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(35), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  // vanilla phantom attack damage is 6
  phantom: { model: phantomModel, animation: 'phantom', eyeHeight: 0.33, followRange: 64, flying: true, burnsInSun: true, override: { damage: 6 }, goals: () => [phantomGoal()] },
  witch: { model: witchModel, animation: 'biped', eyeHeight: 1.62, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), witchGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  salmon: { model: salmonModel, animation: 'fish', eyeHeight: 0.26, followRange: 8, aquatic: true, goals: () => [swimGoal(), panicGoal(2)] },
  // cats and ocelots share the vanilla model; ocelots only ever grow to trust the player
  cat: { model: catModel('cat/tabby.png', true), animation: 'quadruped', eyeHeight: 0.35, followRange: 16, override: { height: 0.7, width: 0.6 }, goals: () => [floatGoal, sitGoal(), catAvoidGoal(), temptGoal(CAT_FOODS, 10), breedGoal(), followParentGoal(), followOwnerGoal(), wanderGoal(120, 0.8, 10), lookAtPlayerGoal(8), randomLookGoal] },
  ocelot: { model: catModel('cat/ocelot.png'), animation: 'quadruped', eyeHeight: 0.35, followRange: 16, override: { height: 0.7, width: 0.6 }, goals: () => [floatGoal, ocelotFleeGoal(), temptGoal(CAT_FOODS, 10), breedGoal(), followParentGoal(), wanderGoal(120, 0.8, 10), lookAtPlayerGoal(8), randomLookGoal] },
  // illagers: pillagers shoot crossbows, vindicators charge with axes, evokers summon vexes and fangs
  pillager: { model: illagerModel('illager/pillager.png'), animation: 'illager', eyeHeight: 1.62, followRange: 32, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(32), targetVillagerGoal(), bowAttackGoal(undefined, 'crossbow'), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  vindicator: { model: illagerModel('illager/vindicator.png'), animation: 'illager', eyeHeight: 1.62, followRange: 32, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(32), targetVillagerGoal(), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  evoker: { model: illagerModel('illager/evoker.png'), animation: 'illager', eyeHeight: 1.62, followRange: 32, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(32), targetVillagerGoal(), evokerGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  vex: { model: vexModel, animation: 'vex', eyeHeight: 0.51, followRange: 32, flying: true, goals: () => [loseTargetGoal(), targetPlayerGoal(32), vexGoal()] },
  ravager: { model: ravagerModel, animation: 'quadruped', eyeHeight: 1.9, followRange: 32, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(32), targetVillagerGoal(), meleeAttackGoal(0.6, (m, w) => w.emitParticles('angry', m.pos.x, m.pos.y + m.height, m.pos.z, 3, m.width, 0.5)), wanderGoal(120, 0.8), lookAtPlayerGoal(8), randomLookGoal] },
  // bees fly between flowers and their hive; vanilla stats are 10 health and a 2-damage sting
  bee: { model: beeModel, animation: 'bee', eyeHeight: 0.45, followRange: 48, flying: true, goals: () => [beeGoal()] },
  // villagers keep a profession, level and trade list in `extra`; the wandering trader is unlayered
  villager: { model: villagerModel('villager/villager.png'), animation: 'biped', eyeHeight: 1.62, followRange: 16, goals: () => villagerGoals() },
  wandering_trader: { model: villagerModel('wandering_trader.png', false), animation: 'biped', eyeHeight: 1.62, followRange: 16, data: 'villager', loot: 'wandering_trader', goals: () => villagerGoals() },
  // equines: attributes are rolled per animal, so the table values are only the vanilla averages
  horse: { model: equineModel('horse/horse_white.png', 'horse', HORSE_MARKING_LAYER, 'equipment/horse_saddle/saddle.png', true), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
  donkey: { model: equineModel('horse/donkey.png', 'mule', null, 'equipment/donkey_saddle/saddle.png'), animation: 'horse', eyeHeight: 1.425, followRange: 16, goals: () => equineGoals() },
  mule: { model: equineModel('horse/mule.png', 'mule', null, 'equipment/mule_saddle/saddle.png'), animation: 'horse', eyeHeight: 1.52, followRange: 16, goals: () => equineGoals() },
  // guardians live in the water and shoot rather than bite; the elder is the same mob at 2.35 scale
  guardian: { model: guardianModel('guardian.png'), animation: 'guardian', eyeHeight: 0.425, followRange: 16, aquatic: true, goals: () => [loseTargetGoal(), targetPlayerGoal(16), guardianGoal()] },
  elder_guardian: { model: guardianModel('guardian_elder.png'), animation: 'guardian', eyeHeight: 1, followRange: 16, aquatic: true, scale: 2.35, goals: () => [elderCurseGoal(), loseTargetGoal(), targetPlayerGoal(16), guardianGoal()] },
  // the Nether's own: piglins take offence unless the player is wearing gold, hoglins charge on sight
  zombified_piglin: { model: piglinModel('piglin/zombified_piglin.png'), animation: 'biped', eyeHeight: 1.79, followRange: 35, fireproof: true, goals: () => [floatGoal, loseTargetGoal(), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  piglin: { model: piglinModel('piglin/piglin.png'), animation: 'biped', eyeHeight: 1.79, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), piglinAngerGoal(), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  piglin_brute: { model: piglinModel('piglin/piglin_brute.png'), animation: 'biped', eyeHeight: 1.79, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(), wanderGoal(120), lookAtPlayerGoal(8), randomLookGoal] },
  hoglin: { model: hoglinModel('hoglin/hoglin.png'), animation: 'quadruped', eyeHeight: 1.4, followRange: 16, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(0.4), wanderGoal(120, 0.8), lookAtPlayerGoal(8), randomLookGoal] },
  zoglin: { model: hoglinModel('hoglin/zoglin.png'), animation: 'quadruped', eyeHeight: 1.4, followRange: 16, data: 'zoglin', fireproof: true, goals: () => [floatGoal, loseTargetGoal(), targetPlayerGoal(16), meleeAttackGoal(0.4), wanderGoal(120, 0.8), lookAtPlayerGoal(8), randomLookGoal] },
  strider: { model: striderModel, animation: 'strider', eyeHeight: 1.5, followRange: 16, fireproof: true, walksOnLava: true, goals: () => [striderGoal(), lookAtPlayerGoal(8), randomLookGoal] },
  blaze: { model: blazeModel, animation: 'blaze', eyeHeight: 1.5, followRange: 48, flying: true, fireproof: true, goals: () => [loseTargetGoal(), targetPlayerGoal(48), blazeGoal()] },
  ghast: { model: ghastModel, animation: 'ghast', eyeHeight: 2.6, followRange: 64, flying: true, fireproof: true, scale: 4.5, override: { health: 10, damage: 6 }, goals: () => [loseTargetGoal(), targetPlayerGoal(64), ghastGoal()] },
  magma_cube: { model: magmaCubeModel, animation: 'slime', eyeHeight: 0.325, followRange: 16, fireproof: true, scale: 1, override: { width: 0.52, height: 0.52, health: 1, damage: 3, xp: 1 }, goals: () => [loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
  magma_cube_medium: { model: magmaCubeModel, animation: 'slime', eyeHeight: 0.65, followRange: 16, fireproof: true, scale: 2, data: 'magma_cube', loot: 'magma_cube', override: { width: 1.04, height: 1.04, health: 4, damage: 4, xp: 2 }, goals: () => [loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
  // the dragon: it circles the middle island and cannot be hurt while a crystal is still healing it
  ender_dragon: { model: dragonModel, animation: 'dragon', eyeHeight: 4, followRange: 128, flying: true, fireproof: true, goals: () => [dragonGoal()] },
  // the end crystal: it stands where it is put, heals the dragon, and goes off when it is hit
  // the shulker: it never moves, and the shell it drops is the only way to a shulker box
  shulker: { model: shulkerModel, animation: 'shulker', eyeHeight: 0.5, followRange: 16, flying: true, override: { xp: 5 }, goals: () => [shulkerGoal()] },
  end_crystal: { model: endCrystalModel, animation: 'crystal', eyeHeight: 1, followRange: 0, flying: true, fireproof: true, data: 'end_crystal', override: { health: 1, damage: 0, xp: 0, width: 2, height: 2 }, goals: () => [] },
  // the Wither: summoned rather than spawned, flying, and armoured once it is half beaten
  wither: { model: witherModel, animation: 'wither', eyeHeight: 3.1, followRange: 64, flying: true, fireproof: true, scale: 2, goals: () => [witherGoal()] },
  magma_cube_big: { model: magmaCubeModel, animation: 'slime', eyeHeight: 1.3, followRange: 16, fireproof: true, scale: 4, data: 'magma_cube', loot: 'magma_cube', override: { width: 2.08, height: 2.08, health: 16, damage: 6, xp: 4 }, goals: () => [loseTargetGoal(), targetPlayerGoal(16), slimeGoal()] },
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
    fireproof: spec.fireproof,
    walksOnLava: spec.walksOnLava,
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
/**
 * Vanilla's nether spawn lists, by biome: the wastes are mostly zombified piglins with ghasts,
 * magma cubes and the odd enderman, the crimson forest is piglins and hoglins, the warped forest
 * only endermen, the soul sand valley skeletons and ghasts, and the deltas magma cubes.
 */
const NETHER_WEIGHTS: Record<string, [string, number][]> = {
  nether_wastes: [['zombified_piglin', 50], ['ghast', 50], ['magma_cube', 2], ['enderman', 1], ['piglin', 15]],
  crimson_forest: [['zombified_piglin', 1], ['hoglin', 9], ['piglin', 5]],
  warped_forest: [['enderman', 1], ['strider', 60]],
  soul_sand_valley: [['skeleton', 20], ['ghast', 50], ['enderman', 1], ['strider', 60]],
  basalt_deltas: [['ghast', 40], ['magma_cube', 100], ['strider', 60]],
};

/** One of a nether biome's own mobs, on vanilla's weights. */
export function pickNether(rng: () => number, biome: BiomeDef | undefined): string {
  const list = NETHER_WEIGHTS[biome?.id ?? ''] ?? NETHER_WEIGHTS.nether_wastes;
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rng() * total;
  for (const [t, w] of list) {
    r -= w;
    if (r < 0) return t === 'magma_cube' ? MAGMA_SIZES[Math.floor(rng() * 3)] : t;
  }
  return list[0][0];
}
const MAGMA_SIZES = ['magma_cube', 'magma_cube_medium', 'magma_cube_big'];

export function pickHostile(rng: () => number, biome: BiomeDef | undefined, y: number, slimeChunk: boolean, moon = 1): string {
  if (biome?.dimension === 'nether') return pickNether(rng, biome);
  if (slimeChunk && y < 40 && rng() < 0.5) return SLIME_SIZES[Math.floor(rng() * 3)];
  // vanilla only lets swamp slimes out by the light of the moon, and the fuller it is the more come
  if (biome?.category === 'swamp' && y >= 50 && y <= 70 && rng() < 0.5 && rng() < moon) return SLIME_SIZES[Math.floor(rng() * 3)];
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
