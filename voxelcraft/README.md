# Voxelcraft

A single-player voxel survival game for the browser modelled on Minecraft Java 1.21.11: the same
block and item rosters, block-state ids, recipes, loot tables, break times, movement constants and
day length. Private, non-commercial project. Built with Vite, vanilla TypeScript and Three.js.

## Run it

```sh
cd voxelcraft
npm install
npm run assets     # fetches the 1.21.11 textures, models and data pack (once; ~20 s)
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ – host it anywhere
```

`npm run assets` downloads the Minecraft client jar from Mojang's public launcher CDN, or falls back
to the InventivetalentDev GitHub mirror of the same files, and unpacks what the game needs into
gitignored folders (`assets/`, `public/atlas`, `public/textures`, `public/models.json`). Nothing
Mojang-owned is committed. It also builds the block/item texture atlases. Re-run with
`-- --force` to refresh, or `-- --source=mirror` to skip the official CDN.

`npm run data` regenerates the committed `data/` files (blocks, items, recipes, loot, tags, mobs,
biomes, enchantments, effects, collision shapes) from the fetched sources.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look (click the game to capture the mouse) |
| W A S D | Move |
| Space | Jump · double-tap in Creative to fly |
| Shift | Sneak (you will not walk off edges) |
| Ctrl or double-tap W | Sprint |
| Left mouse | Mine (hold) |
| Right mouse | Place / use |
| Middle mouse | Pick block (Creative) |
| 1–9, mouse wheel | Select hotbar slot |
| Q | Drop item (Ctrl+Q whole stack) |
| F | Swap with off-hand |
| E | Inventory (next up on the checklist) |
| T | Chat · `/` opens a command |
| F3 | Debug overlay |
| F5 | Toggle third person |
| Esc | Pause menu |

Commands: `/gamemode <survival|creative|spectator>`, `/time set <day|noon|night|midnight|n>`,
`/tp x y z`, `/give <item> [count]`, `/clear`, `/seed`, `/kill`, `/heal`, `/setblock x y z <block>`,
`/xp n`, `/spawnpoint`, `/help`.

## Tests

```sh
npm test           # vitest: worldgen determinism, model baking of every block state, data integrity
npm run test:e2e   # builds, then Playwright: load a world, break and place a block, run a command
npm run typecheck
```

## Layout

```
src/
  core/      game loop, input, save/load (IndexedDB + zip export), Game orchestration, constants
  world/     chunk storage, world generator (gen/), light engine, model baker, mesher, world worker
  blocks/    block registry (vanilla state ids), collision shapes, mining formulas
  items/     item registry, inventory, loot-table evaluator
  entities/  player physics, dropped items
  render/    atlas loader, chunk shader, sky, renderer
  ui/        HUD, menus, chat, item icons, styles
data/        generated 1.21.11 game data (committed)
tools/       asset fetcher, atlas/model builders, data generator
tests/       vitest
e2e/         Playwright smoke test
```

See `CHECKLIST.md` for what is done and what is next, `DECISIONS.md` for the reasoning behind
non-obvious choices and `COVERAGE.md` for how much of the game is implemented.
