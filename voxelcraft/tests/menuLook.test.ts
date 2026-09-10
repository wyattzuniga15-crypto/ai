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

describe('the items vanilla draws itself', () => {
  it('all have an icon rather than the missing texture', async () => {
    const { specialIcon } = await import('../src/ui/specialIcons.ts');
    // vanilla renders these in code rather than from an item model, so the icon has to be built
    // from the same box model the world draws them with
    const drawnInCode = [
      'copper_golem_statue', 'exposed_copper_golem_statue', 'weathered_copper_golem_statue',
      'oxidized_copper_golem_statue', 'waxed_copper_golem_statue', 'waxed_exposed_copper_golem_statue',
      'waxed_weathered_copper_golem_statue', 'waxed_oxidized_copper_golem_statue',
      'decorated_pot', 'dragon_head', 'chest', 'red_bed', 'white_shulker_box', 'conduit',
    ];
    const without = drawnInCode.filter((id) => !specialIcon(id));
    expect(without).toEqual([]);
  });

  it('draws the statues in the pose and the age the block carries', async () => {
    const { specialIcon } = await import('../src/ui/specialIcons.ts');
    const fresh = specialIcon('copper_golem_statue');
    const old = specialIcon('oxidized_copper_golem_statue');
    expect(fresh?.model.texture).toContain('copper_golem');
    expect(old?.model.texture).not.toBe(fresh?.model.texture);
  });
});
