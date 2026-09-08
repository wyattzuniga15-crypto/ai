/**
 * The copper golem statue: the block a golem leaves behind when it seizes up. Vanilla ships an
 * empty block model and draws it in code, so the four poses are Mojang's own geometry, converted
 * the same way the mob's is, and the age picks the texture off the same net.
 */
import type { ModelDef, PartDef } from '../entities/boxModel.ts';

export type StatuePose = 'standing' | 'sitting' | 'running' | 'star';

/** The ages in the order the block ids carry them. */
export const STATUE_SKINS = ['copper_golem', 'exposed_copper_golem', 'weathered_copper_golem', 'oxidized_copper_golem'];

const HEAD_BOXES = [
  { uv: [0, 0], box: [-4, -5, -5, 8, 5, 10] },
  { uv: [56, 0], box: [-1, -2, -6, 2, 3, 2] },
  { uv: [37, 8], box: [-1, -9, -1, 2, 4, 2], inflate: -0.01 },
  { uv: [37, 0], box: [-2, -13, -2, 4, 4, 4], inflate: -0.01 },
] as PartDef['boxes'];

/** geometry.copper_golem: the statue standing as the golem does. */
const STANDING: PartDef[] = [
  { name: 'root', pivot: [0, 24, 0], boxes: [] },
  { name: 'body', parent: 'root', pivot: [0, 19, 0], boxes: [{ uv: [0, 15], box: [-4, -6, -3, 8, 6, 6] }] },
  { name: 'head', parent: 'body', pivot: [0, 13, 0], boxes: HEAD_BOXES },
  { name: 'right_arm', parent: 'body', pivot: [-4, 13, 0], boxes: [{ uv: [36, 16], box: [-3, -1, -2, 3, 10, 4] }] },
  { name: 'left_arm', parent: 'body', pivot: [4, 13, 0], boxes: [{ uv: [50, 16], box: [0, -1, -2, 3, 10, 4] }] },
  { name: 'right_leg', parent: 'root', pivot: [-2, 19, 0], boxes: [{ uv: [0, 27], box: [-1.9, 0, -1.99, 4, 5, 4] }] },
  { name: 'left_leg', parent: 'root', pivot: [2, 19, 0], boxes: [{ uv: [16, 27], box: [-2.1, 0, -2, 4, 5, 4] }] },
];

/** geometry.copper_golem.sitting: sat down with its legs out in front and its arms behind it. */
const SITTING: PartDef[] = [
  { name: 'root', pivot: [0, 24, 0], boxes: [] },
  { name: 'body', parent: 'root', pivot: [0, 21, 2.325], boxes: [{ uv: [3, 19], box: [-3, -4, -4.525, 6, 1, 6] }, { uv: [0, 15], box: [-4, -3, -3.525, 8, 6, 6] }, { uv: [3, 18], box: [-4, -4, -6.525, 8, 6, 3] }] },
  { name: 'head', parent: 'body', pivot: [0, 15, 2.125], boxes: [{ uv: [37, 8], box: [-1, -7, -3.3, 2, 4, 2] }, { uv: [37, 0], box: [-2, -11, -4.3, 4, 4, 4] }, { uv: [0, 0], box: [-4, -3, -7.325, 8, 5, 10] }, { uv: [56, 0], box: [-1, 0, -8.325, 2, 3, 2] }] },
  { name: 'right_arm', parent: 'body', pivot: [-4, 15.4, 0.525], rotation: [-0.4363, 0, 0], boxes: [{ uv: [36, 16], box: [-3.075, -0.884, -1.8768, 3, 10, 4] }] },
  { name: 'left_arm', parent: 'body', pivot: [4, 15.4, 0.625], rotation: [-0.4363, 0, 0], boxes: [{ uv: [50, 16], box: [0.075, -1.0457, -1.9805, 3, 10, 4] }] },
  { name: 'right_leg', parent: 'root', pivot: [-2.1, 21.9, -2.075], boxes: [{ uv: [0, 27], box: [-1.95, -0.925, 1.075, 4, 5, 4] }] },
  { name: 'left_leg', parent: 'root', pivot: [2, 22, -2.075], boxes: [{ uv: [16, 27], box: [-1.95, -1.025, 1.075, 4, 5, 4] }] },
];

/** geometry.copper_golem.running: caught mid-stride, head thrown forward. */
const RUNNING: PartDef[] = [
  { name: 'root', pivot: [0, 24, 0], boxes: [] },
  { name: 'body', parent: 'root', pivot: [0, 19, 0], boxes: [{ uv: [0, 15], box: [-4, -5.8, -3, 8, 6, 6] }] },
  { name: 'head', parent: 'body', pivot: [-0.3, 13.4, -1.999], boxes: HEAD_BOXES },
  { name: 'right_arm', parent: 'body', pivot: [-4, 13, 0], boxes: [{ uv: [36, 16], box: [-3.4, -1, -3, 3, 10, 4] }] },
  { name: 'left_arm', parent: 'body', pivot: [4, 13, 0], boxes: [{ uv: [50, 16], box: [-0.4, -1, -2, 3, 10, 4] }] },
  { name: 'right_leg', parent: 'root', pivot: [-2, 19, 0], boxes: [{ uv: [0, 27], box: [-1.9, 0, -1.99, 4, 5, 4] }] },
  { name: 'left_leg', parent: 'root', pivot: [2, 19, 0], boxes: [{ uv: [16, 27], box: [-2.1, 0, -2, 4, 5, 4] }] },
];

/** geometry.copper_golem.star: arms and legs flung out. */
const STAR: PartDef[] = [
  { name: 'root', pivot: [0, 24, 0], boxes: [] },
  { name: 'body', parent: 'root', pivot: [0, 19, 0], boxes: [{ uv: [0, 15], box: [-4, -6, -3, 8, 6, 6] }] },
  { name: 'head', parent: 'body', pivot: [0, 13, 0], boxes: HEAD_BOXES },
  { name: 'right_arm', parent: 'body', pivot: [-4, 13, 0], boxes: [{ uv: [36, 16], box: [-0.5, -4, -2, 3, 10, 4] }] },
  { name: 'left_arm', parent: 'body', pivot: [4, 13, 0], boxes: [{ uv: [50, 16], box: [-2.5, -4, -2, 3, 10, 4] }] },
  { name: 'right_leg', parent: 'root', pivot: [-2, 19, 0], boxes: [{ uv: [0, 27], box: [-2.65, -0.5, -1.99, 4, 5, 4] }] },
  { name: 'left_leg', parent: 'root', pivot: [2, 19, 0], boxes: [{ uv: [16, 27], box: [-1.35, -0.5, -2, 4, 5, 4] }] },
];

const POSES: Record<StatuePose, PartDef[]> = { standing: STANDING, sitting: SITTING, running: RUNNING, star: STAR };

/** How far along the ages a statue block is, and whether it is waxed (which nothing here cares about). */
export function statueAge(id: string): number {
  const bare = id.replace(/^waxed_/, '');
  if (bare === 'copper_golem_statue') return 0;
  const age = ['exposed', 'weathered', 'oxidized'].indexOf(bare.replace('_copper_golem_statue', ''));
  return age < 0 ? -1 : age + 1;
}

/** The model for one statue block: its pose, in the colour its age wears. */
export function statueModel(id: string, pose: string): ModelDef | null {
  const age = statueAge(id);
  const parts = POSES[pose as StatuePose];
  if (age < 0 || !parts) return null;
  return { texture: `copper_golem/${STATUE_SKINS[age]}.png`, texW: 64, texH: 64, parts };
}
