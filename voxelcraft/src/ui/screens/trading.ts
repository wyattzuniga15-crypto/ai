/**
 * Villager and wandering trader screen (vanilla MerchantScreen, 276×166): the offer list on the
 * left, two payment slots and a result slot on the right, and the villager's level and experience
 * across the top.
 */
import type { ScreenDef, SlotDef } from './container.ts';
import { playerSlots } from './screens.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { cloneStack } from '../../items/inventory.ts';
import { h } from '../dom.ts';
import type { WorkstationHost } from './workstations.ts';
import { LEVEL_MAX_XP, LEVEL_NAMES, LEVEL_XP, costOf, offerSatisfied, takeTrade, type Offer } from '../../entities/villagers.ts';

const sprite = (p: string) => `url('${import.meta.env.BASE_URL}textures/gui/sprites/container/${p}')`;
const byGroup = (slots: SlotDef[], g: string) => slots.filter((s) => s.group === g);
const reversePlayer = (slots: SlotDef[]) => [...byGroup(slots, 'hotbar').reverse(), ...byGroup(slots, 'inventory').reverse()];

// Vanilla MerchantScreen layout constants.
const LIST_X = 5;
const LIST_Y = 17;
const ROW_W = 89;
const ROW_H = 20;
const ROWS = 7;
const SCROLLER_X = 94;
const SCROLLER_Y = 18;
const SCROLLER_W = 6;
const SCROLLER_H = 27;
const SCROLLER_TRACK = 139;

export interface Merchant {
  name: string;
  offers: Offer[];
  /** Villager level 1-5; the wandering trader has none. */
  level: number;
  xp: number;
  levelled: boolean;
  /** Called after a completed trade so the game can grant experience and restock later. */
  onTrade(offer: Offer): void;
}

export interface TradingState { selected: number; slots: [Slot, Slot] }

export function tradingScreen(inv: Inventory, host: WorkstationHost, merchant: Merchant): ScreenDef & { state: TradingState } {
  const state: TradingState = { selected: 0, slots: [null, null] };
  const offer = (): Offer | null => merchant.offers[state.selected] ?? null;
  const result = (): Slot => {
    const o = offer();
    return o && offerSatisfied(o, state.slots[0], state.slots[1]) ? cloneStack(o.gives) : null;
  };
  const pay = (i: 0 | 1): SlotDef => ({
    x: 136 + i * 26, y: 37, group: 'container',
    get: () => state.slots[i],
    set: (s) => { state.slots[i] = s; },
  });
  const out: SlotDef = {
    x: 220, y: 37, group: 'result', result: true,
    get: result,
    set: () => {},
    canTake: () => !!result(),
    onTake: () => {
      const o = offer();
      if (!o) return;
      takeTrade(o, state.slots);
      merchant.onTrade(o);
      host.playSound('villager_trade');
    },
  };
  const player = playerSlots(inv, 108, 84, 142);
  let list: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let header: HTMLElement | null = null;
  let lastKey = '';

  /** Moves matching payment items from the inventory into the trade slots, like clicking a recipe. */
  const fill = (o: Offer): void => {
    const need = [{ id: o.wants[0].id, count: costOf(o) }, ...(o.wants[1] ? [{ id: o.wants[1].id, count: o.wants[1].count }] : [])];
    for (let i = 0; i < need.length; i++) {
      const want = need[i];
      const slot = state.slots[i as 0 | 1];
      if (slot && slot.id === want.id && slot.count >= want.count) continue;
      // return whatever is in the slot, then take the payment out of the inventory
      if (slot) {
        if (inv.add(slot) > 0) host.playSound('pop');
        state.slots[i as 0 | 1] = null;
      }
      let taken = 0;
      for (let s = 0; s < inv.slots.length && taken < want.count; s++) {
        const st = inv.slots[s];
        if (!st || st.id !== want.id) continue;
        const move = Math.min(st.count, want.count - taken);
        st.count -= move;
        taken += move;
        if (st.count <= 0) inv.slots[s] = null;
      }
      if (taken > 0) state.slots[i as 0 | 1] = { id: want.id, count: taken };
      inv.version++;
    }
  };

  return {
    state,
    texture: 'container/villager.png', width: 276, height: 166, textureSize: [512, 256],
    slots: [pay(0), pay(1), out, ...player],
    labels: [{ text: merchant.name, x: 5, y: 6 }, { text: 'Inventory', x: 108, y: 72 }],
    quickMove(from) {
      if (from.group === 'container' || from.group === 'result') return reversePlayer(player);
      return [pay(0), pay(1)];
    },
    overlay(root) {
      const s = host.guiScale;
      if (!list) {
        list = h('div');
        list.style.cssText = `position:absolute;left:${LIST_X * s}px;top:${LIST_Y * s}px;width:${ROW_W * s}px;height:${ROWS * ROW_H * s}px;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;`;
        list.addEventListener('mousedown', (e) => e.stopPropagation());
        scroller = h('div');
        scroller.style.cssText = `position:absolute;left:${SCROLLER_X * s}px;top:${SCROLLER_Y * s}px;width:${SCROLLER_W * s}px;height:${SCROLLER_H * s}px;pointer-events:none;background:${sprite('villager/scroller.png')} 0 0 / 100% 100% no-repeat;`;
        list.addEventListener('scroll', () => {
          const range = list!.scrollHeight - list!.clientHeight;
          const t = range > 0 ? list!.scrollTop / range : 0;
          scroller!.style.top = `${(SCROLLER_Y + t * (SCROLLER_TRACK - SCROLLER_H)) * s}px`;
        });
        header = h('div');
        header.style.cssText = `position:absolute;left:${107 * s}px;top:${4 * s}px;width:${162 * s}px;font-size:${8 * s}px;text-shadow:${s}px ${s}px 0 #000;color:#fff;pointer-events:none;text-align:center;`;
        root.append(list, scroller, header);
      }
      const o = offer();
      const key = `${state.selected}:${merchant.offers.length}:${merchant.level}:${merchant.xp}:${merchant.offers.map((x) => `${x.uses}/${costOf(x)}`).join(',')}`;
      if (key === lastKey) return;
      lastKey = key;
      void o;
      // level name and the experience bar toward the next level
      if (merchant.level > 0) {
        const name = LEVEL_NAMES[Math.min(4, merchant.level - 1)];
        const start = LEVEL_XP[Math.min(4, merchant.level - 1)];
        const end = LEVEL_MAX_XP[Math.min(4, merchant.level - 1)];
        const t = end > start ? Math.max(0, Math.min(1, (merchant.xp - start) / (end - start))) : 1;
        header!.replaceChildren();
        const label = h('div');
        label.textContent = name;
        header!.append(label);
        const bar = h('div');
        bar.style.cssText = `position:relative;margin:${2 * s}px auto 0;width:${102 * s}px;height:${5 * s}px;background:${sprite('villager/experience_bar_background.png')} 0 0 / 100% 100% no-repeat;`;
        const fillEl = h('div');
        fillEl.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${Math.round(t * 100)}%;background:${sprite('villager/experience_bar_current.png')} 0 0 / ${102 * s}px 100% no-repeat;`;
        bar.append(fillEl);
        header!.append(bar);
      }
      list!.replaceChildren();
      const inner = h('div');
      inner.style.cssText = `position:relative;width:100%;height:${Math.max(ROWS, merchant.offers.length) * ROW_H * s}px;`;
      merchant.offers.forEach((op, i) => {
        const row = h('div', { class: 'trade-row' });
        const selected = i === state.selected;
        const stock = op.uses < op.maxUses;
        row.style.cssText = `position:absolute;left:0;top:${i * ROW_H * s}px;width:${ROW_W * s}px;height:${(ROW_H - 2) * s}px;cursor:pointer;background:${selected ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)'};`;
        const icon = (id: string, count: number, x: number, faded: boolean) => {
          const wrap = h('div');
          wrap.style.cssText = `position:absolute;left:${x * s}px;top:${1 * s}px;width:${16 * s}px;height:${16 * s}px;pointer-events:none;${faded ? 'opacity:0.45;' : ''}`;
          const img = h('img', { src: host.icons.icon(id), draggable: false }) as HTMLImageElement;
          img.style.cssText = `width:100%;height:100%;image-rendering:pixelated;`;
          wrap.append(img);
          if (count > 1) {
            const n = h('div');
            n.textContent = String(count);
            n.style.cssText = `position:absolute;right:0;bottom:0;font-size:${8 * s}px;text-shadow:${s}px ${s}px 0 #000;color:#fff;`;
            wrap.append(n);
          }
          return wrap;
        };
        row.append(icon(op.wants[0].id, costOf(op), 2, !stock));
        if (op.wants[1]) row.append(icon(op.wants[1].id, op.wants[1].count, 20, !stock));
        const arrow = h('div');
        arrow.style.cssText = `position:absolute;left:${38 * s}px;top:${6 * s}px;width:${10 * s}px;height:${9 * s}px;pointer-events:none;background:${sprite(stock ? 'villager/trade_arrow.png' : 'villager/trade_arrow_out_of_stock.png')} 0 0 / 100% 100% no-repeat;`;
        row.append(arrow);
        row.append(icon(op.gives.id, op.gives.count, 52, !stock));
        row.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          state.selected = i;
          if (stock) fill(merchant.offers[i]);
          lastKey = '';
          host.refresh();
        });
        inner.append(row);
      });
      list!.append(inner);
    },
  };
}
