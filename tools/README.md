# Level pipeline

`rules.js` is the game core — parsing, rolling, tile behaviour, and the two
breadth-first solvers. `build.js` inlines this exact file into `CubeRoll.html`,
so the levels are validated against the same code the browser runs.

- `gen.js` — carves candidate islands from a random roll-walk of the block,
  paints feature tiles onto them, prunes ground the block can never occupy, and
  scores what survives. `growTiles` places ice one tile at a time, keeping only
  positions that leave the level solvable and land on the optimal route — ice is
  fatal wherever it is not deliberate. `sprinkleStars` adds stars off the fastest
  line so collecting them is a real detour.
- `build_levels.js` — drives `gen.js` over the 30 level themes and writes
  `newlevels.json`. Slow (~15 min); each theme falls back through two relaxed
  passes rather than failing.
- `fix_levels.js`, `fix2.js` — targeted repasses for individual levels.
- `build.js` — assembles `part_head.html` + `mini3d.js` + `rules.js` +
  `part_content.js` + levels + `part_game.js` into the single-file game.
- `smoke.js` — headless Chromium run: builds the menu, opens every tab, then
  auto-solves all 50 levels. Exits non-zero on any console error or unsolved
  level.
