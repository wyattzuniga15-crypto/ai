# Cube Roll

A single-file 3D block-rolling puzzle game. No build step, no dependencies, no
network calls — open `CubeRoll.html` in any browser with WebGL2 and play.

Roll the block across floating islands and drop it **standing upright** into the
goal. A block lying down covers two tiles, and which two depends on how you got
there.

## What's in it

- **50 hand-checked levels** across five chapters. Every level is verified
  solvable by a breadth-first search over the exact rules the game runs, and
  each level's par is its optimal move count.
- **Eleven kinds of ground**, each with its own rule:

  | Tile | Rule |
  | --- | --- |
  | Floor | Safe in any position |
  | Glass | Shatters if the block stands upright on it |
  | Crumble | One use only — collapses the moment you roll off |
  | Ice | You keep sliding the same way until you leave it |
  | Pin | Holds the block upright, never lying down |
  | Portal | Throws you to its twin when you land upright |
  | Round switch | Any contact toggles a bridge |
  | Square switch | Toggles a bridge, but only under an upright block |
  | Bridge | Appears / disappears |
  | Star | Optional pickup, any contact |
  | Star pad | A star you must claim standing upright |

  Some levels also **seal the goal** until every star on the island is claimed.
- **16 missions** — long-running side quests (collect stars, clear levels
  hint-free, never fall, never break glass, roll a thousand moves) tracked
  across the whole game.
- **22 skins** in three slots — cubes, tile sets and skies — unlocked by
  collecting stars, earning ★★★ ratings and finishing missions.
- **A main menu** with Play, Levels, Missions, Skins, Stats, How to play and
  Settings tabs. Progress lives in `localStorage`.

## Controls

Arrows / WASD roll · swipe on touch · `Z` undo · `R` restart · `H` hint ·
`Esc` menu · `L` level select · `M` mute · drag to orbit, scroll to zoom.

## Repository layout

- `CubeRoll.html` — the game. This is the only file you need to play.
- `tools/` — the level pipeline. `rules.js` is the game core, byte-for-byte the
  same code the page runs; `gen.js` and `build_levels.js` generate and validate
  levels against it; `build.js` assembles the page; `smoke.js` drives a headless
  browser that auto-solves all 50 levels and fails on any console error.

### Rebuilding

```sh
node tools/build_levels.js      # regenerate tools/newlevels.json (slow, ~15 min)
node tools/build.js CubeRoll.html
node tools/smoke.js CubeRoll.html
```
