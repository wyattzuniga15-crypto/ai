import { describe, expect, it } from 'vitest';
import { ACTION_INFO, DEFAULT_BINDINGS, UNBOUND, keyName, mergeBindings, mouseButtonOf, type Action } from '../src/core/input.ts';

describe('key bindings', () => {
  it('names keys like vanilla', () => {
    expect(keyName('KeyW')).toBe('W');
    expect(keyName('Digit1')).toBe('1');
    expect(keyName('ShiftLeft')).toBe('Left Shift');
    expect(keyName('ControlRight')).toBe('Right Control');
    expect(keyName('Space')).toBe('Space');
    expect(keyName('Slash')).toBe('/');
    expect(keyName('F3')).toBe('F3');
    expect(keyName('Mouse0')).toBe('Left Button');
    expect(keyName('Mouse1')).toBe('Middle Button');
    expect(keyName('Mouse2')).toBe('Right Button');
    expect(keyName('Mouse4')).toBe('Button 5');
    expect(keyName('NumpadEnter')).toBe('Keypad Enter');
    expect(keyName('Numpad7')).toBe('Keypad 7');
    expect(keyName(UNBOUND)).toBe('Not Bound');
  });

  it('merges saved overrides over the defaults and normalises legacy codes', () => {
    const b = mergeBindings({ forward: 'KeyK', pick: 'MouseMiddle', bogus: 'KeyZ', jump: '' });
    expect(b.forward).toBe('KeyK');
    expect(b.pick).toBe('Mouse1');
    expect(b.jump).toBe(DEFAULT_BINDINGS.jump);
    expect((b as Record<string, string>).bogus).toBeUndefined();
    expect(mergeBindings(undefined)).toEqual(DEFAULT_BINDINGS);
    expect(mouseButtonOf('Mouse2')).toBe(2);
    expect(mouseButtonOf('KeyW')).toBe(-1);
  });

  it('lists every action exactly once on the controls screen', () => {
    const listed = ACTION_INFO.map((i) => i.action);
    expect(new Set(listed).size).toBe(listed.length);
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) expect(listed, a).toContain(a);
  });
});
