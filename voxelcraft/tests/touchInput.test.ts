/**
 * The phone edition's input. On a touch screen there is no pointer to lock and no keyboard, so the
 * on-screen controls stand in for both: the game asks the same questions it asks of a keyboard and
 * has to get the same answers back.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Input } from '../src/core/input.ts';

type Handler = (e: unknown) => void;

/**
 * Just enough of a page for `Input` to hang its listeners on: the tests run under node, and what
 * is under test is the bookkeeping, not the browser.
 */
function fakeDom() {
  const listeners = new Map<string, Handler[]>();
  const target = (tag: string) => ({
    addEventListener(type: string, fn: Handler) {
      const key = `${tag}:${type}`;
      listeners.set(key, [...(listeners.get(key) ?? []), fn]);
    },
  });
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document };
  g.window = target('window');
  g.document = { ...target('document'), pointerLockElement: null };
  return {
    element: target('element') as unknown as HTMLElement,
    /** Fires an event at whatever listened for it, the way the browser would. */
    fire(where: string, type: string, event: Record<string, unknown>) {
      for (const fn of listeners.get(`${where}:${type}`) ?? []) fn(event);
    },
    restore() {
      g.window = saved.window;
      g.document = saved.document;
    },
  };
}

let dom: ReturnType<typeof fakeDom>;

function makeInput(touch = true): Input {
  const input = new Input(dom.element);
  input.touch = touch;
  return input;
}

describe('touch input', () => {
  let input: Input;
  beforeEach(() => { dom = fakeDom(); input = makeInput(); });
  afterEach(() => dom.restore());

  it('holds an action for as long as the control is held, edges and all', () => {
    expect(input.isDown('forward')).toBe(false);
    input.touchHold('forward', true);
    expect([input.isDown('forward'), input.wasPressed('forward'), input.tickPressed('forward')]).toEqual([true, true, true]);
    // the edge is spent once the frame and the tick have each seen it; the hold is not
    input.endFrame();
    input.endTick();
    expect([input.isDown('forward'), input.wasPressed('forward'), input.tickPressed('forward')]).toEqual([true, false, false]);
    input.touchHold('forward', false);
    expect(input.isDown('forward')).toBe(false);
  });

  it('does not fire the edge again while the finger stays down', () => {
    input.touchHold('jump', true);
    input.endFrame();
    input.endTick();
    input.touchHold('jump', true); // the same finger, reported again
    expect([input.wasPressed('jump'), input.tickPressed('jump')]).toEqual([false, false]);
  });

  it('gives a tap one edge and no hold', () => {
    input.touchTap('inventory');
    expect([input.wasPressed('inventory'), input.isDown('inventory')]).toEqual([true, false]);
    input.endFrame();
    expect(input.wasPressed('inventory')).toBe(false);
  });

  it('reports a finger on the world as the mouse button the action is bound to', () => {
    input.touchButton(0, true);
    expect([input.isDown('attack'), input.tickPressed('attack')]).toEqual([true, true]);
    input.touchButton(0, false);
    expect(input.isDown('attack')).toBe(false);
    // a tap that is over before the next tick still has to be seen by it
    input.touchButton(2, true);
    input.touchButton(2, false);
    expect(input.tickPressed('use')).toBe(true);
  });

  it('turns the head by the drag, the way the mouse turns it', () => {
    input.touchLook(12, -4);
    input.touchLook(3, 1);
    expect(input.consumeMouse()).toEqual({ dx: 15, dy: -3 });
    expect(input.consumeMouse()).toEqual({ dx: 0, dy: 0 });
  });

  it('takes and gives back the screen without a pointer to lock', () => {
    const seen: boolean[] = [];
    input.onLockChange = (v) => seen.push(v);
    input.requestLock();
    expect(input.locked).toBe(true);
    input.exitLock();
    expect(input.locked).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('lets go of everything when the screen is taken away', () => {
    input.touchHold('forward', true);
    input.touchButton(0, true);
    input.exitLock();
    expect([input.isDown('forward'), input.isDown('attack')]).toEqual([false, false]);
  });

  it('ignores the mouse events a tap also fires, so nothing counts twice', () => {
    input.requestLock();
    dom.fire('document', 'mousemove', { movementX: 40, movementY: 9 });
    expect(input.consumeMouse()).toEqual({ dx: 0, dy: 0 });
  });

  it('leaves a keyboard and mouse alone', () => {
    const plain = makeInput(false);
    plain.locked = true;
    dom.fire('document', 'mousemove', { movementX: 40, movementY: 9 });
    // the touch one in this test is listening too, and must have taken nothing from it
    expect([plain.consumeMouse(), input.consumeMouse()]).toEqual([{ dx: 40, dy: 9 }, { dx: 0, dy: 0 }]);
  });
});
