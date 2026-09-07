/**
 * Box-model definitions for items that vanilla draws with block-entity renderers instead of an
 * item model (shulker boxes, chests, beds, banners, shields, heads, conduit). The icon renderer
 * builds them with the mob box-model builder on the real entity textures.
 */
import type { ModelDef, PartDef } from '../entities/boxModel.ts';

export interface SpecialIcon {
  model: ModelDef;
  gui: { rotation: [number, number, number]; translation: [number, number, number]; scale: number };
  /** Material colour applied to the parts drawn with this texture (banner flags). */
  tint?: { texture: string; color: number };
  /** Several tinted textures at once, which is how a patterned banner is drawn. */
  tints?: { texture: string; color: number }[];
}

/** Every banner pattern vanilla ships, which the icons preload so a woven banner can be drawn. */
export const BANNER_PATTERNS = [
  'base', 'border', 'bricks', 'circle', 'creeper', 'cross', 'curly_border', 'diagonal_left', 'diagonal_right',
  'diagonal_up_left', 'diagonal_up_right', 'flow', 'flower', 'globe', 'gradient', 'gradient_up', 'guster',
  'half_horizontal', 'half_horizontal_bottom', 'half_vertical', 'half_vertical_right', 'mojang', 'piglin',
  'rhombus', 'skull', 'small_stripes', 'square_bottom_left', 'square_bottom_right', 'square_top_left',
  'square_top_right', 'straight_cross', 'stripe_bottom', 'stripe_center', 'stripe_downleft', 'stripe_downright',
  'stripe_left', 'stripe_middle', 'stripe_right', 'stripe_top', 'triangle_bottom', 'triangle_top',
  'triangles_bottom', 'triangles_top',
];

/**
 * A banner with its woven layers: one flag piece per pattern, each on its own texture so it can take
 * its own dye, stacked a hair apart so they draw in order.
 */
export function bannerIconModel(color: string, layers: { pattern: string; color: string }[]): SpecialIcon {
  const flag = (texture: string, i: number): PartDef => ({
    name: `flag${i}`, pivot: [0, -32, 0], texture,
    boxes: [{ uv: [0, 0], box: [-10, 0, -2 - i * 0.06, 20, 40, 1] }],
  });
  const parts: PartDef[] = [flag('banner/base.png', 0)];
  layers.forEach((l, i) => parts.push(flag(`banner/${l.pattern}.png`, i + 1)));
  parts.push({ name: 'pole', pivot: [0, 0, 0], boxes: [{ uv: [44, 0], box: [-1, -30, -1, 2, 42, 2] }] });
  parts.push({ name: 'bar', pivot: [0, 0, 0], boxes: [{ uv: [0, 42], box: [-10, -32, -1, 20, 2, 2] }] });
  return {
    model: { texture: 'banner_base.png', texW: 64, texH: 64, parts },
    gui: { rotation: [30, 45, 0], translation: [0, 0, 0], scale: 0.22 },
    tints: [
      { texture: 'banner/base.png', color: DYE_COLORS[color] ?? 0xffffff },
      ...layers.map((l) => ({ texture: `banner/${l.pattern}.png`, color: DYE_COLORS[l.color] ?? 0xffffff })),
    ],
  };
}

/** Vanilla DyeColor texture diffuse colours. */
export const DYE_COLORS: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const COLORS = Object.keys(DYE_COLORS);
const BLOCK_GUI: SpecialIcon['gui'] = { rotation: [30, 45, 0], translation: [0, 0, 0], scale: 0.625 };

/** `red_shulker_box` → `red`, `shulker_box` → `` (uncoloured), anything else → null. */
function colorPrefix(id: string, suffix: string): string | null {
  if (id === suffix) return '';
  if (!id.endsWith(`_${suffix}`)) return null;
  const c = id.slice(0, -(suffix.length + 1));
  return COLORS.includes(c) ? c : null;
}

function chestTexture(id: string): string | null {
  const bare = id.startsWith('waxed_') ? id.slice(6) : id;
  const map: Record<string, string> = {
    chest: 'normal', trapped_chest: 'trapped', ender_chest: 'ender', copper_chest: 'copper',
    exposed_copper_chest: 'copper_exposed', weathered_copper_chest: 'copper_weathered', oxidized_copper_chest: 'copper_oxidized',
  };
  return map[bare] ?? null;
}

const HEADS: Record<string, { texture: string; texH: number; wide?: boolean; hat?: boolean }> = {
  skeleton_skull: { texture: 'skeleton/skeleton.png', texH: 32 },
  wither_skeleton_skull: { texture: 'skeleton/wither_skeleton.png', texH: 32 },
  zombie_head: { texture: 'zombie/zombie.png', texH: 64 },
  creeper_head: { texture: 'creeper/creeper.png', texH: 32 },
  piglin_head: { texture: 'piglin/piglin.png', texH: 64, wide: true },
  player_head: { texture: 'player/wide/steve.png', texH: 64, hat: true },
};

export function specialIcon(id: string): SpecialIcon | null {
  const shulker = colorPrefix(id, 'shulker_box');
  if (shulker !== null) {
    return {
      model: {
        texture: `shulker/shulker${shulker ? `_${shulker}` : ''}.png`, texW: 64, texH: 64,
        parts: [
          { name: 'lid', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-8, 8, -8, 16, 12, 16] }] },
          { name: 'base', pivot: [0, 0, 0], boxes: [{ uv: [0, 28], box: [-8, 16, -8, 16, 8, 16] }] },
        ],
      },
      gui: BLOCK_GUI,
    };
  }
  const chest = chestTexture(id);
  if (chest) {
    // vanilla draws chests without the model y flip, so every face is mirrored vertically
    return {
      model: {
        texture: `chest/${chest}.png`, texW: 64, texH: 64,
        parts: [
          { name: 'bottom', pivot: [0, 0, 0], boxes: [{ uv: [0, 19], box: [-7, 14, -7, 14, 10, 14], flipV: true }] },
          { name: 'lid', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-7, 9, -7, 14, 5, 14], flipV: true }] },
          { name: 'lock', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-1, 11, -8, 2, 4, 1], flipV: true }] },
        ],
      },
      gui: BLOCK_GUI,
    };
  }
  const bed = colorPrefix(id, 'bed');
  if (bed) {
    const leg = (name: string, x: number, z: number, uv: [number, number]): PartDef => ({ name, pivot: [0, 0, 0], boxes: [{ uv, box: [x, 21, z, 3, 3, 3] }] });
    return {
      model: {
        texture: `bed/${bed}.png`, texW: 64, texH: 64,
        parts: [
          // the 16×16×6 pieces lie flat: rotated a quarter turn about x around their bottom edge
          { name: 'head', pivot: [0, 18, -8], rotation: [Math.PI / 2, 0, 0], boxes: [{ uv: [0, 0], box: [-8, -16, 0, 16, 16, 6] }] },
          { name: 'foot', pivot: [0, 18, 8], rotation: [Math.PI / 2, 0, 0], boxes: [{ uv: [0, 22], box: [-8, -16, 0, 16, 16, 6] }] },
          leg('leg1', -8, -8, [50, 0]), leg('leg2', 5, -8, [50, 6]), leg('leg3', -8, 5, [50, 12]), leg('leg4', 5, 5, [50, 18]),
        ],
      },
      gui: { rotation: [30, 160, 0], translation: [2, 3, 0], scale: 0.5325 },
    };
  }
  const banner = colorPrefix(id, 'banner');
  if (banner) {
    return {
      model: {
        texture: 'banner_base.png', texW: 64, texH: 64,
        parts: [
          { name: 'flag', pivot: [0, -32, 0], texture: 'banner/base.png', boxes: [{ uv: [0, 0], box: [-10, 0, -2, 20, 40, 1] }] },
          { name: 'pole', pivot: [0, 0, 0], boxes: [{ uv: [44, 0], box: [-1, -30, -1, 2, 42, 2] }] },
          { name: 'bar', pivot: [0, 0, 0], boxes: [{ uv: [0, 42], box: [-10, -32, -1, 20, 2, 2] }] },
        ],
      },
      gui: { rotation: [30, 45, 0], translation: [0, 0, 0], scale: 0.22 },
      tint: { texture: 'banner/base.png', color: DYE_COLORS[banner] },
    };
  }
  if (id === 'shield') {
    return {
      model: {
        texture: 'shield_base_nopattern.png', texW: 64, texH: 64,
        parts: [
          { name: 'plate', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-6, -11, -2, 12, 22, 1] }] },
          { name: 'handle', pivot: [0, 0, 0], boxes: [{ uv: [26, 0], box: [-1, -3, -1, 2, 6, 6] }] },
        ],
      },
      gui: { rotation: [15, -25, -5], translation: [2, 3, 0], scale: 0.65 },
    };
  }
  const head = HEADS[id];
  if (head) {
    const boxes: PartDef['boxes'] = [{ uv: [0, 0], box: head.wide ? [-5, -8, -4, 10, 8, 8] : [-4, -8, -4, 8, 8, 8] }];
    if (head.hat) boxes.push({ uv: [32, 0], box: [-4, -8, -4, 8, 8, 8], inflate: 0.25 });
    const parts: PartDef[] = [{ name: 'head', pivot: [0, 0, 0], boxes }];
    if (head.wide) {
      parts.push({ name: 'left_ear', pivot: [4.5, -6, 0], rotation: [0, 0, -Math.PI / 6], boxes: [{ uv: [51, 6], box: [0, 0, -2, 1, 5, 4] }] });
      parts.push({ name: 'right_ear', pivot: [-4.5, -6, 0], rotation: [0, 0, Math.PI / 6], boxes: [{ uv: [39, 6], box: [-1, 0, -2, 1, 5, 4] }] });
    }
    return { model: { texture: head.texture, texW: 64, texH: head.texH, parts }, gui: { rotation: [30, 45, 0], translation: [0, 0, 0], scale: 0.9 } };
  }
  if (id === 'conduit') {
    return { model: { texture: 'conduit/base.png', texW: 32, texH: 16, parts: [{ name: 'shell', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-3, -3, -3, 6, 6, 6] }] }] }, gui: { rotation: [30, 45, 0], translation: [0, 0, 0], scale: 1 } };
  }
  return null;
}
