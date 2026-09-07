import { describe, expect, it } from 'vitest';
import { claimsStart, nearbyStarts, structureStart, type StructureSet } from '../src/world/gen/structures.ts';

/** Two sets sharing one spread, as vanilla's fortress and bastion do. */
const shared = (name: string, before: number, weight: number): StructureSet => ({
  name, placement: 'jigsaw', spacing: 27, separation: 4, salt: 30084232,
  share: { before, weight, total: 5 },
  pieces: [], biomes: [], templates: [], mainTemplates: [], reach: 5, byKey: new Map(), pools: {},
  biomeSet: new Set(), variantBiomes: [],
} as unknown as StructureSet);

describe('a shared spread', () => {
  it('gives every start to exactly one of the structures on it', () => {
    const bastion = shared('bastion_remnant', 0, 3);
    const fortress = shared('fortress', 3, 2);
    let both = 0, neither = 0, b = 0, f = 0;
    for (let rx = -12; rx <= 12; rx++)
      for (let rz = -12; rz <= 12; rz++) {
        const start = structureStart(4242, bastion, rx, rz);
        const hasB = claimsStart(4242, bastion, start.cx, start.cz);
        const hasF = claimsStart(4242, fortress, start.cx, start.cz);
        if (hasB && hasF) both++;
        if (!hasB && !hasF) neither++;
        if (hasB) b++;
        if (hasF) f++;
      }
    expect(both).toBe(0);
    expect(neither).toBe(0);
    // and roughly on vanilla's three-to-two split
    expect(b / (b + f)).toBeGreaterThan(0.5);
    expect(b / (b + f)).toBeLessThan(0.7);
  });

  it('claims everything when a set does not share', () => {
    const alone = { ...shared('x', 0, 1), share: undefined } as StructureSet;
    for (let i = 0; i < 20; i++) expect(claimsStart(1, alone, i, -i)).toBe(true);
  });
});

describe('nearby starts', () => {
  it('finds the start of a chunk that a structure reaches into', () => {
    const set = shared('bastion_remnant', 0, 3);
    const start = structureStart(4242, set, 0, 0);
    // every chunk within the set's reach of the start must see it
    for (let dx = -set.reach; dx <= set.reach; dx++)
      for (let dz = -set.reach; dz <= set.reach; dz++) {
        const near = nearbyStarts(4242, set, start.cx + dx, start.cz + dz);
        expect(near.some((s) => s.cx === start.cx && s.cz === start.cz)).toBe(true);
      }
    // and one well outside it must not
    const far = nearbyStarts(4242, set, start.cx + 40, start.cz);
    expect(far.some((s) => s.cx === start.cx && s.cz === start.cz)).toBe(false);
  });
});
