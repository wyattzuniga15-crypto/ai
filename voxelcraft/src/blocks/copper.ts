/**
 * Vanilla's weathering copper: the four ages every copper block passes through, the random tick
 * that carries one age to the next, and the axe and honeycomb that undo it.
 *
 * The families are read off the registry rather than listed here, so a block only has to exist in
 * data/blocks.json as `exposed_x`/`weathered_x`/`oxidized_x` (plus the `waxed_` copies) to weather.
 */
import { blocks } from './registry.ts';
import type { BlockContext } from './behaviors.ts';

/** WeatheringCopper.getChanceModifier: the odds a random tick carries a copper block on one age. */
export const WEATHER_CHANCE = 0.05688889;

/** How far vanilla looks for neighbours that speed the weathering up or hold it back. */
export const WEATHER_RANGE = 4;

/** Age names in vanilla's order, which is also the order the ids are built from. */
export const COPPER_AGES = ['unaffected', 'exposed', 'weathered', 'oxidized'] as const;

interface Family {
  /** The four unwaxed ids, oldest last. */
  stages: string[];
  /** The four waxed ids, in the same order. */
  waxed: string[];
}

let families: Family[] | null = null;
/** id -> [family, age, waxed]. */
let index: Map<string, [Family, number, boolean]> | null = null;

/** Builds the weathering tables from the block registry the first time anything asks. */
function build(): Map<string, [Family, number, boolean]> {
  if (index) return index;
  const found: Family[] = [];
  const map = new Map<string, [Family, number, boolean]>();
  for (const def of blocks.defs) {
    if (!def.id.startsWith('exposed_')) continue;
    const tail = def.id.slice('exposed_'.length);
    // the plain block of the copper family is `copper_block`, not `copper`; every other family
    // names its first age after itself
    const base = tail === 'copper' ? 'copper_block' : tail;
    const stages = [base, `exposed_${tail}`, `weathered_${tail}`, `oxidized_${tail}`];
    const waxed = stages.map((s) => `waxed_${s}`);
    if (!stages.every((s) => blocks.has(s)) || !waxed.every((s) => blocks.has(s))) continue;
    const family: Family = { stages, waxed };
    found.push(family);
    for (let age = 0; age < 4; age++) {
      map.set(stages[age], [family, age, false]);
      map.set(waxed[age], [family, age, true]);
    }
  }
  families = found;
  return (index = map);
}

/** Every weathering family found in the registry, for tests and tooling. */
export function copperFamilies(): { stages: string[]; waxed: string[] }[] {
  build();
  return families ?? [];
}

/** How far along the four ages a copper block is, or -1 when it is not copper at all. */
export function copperAge(id: string): number {
  return build().get(id)?.[1] ?? -1;
}

/** The first age of the family a copper block belongs to (`copper_block`, `cut_copper`, ...). */
export function copperBase(id: string): string | null {
  return build().get(id)?.[0].stages[0] ?? null;
}

export function isWaxedCopper(id: string): boolean {
  return build().get(id)?.[2] === true;
}

/** Whether this block weathers on its own: copper that has an older age to go to and no wax. */
export function weathers(id: string): boolean {
  const e = build().get(id);
  return !!e && !e[2] && e[1] < 3;
}

/** The next age up, or null when the block is oxidized, waxed or not copper. */
export function nextCopper(id: string): string | null {
  const e = build().get(id);
  return e && !e[2] && e[1] < 3 ? e[0].stages[e[1] + 1] : null;
}

/** What an axe leaves behind: wax comes off first, then one age of oxidation. */
export function scrapeCopper(id: string): string | null {
  const e = build().get(id);
  if (!e) return null;
  const [family, age, waxed] = e;
  if (waxed) return family.stages[age];
  return age > 0 ? family.stages[age - 1] : null;
}

/** What a honeycomb leaves behind, or null when the block is already waxed or is not copper. */
export function waxCopper(id: string): string | null {
  const e = build().get(id);
  return e && !e[2] ? e[0].waxed[e[1]] : null;
}

/** Moves a block to another id, keeping the state properties (facing, waterlogged, half...). */
export function retainingState(state: number, id: string): number {
  return blocks.stateWith(id, blocks.props(state));
}

/**
 * Vanilla's ChangeOverTimeBlock.changeOverTime. Copper takes its cue from the copper around it: a
 * single younger block within four (by Manhattan distance) stops it weathering altogether, while
 * older ones make it more likely, and the odds are squared before the 1-in-18 base chance applies.
 */
export function weatherTick(ctx: BlockContext): void {
  const next = nextCopper(ctx.def.id);
  if (next === null) return;
  const age = copperAge(ctx.def.id);
  let same = 0;
  let older = 0;
  const r = WEATHER_RANGE;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r + Math.abs(dx); dy <= r - Math.abs(dx); dy++) {
      const rest = r - Math.abs(dx) - Math.abs(dy);
      for (let dz = -rest; dz <= rest; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        // waxed copper is not a weathering block in vanilla, so it neither helps nor hinders
        const entry = build().get(blocks.idOf(ctx.w.getBlock(ctx.x + dx, ctx.y + dy, ctx.z + dz)));
        if (!entry || entry[2]) continue;
        const other = entry[1];
        if (other < age) return; // a younger neighbour holds the whole group back
        if (other > age) older++;
        else same++;
      }
    }
  }
  const share = (older + 1) / (older + same + 1);
  if (ctx.w.rng.next() < share * share * WEATHER_CHANCE) {
    ctx.w.setBlock(ctx.x, ctx.y, ctx.z, retainingState(ctx.state, next));
  }
}
