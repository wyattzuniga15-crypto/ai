/** Enchanting table, anvil and grindstone screens. */
import type { ScreenDef, SlotDef } from './container.ts';
import { playerSlots } from './screens.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { cloneStack } from '../../items/inventory.ts';
import { anvilResult, enchantWithOption, enchantingOptions, enchantmentName, grindstoneResult, grindstoneXp } from '../../items/enchanting.ts';
import { h } from '../dom.ts';
import { Rng } from '../../core/rng.ts';

const byGroup = (slots: SlotDef[], g: string) => slots.filter((s) => s.group === g);
const reversePlayer = (slots: SlotDef[]) => [...byGroup(slots, 'hotbar').reverse(), ...byGroup(slots, 'inventory').reverse()];

export interface EnchantHost {
  inventory: Inventory;
  level(): number;
  spendLevels(n: number): void;
  creative(): boolean;
  guiScale: number;
  playSound(name: string): void;
}

const GLYPHS = 'ᔑᒲᓵᖁᒷ⎓⊣⍑╎⋮ꖌꖎᒲリ𝙹!¡ᑑ∷ᓭℸ ̣⚍⍊∴ ̇/||⨅';

function scramble(n: number, seed: number): string {
  let out = '';
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out += GLYPHS[(s >>> 8) % GLYPHS.length];
  }
  return out;
}

/** Enchanting table: item + lapis, three options; `shelves` is the bookshelf count. */
export function enchantingScreen(host: EnchantHost, shelves: number, seedRef: { seed: number }): ScreenDef {
  const inv = host.inventory;
  const state: { item: Slot; lapis: Slot } = { item: null, lapis: null };
  const player = playerSlots(inv);
  const itemSlot: SlotDef = { x: 15, y: 47, group: 'container', maxCount: 1, get: () => state.item, set: (s) => { state.item = s; } };
  const lapisSlot: SlotDef = { x: 35, y: 47, group: 'container', get: () => state.lapis, set: (s) => { state.lapis = s; }, accepts: (s) => s.id === 'lapis_lazuli' };
  let buttons: HTMLElement[] = [];
  let lastKey = '';
  const def: ScreenDef = {
    texture: 'container/enchanting_table.png', width: 176, height: 166,
    slots: [itemSlot, lapisSlot, ...player],
    labels: [{ text: 'Enchant', x: 12, y: 5 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = host.guiScale;
      const base = `${import.meta.env.BASE_URL}textures/gui/sprites/container/enchanting_table/`;
      if (!buttons.length) {
        for (let i = 0; i < 3; i++) {
          const b = h('div', { class: 'ench-option' });
          b.style.cssText = `position:absolute;left:${60 * s}px;top:${(14 + i * 19) * s}px;width:${108 * s}px;height:${19 * s}px;background:url('${base}enchantment_slot_disabled.png') 0 0 / 100% 100% no-repeat;cursor:pointer;display:flex;align-items:center;`;
          const badge = h('div');
          badge.style.cssText = `width:${16 * s}px;height:${16 * s}px;margin-left:${1 * s}px;background:url('${base}level_${i + 1}_disabled.png') 0 0 / 100% 100% no-repeat;flex:none;`;
          const text = h('div');
          text.style.cssText = `flex:1;font-size:${6 * s}px;color:#685e4a;padding-left:${2 * s}px;white-space:nowrap;overflow:hidden;font-family:serif;`;
          const cost = h('div');
          cost.style.cssText = `font-size:${7 * s}px;color:#8b8;padding-right:${2 * s}px;text-shadow:1px 1px 0 #000;`;
          b.append(badge, text, cost);
          b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            choose(i);
          });
          b.addEventListener('mouseenter', () => showTip(i, b));
          b.addEventListener('mouseleave', () => hideTip());
          root.append(b);
          buttons.push(b);
        }
      }
      const item = state.item;
      const lapis = state.lapis?.count ?? 0;
      const opts = item ? enchantingOptions(seedRef.seed, item.id, shelves) : [];
      const key = `${item?.id ?? ''}|${lapis}|${host.level()}|${seedRef.seed}`;
      if (key === lastKey) return;
      lastKey = key;
      buttons.forEach((b, i) => {
        const o = opts[i];
        const enabled = !!o && o.cost > 0 && !(item?.enchantments && Object.keys(item.enchantments).length) && (host.creative() || (lapis >= i + 1 && host.level() >= o.cost));
        const available = !!o && o.cost > 0 && !(item?.enchantments && Object.keys(item.enchantments).length);
        b.style.backgroundImage = `url('${base}${available ? (enabled ? 'enchantment_slot' : 'enchantment_slot_disabled') : 'enchantment_slot_disabled'}.png')`;
        (b.children[0] as HTMLElement).style.backgroundImage = `url('${base}level_${i + 1}${enabled ? '' : '_disabled'}.png')`;
        (b.children[1] as HTMLElement).textContent = available ? scramble(14, seedRef.seed * 7 + i) : '';
        (b.children[2] as HTMLElement).textContent = available ? String(o.cost) : '';
        (b.children[2] as HTMLElement).style.color = enabled ? '#80ff20' : '#ff5555';
      });
    },
    quickMove(from, stack) {
      if (from.group === 'container') return reversePlayer(player);
      if (stack.id === 'lapis_lazuli' && (!state.lapis || state.lapis.id === 'lapis_lazuli')) return [lapisSlot];
      if (!state.item) return [itemSlot];
      return from.group === 'hotbar' ? byGroup(player, 'inventory') : byGroup(player, 'hotbar');
    },
  };
  let tip: HTMLElement | null = null;
  const showTip = (i: number, anchor: HTMLElement) => {
    const item = state.item;
    if (!item) return;
    const o = enchantingOptions(seedRef.seed, item.id, shelves)[i];
    if (!o || o.cost <= 0) return;
    hideTip();
    tip = h('div', { id: 'tooltip' });
    const hint = o.hint ? enchantmentName(o.hint.id, o.hint.level) : '?';
    tip.append(h('div', { text: `${hint} . . . ?` }), h('div', { class: 'sub', text: `${i + 1} Lapis Lazuli` }), h('div', { class: 'sub', text: `${i + 1} Enchantment Level${i > 0 ? 's' : ''} (needs level ${o.cost})` }));
    const r = anchor.getBoundingClientRect();
    tip.style.left = `${r.right + 8}px`;
    tip.style.top = `${r.top}px`;
    document.body.append(tip);
  };
  const hideTip = () => {
    tip?.remove();
    tip = null;
  };
  const choose = (i: number) => {
    const item = state.item;
    if (!item) return;
    if (item.enchantments && Object.keys(item.enchantments).length) return;
    const o = enchantingOptions(seedRef.seed, item.id, shelves)[i];
    if (!o || o.cost <= 0) return;
    const lapis = state.lapis?.count ?? 0;
    if (!host.creative() && (lapis < i + 1 || host.level() < o.cost)) return;
    const list = enchantWithOption(seedRef.seed, item.id, shelves, i);
    if (!list.length) return;
    const result = cloneStack(item);
    if (result.id === 'book') result.id = 'enchanted_book';
    result.enchantments = {};
    for (const e of list) result.enchantments[e.id] = e.level;
    state.item = result;
    if (!host.creative()) {
      host.spendLevels(i + 1);
      state.lapis!.count -= i + 1;
      if (state.lapis!.count <= 0) state.lapis = null;
    }
    seedRef.seed = (seedRef.seed * 1664525 + 1013904223) >>> 0;
    lastKey = '';
    host.playSound('enchant');
    def.onChange?.();
    hideTip();
  };
  const cleanup = () => hideTip();
  (def as ScreenDef & { cleanup?: () => void; state: typeof state }).cleanup = cleanup;
  (def as ScreenDef & { state: typeof state }).state = state;
  return def;
}

/** Anvil: repair, combine and rename. */
export function anvilScreen(host: EnchantHost): ScreenDef {
  const inv = host.inventory;
  const state: { left: Slot; right: Slot; name: string } = { left: null, right: null, name: '' };
  const player = playerSlots(inv);
  let computed = anvilResult(null, null, undefined);
  const recompute = () => {
    computed = anvilResult(state.left, state.right, state.name || undefined, host.creative());
  };
  const left: SlotDef = { x: 27, y: 47, group: 'container', get: () => state.left, set: (s) => { state.left = s; recompute(); } };
  const right: SlotDef = { x: 76, y: 47, group: 'container', get: () => state.right, set: (s) => { state.right = s; recompute(); } };
  const output: SlotDef = {
    x: 134, y: 47, group: 'result', result: true,
    get: () => computed.result,
    set: () => {},
    canTake: () => !!computed.result && (host.creative() || host.level() >= computed.cost),
    onTake: () => {
      if (!host.creative()) host.spendLevels(computed.cost);
      state.left = null;
      if (state.right) {
        if (computed.materialCost > 0) {
          state.right.count -= computed.materialCost;
          if (state.right.count <= 0) state.right = null;
        } else state.right = null;
      }
      host.playSound('anvil');
      recompute();
    },
  };
  let input: HTMLInputElement | null = null;
  let costEl: HTMLElement | null = null;
  return {
    state,
    texture: 'container/anvil.png', width: 176, height: 166,
    slots: [left, right, output, ...player],
    labels: [{ text: 'Repair & Name', x: 60, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    overlay(root) {
      const s = host.guiScale;
      if (!input) {
        input = h('input', { type: 'text', maxlength: 50, placeholder: '' }) as HTMLInputElement;
        input.style.cssText = `position:absolute;left:${62 * s}px;top:${24 * s}px;width:${103 * s}px;height:${12 * s}px;background:url('${import.meta.env.BASE_URL}textures/gui/sprites/container/anvil/text_field.png') 0 0 / 100% 100% no-repeat;border:none;color:#fff;font-size:${6 * s}px;padding:0 ${4 * s}px;outline:none;font-family:inherit;`;
        input.addEventListener('input', () => {
          state.name = input!.value;
          recompute();
          root.dispatchEvent(new CustomEvent('refresh'));
        });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        root.append(input);
        costEl = h('div');
        costEl.style.cssText = `position:absolute;right:${8 * s}px;top:${69 * s}px;font-size:${6 * s}px;text-shadow:1px 1px 0 #000;white-space:nowrap;`;
        root.append(costEl);
      }
      if (state.left && input.value === '' && state.left.name && document.activeElement !== input) input.value = state.left.name;
      if (!state.left) {
        input.value = '';
        state.name = '';
      }
      if (costEl) {
        if (computed.tooExpensive) {
          costEl.textContent = 'Too Expensive!';
          costEl.style.color = '#ff5555';
        } else if (computed.cost > 0) {
          costEl.textContent = `Enchantment Cost: ${computed.cost}`;
          costEl.style.color = host.creative() || host.level() >= computed.cost ? '#80ff20' : '#ff5555';
        } else costEl.textContent = '';
      }
    },
    quickMove(from) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      if (!state.left) return [left];
      if (!state.right) return [right];
      return from.group === 'hotbar' ? byGroup(player, 'inventory') : byGroup(player, 'hotbar');
    },
  } as ScreenDef & { state: typeof state };
}

/** Grindstone: disenchant and repair. */
export function grindstoneScreen(host: EnchantHost, rng: Rng): ScreenDef {
  const inv = host.inventory;
  const state: { top: Slot; bottom: Slot } = { top: null, bottom: null };
  const player = playerSlots(inv);
  let computed = grindstoneResult(null, null);
  const recompute = () => {
    computed = grindstoneResult(state.top, state.bottom);
  };
  const top: SlotDef = { x: 49, y: 19, group: 'container', get: () => state.top, set: (s) => { state.top = s; recompute(); } };
  const bottom: SlotDef = { x: 49, y: 40, group: 'container', get: () => state.bottom, set: (s) => { state.bottom = s; recompute(); } };
  const output: SlotDef = {
    x: 129, y: 34, group: 'result', result: true,
    get: () => computed.result,
    set: () => {},
    onTake: () => {
      const xp = grindstoneXp(rng, computed.xp);
      state.top = null;
      state.bottom = null;
      recompute();
      host.playSound('anvil');
      (host as EnchantHost & { giveXp?: (n: number) => void }).giveXp?.(xp);
    },
  };
  return {
    state,
    texture: 'container/grindstone.png', width: 176, height: 166,
    slots: [top, bottom, output, ...player],
    labels: [{ text: 'Repair & Disenchant', x: 8, y: 6 }, { text: 'Inventory', x: 8, y: 72 }],
    quickMove(from) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      if (!state.top) return [top];
      if (!state.bottom) return [bottom];
      return from.group === 'hotbar' ? byGroup(player, 'inventory') : byGroup(player, 'hotbar');
    },
  } as ScreenDef & { state: typeof state };
}

export function stateOf(def: ScreenDef): { item?: Slot; lapis?: Slot; left?: Slot; right?: Slot; top?: Slot; bottom?: Slot } | undefined {
  return (def as ScreenDef & { state?: Record<string, Slot> }).state;
}

export type { ItemStack };
