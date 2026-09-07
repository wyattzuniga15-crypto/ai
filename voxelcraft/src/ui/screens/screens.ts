/** Concrete screens: player inventory (2x2 crafting), crafting table, furnaces, chests and friends. */
import type { ScreenDef, SlotDef, SlotGroup } from './container.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { craftingMatcher, consumeIngredients } from '../../items/crafting.ts';
import { findCookingRecipe, isFuel } from '../../items/smelting.ts';
import { items } from '../../items/registry.ts';
import type { FurnaceEntity } from '../../blocks/blockEntity.ts';

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
