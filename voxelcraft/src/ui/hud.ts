/** In-game HUD: crosshair, hotbar, health/food bars, XP bar, F3 overlay, screen effects. */
import { h } from './dom.ts';
import type { Player } from '../entities/player.ts';
import type { ItemIcons } from './icons.ts';
import { items } from '../items/registry.ts';
import type { ItemStack } from '../items/inventory.ts';

const T = (p: string) => `url('${import.meta.env.BASE_URL}textures/gui/sprites/hud/${p}.png')`;

export function renderSlot(el: HTMLElement, stack: ItemStack | null, icons: ItemIcons): void {
  el.replaceChildren();
  if (!stack) return;
  const img = h('img', { src: icons.icon(stack.id), alt: stack.id, draggable: false }) as HTMLImageElement;
  el.append(img);
  const def = items.byId.get(stack.id);
  if (def?.durability && stack.damage) {
    const frac = 1 - stack.damage / def.durability;
    const bar = h('div', { class: 'durability' }, h('div'));
    (bar.firstChild as HTMLElement).style.width = `${Math.max(0, frac) * 100}%`;
    (bar.firstChild as HTMLElement).style.background = `hsl(${Math.round(frac * 120)}, 100%, 45%)`;
    el.append(bar);
  }
  if (stack.count > 1) el.append(h('span', { class: 'count', text: String(stack.count) }));
}

export class Hud {
  readonly root: HTMLElement;
  private readonly hotbarSlots: HTMLElement[] = [];
  private readonly hotbarSel: HTMLElement;
  private readonly hearts: HTMLElement[] = [];
  private readonly foods: HTMLElement[] = [];
  private readonly xpFill: HTMLElement;
  private readonly xpLevel: HTMLElement;
  private readonly heldName: HTMLElement;
  private readonly f3: HTMLElement;
  private readonly underwater: HTMLElement;
  private readonly lava: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly effects: HTMLElement;
  private lastEffectKey = '';
  private lastInventoryVersion = -1;
  private lastHeld = '';
  private heldTimer = 0;
  private toastTimer = 0;
  showDebug = false;

  constructor(container: HTMLElement, private readonly icons: ItemIcons) {
    this.hotbarSel = h('div', { id: 'hotbar-sel' });
    this.hotbar = h('div', { id: 'hotbar' }, this.hotbarSel);
    for (let i = 0; i < 9; i++) {
      const s = h('div', { class: 'slot' });
      s.style.left = `calc(${3 + i * 20}px * var(--gui))`;
      this.hotbarSlots.push(s);
      this.hotbar.append(s);
    }
    const hearts = h('div', { id: 'hearts' });
    const food = h('div', { id: 'food' });
    for (let i = 0; i < 10; i++) {
      const hb = h('div', { class: 'icon9' }, h('div'));
      hb.style.backgroundImage = T('heart/container');
      this.hearts.push(hb);
      hearts.append(hb);
      const fb = h('div', { class: 'icon9' }, h('div'));
      fb.style.backgroundImage = T('food_empty');
      this.foods.push(fb);
      food.append(fb);
    }
    this.xpFill = h('div');
    this.xpLevel = h('div', { id: 'xplevel' });
    this.heldName = h('div', { id: 'held-name', class: 'shadow' });
    this.f3 = h('div', { id: 'f3', class: 'hidden' });
    this.underwater = h('div', { id: 'underwater', class: 'hidden' });
    this.lava = h('div', { id: 'lava-overlay', class: 'hidden' });
    this.hurt = h('div', { id: 'hurt', class: 'hidden' });
    this.toast = h('div', { id: 'toast' });
    this.effects = h('div', { id: 'effects' });
    this.root = h('div', { id: 'hud' },
      this.effects,
      this.underwater, this.lava, this.hurt,
      h('div', { id: 'crosshair' }),
      h('div', { id: 'status' }, hearts, food),
      h('div', { id: 'xpbar' }, this.xpFill),
      this.xpLevel,
      this.heldName,
      this.hotbar,
      this.f3,
      this.toast,
    );
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastTimer = 60;
  }

  update(player: Player, debugText: string, dt: number): void {
    const inv = player.inventory;
    if (inv.version !== this.lastInventoryVersion) {
      this.lastInventoryVersion = inv.version;
      for (let i = 0; i < 9; i++) renderSlot(this.hotbarSlots[i], inv.slots[i], this.icons);
    }
    this.hotbarSel.style.left = `calc(${-1 + inv.selected * 20}px * var(--gui))`;
    const held = inv.selectedStack;
    const heldKey = held ? `${held.id}:${inv.selected}` : `:${inv.selected}`;
    if (heldKey !== this.lastHeld) {
      this.lastHeld = heldKey;
      if (held) {
        const def = items.byId.get(held.id);
        this.heldName.textContent = held.name ?? def?.name ?? held.id;
        this.heldName.style.opacity = '1';
        this.heldTimer = 2;
      } else this.heldName.style.opacity = '0';
    }
    if (this.heldTimer > 0) {
      this.heldTimer -= dt;
      if (this.heldTimer <= 0) this.heldName.style.opacity = '0';
    }
    if (this.toastTimer > 0 && --this.toastTimer === 0) this.toast.style.opacity = '0';
    const survival = player.gamemode === 'survival';
    this.hearts.forEach((el, i) => {
      el.classList.toggle('hidden', !survival);
      const inner = el.firstChild as HTMLElement;
      const hp = player.health - i * 2;
      inner.style.backgroundImage = hp >= 2 ? T('heart/full') : hp >= 1 ? T('heart/half') : 'none';
    });
    this.foods.forEach((el, i) => {
      el.classList.toggle('hidden', !survival);
      const inner = el.firstChild as HTMLElement;
      const f = player.food - i * 2;
      inner.style.backgroundImage = f >= 2 ? T('food_full') : f >= 1 ? T('food_half') : 'none';
    });
    const xpEl = this.xpFill.parentElement!;
    xpEl.classList.toggle('hidden', !survival);
    this.xpLevel.classList.toggle('hidden', !survival || player.xpLevel === 0);
    this.xpFill.style.width = `${Math.round(xpProgress(player) * 100)}%`;
    this.xpLevel.textContent = String(player.xpLevel);
    this.f3.classList.toggle('hidden', !this.showDebug);
    if (this.showDebug) this.f3.textContent = debugText;
    this.hurt.classList.toggle('hidden', player.hurtTime <= 0);
    // active effect icons (top right, vanilla mob_effect sprites)
    const list = [...player.effects.active.values()];
    const key = list.map((e) => `${e.id}:${e.amplifier}:${Math.ceil(e.duration / 20)}`).join('|');
    if (key !== this.lastEffectKey) {
      this.lastEffectKey = key;
      this.effects.replaceChildren();
      for (const e of list) {
        const secs = Math.ceil(e.duration / 20);
        const el = h('div', { class: 'effect' },
          h('div', { class: 'effect-icon pixel' }),
          h('div', { class: 'effect-time', text: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }),
        );
        (el.firstChild as HTMLElement).style.backgroundImage = `url('${import.meta.env.BASE_URL}textures/mob_effect/${e.id}.png')`;
        this.effects.append(el);
      }
    }
  }

  setUnderwater(v: boolean): void {
    this.underwater.classList.toggle('hidden', !v);
  }

  setInLava(v: boolean): void {
    this.lava.classList.toggle('hidden', !v);
  }
}

export function xpForLevel(level: number): number {
  if (level >= 31) return 9 * level - 158;
  if (level >= 16) return 5 * level - 38;
  return 2 * level + 7;
}

export function xpProgress(p: Player): number {
  return Math.min(1, p.xp / xpForLevel(p.xpLevel));
}
