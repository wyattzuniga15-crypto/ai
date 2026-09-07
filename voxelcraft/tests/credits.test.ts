import { describe, expect, it } from 'vitest';
import { parseCredits, parseEndPoem } from '../src/ui/credits.ts';

describe('the end poem', () => {
  it('splits vanilla\'s paragraphs and reads its colour codes', () => {
    const poem = parseEndPoem('§3I see the player you mean.\n\n§2PLAYERNAME?\n\n§3Yes. Take care.', 'Steve');
    expect(poem).toHaveLength(3);
    expect(poem[0][0]).toEqual({ text: 'I see the player you mean.', color: '#00aaaa', obfuscated: false });
    // the reader's own name goes where vanilla puts it
    expect(poem[1][0].text).toBe('Steve?');
    expect(poem[1][0].color).toBe('#00aa00');
  });

  it('keeps the scrambled runs apart from the plain ones, and ends them at the next colour', () => {
    const poem = parseEndPoem('§fplain §kzzz§f after', 'Steve');
    expect(poem[0].map((r) => [r.text, r.obfuscated])).toEqual([['plain ', false], ['zzz', true], [' after', false]]);
  });

  it('reads an empty or blank file as no poem at all', () => {
    expect(parseEndPoem('', 'Steve')).toEqual([]);
    expect(parseEndPoem('\n\n   \n\n', 'Steve')).toEqual([]);
  });
});

describe('the credits', () => {
  it('flattens vanilla\'s sections into headings and names', () => {
    const sections = parseCredits([
      { section: 'Mojang Studios', disciplines: [{ discipline: 'Leadership', titles: [{ title: 'Studio Head', names: ['A Person', 'Another'] }] }] },
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Mojang Studios');
    expect(sections[0].lines).toEqual([
      { text: 'Leadership', heading: true },
      { text: 'Studio Head', heading: true },
      { text: 'A Person', heading: false },
      { text: 'Another', heading: false },
    ]);
  });

  it('shrugs off anything that is not the file it expects', () => {
    expect(parseCredits(null)).toEqual([]);
    expect(parseCredits({ nope: true })).toEqual([]);
    expect(parseCredits([{ section: 'Empty' }])).toEqual([{ title: 'Empty', lines: [] }]);
  });
});
