/**
 * The creative inventory: vanilla's tabbed item list, with the scroll bar down its side and the
 * search tab. Every slot in the grid is a bottomless source — taking from one leaves it there — and
 * anything dropped back onto the list is thrown away, which is how vanilla's own list behaves.
 */
import { h } from '../dom.ts';
import { items } from '../../items/registry.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import type { ItemIcons } from '../icons.ts';
import { CREATIVE_TABS, searchItems, tabItems } from '../../items/creativeTabs.ts';
import type { ScreenDef, SlotDef } from './container.ts';

const T = (p: string) => `url('${import.meta.env.BASE_URL}textures/gui/${p}')`;
const SPRITE = 'sprites/container/creative_inventory/';

/** Vanilla's window: a five-row grid of nine, the hotbar under it, and the bar down the right. */
const COLS = 9;
const ROWS = 5;
const GRID_X = 9;
const GRID_Y = 18;
const SCROLL_X = 175;
const SCROLL_Y = 18;
const SCROLL_H = 112;
const KNOB_H = 15;

/** The tabs, with the search tab first the way vanilla puts it at the top left. */
const TABS = [{ id: 'search', title: 'Search Items', icon: 'compass' }, ...CREATIVE_TABS];
const TOP_ROW = 7;

export interface CreativeState {
  tab: string;
  scroll: number;
  query: string;
}

/** The list a tab is showing, which the search tab reads off whatever has been typed. */
export function listFor(state: CreativeState): ItemStack[] {
  const defs = state.tab === 'search' ? searchItems(state.query) : tabItems(state.tab);
  return defs.map((d) => ({ id: d.id, count: items.maxStack(d.id) }));
}

/** How many rows of items a list scrolls through. */
export const scrollRows = (count: number): number => Math.max(0, Math.ceil(count / COLS) - ROWS);

export interface CreativeHost {
  icons: ItemIcons;
  guiScale: number;
  /** Opens the survival inventory, which vanilla keeps as one of the tabs. */
  openInventory(): void;
  refresh(): void;
}

export function creativeScreen(inv: Inventory, state: CreativeState, host: CreativeHost): ScreenDef {
  let list = listFor(state);
  const reload = () => {
    list = listFor(state);
    state.scroll = Math.min(state.scroll, scrollRows(list.length));
  };
  const at = (i: number): Slot => {
    const index = (state.scroll + Math.floor(i / COLS)) * COLS + (i % COLS);
    const stack = list[index];
    return stack ? { ...stack } : null;
  };
  const grid: SlotDef[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      // taking from the list leaves it where it is, and putting something back throws it away
      grid.push({ x: GRID_X + c * 18, y: GRID_Y + r * 18, group: 'container', get: () => at(i), set: () => {} });
    }
  const hotbar: SlotDef[] = [];
  for (let c = 0; c < 9; c++)
    hotbar.push({ x: GRID_X + c * 18, y: 112, group: 'hotbar', get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; inv.version++; } });

  let built: HTMLElement | null = null;
  return {
    texture: 'container/creative_inventory/tab_items.png',
    width: 195, height: 136,
    pieces: [[0, 0, 195, 136, 0, 0]],
    slots: [...grid, ...hotbar],
    labels: [],
    quickMove(from) {
      // shift-clicking the list fills the hotbar, and shift-clicking the hotbar throws it away
      return from.group === 'container' ? hotbar : [];
    },
    overlay(root) {
      const s = host.guiScale;
      if (built && built.isConnected) {
        // the knob and the title are all that change once the furniture is up
        const rows = scrollRows(list.length);
        const knob = built.querySelector('.knob') as HTMLElement;
        knob.style.top = `${(SCROLL_Y + (rows ? (state.scroll / rows) * (SCROLL_H - KNOB_H) : 0)) * s}px`;
        knob.style.background = `${T(`${SPRITE}${rows ? 'scroller' : 'scroller_disabled'}.png`)} 0 0 / 100% 100% no-repeat`;
        const searching = state.tab === 'search';
        const label = built.querySelector('.title') as HTMLElement;
        label.textContent = TABS.find((t) => t.id === state.tab)?.title ?? '';
        label.style.display = searching ? 'none' : 'block';
        (built.querySelector('.creative-search') as HTMLElement).style.display = searching ? 'block' : 'none';
        return;
      }
      const layer = h('div');
      // the layer only carries the furniture: the slots under it have to stay clickable
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      built = layer;
      root.append(layer);

      // the tabs: seven across the top, the rest along the bottom, each with an item on it
      TABS.forEach((tab, i) => {
        const top = i < TOP_ROW;
        const col = top ? i : i - TOP_ROW;
        const selected = state.tab === tab.id;
        const sprite = `${SPRITE}tab_${top ? 'top' : 'bottom'}_${selected ? 'selected' : 'unselected'}_${col + 1}.png`;
        const el = h('div', { class: 'creative-tab', title: tab.title });
        el.style.cssText = `position:absolute;left:${col * 28 * s}px;top:${(top ? -28 : 136 - 4) * s}px;width:${26 * s}px;height:${32 * s}px;background:${T(sprite)} 0 0 / 100% 100% no-repeat;image-rendering:pixelated;cursor:pointer;pointer-events:auto;`;
        const icon = h('div');
        icon.style.cssText = `position:absolute;left:${5 * s}px;top:${(top ? 9 : 7) * s}px;width:${16 * s}px;height:${16 * s}px;background:url('${host.icons.forStack({ id: tab.icon, count: 1 })}') center / 100% 100% no-repeat;image-rendering:pixelated;pointer-events:none;`;
        el.append(icon);
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.tab = tab.id;
          state.scroll = 0;
          built = null;
          layer.remove();
          reload();
          host.refresh();
        });
        layer.append(el);
      });
      // vanilla keeps the survival inventory as a tab of its own
      const inventoryTab = h('div', { class: 'creative-tab', title: 'Survival Inventory' });
      const col = TABS.length - TOP_ROW;
      inventoryTab.style.cssText = `position:absolute;left:${col * 28 * s}px;top:${132 * s}px;width:${26 * s}px;height:${32 * s}px;background:${T(`${SPRITE}tab_bottom_unselected_${col + 1}.png`)} 0 0 / 100% 100% no-repeat;image-rendering:pixelated;cursor:pointer;pointer-events:auto;`;
      const chest = h('div');
      chest.style.cssText = `position:absolute;left:${5 * s}px;top:${7 * s}px;width:${16 * s}px;height:${16 * s}px;background:url('${host.icons.forStack({ id: 'chest', count: 1 })}') center / 100% 100% no-repeat;image-rendering:pixelated;pointer-events:none;`;
      inventoryTab.append(chest);
      inventoryTab.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        host.openInventory();
      });
      layer.append(inventoryTab);

      const title = h('div', { class: 'title' });
      title.style.cssText = `position:absolute;left:${9 * s}px;top:${6 * s}px;font-size:${7 * s}px;color:#404040;line-height:1;white-space:nowrap;pointer-events:none;display:${state.tab === 'search' ? 'none' : 'block'};`;
      layer.append(title);

      // the search box, which vanilla shows on its own tab
      const field = h('input', { type: 'text', class: 'creative-search', value: state.query }) as HTMLInputElement;
      // vanilla's own search box sits across the window's header, where the tab's name goes otherwise
      field.style.cssText = `position:absolute;left:${8 * s}px;top:${4 * s}px;width:${160 * s}px;height:${12 * s}px;font:${7 * s}px/1 inherit;color:#fff;background:#000;border:${s}px solid #a0a0a0;padding:0 ${2 * s}px;box-sizing:border-box;pointer-events:auto;display:${state.tab === 'search' ? 'block' : 'none'};`;
      field.addEventListener('input', () => {
        state.query = field.value;
        state.scroll = 0;
        reload();
        host.refresh();
      });
      field.addEventListener('keydown', (e) => e.stopPropagation());
      layer.append(field);
      if (state.tab === 'search') setTimeout(() => field.focus(), 0);

      const track = h('div');
      track.style.cssText = `position:absolute;left:${SCROLL_X * s}px;top:${SCROLL_Y * s}px;width:${12 * s}px;height:${SCROLL_H * s}px;cursor:pointer;pointer-events:auto;`;
      const knob = h('div', { class: 'knob' });
      knob.style.cssText = `position:absolute;left:${SCROLL_X * s}px;top:${SCROLL_Y * s}px;width:${12 * s}px;height:${KNOB_H * s}px;image-rendering:pixelated;pointer-events:none;`;
      const scrollTo = (clientY: number) => {
        const rows = scrollRows(list.length);
        if (!rows) return;
        const rect = track.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (clientY - rect.top - (KNOB_H * s) / 2) / (rect.height - KNOB_H * s)));
        state.scroll = Math.round(f * rows);
        host.refresh();
      };
      track.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollTo(e.clientY);
        const move = (m: MouseEvent) => scrollTo(m.clientY);
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      layer.append(track, knob);

      root.addEventListener('wheel', (e) => {
        const rows = scrollRows(list.length);
        if (!rows) return;
        e.preventDefault();
        state.scroll = Math.max(0, Math.min(rows, state.scroll + Math.sign(e.deltaY)));
        host.refresh();
      }, { passive: false });
    },
  };
}
