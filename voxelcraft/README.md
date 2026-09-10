# Voxelcraft

A single-player voxel survival game for the browser modelled on Minecraft Java 1.21.11: the same
block and item rosters, block-state ids, recipes, loot tables, break times, movement constants and
day length. Private, non-commercial project. Built with Vite, vanilla TypeScript and Three.js.

## Play it

```sh
cd voxelcraft
npm install
npm start
```

That is the whole thing. `npm start` fetches whatever is missing the first time — the 1.21.11
textures, models and data pack, then the structure templates — and opens the game in your browser.
Later runs skip straight to the server. It takes about a minute the first time and a second after
that.

For a window of its own, with no browser around it:

```sh
npm run app
```

That builds the game and opens it in a desktop window — no tabs, no address bar, straight into the
title screen, F11 for full screen. It is Electron under the skin, which `npm install` fetches.

`npm run pack` builds the folder to hand somebody who has none of this: the game, a launcher for
each platform, and the sounds it can actually reach, zipped up beside the repo.

```sh
npm start -- --sounds   # with the music and the long sounds as well (a bigger download, once)
npm start -- --build    # build the static site and serve that instead
npm start -- --force    # re-fetch everything
```

The pieces underneath, if you would rather drive them yourself:

```sh
npm run assets     # fetches the 1.21.11 textures, models and data pack (once; ~20 s)
npm run structures # converts Mojang's structure templates into public/structures/
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ – host it anywhere
```

`npm run assets` downloads the Minecraft client jar from Mojang's public launcher CDN, or falls back
to the InventivetalentDev GitHub mirror of the same files, and unpacks what the game needs into
gitignored folders (`assets/`, `public/atlas`, `public/textures`, `public/texts`, `public/models.json`,
`public/sounds.json`). Nothing Mojang-owned is committed. It also builds the block/item texture atlases.
Re-run with `-- --force` to refresh, or `-- --source=mirror` to skip the official CDN.

The sound files are not in the client jar — they come off Mojang's asset CDN — so they are opt-in:
`npm run assets -- --sounds` fills `public/sounds/` (gitignored too) with the 3,627 effect files, and
`--music` adds the music and the records on top. Mojang's CDN is not reachable from every network, so
the fetch takes them off the same GitHub mirror the textures come from unless `--source=official`
says otherwise. Without them the game falls back to the synthesized voices it has always had.

`npm run structures` converts Mojang's structure templates from the fetched client into
`public/structures/` (gitignored, like the textures); without it the world simply generates no
structures.

`npm run data` regenerates the committed `data/` files (blocks, items, recipes, loot, tags, mobs,
biomes, enchantments, effects, collision shapes) from the fetched sources. Two smaller tools cover
what Java keeps in code rather than in the assets: `npm run trades` turns Mojang's published trade
tables into `data/trades.json`, and `npm run geo` converts a published entity geometry file into the
box model format `src/entities/boxModel.ts` uses.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look (click the game to capture the mouse) |
| W A S D | Move |
| Space | Jump · double-tap in Creative to fly · hold to charge a horse's jump |
| Shift | Sneak (you will not walk off edges) · dismount a horse |
| Ctrl or double-tap W | Sprint |
| Left mouse | Mine (hold) · attack mobs |
| Right mouse | Place / use (hold to eat, doors, buttons, beds at night, buckets, bone meal) |
| Middle mouse | Pick block (Creative) |
| 1–9, mouse wheel | Select hotbar slot |
| Q | Drop item (Ctrl+Q whole stack) |
| F | Swap with off-hand |
| E | Inventory (2x2 crafting) · right-click a crafting table, furnace or chest to open it · the mount's inventory while riding |
| T | Chat · `/` opens a command |
| F3 | Debug overlay |
| F5 | Toggle third person |
| Esc | Pause menu |

Commands: `/gamemode <survival|creative|spectator>`, `/time set <day|noon|night|midnight|n>`,
`/tp x y z`, `/give <item> [count]`, `/clear`, `/seed`, `/kill`, `/heal`, `/setblock x y z <block>`,
`/xp n`, `/effect give @s <effect> [seconds] [amplifier]`, `/summon <mob>`, `/butcher`, `/spawnpoint`, `/help`.

## Tests

```sh
npm test           # vitest: worldgen determinism, model baking of every block state, data integrity
npm run test:e2e   # builds, then Playwright: load a world, break and place a block, run a command, craft planks
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
