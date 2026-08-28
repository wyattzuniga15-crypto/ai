# Cube Roll

A single-file 3D block-rolling puzzle game. No build step, no dependencies, no
network calls — open `CubeRoll.html` in any browser with WebGL2 and play.

Roll the block across floating islands and drop it **standing upright** into the
goal. A block lying down covers two tiles, and which two depends on how you got
there.

## What's in it

- **70 hand-checked islands** across seven chapters. Every one is verified
  solvable by a breadth-first search over the exact rules the game runs, and
  each level's par is its optimal move count.
- **A Daily Challenge and an Endless run** that forge brand-new islands in your
  browser from the same rules engine — proven solvable before you ever see them.
  The daily island is the same one for everybody; the endless run gets harder
  with every island you clear.
- **Eleven kinds of ground**, each with its own rule:

  | Tile | Rule |
  | --- | --- |
  | Floor | Safe in any position |
  | Glass | Shatters if the block stands upright on it |
  | Crumble | One use only — collapses the moment you roll off |
  | Ice | You keep sliding the same way until you leave it |
  | Pin | Holds the block upright, never lying down |
  | Portal | Throws you to its twin when you land upright |
  | Spring | Fires you three tiles on, straight over any gap |
  | Key / Gate | Red gates are thin air until you hold every key |
  | Switches | Round flips a bridge on contact; square needs your full weight |
  | Star / Star pad | Optional pickups; a pad needs you standing upright |

  Some levels also **seal the goal** until every star on the island is claimed.
- **22 missions** — long-running side quests (collect stars, clear levels
  hint-free, never fall, never break glass, ride springs, keep a daily streak,
  survive an endless run) tracked across the whole game.
- **32 skins** in four slots — cubes, tile sets, skies and particle trails —
  unlocked by collecting stars, earning ★★★ ratings and finishing missions.
- **A main menu** with Play, Levels, Challenge, Missions, Skins, Stats, How to
  play and Settings tabs, plus tutorial cards that explain each kind of ground
  the first time you meet it. Progress lives in `localStorage`.

## Controls

Arrows / WASD roll · swipe on touch · `Z` undo · `R` restart · `H` hint ·
`Esc` menu · `L` level select · `M` mute · drag to orbit, scroll to zoom.

## Repository layout

- `CubeRoll.html` — the game. This is the only file you need to play.
- `tools/` — the level pipeline. `rules.js` is the game core, byte-for-byte the
  same code the page runs; `gen.js` and `build_levels*.js` generate and validate
  levels against it; `part_forge.js` is the in-browser generator behind Daily and
  Endless; `build.js` assembles the page; `smoke.js` drives a headless browser
  that auto-solves all 70 levels plus a daily and three endless islands, and
  fails on any console error.

### Rebuilding

```sh
node tools/build_levels.js      # regenerate tools/newlevels.json  (slow)
node tools/build_levels2.js     # regenerate tools/newlevels2.json (slow)
node tools/build.js CubeRoll.html
node tools/smoke.js CubeRoll.html
```
