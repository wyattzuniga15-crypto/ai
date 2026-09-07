/**
 * Builds `data/trades.json` from Mojang's published Bedrock economy trade tables (the same trade
 * economy the Java villagers use): one entry per profession plus the wandering trader, each a list
 * of tiers with the experience needed to reach them and the trades that tier can offer.
 *
 *   npx tsx tools/gen-trades.ts .cache/trades
 *
 * Bedrock keeps a few legacy item names and metadata suffixes, which are mapped back to the 1.21
 * ids here; a trade whose item has no 1.21 equivalent in our registry is dropped and reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import itemsJson from '../data/items.json' with { type: 'json' };

interface BedrockItem { item?: string; quantity?: number | { min: number; max: number }; price_multiplier?: number; choice?: BedrockItem[]; functions?: { function?: string; id?: string }[] }
interface BedrockTrade { wants: BedrockItem[]; gives: BedrockItem[]; max_uses?: number; trader_exp?: number; reward_exp?: boolean }
interface BedrockTier { total_exp_required?: number; groups: { num_to_select?: number; trades: BedrockTrade[] }[] }

/** Bedrock's legacy ids for items Java renamed. */
const RENAMES: Record<string, string> = {
  fish: 'cod', cooked_fish: 'cooked_cod', clownfish: 'tropical_fish', melon_block: 'melon',
  speckled_melon: 'glistering_melon_slice', empty_map: 'map', frame: 'item_frame', waterlily: 'lily_pad',
  horsearmorleather: 'leather_horse_armor', banner: 'white_banner', turtle_shell_piece: 'turtle_scute',
  small_dripleaf_block: 'small_dripleaf', dirt_with_roots: 'rooted_dirt', carrot_on_a_stick: 'carrot_on_a_stick',
  'dye:0': 'ink_sac', 'dye:4': 'lapis_lazuli', 'dye:15': 'bone_meal',
  muttonraw: 'mutton', bed: 'white_bed', golden_dandelion: 'dandelion', sulfur_spike: 'pointed_dripstone',
};

const known = new Set((itemsJson as { id: string }[]).map((i) => i.id));
const dropped = new Map<string, number>();

function itemId(raw: string): string | null {
  const name = raw.replace('minecraft:', '');
  const mapped = RENAMES[name] ?? RENAMES[name.split(':')[0]] ?? name.split(':')[0];
  if (known.has(mapped)) return mapped;
  dropped.set(raw, (dropped.get(raw) ?? 0) + 1);
  return null;
}

interface OutItem { id: string; count: number; max?: number; enchanted?: boolean }

function convert(entry: BedrockItem): OutItem | null {
  const src = entry.choice?.[0] ?? entry;
  if (!src.item) return null;
  const id = itemId(src.item);
  if (!id) return null;
  const q = src.quantity;
  const count = typeof q === 'number' ? q : q ? q.min : 1;
  const max = typeof q === 'object' && q && q.max !== q.min ? q.max : undefined;
  // librarian books come out of an enchant_randomly loot function
  const enchanted = (src.functions ?? []).some((f) => String(f.function ?? '').includes('enchant')) || undefined;
  // an enchanted book trade gives the enchanted item, which for `book` means an enchanted book
  const finalId = enchanted && id === 'book' ? 'enchanted_book' : id;
  return { id: finalId, count, ...(max ? { max } : {}), ...(enchanted ? { enchanted } : {}) };
}

const dir = process.argv[2] ?? '.cache/trades';
const out: Record<string, { xp: number; trades: unknown[] }[]> = {};
for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith('.json')) continue;
  const raw = fs.readFileSync(path.join(dir, file), 'utf8')
    .replace(/\/\/[^\n]*/g, '')      // the tables carry line comments
    .replace(/,(\s*[}\]])/g, '$1');  // and the occasional trailing comma
  const data = JSON.parse(raw) as { tiers: BedrockTier[] };
  const key = path.basename(file, '.json');
  out[key] = data.tiers.map((tier) => ({
    xp: tier.total_exp_required ?? 0,
    trades: tier.groups.flatMap((g) => g.trades).flatMap((t) => {
      const wants = t.wants.map(convert);
      const gives = t.gives.map(convert);
      if (wants.some((w) => !w) || gives.some((g2) => !g2) || !gives[0]) return [];
      const price = (t.wants[0].choice?.[0] ?? t.wants[0]).price_multiplier ?? 0.05;
      return [{
        wants: wants as OutItem[],
        gives: gives[0] as OutItem,
        maxUses: t.max_uses ?? 12,
        xp: t.trader_exp ?? 0,
        price,
      }];
    }),
  }));
}

fs.writeFileSync('data/trades.json', `${JSON.stringify(out, null, 1)}\n`);
const counts = Object.entries(out).map(([k, v]) => `${k}:${v.reduce((n, t) => n + t.trades.length, 0)}`).join(' ');
console.log(`data/trades.json written — ${counts}`);
if (dropped.size) console.log('dropped (no 1.21 item):', [...dropped].map(([k, v]) => `${k}×${v}`).join(', '));
