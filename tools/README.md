# Level pipeline

`rules.js` is the game core — parsing, rolling, tile behaviour, and the solvers.
`build.js` inlines this exact file into `CubeRoll.html`, so every level is
validated against the same code the browser runs.

## Generating levels

- `gen.js` — carves candidate islands from a random roll-walk of the block,
  paints feature tiles onto them, prunes ground the block can never occupy, and
  scores what survives.
  - `growTiles` places a tile one at a time, keeping only positions that leave
    the island solvable and land on the optimal route. Ice and springs are fatal
    or pointless wherever they are not deliberate, so they go through this.
    `mustFire` tightens the rule further: a spring the block merely rolls across
    lying down is decoration, so the placement is only kept if the optimal
    solution actually *launches* off it.
  - `placeKeys` puts keys down and lets BFS prove the placement — a key behind
    its own gate simply makes the island unsolvable and is rejected.
  - `sprinkleStars` adds stars off the fastest line, so collecting them is a
    real detour rather than free.
- `build_levels.js` → `newlevels.json` (islands 21–50). Slow, ~15 min.
- `build_levels2.js` → `newlevels2.json` (islands 51–70). Slow, ~20 min.
- `fix*.js` — targeted repasses for individual islands: ice that did not survive
  pruning, sealed-goal levels that drifted long, springs that never fired, and
  the finale.

## Assembling and testing

- `part_forge.js` — the in-browser generator behind Daily and Endless. Same
  rules module, so an island is proven solvable and its par is the true optimum
  before the player ever sees it. Roughly 50 ms per island, 300 ms worst case.
- `build.js` — assembles `part_head.html` + `mini3d.js` + `rules.js` +
  `part_forge.js` + `part_content.js` + levels + `part_game.js` into the
  single-file game.
- `smoke.js` — headless Chromium: builds the menu, opens every tab, auto-solves
  all 70 campaign islands, then plays the daily challenge and three endless
  islands. Exits non-zero on any console error or unsolved island.
