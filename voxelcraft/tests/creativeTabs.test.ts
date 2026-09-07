import { describe, expect, it } from 'vitest';
import { CREATIVE_TABS, inCreativeMenu, searchItems, tabItems, tabOf } from '../src/items/creativeTabs.ts';
import { items } from '../src/items/registry.ts';
import { listFor, scrollRows } from '../src/ui/screens/creative.ts';

const tabIds = new Set(CREATIVE_TABS.map((t) => t.id));

describe('the creative tabs', () => {
  it('files every item in the menu under a tab that exists', () => {
    for (const def of items.defs) {
      if (!inCreativeMenu(def)) continue;
      expect(tabIds.has(tabOf(def)), `${def.id} -> ${tabOf(def)}`).toBe(true);
    }
  });

  it('accounts for the whole item list between them, once each', () => {
    const seen = new Set<string>();
    let n = 0;
    for (const tab of CREATIVE_TABS)
      for (const def of tabItems(tab.id)) {
        expect(seen.has(def.id)).toBe(false);
        seen.add(def.id);
        n++;
      }
    expect(n).toBe(items.defs.filter(inCreativeMenu).length);
  });

  it('puts things where a player would look for them', () => {
    const at = (id: string) => tabOf(items.get(id));
    expect(at('oak_planks')).toBe('building_blocks');
    expect(at('cyan_wool')).toBe('colored_blocks');
    expect(at('grass_block')).toBe('natural_blocks');
    expect(at('diamond_ore')).toBe('natural_blocks');
    expect(at('crafting_table')).toBe('functional_blocks');
    expect(at('chest')).toBe('functional_blocks');
    expect(at('repeater')).toBe('redstone_blocks');
    expect(at('oak_door')).toBe('redstone_blocks');
    expect(at('diamond_pickaxe')).toBe('tools_and_utilities');
    expect(at('elytra')).toBe('tools_and_utilities');
    expect(at('diamond_sword')).toBe('combat');
    expect(at('diamond_chestplate')).toBe('combat');
    expect(at('bow')).toBe('combat');
    expect(at('bread')).toBe('food_and_drinks');
    expect(at('golden_apple')).toBe('food_and_drinks');
    expect(at('iron_ingot')).toBe('ingredients');
    expect(at('pig_spawn_egg')).toBe('spawn_eggs');
    expect(at('command_block')).toBe('operator_utilities');
  });

  it('keeps the blocks nobody can hold out of the menu', () => {
    expect(inCreativeMenu(items.get('air'))).toBe(false);
    expect(inCreativeMenu(items.get('stone'))).toBe(true);
  });

  it('lists a tab in registry order', () => {
    const list = tabItems('natural_blocks');
    expect(list.length).toBeGreaterThan(50);
    for (let i = 1; i < list.length; i++) expect(list[i].num).toBeGreaterThan(list[i - 1].num);
  });
});

describe('the search tab', () => {
  it('matches on name and on id, and puts what starts with the query first', () => {
    const found = searchItems('diamond').map((d) => d.id);
    expect(found).toContain('diamond_sword');
    expect(found).toContain('diamond_ore');
    expect(found[0].startsWith('diamond')).toBe(true);
    expect(searchItems('   ')).toEqual([]);
  });

  it('reads a typed space as the underscore an id uses', () => {
    expect(searchItems('oak plank').map((d) => d.id)).toContain('oak_planks');
  });
});

describe('the creative window', () => {
  it('fills its grid from the tab it is on', () => {
    const list = listFor({ tab: 'combat', scroll: 0, query: '' });
    expect(list.length).toBeGreaterThan(20);
    expect(list.every((s) => s.count === items.maxStack(s.id))).toBe(true);
  });

  it('scrolls by as many rows as the list is longer than the window', () => {
    expect(scrollRows(0)).toBe(0);
    expect(scrollRows(45)).toBe(0);
    expect(scrollRows(46)).toBe(1);
    expect(scrollRows(9 * 8)).toBe(3);
  });
});
