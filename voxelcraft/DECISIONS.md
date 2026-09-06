# Decisions

Logged as they are made, most recent last. Each entry says what was chosen and why.

1. **Project lives in `voxelcraft/` inside the `ai` repository.** The repository already hosts
   other single-file games at its root (Cube Roll, Minebreak, ...), so the Vite project gets its own
   folder rather than mixing `src/`, `data/` and `tools/` into the root.

2. **Real Minecraft textures are used, but fetched, never committed.** The owner relaxed the
   original "all art is original" rule and asked for the real 1.21.11 textures. The GitHub
   repository is *public*, so committing Mojang's PNGs would redistribute them. Instead
   `npm run assets` downloads the client jar from Mojang's public launcher CDN (or, when that is
   unreachable, the InventivetalentDev GitHub mirror of the same files) into gitignored folders
   (`.cache/`, `assets/`, `public/atlas`, `public/textures`, `public/models.json`). The game reads
   them resource-pack style from `assets/textures/block/<id>.png`. If the repo ever becomes private
   and the owner wants them committed, removing the `.gitignore` lines is all it takes. The sandbox
   this was built in could only reach the mirror, so the official-CDN path was written carefully
   but not exercised end to end.

3. **Vanilla block models and blockstates are used for rendering.** With real textures allowed,
   using the matching model JSON means every one of the 1166 blocks (stairs, fences, doors, crops,
   torches, ...) renders correctly with zero bespoke code. They travel with the textures (fetched,
   gitignored, merged into `public/models.json`).

4. **Game data comes from the vanilla data pack plus PrismarineJS minecraft-data.** The Minecraft
   Wiki was unreachable from the build sandbox, but the data pack inside the client jar (recipes of
   every type, loot tables, tags, enchantment definitions, biome definitions) and minecraft-data
   1.21.11 (hardness, blast resistance, harvest tiers, entity sizes, biomes) are the same facts in
   machine-readable form. `tools/gen-data.ts` normalises them into the `data/` files that are
   committed. Hand-written tables cover what neither source has: tool/armor stats, food values,
   mob stats, and the generator's per-biome surface configuration.

5. **minecraft-data's foods.json has wrong saturation values for 1.21.11**, so foods are a
   hand-written table (nutrition and saturation modifier per the wiki).

6. **Copper tools/armor (1.21.9+) stats are best-effort**: mining level = stone, speed 5,
   durability 190 (durability confirmed by minecraft-data), sword damage 5, armor 2/4/3/1.
   Re-verify against the wiki when it is reachable.

7. **Block-state ids match vanilla numerically.** Chunks store 16-bit global state ids using the
   same property ordering as the game (last property varies fastest), so blockstate variant keys
   from the model files apply directly.

8. **One world worker owns generation, lighting and meshing.** Keeping the authoritative chunk
   data in one place makes cross-chunk lighting and decoration simple. The main thread keeps block
   copies for physics and raycasts. A generation worker pool is a later optimisation.

9. **Chunk geometry is merged per column (one draw call per column per layer)** rather than one
   mesh per 16^3 section, to keep draw calls near 2 x (2rd+1)^2. Sections are still meshed
   independently in the worker so an edit only rebuilds one section.

10. **Atlas mipmaps are limited to 5 levels (16 px -> 1 px per tile)** with `TEXTURE_MAX_LEVEL`
    set directly on the WebGL texture, mirroring vanilla, so distant terrain does not shimmer and
    tiles never bleed into each other.

11. **Lighting uses the vanilla curve** `b = l/(4-3l)` per channel with a warm tint where block
    light dominates and a "Brightness" option that lifts the dark end, instead of the lightmap
    texture.

12. **Biome grass/foliage colours are sampled from the vanilla colormaps** using each biome's
    temperature and downfall from the data pack, with the dark forest and swamp modifiers.
    Colour blending across biome borders is not done yet.

13. **Fluids render as still source blocks** (8/9 height, flow texture on the sides). Flowing
    water/lava levels come with the fluid simulation in Phase 2.

14. **Sky light is seeded from a per-column light heightmap** and propagated by BFS across chunk
    borders; block placement/removal uses the standard remove-then-re-add flood fill.

15. **Dropped items render as billboard sprites of their inventory icon** (blocks and items alike).
    Vanilla renders block drops as small 3D cubes; this can be upgraded when the entity renderer
    exists.

16. **Fonts are system sans-serif with pixel shadows.** The bitmap font PNGs were not adopted for
    the HTML GUI because the layout uses ordinary text; readability matters more than the exact
    glyphs.

17. **The title splash is "Voxels ahoy!"** – nothing from Mojang's splash list.

18. **GUI screens are one generic slot engine plus per-screen layouts** (`src/ui/screens/`), with the
    vanilla slot coordinates from the container textures. Shift-click routing follows vanilla
    (`quickMove`), including the reversed hotbar-first fill when taking from containers.

19. **Block entities live on the main thread** (`LoadedChunk.entities`, keyed by world position)
    and are saved as JSON inside the chunk record. The worker never needs them.

20. **Shulker boxes spill their contents when broken** for now; keeping contents inside the item
    needs item components, which come with the anvil/enchanting work.

21. **The furnace lighting tick does not consume fuel time**, matching vanilla (`litTime` is
    decremented only when the furnace was already lit at the start of the tick).
