/**
 * The phone edition's controls. A touch screen has no keyboard, no mouse and no pointer to lock, so
 * this lays Bedrock's own arrangement over the game and feeds it back through the same actions the
 * keys drive: a thumb pad on the left, jump and its neighbours on the right, the hotbar between
 * them, and the rest of the screen given over to looking around.
 *
 * Mining and placing follow Bedrock too. A tap on the world uses what is in hand or places it; a
 * finger held still on the world mines whatever is under the crosshair for as long as it stays
 * down. Dragging looks around instead, and never mines, so turning to face something cannot break
 * the thing you were already looking at.
 */
import type { Action, Input } from '../core/input.ts';
import { h } from './dom.ts';

/** Whether this is a phone or a tablet rather than something with a mouse. */
export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
}

/** How far a finger may wander and still count as a tap rather than a drag, in CSS pixels. */
const TAP_SLOP = 12;
/** How long a finger may rest before it stops being a tap and starts mining, in milliseconds. */
const HOLD_MS = 180;

interface Pad { action: Action; label: string; cls: string }

/** The thumb pad, in the arrangement Bedrock puts it in: forward over a row of back, left, right. */
const PAD: Pad[] = [
  { action: 'forward', label: '▲', cls: 'up' },
  { action: 'left', label: '◀', cls: 'left' },
  { action: 'back', label: '▼', cls: 'down' },
  { action: 'right', label: '▶', cls: 'right' },
];

export interface TouchHooks {
  /** Whether a screen is open over the world, which hides the controls the way Bedrock does. */
  busy(): boolean;
}

export class TouchControls {
  readonly root: HTMLElement;
  /** Which finger is doing what, so two thumbs never fight over one job. */
  private look: { id: number; x: number; y: number; sx: number; sy: number; at: number; mining: boolean } | null = null;
  private readonly padFingers = new Map<number, Action>();

  constructor(private readonly input: Input, container: HTMLElement, private readonly hooks: TouchHooks) {
    const pad = h('div', { class: 'touch-pad' });
    for (const p of PAD) pad.append(this.padButton(p));
    const jump = this.holdButton('jump', '⤒', 'jump');
    const crouch = this.holdButton('sneak', '⤓', 'crouch');
    const sprint = this.toggleButton('sprint', '»', 'sprint');
    this.root = h('div', { id: 'touch-controls' },
      h('div', { class: 'touch-look' }),
      pad,
      h('div', { class: 'touch-right' }, sprint, jump, crouch),
      // the game's font is Mojang's ascii page, so these say what they do in words it can draw
      h('div', { class: 'touch-top' },
        this.tapButton('pause', 'II', 'pause'),
        this.tapButton('inventory', 'Bag', 'bag'),
        this.tapButton('chat', 'Chat', 'chat'),
        this.tapButton('drop', 'Drop', 'drop'),
      ),
    );
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    const surface = this.root.querySelector('.touch-look') as HTMLElement;
    surface.addEventListener('pointerdown', (e) => this.lookDown(e, surface));
    surface.addEventListener('pointermove', (e) => this.lookMove(e));
    surface.addEventListener('pointerup', (e) => this.lookUp(e));
    surface.addEventListener('pointercancel', (e) => this.lookUp(e));
    container.append(this.root);
  }

  /** Called once a frame so the controls match the state the player is actually in. */
  update(): void {
    const busy = this.hooks.busy();
    this.root.classList.toggle('hidden', busy);
    if (busy && (this.look || this.padFingers.size)) this.releaseAll();
    // a finger resting on the world starts mining once it has been still long enough to mean it
    if (this.look && !this.look.mining && performance.now() - this.look.at > HOLD_MS) {
      this.look.mining = true;
      this.input.touchButton(0, true);
    }
  }

  dispose(): void {
    this.releaseAll();
    this.root.remove();
  }

  private releaseAll(): void {
    if (this.look?.mining) this.input.touchButton(0, false);
    this.look = null;
    for (const action of this.padFingers.values()) this.input.touchHold(action, false);
    this.padFingers.clear();
    this.input.clearTouch();
    for (const el of this.root.querySelectorAll('.touch-btn.on')) el.classList.remove('on');
  }

  /**
   * A pad key. The finger is tracked rather than the button, so sliding a thumb from forward onto
   * forward-and-left works the way it does on a real pad instead of sticking on the first key.
   */
  private padButton(p: Pad): HTMLElement {
    const el = h('div', { class: `touch-btn pad ${p.cls}`, text: p.label });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      this.padFingers.set(e.pointerId, p.action);
      this.input.touchHold(p.action, true);
      el.classList.add('on');
    });
    const up = (e: PointerEvent) => {
      if (this.padFingers.get(e.pointerId) !== p.action) return;
      this.padFingers.delete(e.pointerId);
      this.input.touchHold(p.action, false);
      el.classList.remove('on');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return el;
  }

  /** A button held for as long as the finger is on it: jump, and crouch when not flying. */
  private holdButton(action: Action, label: string, cls: string): HTMLElement {
    const el = h('div', { class: `touch-btn ${cls}`, text: label });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.touchHold(action, true);
      el.classList.add('on');
    });
    const up = () => {
      this.input.touchHold(action, false);
      el.classList.remove('on');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return el;
  }

  /** A button that stays down once tapped, the way Bedrock latches sprint. */
  private toggleButton(action: Action, label: string, cls: string): HTMLElement {
    const el = h('div', { class: `touch-btn ${cls}`, text: label });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      this.input.touchHold(action, on);
    });
    return el;
  }

  /** A button that fires once a tap, for the things that only want the edge. */
  private tapButton(action: Action, label: string, cls: string): HTMLElement {
    const el = h('div', { class: `touch-btn small ${cls}`, text: label });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.touchTap(action);
      el.classList.add('on');
      setTimeout(() => el.classList.remove('on'), 90);
    });
    return el;
  }

  private lookDown(e: PointerEvent, surface: HTMLElement): void {
    if (this.look) return; // one finger looks; the other thumb is on the pad
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, at: performance.now(), mining: false };
  }

  private lookMove(e: PointerEvent): void {
    const l = this.look;
    if (!l || e.pointerId !== l.id) return;
    e.preventDefault();
    const dx = e.clientX - l.x;
    const dy = e.clientY - l.y;
    l.x = e.clientX;
    l.y = e.clientY;
    this.input.touchLook(dx, dy);
    // once the finger has travelled it is a look, not a tap, and a look never starts mining
    if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > TAP_SLOP) {
      l.at = Infinity;
      if (l.mining) {
        l.mining = false;
        this.input.touchButton(0, false);
      }
    }
  }

  private lookUp(e: PointerEvent): void {
    const l = this.look;
    if (!l || e.pointerId !== l.id) return;
    e.preventDefault();
    this.look = null;
    if (l.mining) {
      this.input.touchButton(0, false);
      return;
    }
    // a short tap that never wandered: use what is in hand, which is what places a block
    if (performance.now() - l.at <= HOLD_MS + 120 && Math.hypot(e.clientX - l.sx, e.clientY - l.sy) <= TAP_SLOP) {
      this.input.touchButton(2, true);
      // the button has to survive a tick for the game to see the press, and no longer
      setTimeout(() => this.input.touchButton(2, false), 60);
    }
  }
}
