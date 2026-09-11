/**
 * Auto GUI scale. Vanilla grows the interface for as long as the screen still measures 320 by 240
 * of its units; a phone is shorter than that rule allows for and would land on 1, where nothing is
 * big enough to hit with a thumb, so a touch screen never goes below 2.
 */
import { describe, expect, it, afterEach } from 'vitest';

const g = globalThis as Record<string, unknown>;
const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** Stands up just enough of a browser for the scale to be worked out against. */
async function scaleFor(width: number, height: number, touch: boolean): Promise<number> {
  g.window = { innerWidth: width, innerHeight: height };
  // node's own `navigator` is a getter, so it has to be redefined rather than assigned
  Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: touch ? 5 : 0 }, configurable: true });
  g.matchMedia = (q: string) => ({ matches: touch && q.includes('coarse') });
  const { autoGuiScale } = await import('../src/ui/dom.ts');
  return autoGuiScale();
}

afterEach(() => {
  delete g.window;
  delete g.matchMedia;
  if (saved) Object.defineProperty(globalThis, 'navigator', saved);
});

describe('auto gui scale', () => {
  it('follows vanilla’s 320 by 240 rule on a desktop', async () => {
    // the largest scale at which the screen is still 320 units across and 240 down
    for (const [w, h, want] of [[1920, 1080, 4], [1280, 720, 3], [1000, 640, 2], [854, 480, 2], [640, 480, 2], [400, 300, 1]] as const) {
      expect([w, h, await scaleFor(w, h, false)]).toEqual([w, h, want]);
    }
  });

  it('never drops a phone below 2, where a control is too small to hit', async () => {
    // every one of these lands on 1 by the rule alone
    for (const [w, h] of [[844, 390], [740, 360], [667, 375]] as const) {
      expect([w, h, await scaleFor(w, h, true)]).toEqual([w, h, 2]);
    }
  });

  it('still grows on a tablet, which has the room for it', async () => {
    expect(await scaleFor(1180, 820, true)).toBe(3);
  });
});
