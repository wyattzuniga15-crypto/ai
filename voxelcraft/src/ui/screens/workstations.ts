/** Stonecutter and smithing table screens (vanilla layouts, 176×166). */
import type { ScreenDef, SlotDef } from './container.ts';
import { playerSlots } from './screens.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { cloneStack } from '../../items/inventory.ts';
import { ingredientMatches, type Ingredient } from '../../items/crafting.ts';
import stonecuttingJson from '../../../data/recipes/stonecutting.json';
import smithingJson from '../../../data/recipes/smithing.json';
import { items } from '../../items/registry.ts';
import { trimMaterialForItem } from '../../items/trims.ts';
import { h } from '../dom.ts';
import type { ItemIcons } from '../icons.ts';

export interface StonecuttingRecipe { id: string; ingredient: Ingredient; result: { item: string; count: number } }
export interface SmithingRecipe {
  id: string; type: 'transform' | 'trim'; template: Ingredient; base: Ingredient; addition: Ingredient;
  result?: { item: string; count: number }; pattern?: string;
}

export const stonecuttingRecipes = stonecuttingJson as StonecuttingRecipe[];
export const smithingRecipes = smithingJson as SmithingRecipe[];

const byGroup = (slots: SlotDef[], g: string) => slots.filter((s) => s.group === g);
const reversePlayer = (slots: SlotDef[]) => [...byGroup(slots, 'hotbar').reverse(), ...byGroup(slots, 'inventory').reverse()];
const sprite = (p: string) => `url('${import.meta.env.BASE_URL}textures/gui/sprites/container/${p}')`;

export interface WorkstationHost {
  inventory: Inventory;
  guiScale: number;
  icons: ItemIcons;
  playSound(name: string): void;
  /** Redraws the open screen (slots and overlays). */
  refresh(): void;
}

/** Stonecutting recipes that accept the given stack, in data order (the order the GUI lists them). */
export function stonecuttingRecipesFor(stack: Slot): StonecuttingRecipe[] {
  return stack ? stonecuttingRecipes.filter((r) => ingredientMatches(r.ingredient, stack)) : [];
}

// Vanilla StonecutterScreen constants.
const RECIPES_X = 52;
const RECIPES_Y = 14;
const RECIPES_COLUMNS = 4;
const RECIPES_ROWS = 3;
const RECIPE_W = 16;
const RECIPE_H = 18;
const SCROLLER_X = 119;
const SCROLLER_Y = 15;
const SCROLLER_W = 12;
const SCROLLER_H = 15;
const SCROLLER_TRACK = 54;

export function stonecutterScreen(host: WorkstationHost): ScreenDef {
  const inv = host.inventory;
  const state: { input: Slot; selected: number } = { input: null, selected: -1 };
  const player = playerSlots(inv);
  const output = (): Slot => {
    const r = stonecuttingRecipesFor(state.input)[state.selected];
    return r ? { id: r.result.item, count: r.result.count } : null;
  };
  const input: SlotDef = {
    x: 20, y: 33, group: 'container',
    get: () => state.input,
    set: (s) => {
      // Vanilla keeps the selection while the input item stays the same and clears it otherwise.
      if (!s || !state.input || s.id !== state.input.id) state.selected = -1;
      state.input = s;
    },
  };
  const out: SlotDef = {
    x: 143, y: 33, group: 'result', result: true,
    get: output,
    set: () => {},
    onTake: () => {
      if (!state.input) return;
      state.input.count--;
      if (state.input.count <= 0) {
        state.input = null;
        state.selected = -1;
      }
      host.playSound('stonecutter');
    },
  };
  let list: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let lastKey = '';
  return {
    state,
    texture: 'container/stonecutter.png', width: 176, height: 166,
    slots: [input, out, ...player],
    labels: [{ text: 'Stonecutter', x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = host.guiScale;
      if (!list) {
        list = h('div');
        list.style.cssText = `position:absolute;left:${RECIPES_X * s}px;top:${RECIPES_Y * s}px;width:${RECIPES_COLUMNS * RECIPE_W * s}px;height:${RECIPES_ROWS * RECIPE_H * s}px;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;`;
        list.addEventListener('mousedown', (e) => e.stopPropagation());
        scroller = h('div');
        scroller.style.cssText = `position:absolute;left:${SCROLLER_X * s}px;top:${SCROLLER_Y * s}px;width:${SCROLLER_W * s}px;height:${SCROLLER_H * s}px;pointer-events:none;background:${sprite('stonecutter/scroller_disabled.png')} 0 0 / 100% 100% no-repeat;`;
        list.addEventListener('scroll', () => {
          const range = list!.scrollHeight - list!.clientHeight;
          const t = range > 0 ? list!.scrollTop / range : 0;
          scroller!.style.top = `${(SCROLLER_Y + t * (SCROLLER_TRACK - SCROLLER_H)) * s}px`;
        });
        root.append(list, scroller);
      }
      const recipes = stonecuttingRecipesFor(state.input);
      const key = `${state.input?.id ?? ''}:${state.selected}:${recipes.length}`;
      if (key === lastKey) return;
      lastKey = key;
      list.replaceChildren();
      const rows = Math.ceil(recipes.length / RECIPES_COLUMNS);
      const inner = h('div');
      inner.style.cssText = `position:relative;width:100%;height:${Math.max(RECIPES_ROWS, rows) * RECIPE_H * s}px;`;
      recipes.forEach((r, i) => {
        const cell = h('div', { class: 'stonecutter-recipe' });
        const sel = i === state.selected;
        const bg = (name: string) => `${sprite(`stonecutter/${name}.png`)} 0 0 / 100% 100% no-repeat`;
        cell.style.cssText = `position:absolute;left:${(i % RECIPES_COLUMNS) * RECIPE_W * s}px;top:${Math.floor(i / RECIPES_COLUMNS) * RECIPE_H * s}px;width:${RECIPE_W * s}px;height:${RECIPE_H * s}px;cursor:pointer;background:${bg(sel ? 'recipe_selected' : 'recipe')};`;
        const img = h('img', { src: host.icons.icon(r.result.item), draggable: false }) as HTMLImageElement;
        img.style.cssText = `position:absolute;left:0;top:${s}px;width:${RECIPE_W * s}px;height:${RECIPE_W * s}px;image-rendering:pixelated;pointer-events:none;`;
        cell.append(img);
        if (!sel) {
          cell.addEventListener('mouseenter', () => { cell.style.background = bg('recipe_highlighted'); });
          cell.addEventListener('mouseleave', () => { cell.style.background = bg('recipe'); });
        }
        cell.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (state.selected === i) return;
          state.selected = i;
          host.playSound('stonecutter_select');
          host.refresh();
        });
        inner.append(cell);
      });
      list.append(inner);
      const scrollable = rows > RECIPES_ROWS;
      scroller!.style.backgroundImage = sprite(scrollable ? 'stonecutter/scroller.png' : 'stonecutter/scroller_disabled.png');
      if (!scrollable) {
        list.scrollTop = 0;
        scroller!.style.top = `${SCROLLER_Y * s}px`;
      }
    },
    quickMove(from, stack) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      if (stonecuttingRecipesFor(stack).length) return [input];
      return from.group === 'hotbar' ? byGroup(player, 'inventory') : byGroup(player, 'hotbar');
    },
  } as ScreenDef & { state: typeof state };
}

/** Result of a smithing recipe for the three inputs, or null. */
export function smithingResult(template: Slot, base: Slot, addition: Slot): ItemStack | null {
  if (!template || !base || !addition) return null;
  for (const r of smithingRecipes) {
    if (!ingredientMatches(r.template, template) || !ingredientMatches(r.base, base) || !ingredientMatches(r.addition, addition)) continue;
    if (r.type === 'transform' && r.result) {
      const out = cloneStack(base, 1);
      out.id = r.result.item;
      return out;
    }
    if (r.type === 'trim' && r.pattern) {
      const material = trimMaterialForItem(addition.id);
      if (!material) return null;
      // Vanilla refuses to re-apply the exact same trim.
      if (base.trim && base.trim.pattern === r.pattern && base.trim.material === material.id) return null;
      const out = cloneStack(base, 1);
      out.trim = { pattern: r.pattern, material: material.id };
      return out;
    }
  }
  return null;
}

export function smithingScreen(host: WorkstationHost): ScreenDef {
  const inv = host.inventory;
  const state: { template: Slot; base: Slot; addition: Slot } = { template: null, base: null, addition: null };
  const player = playerSlots(inv);
  const template: SlotDef = { x: 8, y: 48, group: 'container', get: () => state.template, set: (s) => { state.template = s; }, icon: 'sprites/container/slot/smithing_template_armor_trim.png' };
  const base: SlotDef = { x: 26, y: 48, group: 'container', get: () => state.base, set: (s) => { state.base = s; } };
  const addition: SlotDef = { x: 44, y: 48, group: 'container', get: () => state.addition, set: (s) => { state.addition = s; }, icon: 'sprites/container/slot/ingot.png' };
  const output: SlotDef = {
    x: 98, y: 48, group: 'result', result: true,
    get: () => smithingResult(state.template, state.base, state.addition),
    set: () => {},
    onTake: () => {
      for (const k of ['template', 'base', 'addition'] as const) {
        const s = state[k];
        if (!s) continue;
        s.count--;
        if (s.count <= 0) state[k] = null;
      }
      host.playSound('smithing');
    },
  };
  let error: HTMLElement | null = null;
  return {
    state,
    texture: 'container/smithing.png', width: 176, height: 166,
    slots: [template, base, addition, output, ...player],
    labels: [{ text: 'Upgrade Gear', x: 44, y: 15 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = host.guiScale;
      if (!error) {
        error = h('div');
        error.style.cssText = `position:absolute;left:${65 * s}px;top:${46 * s}px;width:${28 * s}px;height:${21 * s}px;pointer-events:none;background:${sprite('smithing/error.png')} 0 0 / 100% 100% no-repeat;`;
        root.append(error);
      }
      // Vanilla shows the error sprite when there is a base item with a template or addition but no result.
      const show = !!state.base && (!!state.template || !!state.addition) && !output.get();
      error.hidden = !show;
    },
    quickMove(from, stack) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      const def = items.byId.get(stack.id);
      if (def?.behavior === 'smithing_template' && !state.template) return [template];
      if ((def?.armor || def?.attack || def?.durability) && !state.base) return [base];
      if (!state.addition) return [addition];
      return from.group === 'hotbar' ? byGroup(player, 'inventory') : byGroup(player, 'hotbar');
    },
  } as ScreenDef & { state: typeof state };
}
