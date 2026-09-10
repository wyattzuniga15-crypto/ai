/**
 * The menus. Vanilla's widgets are drawn from sprites with a nine-slice border its own mcmeta
 * gives, and its text is the font built out of `ascii.png` — so the stylesheet has to name those
 * files rather than draw its own gradients.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/ui.css', 'utf8');

describe('the menu styling', () => {
  it('draws its buttons from Mojang’s own widget sprites', () => {
    for (const sprite of ['widget/button.png', 'widget/button_highlighted.png', 'widget/button_disabled.png', 'widget/text_field.png', 'widget/slider.png']) {
      expect([sprite, css.includes(sprite)]).toEqual([sprite, true]);
    }
  });

  it('nine-slices the button with the three-pixel border its mcmeta names', () => {
    const meta = JSON.parse(fs.readFileSync('assets/textures/gui/sprites/widget/button.png.mcmeta', 'utf8')) as { gui: { scaling: { border: number } } };
    expect(meta.gui.scaling.border).toBe(3);
    expect(css).toMatch(/widget\/button\.png'\) 3 fill/);
  });

  it('sets the type in the font built from the atlas, at vanilla’s own size', () => {
    expect(css).toContain("font-family: 'Minecraft'");
    expect(css).toContain('/font/minecraft.ttf');
    // eight pixels a line, scaled by the gui scale, is exactly how tall vanilla draws it
    expect(css).toContain('--text: calc(8px * var(--gui))');
  });

  it('leaves no hand-rolled button gradient behind', () => {
    expect(css).not.toMatch(/\.btn\s*\{[^}]*background:\s*#6f6f6f/);
  });
});
