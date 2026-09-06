/** Recipe book panel: lists recipes that fit the open crafting grid and fills the grid on click. */
import { h } from '../dom.ts';
import type { ItemIcons } from '../icons.ts';
import type { Inventory, ItemStack, Slot } from '../../items/inventory.ts';
import { cloneStack } from '../../items/inventory.ts';
import { craftingRecipes, type CraftingRecipe, type Ingredient } from '../../items/crafting.ts';
import { items } from '../../items/registry.ts';
import type { CraftingGrid } from './screens.ts';

export interface RecipeBookHost {
  icons: ItemIcons;
  inventory: Inventory;
  grid: CraftingGrid;
  guiScale: number;
  /** Redraw the container screen after the grid changed. */
  refresh(): void;
}

const ids = (i: Ingredient): string[] => (Array.isArray(i) ? i : [i]);

/** Item ids needed by a recipe, expanded per grid cell (row-major for shaped). */
function requirements(r: CraftingRecipe, width: number): (Ingredient | null)[] {
  if (r.type === 'shaped') {
    const rows = r.pattern ?? [];
    const cells: (Ingredient | null)[] = new Array(width * width).fill(null);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ' ' && r.key?.[ch]) cells[y * width + x] = r.key[ch];
    }));
    return cells;
  }
  if (r.type === 'shapeless') return (r.ingredients ?? []).slice();
  return [r.input!, r.material!];
}

function fits(r: CraftingRecipe, width: number): boolean {
  if (r.type === 'shaped') {
    const rows = r.pattern ?? [];
    return rows.length <= width && Math.max(...rows.map((x) => x.length)) <= width;
  }
  if (r.type === 'shapeless') return (r.ingredients ?? []).length <= width * width;
  return width >= 2;
}

/** Picks concrete items from the inventory for each requirement; null when not craftable. */
function plan(r: CraftingRecipe, width: number, inv: Inventory, grid: CraftingGrid): (string | null)[] | null {
  const available = new Map<string, number>();
  for (const s of [...inv.slots, ...grid.cells]) if (s) available.set(s.id, (available.get(s.id) ?? 0) + s.count);
  const out: (string | null)[] = [];
  for (const req of requirements(r, width)) {
    if (!req) {
      out.push(null);
      continue;
    }
    const choice = ids(req).find((id) => (available.get(id) ?? 0) > 0);
    if (!choice) return null;
    available.set(choice, available.get(choice)! - 1);
    out.push(choice);
  }
  return out;
}

export function attachRecipeBook(gui: HTMLElement, host: RecipeBookHost, width: number): { destroy(): void; toggle(): void; open: boolean } {
  const s = host.guiScale;
  const base = `${import.meta.env.BASE_URL}textures/gui/`;
  const panel = h('div', { class: 'recipe-book' });
  panel.style.cssText = `position:absolute;right:100%;top:0;width:${147 * s}px;height:${166 * s}px;background:url('${base}recipe_book.png') 0 0 / ${256 * s}px ${256 * s}px no-repeat;image-rendering:pixelated;display:none;`;
  const search = h('input', { type: 'text', placeholder: 'Search...' }) as HTMLInputElement;
  search.style.cssText = `position:absolute;left:${25 * s}px;top:${13 * s}px;width:${80 * s}px;height:${12 * s}px;background:transparent;border:none;color:#fff;font-size:${6 * s}px;outline:none;font-family:inherit;`;
  search.addEventListener('mousedown', (e) => e.stopPropagation());
  search.addEventListener('keydown', (e) => e.stopPropagation());
  search.addEventListener('input', () => render());
  const filter = h('div');
  let craftableOnly = false;
  filter.style.cssText = `position:absolute;left:${110 * s}px;top:${12 * s}px;width:${26 * s}px;height:${16 * s}px;cursor:pointer;background:url('${base}sprites/recipe_book/filter_disabled.png') 0 0 / 100% 100% no-repeat;`;
  filter.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    craftableOnly = !craftableOnly;
    filter.style.backgroundImage = `url('${base}sprites/recipe_book/filter_${craftableOnly ? 'enabled' : 'disabled'}.png')`;
    page = 0;
    render();
  });
  const gridEl = h('div');
  gridEl.style.cssText = `position:absolute;left:${11 * s}px;top:${31 * s}px;width:${125 * s}px;height:${100 * s}px;`;
  const pageLabel = h('div');
  pageLabel.style.cssText = `position:absolute;left:0;right:0;top:${137 * s}px;text-align:center;font-size:${6 * s}px;color:#404040;`;
  const prev = h('div');
  const next = h('div');
  for (const [el, left, dir] of [[prev, 38, 'backward'], [next, 94, 'forward']] as const) {
    el.style.cssText = `position:absolute;left:${left * s}px;top:${137 * s}px;width:${12 * s}px;height:${17 * s}px;cursor:pointer;background:url('${base}sprites/recipe_book/page_${dir}.png') 0 0 / 100% 100% no-repeat;`;
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      page += dir === 'forward' ? 1 : -1;
      render();
    });
  }
  panel.append(search, filter, gridEl, pageLabel, prev, next);
  gui.append(panel);
  let page = 0;
  let tooltip: HTMLElement | null = null;

  const candidates = craftingRecipes.filter((r) => r.result && items.has(r.result.item) && fits(r, width));

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const seen = new Set<string>();
    const list: { recipe: CraftingRecipe; craftable: boolean }[] = [];
    for (const r of candidates) {
      const name = items.get(r.result.item).name.toLowerCase();
      if (q && !name.includes(q) && !r.result.item.includes(q)) continue;
      const craftable = plan(r, width, host.inventory, host.grid) !== null;
      if (craftableOnly && !craftable) continue;
      const key = r.result.item;
      if (seen.has(key) && !craftable) continue;
      if (seen.has(key)) {
        // prefer a craftable variant of an already listed result
        const idx = list.findIndex((e) => e.recipe.result.item === key);
        if (idx >= 0 && !list[idx].craftable) list[idx] = { recipe: r, craftable };
        continue;
      }
      seen.add(key);
      list.push({ recipe: r, craftable });
    }
    const perPage = 20;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    page = Math.max(0, Math.min(pages - 1, page));
    pageLabel.textContent = `${page + 1}/${pages}`;
    gridEl.replaceChildren();
    list.slice(page * perPage, page * perPage + perPage).forEach((entry, i) => {
      const c = i % 5;
      const r = Math.floor(i / 5);
      const cell = h('div', { class: 'slot' });
      cell.style.cssText = `position:absolute;left:${c * 25 * s}px;top:${r * 25 * s}px;width:${25 * s}px;height:${25 * s}px;background:url('${base}sprites/recipe_book/slot_${entry.craftable ? 'craftable' : 'uncraftable'}.png') 0 0 / 100% 100% no-repeat;cursor:pointer;`;
      const img = h('img', { src: host.icons.icon(entry.recipe.result.item), draggable: false }) as HTMLImageElement;
      img.style.cssText = `position:absolute;left:${4.5 * s}px;top:${4.5 * s}px;width:${16 * s}px;height:${16 * s}px;image-rendering:pixelated;${entry.craftable ? '' : 'opacity:0.5;'}`;
      cell.append(img);
      if (entry.recipe.result.count > 1) cell.append(h('span', { class: 'count', text: String(entry.recipe.result.count) }));
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        fill(entry.recipe);
      });
      cell.addEventListener('mouseenter', (e) => {
        tooltip?.remove();
        tooltip = h('div', { id: 'tooltip' }, h('div', { text: items.get(entry.recipe.result.item).name }));
        tooltip.style.left = `${(e as MouseEvent).clientX + 12}px`;
        tooltip.style.top = `${(e as MouseEvent).clientY - 12}px`;
        document.body.append(tooltip);
      });
      cell.addEventListener('mouseleave', () => {
        tooltip?.remove();
        tooltip = null;
      });
      gridEl.append(cell);
    });
  };

  /** Moves ingredients from the inventory into the grid for the recipe (as far as available). */
  const fill = (r: CraftingRecipe) => {
    const inv = host.inventory;
    const grid = host.grid;
    // return current grid contents first
    for (let i = 0; i < grid.cells.length; i++) {
      const c = grid.cells[i];
      if (!c) continue;
      const left = inv.add(c);
      grid.cells[i] = left > 0 ? cloneStack(c, left) : null;
    }
    const p = plan(r, width, inv, grid);
    const reqs = requirements(r, width);
    const take = (id: string): ItemStack | null => {
      for (let i = 0; i < 36; i++) {
        const s2 = inv.slots[i];
        if (s2 && s2.id === id) {
          const one = cloneStack(s2, 1);
          s2.count--;
          if (s2.count <= 0) inv.slots[i] = null;
          return one;
        }
      }
      return null;
    };
    reqs.forEach((req, i) => {
      if (!req) return;
      const id = p ? p[i] : ids(req).find((x) => inv.count(x) > 0);
      if (!id) return;
      const one = take(id);
      if (!one) return;
      const cell: Slot = grid.cells[i];
      if (cell && cell.id === one.id) cell.count++;
      else grid.cells[i] = one;
    });
    inv.version++;
    grid.update();
    host.refresh();
    render();
  };

  const api = {
    open: false,
    toggle() {
      api.open = !api.open;
      panel.style.display = api.open ? 'block' : 'none';
      if (api.open) render();
    },
    destroy() {
      tooltip?.remove();
      panel.remove();
    },
  };
  return api;
}

/** The book toggle button drawn inside a crafting GUI. */
export function recipeBookButton(gui: HTMLElement, x: number, y: number, guiScale: number, onClick: () => void): HTMLElement {
  const s = guiScale;
  const b = h('div', { class: 'recipe-button' });
  b.style.cssText = `position:absolute;left:${x * s}px;top:${y * s}px;width:${20 * s}px;height:${18 * s}px;cursor:pointer;background:url('${import.meta.env.BASE_URL}textures/gui/sprites/recipe_book/button.png') 0 0 / 100% 100% no-repeat;`;
  b.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  gui.append(b);
  return b;
}
