/**
 * Generic slot-based GUI screen with vanilla interaction rules: pick up / place / split / merge,
 * shift-click quick move, number-key hotbar swap, double-click collect, drag distribution, Q to
 * drop, tooltips, and a cursor stack. Concrete screens only describe their slots.
 */
import { h } from '../dom.ts';
import { renderSlot } from '../hud.ts';
import type { ItemIcons } from '../icons.ts';
import { trimMaterial, trimPattern } from '../../items/trims.ts';
import { cloneStack, stackable, type ItemStack, type Slot } from '../../items/inventory.ts';
import { items } from '../../items/registry.ts';

export type SlotGroup = 'container' | 'inventory' | 'hotbar' | 'armor' | 'offhand' | 'result' | 'craft';

export interface SlotDef {
  x: number;
  y: number;
  get(): Slot;
  set(s: Slot): void;
  group: SlotGroup;
  /** Whether a stack may be put here by the player. */
  accepts?(s: ItemStack): boolean;
  /** Called after the player takes `taken` from a result slot; return false to refuse. */
  onTake?(taken: ItemStack): void;
  /** Result slots can't receive items and craft on take. */
  result?: boolean;
  /** For result slots: whether the player may take the item right now (level costs). */
  canTake?(): boolean;
  /** Sprite drawn in the empty slot (e.g. armor silhouettes). */
  icon?: string;
  maxCount?: number;
}

export interface ScreenDef {
  /** Background texture path relative to textures/gui/ (drawn at GUI scale). */
  texture: string;
  width: number;
  height: number;
  /** Extra background pieces: [textureX, textureY, w, h, destX, destY]. */
  pieces?: [number, number, number, number, number, number][];
  slots: SlotDef[];
  labels?: { text: string; x: number; y: number }[];
  /** Custom overlays drawn each frame (progress bars). */
  overlay?(root: HTMLElement): void;
  /** Called whenever slot contents changed by the player. */
  onChange?(): void;
  /** Order for shift-click routing: where an item from `from` should go. */
  quickMove?(from: SlotDef, stack: ItemStack): SlotDef[] | null;
}

export interface ScreenHost {
  icons: ItemIcons;
  guiScale: number;
  /** Drop a stack in front of the player. */
  drop(stack: ItemStack): void;
  creative: boolean;
  advancedTooltips: boolean;
}

const T = (p: string) => `url('${import.meta.env.BASE_URL}textures/gui/${p}')`;

export class ContainerScreen {
  readonly root: HTMLElement;
  readonly gui: HTMLElement;
  private readonly slotEls: HTMLElement[] = [];
  private readonly cursorEl: HTMLElement;
  private readonly tooltip: HTMLElement;
  cursor: Slot = null;
  private hovered = -1;
  private drag: { button: number; slots: number[] } | null = null;
  private lastClick = { slot: -1, time: 0 };
  private mouse = { x: 0, y: 0 };
  onClose: (() => void) | null = null;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor(readonly def: ScreenDef, private readonly host: ScreenHost, container: HTMLElement) {
    const s = host.guiScale;
    this.gui = h('div', { class: 'gui' });
    this.gui.style.width = `${def.width * s}px`;
    this.gui.style.height = `${def.height * s}px`;
    if (def.pieces) {
      for (const [tx, ty, w, hh, dx, dy] of def.pieces) {
        const piece = h('div');
        piece.style.cssText = `position:absolute;left:${dx * s}px;top:${dy * s}px;width:${w * s}px;height:${hh * s}px;background:${T(def.texture)} ${-tx * s}px ${-ty * s}px / ${256 * s}px ${256 * s}px no-repeat;image-rendering:pixelated;`;
        this.gui.append(piece);
      }
    } else {
      this.gui.style.background = `${T(def.texture)} 0 0 / ${256 * s}px ${256 * s}px no-repeat`;
    }
    for (const l of def.labels ?? []) {
      const el = h('div', { text: l.text });
      el.style.cssText = `position:absolute;left:${l.x * s}px;top:${l.y * s}px;font-size:${7 * s}px;color:#404040;line-height:1;white-space:nowrap;`;
      this.gui.append(el);
    }
    def.slots.forEach((slot, i) => {
      const el = h('div', { class: `slot ${slot.group}` });
      el.style.left = `${slot.x * s}px`;
      el.style.top = `${slot.y * s}px`;
      el.style.width = `${16 * s}px`;
      el.style.height = `${16 * s}px`;
      if (slot.icon) {
        const icon = h('div');
        icon.style.cssText = `position:absolute;inset:0;background:${T(slot.icon)} center / 100% 100% no-repeat;opacity:0.5;pointer-events:none;`;
        el.append(icon);
      }
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onSlotDown(i, e);
      });
      el.addEventListener('mouseenter', () => {
        this.hovered = i;
        if (this.drag && !this.drag.slots.includes(i)) {
          const st = this.def.slots[i].get();
          if (!st || (this.cursor && stackable(st, this.cursor))) this.drag.slots.push(i);
        }
        this.updateTooltip();
      });
      el.addEventListener('mouseleave', () => {
        if (this.hovered === i) this.hovered = -1;
        this.updateTooltip();
      });
      this.slotEls.push(el);
      this.gui.append(el);
    });
    this.cursorEl = h('div', { id: 'cursor-item', class: 'slot' });
    this.cursorEl.style.width = `${16 * s}px`;
    this.cursorEl.style.height = `${16 * s}px`;
    this.tooltip = h('div', { id: 'tooltip', class: 'hidden' });
    this.root = h('div', { class: 'screen' }, this.gui, this.cursorEl, this.tooltip);
    this.root.style.background = 'rgba(0,0,0,0.5)';
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) {
        e.preventDefault();
        this.dropCursor(e.button === 2 ? 1 : Infinity);
      }
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      this.cursorEl.style.left = `${e.clientX - 8 * s}px`;
      this.cursorEl.style.top = `${e.clientY - 8 * s}px`;
      this.tooltip.style.left = `${e.clientX + 12}px`;
      this.tooltip.style.top = `${e.clientY - 12}px`;
    });
    window.addEventListener('mouseup', this.onMouseUp);
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    container.append(this.root);
    this.refresh();
  }

  destroy(): void {
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }

  /** Redraws every slot and the cursor. */
  refresh(): void {
    this.def.slots.forEach((slot, i) => renderSlot(this.slotEls[i], slot.get(), this.host.icons));
    renderSlot(this.cursorEl, this.cursor, this.host.icons);
    this.def.overlay?.(this.gui);
    this.updateTooltip();
  }

  tick(): void {
    this.def.overlay?.(this.gui);
  }

  private changed(): void {
    this.def.onChange?.();
    this.refresh();
  }

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.slots.length > 1 && this.cursor) this.applyDrag(d.button, d.slots);
    void e;
  };

  private onSlotDown(i: number, e: MouseEvent): void {
    const now = performance.now();
    const dbl = e.button === 0 && this.lastClick.slot === i && now - this.lastClick.time < 300;
    this.lastClick = { slot: i, time: now };
    if (dbl && this.cursor) {
      this.collectAll();
      return;
    }
    if (e.shiftKey && e.button === 0) {
      this.quickMove(i);
      return;
    }
    if (this.cursor && (e.button === 0 || e.button === 2)) this.drag = { button: e.button, slots: [i] };
    this.click(i, e.button);
  }

  /** Vanilla left/right click semantics for one slot. */
  click(i: number, button: number): void {
    const slot = this.def.slots[i];
    const st = slot.get();
    const cur = this.cursor;
    if (slot.result) {
      if (!st) return;
      if (slot.canTake && !slot.canTake()) return;
      if (cur && (!stackable(cur, st) || cur.count + st.count > items.maxStack(st.id))) return;
      const taken = cloneStack(st);
      slot.onTake?.(taken);
      if (cur) cur.count += taken.count;
      else this.cursor = taken;
      this.changed();
      return;
    }
    if (!cur) {
      if (!st) return;
      if (button === 0) {
        this.cursor = st;
        slot.set(null);
      } else if (button === 2) {
        const half = Math.ceil(st.count / 2);
        this.cursor = cloneStack(st, half);
        st.count -= half;
        slot.set(st.count > 0 ? st : null);
      } else if (this.host.creative) {
        this.cursor = cloneStack(st, items.maxStack(st.id));
      }
    } else if (!st) {
      if (slot.accepts && !slot.accepts(cur)) return;
      const max = Math.min(items.maxStack(cur.id), slot.maxCount ?? 64);
      if (button === 0) {
        const n = Math.min(cur.count, max);
        slot.set(cloneStack(cur, n));
        cur.count -= n;
      } else if (button === 2) {
        slot.set(cloneStack(cur, 1));
        cur.count -= 1;
      }
      if (cur.count <= 0) this.cursor = null;
    } else if (stackable(st, cur)) {
      if (slot.accepts && !slot.accepts(cur)) return;
      const max = Math.min(items.maxStack(cur.id), slot.maxCount ?? 64);
      const n = button === 2 ? Math.min(1, max - st.count) : Math.min(cur.count, max - st.count);
      if (n <= 0) {
        // full: pick it up instead (vanilla swaps nothing)
        return;
      }
      st.count += n;
      cur.count -= n;
      if (cur.count <= 0) this.cursor = null;
      slot.set(st);
    } else {
      if (slot.accepts && !slot.accepts(cur)) return;
      if (cur.count > (slot.maxCount ?? 64)) return;
      slot.set(cur);
      this.cursor = st;
    }
    this.changed();
  }

  private applyDrag(button: number, slots: number[]): void {
    const cur = this.cursor;
    if (!cur) return;
    const targets = slots.map((i) => this.def.slots[i]).filter((s) => !s.result && (!s.accepts || s.accepts(cur)));
    if (!targets.length) return;
    const per = button === 2 ? 1 : this.host.creative && button === 1 ? items.maxStack(cur.id) : Math.floor(cur.count / targets.length);
    if (per <= 0) return;
    for (const slot of targets) {
      if (cur.count <= 0 && !this.host.creative) break;
      const st = slot.get();
      const max = Math.min(items.maxStack(cur.id), slot.maxCount ?? 64);
      const room = st ? (stackable(st, cur) ? max - st.count : 0) : max;
      const n = Math.min(per, room, cur.count);
      if (n <= 0) continue;
      if (st) st.count += n;
      else slot.set(cloneStack(cur, n));
      if (st) slot.set(st);
      if (!(this.host.creative && button === 1)) cur.count -= n;
    }
    if (cur.count <= 0) this.cursor = null;
    this.changed();
  }

  private collectAll(): void {
    const cur = this.cursor;
    if (!cur) return;
    const max = items.maxStack(cur.id);
    // smaller stacks first, like vanilla
    const order = this.def.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.result && s.get() && stackable(s.get()!, cur)).sort((a, b) => a.s.get()!.count - b.s.get()!.count);
    for (const { s } of order) {
      if (cur.count >= max) break;
      const st = s.get()!;
      const n = Math.min(st.count, max - cur.count);
      st.count -= n;
      cur.count += n;
      s.set(st.count > 0 ? st : null);
    }
    this.changed();
  }

  /** Shift-click: move the whole stack to the other side of the screen. */
  quickMove(i: number): void {
    const slot = this.def.slots[i];
    let st = slot.get();
    if (!st) return;
    if (slot.result) {
      // craft as many as possible
      let guard = 0;
      while (st && guard++ < 64) {
        if (slot.canTake && !slot.canTake()) break;
        const targets = this.def.quickMove?.(slot, st) ?? [];
        const taken = cloneStack(st);
        if (!this.insertInto(taken, targets)) break;
        slot.onTake?.(taken);
        this.def.onChange?.();
        st = slot.get();
        if (!st || guard > 64) break;
      }
      this.refresh();
      return;
    }
    const targets = this.def.quickMove?.(slot, st);
    if (!targets || !targets.length) return;
    const moving = cloneStack(st);
    this.insertInto(moving, targets);
    slot.set(moving.count > 0 ? moving : null);
    this.changed();
  }

  /** Fills matching stacks first, then empty slots. Mutates `stack.count`; returns true if any moved. */
  private insertInto(stack: ItemStack, targets: SlotDef[]): boolean {
    const start = stack.count;
    const max = items.maxStack(stack.id);
    for (const t of targets) {
      if (t.accepts && !t.accepts(stack)) continue;
      if (stack.count <= 0) break;
      const st = t.get();
      if (!st || !stackable(st, stack) || t.result) continue;
      const room = Math.min(max, t.maxCount ?? 64) - st.count;
      if (room <= 0) continue;
      const n = Math.min(room, stack.count);
      st.count += n;
      stack.count -= n;
      t.set(st);
    }
    for (const t of targets) {
      if (stack.count <= 0) break;
      if (t.get() || t.result) continue;
      if (t.accepts && !t.accepts(stack)) continue;
      const n = Math.min(stack.count, Math.min(max, t.maxCount ?? 64));
      t.set(cloneStack(stack, n));
      stack.count -= n;
    }
    return stack.count < start;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Escape' || e.code === 'KeyE') {
      e.preventDefault();
      this.onClose?.();
      return;
    }
    if (/^Digit[1-9]$/.test(e.code) && this.hovered >= 0) {
      const n = Number(e.code.slice(5)) - 1;
      const hot = this.def.slots.find((s) => s.group === 'hotbar' && (s as SlotDef & { index?: number }).index === n) ?? this.def.slots.filter((s) => s.group === 'hotbar')[n];
      const slot = this.def.slots[this.hovered];
      if (hot && slot && hot !== slot && !slot.result) {
        const a = slot.get();
        const b = hot.get();
        if ((a && hot.accepts && !hot.accepts(a)) || (b && slot.accepts && !slot.accepts(b))) return;
        slot.set(b);
        hot.set(a);
        this.changed();
      } else if (hot && slot?.result && slot.get() && !hot.get() && (!slot.canTake || slot.canTake())) {
        const taken = cloneStack(slot.get()!);
        slot.onTake?.(taken);
        hot.set(taken);
        this.changed();
      }
      e.preventDefault();
    }
    if (e.code === 'KeyQ' && this.hovered >= 0) {
      const slot = this.def.slots[this.hovered];
      const st = slot.get();
      if (st && !slot.result) {
        const n = e.ctrlKey ? st.count : 1;
        this.host.drop(cloneStack(st, n));
        st.count -= n;
        slot.set(st.count > 0 ? st : null);
        this.changed();
      } else if (st && slot.result && (!slot.canTake || slot.canTake())) {
        const taken = cloneStack(st);
        slot.onTake?.(taken);
        this.host.drop(taken);
        this.changed();
      }
      e.preventDefault();
    }
  }

  private dropCursor(n: number): void {
    if (!this.cursor) return;
    const k = Math.min(n, this.cursor.count);
    this.host.drop(cloneStack(this.cursor, k));
    this.cursor.count -= k;
    if (this.cursor.count <= 0) this.cursor = null;
    this.refresh();
  }

  /** Returns the cursor stack to the inventory (or drops it) when the screen closes. */
  releaseCursor(insert: (s: ItemStack) => number): void {
    if (!this.cursor) return;
    const left = insert(this.cursor);
    if (left > 0) this.host.drop(cloneStack(this.cursor, left));
    this.cursor = null;
  }

  private updateTooltip(): void {
    const slot = this.hovered >= 0 ? this.def.slots[this.hovered] : null;
    const st = slot?.get();
    if (!st || this.cursor) {
      this.tooltip.classList.add('hidden');
      return;
    }
    this.tooltip.replaceChildren();
    const def = items.byId.get(st.id);
    const name = h('div', { text: st.name ?? def?.name ?? st.id });
    if (st.enchantments && Object.keys(st.enchantments).length) name.style.color = '#55ffff';
    if (st.name) name.style.fontStyle = 'italic';
    this.tooltip.append(name);
    for (const [id, lvl] of Object.entries(st.enchantments ?? {})) this.tooltip.append(h('div', { class: 'ench', text: `${id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} ${roman(lvl)}` }));
    if (def?.food) this.tooltip.append(h('div', { class: 'sub', text: `Nutrition ${def.food.nutrition}, saturation ${def.food.saturation}` }));
    if (def?.attack) this.tooltip.append(h('div', { class: 'sub', text: `${def.attack.damage} Attack Damage · ${def.attack.speed} Attack Speed` }));
    if (def?.armor) this.tooltip.append(h('div', { class: 'sub', text: `+${def.armor.points} Armor${def.armor.toughness ? ` · +${def.armor.toughness} Toughness` : ''}` }));
    if (st.trim) {
      const pattern = trimPattern(st.trim.pattern);
      const material = trimMaterial(st.trim.material);
      this.tooltip.append(h('div', { class: 'sub', text: 'Upgrade: ' }));
      const line = (text: string) => {
        const el = h('div', { text: `\u00a0${text}` });
        el.style.color = material?.color ?? '#a0a0a0';
        this.tooltip.append(el);
      };
      line(pattern?.name ?? st.trim.pattern);
      line(material?.name ?? st.trim.material);
    }
    if (st.contents) {
      const inside = st.contents.filter((s): s is ItemStack => !!s);
      for (const s of inside.slice(0, 5)) this.tooltip.append(h('div', { text: `${items.byId.get(s.id)?.name ?? s.id} x${s.count}` }));
      if (inside.length > 5) {
        const more = h('div', { class: 'sub', text: `and ${inside.length - 5} more...` });
        more.style.fontStyle = 'italic';
        this.tooltip.append(more);
      }
    }
    if (def?.behavior === 'smithing_template') {
      const upgrade = st.id === 'netherite_upgrade_smithing_template';
      this.tooltip.append(h('div', { class: 'sub', text: 'Smithing Template' }));
      const pair = (label: string, value: string) => {
        this.tooltip.append(h('div', { class: 'sub', text: label }));
        const el = h('div', { text: `\u00a0${value}` });
        el.style.color = '#5555ff';
        this.tooltip.append(el);
      };
      pair('Applies to:', upgrade ? 'Diamond Equipment' : 'Armor');
      pair('Ingredients:', upgrade ? 'Netherite Ingot' : 'Ingots & Crystals');
    }
    if (def?.durability && st.damage) this.tooltip.append(h('div', { class: 'sub', text: `Durability: ${def.durability - st.damage} / ${def.durability}` }));
    if (this.host.advancedTooltips) this.tooltip.append(h('div', { class: 'sub', text: `minecraft:${st.id}` }));
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = `${this.mouse.x + 12}px`;
    this.tooltip.style.top = `${this.mouse.y - 12}px`;
  }
}

function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}
