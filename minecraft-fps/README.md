# Minecraft FPS

How to push Minecraft: Java Edition (1.21.4, Fabric) as high as your PC allows,
plus a script that does the Windows and settings parts for you.

## Can you hit 2000 FPS?

Probably, but it depends on your CPU more than anything else. Minecraft's
framerate is limited by one CPU core, so the processor matters more than the
graphics card.

| Setup | Rough FPS with everything below |
| --- | --- |
| Recent high-end CPU (Ryzen X3D, Core i7/i9 13th gen or newer) | 1000–3000+ at render distance 2–4 |
| Mid-range desktop | 400–1000 |
| Laptop / older PC | 150–500 |

Vanilla rarely goes past a few hundred FPS. **Sodium is what gets you into the
thousands.** Your monitor still only shows its refresh rate (144, 240…), so
past that the gain is slightly lower input lag, not smoother motion.

## The files

| Double-click | What it does |
| --- | --- |
| `check-my-pc.cmd` | Report on what is holding your FPS back. Changes nothing |
| `optimize-minecraft.cmd` | Applies the fixes it can (close Minecraft first) |
| `undo-minecraft-tweaks.cmd` | Puts your original settings back |

All three run `optimize-minecraft.ps1`. Keep the files in the same folder.

## 0. Check your PC

Double-click **`check-my-pc.cmd`**. It's safe to run any time, even with the
game open. It marks each item `[ OK ]`, `[INFO]` or `[FIX ]`, then lists every
fix in a summary at the end:

- **Memory:** total RAM, one stick vs two (single-channel is slower), and
  whether the RAM runs below its rated speed (XMP/EXPO off). Also how much
  memory to give Minecraft.
- **Graphics:** whether the monitor is plugged into the motherboard instead
  of the graphics card, a missing or year-old driver, the monitor's refresh
  rate, and whether Java is set to use the graphics card.
- **Power:** laptop on battery, Power saver plan.
- **Windows:** Game Mode, Xbox background recording, and the programs using
  the most memory.
- **Every Minecraft instance:**
  - VSync, FPS cap, Fabulous graphics and render distance;
  - whether Sodium and the other performance mods are installed;
  - OptiFine, Distant Horizons, Physics Mod, Bobby, map mods, 3D Skin Layers,
    Not Enough Animations and EMF/ETF;
  - Iris shaders being on, and 64x-or-larger resource packs.

It can't read temperatures. Use the free app HWiNFO for those.

## 1. Run the optimizer (2 minutes)

Close Minecraft, then double-click **`optimize-minecraft.cmd`**. Or in
PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1
```

It changes four things, all for your Windows user only. It needs no admin
rights and installs nothing:

1. **options.txt**: VSync off, FPS unlimited, Fast graphics, render distance 4,
   simulation distance 5, no clouds, minimal particles, smooth lighting, entity
   shadows, biome blend and mipmaps off, fullscreen on. It does this for the
   official launcher and every Modrinth App, Prism Launcher and CurseForge
   instance it finds, saving a backup as `options.txt.bak-<date>` beside each.
2. **GPU**: tells Windows to run Minecraft's Java on the high-performance GPU.
   This matters on gaming laptops, which otherwise often run games on the weak
   built-in chip.
3. **Game Mode** on, **Xbox background recording** off.
4. **Power plan**: High performance.

Options:

```powershell
.\optimize-minecraft.ps1 -RenderDistance 2     # absolute max FPS
.\optimize-minecraft.ps1 -RenderDistance 8     # nicer view, fewer FPS
.\optimize-minecraft.ps1 -SkipWindowsTweaks    # only touch options.txt
.\optimize-minecraft.ps1 -GameDir "C:\path\to\instance"   # only this one instance
```

**Undo:** double-click **`undo-minecraft-tweaks.cmd`** (or run with
`-Restore`). It puts every options.txt back the way it was before the first
run and switches to the Balanced power plan. Running it twice is safe.

## 2. Install the performance mods (biggest gain)

**Easiest way:** install the [Modrinth App](https://modrinth.com/app) or
[Prism Launcher](https://prismlauncher.org/), then install the
**Fabulously Optimized** modpack. It bundles everything below, already
configured.

**Manual way:** install [Fabric](https://fabricmc.net/use/installer/) for
1.21.4, then drop these into `%APPDATA%\.minecraft\mods` (all on
[Modrinth](https://modrinth.com/mods), pick the 1.21.4 Fabric file of each):

| Mod | What it does |
| --- | --- |
| **Sodium** | Replaces the renderer. This one gives the 2–5× FPS gain |
| **Lithium** | Faster game logic (helps in singleplayer) |
| **FerriteCore** | Uses less memory, so fewer garbage-collection stutters |
| **ImmediatelyFast** | Faster drawing of the HUD, text and entities |
| **Entity Culling** | Skips drawing mobs and chests you can't see |
| **More Culling** | Skips drawing hidden block faces, leaves and item frames |
| **ModernFix** | Faster startup, less memory |
| **Fabric API** | Required by most of the above |

**Potato Client** (your mod on the `claude/minecraft-perf-utility-client-*`
branch) works on top of these. Press **P** for Potato Mode.

**Turn shaders off** if you use Iris. A shader pack can easily cost 80–90% of
your FPS.

## 3. Sodium settings

In **Options → Video Settings** (Sodium's screen):

- **General**: Render Distance 2–4, VSync **Off**, Max Framerate **Unlimited**,
  View Bobbing off.
- **Quality**: Graphics **Fast**, Clouds **Off**, Weather **Fast**, Leaves
  **Fast**, Particles **Minimal**, Smooth Lighting **Off**, Biome Blend **Off**,
  Entity Shadows **Off**, Mipmap Levels **0**.
- **Performance**: turn on every culling option (Block Face Culling, Fog
  Occlusion, Entity Culling). Set Chunk Update Threads to **Default**.

## 4. Java memory

| RAM in your PC | Give Minecraft |
| --- | --- |
| 8 GB | 3 GB (3072 MB) |
| 16 GB | 4–6 GB (4096–6144 MB) |
| 32 GB or more | 6–8 GB (6144–8192 MB) |

- **Modrinth App:** the instance → **⋯ → Edit instance → Java and memory →
  Custom memory allocation**.
- **Prism Launcher:** **Settings → Java → Maximum memory allocation**.
- **Minecraft Launcher:** **Installations → (your 1.21.4 Fabric profile) →
  ⋯ → Edit → More Options → JVM Arguments**. Change `-Xmx2G` at the start to
  `-Xmx4G` and leave the rest alone.

More memory doesn't add FPS, and past about 8 GB it can cause stutter. In F3,
**Mem** climbing and then dropping is normal. Only raise it if Mem sits at
90–100% and the game freezes.

## 5. Graphics driver settings

**NVIDIA** (NVIDIA Control Panel → Manage 3D settings → Program Settings →
add `javaw.exe`; the script prints its path):

- Power management mode: **Prefer maximum performance**
- Vertical sync: **Off**

**AMD** (Adrenalin → Gaming → Minecraft or javaw):

- Radeon Chill: **Off**
- Frame Rate Target Control: **Off**
- Enhanced Sync / Wait for Vertical Refresh: **Off**

Update the graphics driver too. It's free FPS.

## 6. Everything else

- **Laptop:** plug it in. On battery the CPU and GPU run much slower.
- Close Chrome tabs playing video, Discord's in-game overlay, and RGB/fan
  control software while you play.
- Play in **fullscreen**, not windowed.
- Reading FPS: press **F3**; it's the number at the top left. The F3 screen
  itself costs a little FPS, so Potato Client's FPS HUD is a better gauge.
- Looking at the sky or into a wall shows the highest numbers. A busy base with
  lots of chests, item frames and mobs shows the lowest.
