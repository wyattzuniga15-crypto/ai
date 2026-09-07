/** Concrete screens: player inventory (2x2 crafting), crafting table, furnaces, chests and friends. */
import type { ScreenDef, SlotDef, SlotGroup } from './container.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { craftingMatcher, consumeIngredients } from '../../items/crafting.ts';
import { findCookingRecipe, isFuel } from '../../items/smelting.ts';
import { items } from '../../items/registry.ts';
import type { BeaconEntity, BrewingEntity, CrafterEntity, FurnaceEntity } from '../../blocks/blockEntity.ts';
import { crafterResult, toggleSlot } from '../../blocks/crafter.ts';
import { LOOM_PATTERNS, PATTERN_ITEMS, dyeColor, isBanner, loomResult, type BannerLayer } from '../../items/banners.ts';
import { BEACON_EFFECTS, BEACON_PAYMENT, BEACON_SECONDARY } from '../../blocks/beacon.ts';
import { BREW_TICKS, FUEL_BREWS } from '../../blocks/brewing.ts';
import { isBrewingIngredient } from '../../items/potions.ts';

const ARMOR_SLOT_INDEX: Record<string, number> = { boots: 0, leggings: 1, chestplate: 2, helmet: 3 };
const ARMOR_ICONS = ['sprites/container/slot/boots.png', 'sprites/container/slot/leggings.png', 'sprites/container/slot/chestplate.png', 'sprites/container/slot/helmet.png'];

function invSlot(inv: Inventory, index: number, x: number, y: number): SlotDef & { index: number } {
  return { x, y, index, group: index < 9 ? 'hotbar' : 'inventory', get: () => inv.slots[index], set: (s) => inv.set(index, s) };
}

/** 27 main + 9 hotbar slots at the standard positions. */
export function playerSlots(inv: Inventory, x = 8, yMain = 84, yHotbar = 142): (SlotDef & { index: number })[] {
  const out: (SlotDef & { index: number })[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) out.push(invSlot(inv, 9 + r * 9 + c, x + c * 18, yMain + r * 18));
  for (let c = 0; c < 9; c++) out.push(invSlot(inv, c, x + c * 18, yHotbar));
  return out;
}

const byGroup = (slots: SlotDef[], g: SlotGroup) => slots.filter((s) => s.group === g);
/** Vanilla "reverse" fill: hotbar right-to-left first, then main inventory bottom-right up. */
const reversePlayer = (slots: SlotDef[]) => [...byGroup(slots, 'hotbar').reverse(), ...byGroup(slots, 'inventory').reverse()];
const forwardPlayer = (slots: SlotDef[]) => [...byGroup(slots, 'inventory'), ...byGroup(slots, 'hotbar')];

export interface CraftingGrid {
  cells: Slot[];
  width: number;
  height: number;
  result: Slot;
  update(): void;
}

export function makeGrid(width: number, height: number): CraftingGrid {
  const grid: CraftingGrid = {
    cells: new Array(width * height).fill(null),
    width,
    height,
    result: null,
    update() {
      const m = craftingMatcher.match(grid.cells, width, height);
      grid.result = m ? m.result : null;
    },
  };
  return grid;
}

function craftSlots(grid: CraftingGrid, x0: number, y0: number, rx: number, ry: number): SlotDef[] {
  const slots: SlotDef[] = [];
  for (let r = 0; r < grid.height; r++)
    for (let c = 0; c < grid.width; c++) {
      const i = r * grid.width + c;
      slots.push({ x: x0 + c * 18, y: y0 + r * 18, group: 'craft', get: () => grid.cells[i], set: (s) => { grid.cells[i] = s; grid.update(); } });
    }
  slots.push({
    x: rx, y: ry, group: 'result', result: true,
    get: () => grid.result,
    set: () => {},
    onTake: () => {
      grid.cells = consumeIngredients(grid.cells);
      grid.update();
    },
  });
  return slots;
}

function armorAccepts(slotIndex: number) {
  return (s: ItemStack) => {
    const def = items.byId.get(s.id);
    if (def?.armor) return ARMOR_SLOT_INDEX[def.armor.slot] === slotIndex;
    if (slotIndex === 3 && (s.id === 'carved_pumpkin' || s.id.endsWith('_head') || s.id.endsWith('_skull'))) return true;
    return false;
  };
}

export function inventoryScreen(inv: Inventory, grid: CraftingGrid): ScreenDef {
  const armor: SlotDef[] = [3, 2, 1, 0].map((ai, row) => ({
    x: 8, y: 8 + row * 18, group: 'armor', icon: ARMOR_ICONS[ai], maxCount: 1,
    get: () => inv.armor[ai], set: (s) => { inv.armor[ai] = s; inv.version++; }, accepts: armorAccepts(ai),
  }));
  const offhand: SlotDef = { x: 77, y: 62, group: 'offhand', icon: 'sprites/container/slot/shield.png', get: () => inv.offhand, set: (s) => { inv.offhand = s; inv.version++; } };
  const player = playerSlots(inv);
  const slots = [...armor, offhand, ...craftSlots(grid, 98, 18, 154, 28), ...player];
  return {
    texture: 'container/inventory.png', width: 176, height: 166, slots,
    labels: [{ text: 'Crafting', x: 97, y: 8 }],
    quickMove(from, stack) {
      if (from.group === 'result') return reversePlayer(player);
      if (from.group === 'craft' || from.group === 'armor' || from.group === 'offhand') return forwardPlayer(player);
      const def = items.byId.get(stack.id);
      if (def?.armor) {
        const target = armor.find((a) => a.accepts!(stack));
        if (target && !target.get()) return [target];
      }
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

export function craftingTableScreen(inv: Inventory, grid: CraftingGrid): ScreenDef {
  const player = playerSlots(inv);
  const slots = [...craftSlots(grid, 30, 17, 124, 35), ...player];
  return {
    texture: 'container/crafting_table.png', width: 176, height: 166, slots,
    labels: [{ text: 'Crafting', x: 28, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    quickMove(from) {
      if (from.group === 'result') return reversePlayer(player);
      if (from.group === 'craft') return forwardPlayer(player);
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

export function furnaceScreen(inv: Inventory, e: FurnaceEntity, onXp: (n: number) => void): ScreenDef {
  const player = playerSlots(inv);
  const texture = e.type === 'furnace' ? 'container/furnace.png' : e.type === 'blast_furnace' ? 'container/blast_furnace.png' : 'container/smoker.png';
  const title = e.type === 'furnace' ? 'Furnace' : e.type === 'blast_furnace' ? 'Blast Furnace' : 'Smoker';
  const input: SlotDef = { x: 56, y: 17, group: 'container', get: () => e.items[0], set: (s) => { e.items[0] = s; } };
  const fuel: SlotDef = { x: 56, y: 53, group: 'container', get: () => e.items[1], set: (s) => { e.items[1] = s; }, accepts: (s) => isFuel(s) || s.id === 'bucket' };
  const output: SlotDef = {
    x: 116, y: 35, group: 'result', result: true, get: () => e.items[2], set: () => {},
    onTake: (taken) => {
      e.items[2] = null;
      const whole = Math.floor(e.xp);
      if (whole > 0) onXp(whole);
      e.xp -= whole;
      void taken;
    },
  };
  const slots = [input, fuel, output, ...player];
  let flame: HTMLElement | null = null;
  let arrow: HTMLElement | null = null;
  return {
    texture, width: 176, height: 166, slots,
    labels: [{ text: title, x: 60, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/furnace/`;
      if (!flame) {
        flame = document.createElement('div');
        flame.style.cssText = `position:absolute;left:${57 * s}px;top:${37 * s}px;width:${14 * s}px;height:${14 * s}px;background:url('${base}lit_progress.png') bottom / 100% ${14 * s}px no-repeat;pointer-events:none;`;
        root.append(flame);
        arrow = document.createElement('div');
        arrow.style.cssText = `position:absolute;left:${79 * s}px;top:${34 * s}px;width:0;height:${17 * s}px;background:url('${base}burn_progress.png') left / ${24 * s}px ${17 * s}px no-repeat;pointer-events:none;`;
        root.append(arrow);
      }
      const burn = e.burnTotal > 0 ? e.burnTime / e.burnTotal : 0;
      const fh = Math.round(burn * 13 * s);
      flame.style.height = `${fh}px`;
      flame.style.top = `${37 * s + (13 * s - fh)}px`;
      flame.style.backgroundPosition = 'bottom';
      const cook = e.cookTotal > 0 ? e.cookTime / e.cookTotal : 0;
      arrow!.style.width = `${Math.round(cook * 24 * s)}px`;
    },
    quickMove(from, stack) {
      if (from.group === 'result' || from.group === 'container') return reversePlayer(player);
      if (findCookingRecipe(e.type, stack)) return [input];
      if (isFuel(stack)) return [fuel];
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

/** Generic chest-style screen for `rows` rows of nine slots. */
export function chestScreen(inv: Inventory, contents: Slot[], rows: number, title: string, onChange?: () => void, accepts?: (s: ItemStack) => boolean): ScreenDef {
  const container: SlotDef[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 9; c++) {
      const i = r * 9 + c;
      container.push({ x: 8 + c * 18, y: 18 + r * 18, group: 'container', get: () => contents[i], set: (s) => { contents[i] = s; onChange?.(); }, accepts });
    }
  const player = playerSlots(inv, 8, rows * 18 + 31, rows * 18 + 89);
  const height = rows * 18 + 114;
  return {
    texture: 'container/generic_54.png', width: 176, height,
    pieces: [[0, 0, 176, rows * 18 + 17, 0, 0], [0, 126, 176, 96, 0, rows * 18 + 17]],
    slots: [...container, ...player],
    labels: [{ text: title, x: 8, y: 6 }, { text: 'Inventory', x: 8, y: rows * 18 + 19 }],
    quickMove(from) {
      if (from.group === 'container') return reversePlayer(player);
      return container;
    },
  };
}

/** 3x3 dispenser/dropper screen. */
export function dispenserScreen(inv: Inventory, contents: Slot[], title: string, onChange?: () => void): ScreenDef {
  const container: SlotDef[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      container.push({ x: 62 + c * 18, y: 17 + r * 18, group: 'container', get: () => contents[i], set: (s) => { contents[i] = s; onChange?.(); } });
    }
  const player = playerSlots(inv);
  return {
    texture: 'container/dispenser.png', width: 176, height: 166, slots: [...container, ...player],
    labels: [{ text: title, x: 60, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    quickMove(from) {
      if (from.group === 'container') return reversePlayer(player);
      return container;
    },
  };
}

export function hopperScreen(inv: Inventory, contents: Slot[], onChange?: () => void): ScreenDef {
  const container: SlotDef[] = [];
  for (let c = 0; c < 5; c++) container.push({ x: 44 + c * 18, y: 20, group: 'container', get: () => contents[c], set: (s) => { contents[c] = s; onChange?.(); } });
  const player = playerSlots(inv, 8, 51, 109);
  return {
    texture: 'container/hopper.png', width: 176, height: 133, slots: [...container, ...player],
    labels: [{ text: 'Item Hopper', x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 39 }],
    quickMove(from) {
      if (from.group === 'container') return reversePlayer(player);
      return container;
    },
  };
}

/**
 * Vanilla horse screen: a saddle slot, an armour slot for horses and, for a chested donkey or mule,
 * three rows of five chest slots beside the (unrendered) mob preview panel.
 */
export function horseScreen(inv: Inventory, title: string, equip: Slot[], chest: Slot[] | null, armored: boolean, onChange?: () => void): ScreenDef {
  const container: SlotDef[] = [
    { x: 7, y: 35, group: 'container', icon: 'sprites/container/slot/saddle.png', maxCount: 1, get: () => equip[0], set: (s) => { equip[0] = s; onChange?.(); }, accepts: (s) => s.id === 'saddle' },
  ];
  if (armored) container.push({ x: 7, y: 53, group: 'container', icon: 'sprites/container/slot/horse_armor.png', maxCount: 1, get: () => equip[1], set: (s) => { equip[1] = s; onChange?.(); }, accepts: (s) => s.id.endsWith('_horse_armor') });
  if (chest) {
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 5; c++) {
        const i = r * 5 + c;
        container.push({ x: 80 + c * 18, y: 18 + r * 18, group: 'container', get: () => chest[i], set: (s) => { chest[i] = s; onChange?.(); } });
      }
  }
  const player = playerSlots(inv);
  return {
    texture: 'container/horse.png', width: 176, height: 166,
    // vanilla blits the equipment and chest slot frames over the window at runtime
    sprites: [
      { texture: 'sprites/container/slot.png', x: 6, y: 34, w: 18, h: 18 },
      ...(armored ? [{ texture: 'sprites/container/slot.png', x: 6, y: 52, w: 18, h: 18 }] : []),
      ...(chest ? [{ texture: 'sprites/container/horse/chest_slots.png', x: 79, y: 17, w: 90, h: 54 }] : []),
    ],
    slots: [...container, ...player],
    labels: [{ text: title, x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    quickMove(from, stack) {
      if (from.group === 'container') return reversePlayer(player);
      if (stack.id === 'saddle' || stack.id.endsWith('_horse_armor')) return container;
      return chest ? container.filter((c) => c.group === 'container' && c.x >= 80) : reversePlayer(player);
    },
  };
}

/**
 * The brewing stand: three bottles in a row at the bottom, the ingredient over them and the blaze
 * powder at the side, with vanilla's bubbles and the arrow that fills as the brew runs.
 */
export function brewingScreen(inv: Inventory, e: BrewingEntity, onChange?: () => void): ScreenDef {
  const player = playerSlots(inv);
  const bottle = (i: number, x: number, y: number): SlotDef => ({
    x, y, group: 'container', maxCount: 1,
    get: () => e.items[i],
    set: (s) => { e.items[i] = s; onChange?.(); },
    accepts: (s) => s.id === 'potion' || s.id === 'splash_potion' || s.id === 'lingering_potion' || s.id === 'glass_bottle',
  });
  const bottles = [bottle(0, 56, 51), bottle(1, 79, 58), bottle(2, 102, 51)];
  const ingredient: SlotDef = {
    x: 79, y: 17, group: 'container',
    get: () => e.items[3],
    set: (s) => { e.items[3] = s; onChange?.(); },
    accepts: (s) => isBrewingIngredient(s.id),
  };
  const fuel: SlotDef = {
    x: 17, y: 17, group: 'container',
    get: () => e.items[4],
    set: (s) => { e.items[4] = s; onChange?.(); },
    accepts: (s) => s.id === 'blaze_powder',
  };
  let bubbles: HTMLElement | null = null;
  let arrow: HTMLElement | null = null;
  let flame: HTMLElement | null = null;
  return {
    texture: 'container/brewing_stand.png', width: 176, height: 166,
    slots: [...bottles, ingredient, fuel, ...player],
    labels: [{ text: 'Brewing Stand', x: 44, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/brewing_stand/`;
      if (!bubbles) {
        flame = document.createElement('div');
        flame.style.cssText = `position:absolute;left:${60 * s}px;top:${44 * s}px;width:0;height:${4 * s}px;background:url('${base}fuel_length.png') left / ${18 * s}px ${4 * s}px no-repeat;pointer-events:none;`;
        root.append(flame);
        arrow = document.createElement('div');
        arrow.style.cssText = `position:absolute;left:${97 * s}px;top:${16 * s}px;width:${9 * s}px;height:0;background:url('${base}brew_progress.png') top / ${9 * s}px ${28 * s}px no-repeat;pointer-events:none;`;
        root.append(arrow);
        bubbles = document.createElement('div');
        bubbles.style.cssText = `position:absolute;left:${63 * s}px;top:${14 * s}px;width:${12 * s}px;height:0;background:url('${base}bubbles.png') bottom / ${12 * s}px ${29 * s}px no-repeat;pointer-events:none;`;
        root.append(bubbles);
      }
      flame!.style.width = `${Math.round((e.fuel / FUEL_BREWS) * 18 * s)}px`;
      const done = e.brewTime > 0 ? (BREW_TICKS - e.brewTime) / BREW_TICKS : 0;
      arrow!.style.height = `${Math.round(done * 28 * s)}px`;
      const bh = e.brewTime > 0 ? Math.round((0.5 + 0.5 * Math.sin(e.brewTime * 0.2)) * 29 * s) : 0;
      bubbles!.style.height = `${bh}px`;
      bubbles!.style.top = `${14 * s + (29 * s - bh)}px`;
    },
    quickMove(from, stack) {
      if (from.group === 'container') return reversePlayer(player);
      if (stack.id === 'blaze_powder') return [fuel];
      if (stack.id.endsWith('potion') || stack.id === 'glass_bottle') return bottles;
      if (isBrewingIngredient(stack.id)) return [ingredient];
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

/**
 * The crafter: three by three of slots that can each be switched off, with the result it would make
 * shown at the side. Clicking an empty slot with nothing in hand turns it off, as vanilla does.
 */
export function crafterScreen(inv: Inventory, e: CrafterEntity, onChange?: () => void): ScreenDef {
  const player = playerSlots(inv);
  const grid: SlotDef[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      grid.push({
        x: 30 + c * 18, y: 17 + r * 18, group: 'container',
        get: () => (e.disabled[i] ? null : e.items[i]),
        set: (s) => { e.items[i] = s; if (s) e.disabled[i] = false; onChange?.(); },
        onClickEmpty: () => { toggleSlot(e, i); onChange?.(); },
      });
    }
  const result: SlotDef = { x: 124, y: 35, group: 'result', result: true, get: () => crafterResult(e), set: () => {} };
  return {
    texture: 'container/crafter.png', width: 176, height: 166, slots: [...grid, result, ...player],
    labels: [{ text: 'Crafter', x: 29, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/crafter/`;
      let marks = root.querySelector('.crafter-marks') as HTMLElement | null;
      if (!marks) {
        marks = document.createElement('div');
        marks.className = 'crafter-marks';
        marks.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
        root.append(marks);
      }
      marks.replaceChildren();
      for (let i = 0; i < 9; i++) {
        if (!e.disabled[i]) continue;
        const cell = document.createElement('div');
        const x = 30 + (i % 3) * 18;
        const y = 17 + Math.floor(i / 3) * 18;
        cell.style.cssText = `position:absolute;left:${x * s}px;top:${y * s}px;width:${16 * s}px;height:${16 * s}px;background:url('${base}disabled_slot.png') center / 100% 100% no-repeat;`;
        marks.append(cell);
      }
    },
    quickMove(from) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      return grid;
    },
  };
}

/**
 * The loom: a banner, a dye and (for the eight patterns that need one) a pattern item, with the
 * list of patterns vanilla offers and the woven banner in the result slot.
 */
export function loomScreen(inv: Inventory, host: { icons: { bannerIcon(color: string, layers: BannerLayer[]): string } }, state: { banner: Slot; dye: Slot; pattern: Slot; selected: string | null; scroll: number }, onChange?: () => void): ScreenDef {
  const player = playerSlots(inv);
  const banner: SlotDef = { x: 13, y: 26, group: 'container', get: () => state.banner, set: (s) => { state.banner = s; onChange?.(); }, accepts: (s) => isBanner(s.id) };
  const dye: SlotDef = { x: 33, y: 26, group: 'container', get: () => state.dye, set: (s) => { state.dye = s; onChange?.(); }, accepts: (s) => !!dyeColor(s.id) };
  const pattern: SlotDef = { x: 23, y: 45, group: 'container', get: () => state.pattern, set: (s) => { state.pattern = s; onChange?.(); }, accepts: (s) => s.id in PATTERN_ITEMS };
  const result: SlotDef = {
    x: 143, y: 58, group: 'result', result: true,
    get: () => loomResult(state.banner, state.dye, state.pattern, state.selected),
    set: () => {},
    onTake: () => {
      // weaving uses up the dye and the banner, and the pattern item stays
      if (state.banner && --state.banner.count <= 0) state.banner = null;
      if (state.dye && --state.dye.count <= 0) state.dye = null;
      state.selected = null;
      onChange?.();
    },
  };
  /** Which patterns the loom can offer right now. */
  const offered = (): string[] => {
    if (state.pattern) return [PATTERN_ITEMS[state.pattern.id]].filter(Boolean);
    return LOOM_PATTERNS;
  };
  return {
    texture: 'container/loom.png', width: 176, height: 166, slots: [banner, dye, pattern, result, ...player],
    labels: [{ text: 'Loom', x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/loom/`;
      let list = root.querySelector('.loom-list') as HTMLElement | null;
      if (!list) {
        list = document.createElement('div');
        list.className = 'loom-list';
        list.style.cssText = `position:absolute;left:${60 * s}px;top:${13 * s}px;width:${56 * s}px;height:${56 * s}px;overflow:hidden;`;
        root.append(list);
        list.addEventListener('wheel', (e) => {
          e.preventDefault();
          state.scroll = Math.max(0, state.scroll + (e.deltaY > 0 ? 1 : -1));
          onChange?.();
        });
      }
      const patterns = offered();
      const rows = Math.ceil(patterns.length / 4);
      state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, rows - 4)));
      list.replaceChildren();
      const color = state.dye ? dyeColor(state.dye.id) ?? 'white' : 'white';
      const bannerColorId = state.banner ? state.banner.id.slice(0, -7) : 'white';
      patterns.slice(state.scroll * 4, state.scroll * 4 + 16).forEach((p, i) => {
        const cell = document.createElement('div');
        const x = (i % 4) * 14 * s;
        const y = Math.floor(i / 4) * 14 * s;
        const sprite = p === state.selected ? 'pattern_selected.png' : 'pattern.png';
        cell.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${14 * s}px;height:${14 * s}px;background:url('${base}${sprite}') 0 0 / 100% 100% no-repeat;cursor:pointer;`;
        const img = document.createElement('img');
        img.src = host.icons.bannerIcon(bannerColorId, [{ pattern: p, color }]);
        img.style.cssText = `position:absolute;left:${2 * s}px;top:${2 * s}px;width:${10 * s}px;height:${10 * s}px;image-rendering:pixelated;`;
        cell.append(img);
        cell.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          state.selected = p;
          onChange?.();
        });
        list!.append(cell);
      });
    },
    quickMove(from, stack) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      if (isBanner(stack.id)) return [banner];
      if (dyeColor(stack.id)) return [dye];
      if (stack.id in PATTERN_ITEMS) return [pattern];
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

/**
 * The beacon: one payment slot and the effects the pyramid has earned, with vanilla's second column
 * for a full pyramid. Choosing an effect and paying sets the beacon going.
 */
export function beaconScreen(inv: Inventory, e: BeaconEntity, host: { icons: { icon(id: string): string } }, onSet: (primary: string | null, secondary: string | null) => void): ScreenDef {
  const player = playerSlots(inv, 36, 137, 195);
  let payment: Slot = null;
  let primary: string | null = e.primary;
  let secondary: string | null = e.secondary;
  const slot: SlotDef = {
    x: 136, y: 110, group: 'container', maxCount: 1,
    get: () => payment,
    set: (s) => { payment = s; },
    accepts: (s) => BEACON_PAYMENT.has(s.id),
  };
  return {
    texture: 'container/beacon.png', width: 230, height: 219, textureSize: [256, 256],
    slots: [slot, ...player],
    labels: [{ text: 'Beacon', x: 60, y: 6 }, { text: 'Primary', x: 60, y: 12 }, { text: 'Secondary', x: 158, y: 12 }],
    overlay(root) {
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/beacon/`;
      let panel = root.querySelector('.beacon-panel') as HTMLElement | null;
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'beacon-panel';
        panel.style.cssText = 'position:absolute;left:0;top:0;';
        root.append(panel);
      }
      panel.replaceChildren();
      const cell = (effect: string, x: number, y: number, chosen: boolean, enabled: boolean, onPick: () => void): void => {
        const el = document.createElement('div');
        const sprite = !enabled ? 'button_disabled.png' : chosen ? 'button_selected.png' : 'button.png';
        el.style.cssText = `position:absolute;left:${x * s}px;top:${y * s}px;width:${22 * s}px;height:${22 * s}px;background:url('${base}${sprite}') 0 0 / 100% 100% no-repeat;cursor:${enabled ? 'pointer' : 'default'};`;
        const icon = document.createElement('div');
        icon.style.cssText = `position:absolute;left:${2 * s}px;top:${2 * s}px;width:${18 * s}px;height:${18 * s}px;background:url('${import.meta.env.BASE_URL}textures/mob_effect/${effect}.png') 0 0 / 100% 100% no-repeat;image-rendering:pixelated;opacity:${enabled ? 1 : 0.4};`;
        el.append(icon);
        if (enabled) el.addEventListener('mousedown', (ev) => { ev.stopPropagation(); onPick(); });
        panel!.append(el);
      };
      // vanilla lays each tier out centred on x = 76, a row every 25 pixels
      BEACON_EFFECTS.slice(0, 3).forEach((list, row) => {
        const span = list.length * 22 + (list.length - 1) * 2;
        list.forEach((effect, i) => {
          cell(effect, 76 + i * 24 - span / 2, 22 + row * 25, primary === effect, e.levels > row, () => {
            primary = effect;
            root.dispatchEvent(new Event('beacon-refresh'));
          });
        });
      });
      if (e.levels >= 4) {
        cell(BEACON_SECONDARY, 167, 22, secondary === BEACON_SECONDARY, true, () => {
          secondary = BEACON_SECONDARY;
          root.dispatchEvent(new Event('beacon-refresh'));
        });
        if (primary) {
          cell(primary, 167, 47, secondary === primary, true, () => {
            secondary = primary;
            root.dispatchEvent(new Event('beacon-refresh'));
          });
        }
      }
      let confirm = root.querySelector('.beacon-confirm') as HTMLElement | null;
      if (!confirm) {
        confirm = document.createElement('div');
        confirm.className = 'beacon-confirm';
        confirm.style.cssText = `position:absolute;left:${164 * s}px;top:${107 * s}px;width:${22 * s}px;height:${22 * s}px;background:url('${base}confirm.png') 0 0 / 100% 100% no-repeat;cursor:pointer;`;
        confirm.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
          if (!payment || !primary) return;
          if (--payment.count <= 0) payment = null;
          onSet(primary, secondary);
        });
        root.append(confirm);
      }
      confirm.style.opacity = payment && primary ? '1' : '0.4';
      void host;
    },
    quickMove(from, stack) {
      if (from.group === 'container') return reversePlayer(player);
      if (BEACON_PAYMENT.has(stack.id)) return [slot];
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}

/**
 * The cartography table: a map and something to do to it. Paper zooms it out, an empty map copies
 * it, and a glass pane locks it so it stops filling in.
 */
export function cartographyScreen(inv: Inventory, state: { map: Slot; extra: Slot }, describe: (stack: ItemStack) => string, onTake: (kind: 'copy' | 'zoom' | 'lock') => ItemStack | null): ScreenDef {
  const player = playerSlots(inv);
  const mapSlot: SlotDef = { x: 15, y: 15, group: 'container', get: () => state.map, set: (s) => { state.map = s; }, accepts: (s) => s.id === 'filled_map' };
  const extra: SlotDef = { x: 15, y: 52, group: 'container', get: () => state.extra, set: (s) => { state.extra = s; }, accepts: (s) => s.id === 'paper' || s.id === 'map' || s.id === 'glass_pane' };
  /** What the two slots would make, which is what vanilla shows in the result. */
  const kind = (): 'copy' | 'zoom' | 'lock' | null => {
    if (!state.map || state.map.id !== 'filled_map' || !state.extra) return null;
    if (state.extra.id === 'paper') return 'zoom';
    if (state.extra.id === 'map') return 'copy';
    if (state.extra.id === 'glass_pane') return 'lock';
    return null;
  };
  const result: SlotDef = {
    x: 145, y: 39, group: 'result', result: true,
    get: () => {
      const k = kind();
      if (!k || !state.map) return null;
      return { ...state.map, count: 1 };
    },
    set: () => {},
    onTake: (taken) => {
      const k = kind();
      if (!k) return;
      const made = onTake(k);
      if (made) {
        taken.map = made.map;
        taken.id = made.id;
      }
      if (state.extra && --state.extra.count <= 0) state.extra = null;
      // copying leaves the original behind; zooming and locking use it up
      if (k !== 'copy' && state.map && --state.map.count <= 0) state.map = null;
    },
  };
  return {
    texture: 'container/cartography_table.png', width: 176, height: 166,
    slots: [mapSlot, extra, result, ...player],
    labels: [{ text: 'Cartography Table', x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      let label = root.querySelector('.carto-label') as HTMLElement | null;
      const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
      if (!label) {
        label = document.createElement('div');
        label.className = 'carto-label';
        label.style.cssText = `position:absolute;left:${60 * s}px;top:${20 * s}px;width:${70 * s}px;color:#404040;font-size:${6 * s}px;line-height:1.4;`;
        root.append(label);
      }
      label.textContent = state.map ? describe(state.map) : '';
    },
    quickMove(from, stack) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      if (stack.id === 'filled_map') return [mapSlot];
      if (stack.id === 'paper' || stack.id === 'map' || stack.id === 'glass_pane') return [extra];
      if (from.group === 'hotbar') return byGroup(player, 'inventory');
      return byGroup(player, 'hotbar');
    },
  };
}
