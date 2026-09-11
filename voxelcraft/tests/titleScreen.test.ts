/**
 * The title screen. Vanilla draws its own logo from `minecraft.png` with the edition strip under
 * it, lays the rows out from height/4 + 48, and puts the version in one bottom corner and the
 * copyright in the other. The numbers here are vanilla's own, so the layout has to name them.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { MC_VERSION } from '../src/core/constants.ts';

const css = fs.readFileSync('src/ui/ui.css', 'utf8');
const menus = fs.readFileSync('src/ui/menus.ts', 'utf8');

describe('the title screen', () => {
  it('draws Mojang’s own logo rather than setting the name in text', () => {
    expect(css).toContain('textures/gui/title/minecraft.png');
    expect(css).toContain('textures/gui/title/edition.png');
    // 256x44 of a 256x64 sheet, thirty units down, with the strip overlapping it by seven
    expect(css).toContain('top: calc(30px * var(--gui))');
    expect(css).toContain('calc(100% * 64 / 44)');
    expect(css).toContain('top: calc(37px * var(--gui))');
  });

  it('has the buttons vanilla has, in vanilla’s order', () => {
    const order = ['Singleplayer', 'Multiplayer', 'Minecraft Realms', 'Options...', 'Quit Game'];
    const at = order.map((label) => menus.indexOf(`button('${label}'`));
    expect(at.some((i) => i < 0)).toBe(false);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // and the two square ones that bracket the bottom row
    expect(menus).toContain("iconButton('language'");
    expect(menus).toContain("iconButton('accessibility'");
  });

  it('names the version in one corner and the copyright in the other', () => {
    expect(menus).toContain('`Minecraft ${MC_VERSION}`');
    expect(MC_VERSION).toBe('1.21.11');
    expect(menus).toContain('Copyright Mojang AB. Do not distribute!');
  });

  it('starts the rows where vanilla starts them and keeps them on a short screen', () => {
    // height/4 + 48, which in a stylesheet is a quarter of the viewport plus 48 units
    expect(css).toContain('calc(25vh + 48px * var(--gui))');
    // a phone held sideways is shorter than that allows for, so the block also has a floor
    expect(css).toMatch(/\.screen\.title \.menu \{[^}]*top: min\(/);
  });

  it('leaves room for a notch down either side', () => {
    for (const rule of ['.corner.left', '.corner.right']) {
      const line = css.split('\n').find((l) => l.startsWith(rule));
      expect([rule, line?.includes('safe-area-inset')]).toEqual([rule, true]);
    }
  });
});
