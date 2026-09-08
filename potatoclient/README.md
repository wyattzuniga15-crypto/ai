# Potato Client

A client-side performance and utility mod for **Minecraft 1.21.4** (Fabric).

Nine draggable HUD modules, debug rendering that does not need F3, and a single
**Potato Mode** switch that trades visual quality for framerate.

It is built to sit *on top of* Sodium, Lithium and Iris rather than compete with
them. Nothing here touches chunk meshing, terrain rendering or the lighting
engine.

---

## Requirements

| | |
|---|---|
| Minecraft | 1.21.4 |
| Loader | Fabric Loader 0.16.9+ |
| Dependency | Fabric API |
| Java | 21 |
| Side | Client only. Works on any server; nothing is installed server-side. |

Optional: Mod Menu adds a Config button. Sodium, Lithium and Iris are supported
but not required.

## Building

```
./gradlew build
```

The jar lands in `build/libs/`. Set `enable_modmenu=false` in
`gradle.properties` if you cannot reach `maven.terraformersmc.com`; the mod still
builds and runs, you just lose the Mod Menu button.

## Keybinds

All rebindable under Options → Controls → Potato Client.

| Default | Action |
|---|---|
| F9 | Open settings |
| F10 | Open the HUD editor |
| P | Toggle Potato Mode |
| B | Toggle hitboxes |
| G | Toggle chunk borders |
| unbound | Toggle fullbright |
| unbound | Toggle the whole HUD |

## HUD modules

Each module has its own enable switch, position and scale. Drag them in the HUD
editor: left-drag to move, right-click to toggle, scroll to scale, `R` to reset,
`Esc` to close. Dragging snaps to the screen edges, the centre lines and the
edges of the other modules.

Positions are stored as a fraction of the scaled window, so a layout made at
1080p still looks right at 1440p or at a different GUI scale.

- **FPS** — current, rolling average and 1% low. The 1% low is the mean of the
  slowest one percent of frames in the window, the figure benchmarking tools
  report, so one stutter shows up there without moving the average. Colour
  coded: green above 120, yellow 60–120, red below 60, all three configurable.
- **Coordinates** — XYZ, position within the chunk and which chunk, facing with
  the axis it moves along, and the biome id.
- **Ping** — latency to the current server, sampled on an interval because the
  server only republishes it every keep-alive.
- **CPS** — left and right mouse buttons counted separately. Clicks inside a
  screen are not counted.
- **Keystrokes** — WASD, space, sneak and the mouse buttons, with a press
  animation. Labels follow the player's actual bindings, so a rebound layout
  still lights up the right box.
- **Armor** — worn armour and optionally the held item, with durability as a
  count or a percentage, coloured by how much is left.
- **Potion effects** — icons and time remaining, soonest to expire first.
  Infinite effects sort last, so a beacon effect about to lapse is never pushed
  off the top.
- **Reach** — distance to the entity you last hit. Measured from the eyes to the
  nearest point of the target's hitbox at the moment of the attack, which is
  what a server-side reach check measures. Distance to the entity's centre would
  read about half a block longer and would not match.
- **Memory** — heap in use against heap allocated, with an optional bar.

## Rendering and debug

- **Hitboxes** without F3+B. Line thickness, opacity, and a colour per category
  (hostile red, passive green, players blue, items yellow, everything else
  grey). A max-distance slider keeps mob farms from tanking the framerate, plus
  a hard cap on boxes per frame.
  - **Eye line** draws each entity's look vector.
  - **Attack expansion** draws the extra 0.1-block box vanilla actually tests a
    hit against, so you can see the volume a hit needs rather than the model.
- **Chunk borders** on a key, no F3 needed. This drives the vanilla renderer's
  own flag rather than drawing a second grid, so the lines are identical to
  F3+G and cost nothing when off.
- **Block outline** customisation: thickness, colour, and a glow pass — a wider,
  dimmer outline underneath that stays readable against busy terrain.
- **Item and XP orb highlighting**, optionally through walls. Off by default.
- **Fullbright**: a gamma override, not a night-vision effect. The player's own
  gamma is saved when it is switched on and written back when it is switched
  off or when they leave the world.

## Potato Mode

One switch. Turning it on snapshots every per-feature flag and forces them all
on; turning it off restores the snapshot. The renderers only ever read the
per-feature flags, never the master switch, so **every option stays individually
toggleable, including while Potato Mode is on**.

| Option | What it does |
|---|---|
| Disable particles | Refuses particles as they are queued, so their per-tick physics goes too. A cap is available instead of an outright block. |
| Disable weather | Skips the rain and snow geometry and their splash particles and sound. |
| Disable clouds | Cancels the cloud render, including the mesh rebuild when you cross a cloud cell. |
| Remove fog | Flips the game's own `fogEnabled` switch and widens the view distance the fog curve is built from. |
| Disable sky | Sky dome, stars, sun, moon and the End sky. The framebuffer still clears to the fog colour. |
| Disable entity shadows | Skips the shadow pass, which samples the blocks under every entity. |
| Freeze animated textures | Stops water, lava, fire and portals from ticking, which removes their per-tick texture upload. |
| Disable enchantment glint | Returns the plain buffer instead of the second scrolling-texture pass. |
| Decoration distance | Culls item frames, armour stands, paintings and displays past a radius. |
| Block entity distance | Culls chests, signs and banners past a radius. Terrain is untouched. |
| Aggressive entity culling | Frustum culling that also applies to entities asking to be drawn off-screen, plus an optional occlusion test. |

**Occlusion culling** samples the target's centre and its eight corners rather
than one centre ray, so an entity peeking around a corner is not culled.
Results are cached per entity for a few ticks, because a raycast per entity per
frame would cost more than the draw it saves. Entities closer than a
configurable distance are never occlusion-culled, so a melee target never
flickers out.

## Sodium, Lithium and Iris

Nothing here reimplements chunk rendering, terrain meshing or lighting. The
choice of hook was made per feature with Sodium's own patch set in mind:

- Hitboxes and item highlighting run from Fabric's `AFTER_ENTITIES` world render
  event and only append lines to the entity vertex consumer already in flight.
- The block outline uses Fabric's `BLOCK_OUTLINE` event and suppresses the
  vanilla one by returning `false`. Sodium rewrites much of `WorldRenderer`, so
  an `@Overwrite` there would be a hard conflict.
- Entity culling hooks `EntityRenderer#shouldRender`, a per-entity decision
  Sodium leaves alone. The injection only ever returns `false`, so it composes
  with any other mod that also wants to skip an entity.
- Every mixin is an `@Inject` or an accessor. There is no `@Overwrite` and no
  mixin into chunk building, lighting or the terrain pipeline.

Iris is unaffected: fog, sky and cloud handling cancel vanilla passes rather
than replacing shaders or touching the shader pipeline.

## Configuration file

`config/potatoclient.json`, written atomically so a crash mid-write cannot
truncate a good config. Every option in the UI is there, plus exact ARGB
integers for colours the palette picker does not offer. A hand-edited file with
missing sections is repaired on load; a broken one is kept as `.bak` and
defaults are used.

## Known behaviour

- **Freezing animated textures mid-session** freezes each sprite where it is,
  not at frame 0, until the next resource reload (F3+T). With the option already
  on at launch, sprites never leave the frame the atlas was built with, which is
  frame 0.
- **Fullbright saves the gamma value it finds** the first time it engages. If you
  change the brightness slider while it is on, that change is what gets restored.
- **The HUD editor opened from the main menu** shows placeholder content for the
  modules that read live world state, so they can still be positioned.

## Licence

MIT. See `LICENSE`.
