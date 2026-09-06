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

22. **Block simulation runs on the main thread** (`src/world/simulation.ts`): scheduled ticks in a
    binary heap, vanilla random ticks (3 per section per tick within a 6-chunk simulation distance)
    and neighbour updates, dispatched to `src/blocks/behaviors.ts`. The worker only lights and
    meshes; edits are batched per tick into one message.

23. **Fluids follow the vanilla level rules** (amount 8 source, drop-off 1 for water and 2 for
    lava, falling columns, slope search up to 4 blocks, infinite water from two sources, lava +
    water interactions) but render as still surfaces with the level-based height; per-corner
    heights and flow-direction texture rotation are still to do.

24. **Input edges are latched per simulation tick as well as per frame.** Rendering runs faster
    than the 20 TPS simulation, so frame-cleared key/mouse edges could be missed by the tick; a
    second set (`tickPressed`, `tickClicked`) fixes that.

25. **Sleeping skips to morning after a two-second delay** without the vanilla monster check
    (there are no mobs yet) and without the wake-up animation.

26. **Bed placement uses the vanilla `part`/`facing`/`occupied` states** with the head one block
    further along the player's facing; sitting in it is not simulated.

27. **Mobs use the vanilla entity textures on re-created classic box models.** The owner relaxed
    the art rule to "use the real textures"; entity textures only make sense on the box models
    they were painted for, so `src/entities/mobTypes.ts` re-creates the classic biped, quadruped,
    creeper, spider and chicken part layouts from public knowledge of the model format. This goes
    beyond the original "original mob designs" brief item; if that is not wanted, the model
    definitions are the only thing to swap. The 1.21.5+ cow and pig textures are 64x64 but keep
    the classic net in their top half, so the classic layouts map onto them.

28. **Mob movement uses `speed_attribute^2 * 2.2` blocks/tick of acceleration**, which reproduces
    vanilla's input-vector scaling (a zombie moves about 2.3 m/s, a spider about 4 m/s). Pathing is
    straight-line steering with auto-jump; A* comes later.

29. **XP from kills and furnaces is awarded directly** instead of spawning XP orb entities for now.

30. **The world generator dressed fake surfaces under ore and dirt blobs** (grass blocks inside the
    ground), which random ticks then converted to dirt hundreds of times a second. Surfaces are now
    only stone runs directly under air or water.

31. **All sound is synthesized in code** (`src/audio/audio.ts`, Web Audio noise bursts and
    oscillators) as the brief asked; the texture exception the owner granted does not cover
    Mojang's sound files. Sounds are spatialised by simple distance falloff (16 blocks).

32. **Falling-block entities are not saved**; they land within a second, and a save in that
    window loses at most the block. Dropped items are saved with their chunk.

33. **Enchanting options are generated from a per-table seed with a small xorshift generator** so
    the preview and the applied result agree exactly, mirroring vanilla's seeded `EnchantmentMenu`.
    The obfuscated glyph text on the buttons is decorative; the tooltip reveals one enchantment
    like vanilla.

34. **Sign boards and posts are entity meshes** (the vanilla sign block models have no elements),
    rendered with the box-model builder on the real `entity/signs/*.png` textures, with the text
    on a canvas plane. Hanging signs are not placeable yet.

35. **Armor trims are stored on the stack as `{ pattern, material }` registry ids** (`bolt`,
    `lapis`), generated into `data/trims.json` from the data pack's `trim_pattern` and
    `trim_material` folders with the vanilla names and material colours. Vanilla maps ingredient
    items to materials through the `provides_trim_material` item component, which minecraft-data
    does not expose, so that eleven-entry table is hand-encoded in `tools/gen-data.ts`. Trimmed
    armor still uses the plain item icon; the tooltip shows the vanilla "Upgrade:" lines in the
    material colour.

36. **Every workstation screen hands its own slots back on close** (`returnSlots`), like vanilla's
    `removed()`; leftovers that do not fit are dropped at the player's feet. The anvil and
    grindstone screens were missing this and silently lost their inputs.

37. **Standing signs carry separate front and back text** like vanilla's `front_text`/`back_text`;
    right-clicking edits the side the player stands on (`SignBlock.isFacingFrontText`). A blank
    back draws no text plane. Glowing/dyed text is stored (`color`) but not yet editable in-game.
