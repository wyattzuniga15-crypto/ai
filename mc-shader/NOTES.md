# Custom — Iris shaderpack build notes

Target: **Iris 1.10.x / Minecraft 1.21.11 (Fabric) / Sodium 0.8.x**

---

## Environment

**This pack was authored in a remote container with no Minecraft install.**
`~/.minecraft/` did not exist and no Iris/Sodium jars were present anywhere on
the filesystem, so the installed-jar versions could not be read. See
"Verify before you launch" below for the check to run locally.

What was verified from primary sources rather than assumed:

| Thing | Source | Result |
|---|---|---|
| Iris 1.10.7 targets MC 1.21.11 | Iris issue tracker (#3208, #3225, #3260) | confirmed |
| Sodium 0.8.13 breaks Iris ≤1.10.7 | same | confirmed — Sodium declares a hard `breaks` on Iris ≤1.10.7 |
| Fix | same | use a Sodium 0.8.x **below** 0.8.13, or an Iris newer than 1.10.7 |
| Shader stages / program names | `IrisShaders/docs` repo (cloned) | see below |
| Uniform names and types | same, `Reference/Uniforms/*` | all uniforms used here are on that list |
| GLSL profile | same, `How To/compatibility_vs_core.mdx` | docs say **use `compatibility`**, not `core` |

The docs site (`shaders.properties`) is egress-blocked from this container, so
the docs were read from the source repo `github.com/IrisShaders/docs`
(`src/content/docs/current/`), which is what that site is built from.

### GLSL version

**`#version 330 compatibility` in every stage, no exceptions.**

The Iris docs recommend the compatibility profile explicitly: on 1.17+ Iris
patches the pack to core internally either way, the core vertex attribute names
are not stable across Minecraft versions (`chunkOffset` → `modelOffset` in
1.21.2, with only the old name still supported by Iris), and the Iris patcher is
much better tested on compatibility-profile input.

So this pack uses the legacy built-ins — `gl_Vertex`, `gl_ModelViewMatrix`,
`gl_Color`, `gl_Normal`, `gl_MultiTexCoord0/1`, `gl_TextureMatrix[]` — and
modern `layout(location = N) out vec4` for fragment outputs. glslangValidator
accepts that mixture, and so does Iris.

**Consequence worth remembering:** because fragment outputs use the `out`
syntax rather than `gl_FragData`, Iris does **not** apply the alpha test for us.
Every cutout program has to do `if (color.a < alphaTestRef) discard;` by hand.
Translucent programs (`gbuffers_water`) must *not* — blending needs that alpha.

---

## Layout

```
~/mc-shader/
├── check.sh            # validates every stage; run after every edit
├── install.sh          # links the pack into .minecraft/shaderpacks/Custom
├── NOTES.md
└── Custom/             # <- this folder IS the shaderpack
    └── shaders/
        ├── shaders.properties
        ├── lib/        # shared includes (not standalone translation units)
        └── *.vsh/*.fsh
```

Iris loads shaderpacks from plain folders, so `Custom/` is symlinked (or copied)
into `.minecraft/shaderpacks/` and reloaded in-game with no rezipping.

---

## Buffer layout

Formats are set explicitly in `shaders.properties`. Anything holding HDR colour
or a normal is float — the RGBA8 default would clamp to 1.0 and destroy both
bloom and auto-exposure.

| Buffer | Format | Holds |
|---|---|---|
| `colortex0` | RGBA16F | HDR scene colour. Cleared to `fogColor` by Iris. |

*(rows are added as later steps land)*

**Gotcha from the docs:** `colortex0`–`colortex3` **cannot be read** from a
gbuffers program — sampling them there silently returns the texture atlas
instead. Any gbuffer→gbuffer communication has to go through `colortex4`+.

---

## Passes

| Pass | Does |
|---|---|
| `gbuffers_*` | Writes scene colour to `colortex0`. |
| `final` | Copies `colortex0` to the backbuffer. |

### Step 1 — pass-through skeleton ✅

Deliberately vanilla-identical. Vanilla's own `lightmap` texture, vanilla's own
fog parameters, straight copy in `final`. If the game looks unchanged with the
pack on, step 1 passed.

Programs: `gbuffers_basic`, `gbuffers_textured`, `gbuffers_textured_lit`,
`gbuffers_terrain`, `gbuffers_entities`, `gbuffers_hand`, `gbuffers_water`,
`gbuffers_skybasic`, `gbuffers_skytextured`, `gbuffers_clouds`, `final`.

Per-program decisions that are *not* arbitrary:

- **`gbuffers_skybasic` / `gbuffers_skytextured` get no fog.** Vanilla already
  tints the sky dome toward `fogColor` at the horizon; applying distance fog on
  top collapses the whole dome to one flat colour.
- **`gbuffers_clouds` does get fog** — vanilla fogs clouds.
- **`gbuffers_water` does no alpha test** — it is the translucent program, and
  discarding on alpha would punch holes in water instead of blending it.
- **`gbuffers_entities` applies `entityColor`** — the red hurt flash and creeper
  charge overlay. Miss this and mobs stop flashing when hit.

Fog reproduces vanilla by *using vanilla's parameters* (`fogStart`, `fogEnd`,
`fogMode`, `fogShape`, `fogDensity`, `fogColor`) rather than inventing a curve.
`fogShape == 1` is cylindrical — `max(length(xz), abs(y))` — which is what
vanilla uses near the height limits so the sky doesn't fog out overhead.

---

## check.sh

Runs `glslangValidator` over every `.vsh`/`.fsh`/`.gsh`/`.csh`/`.tcs`/`.tes`
with the right `-S` stage flag. Exit code 0 only if everything compiles.

Two things it has to do that aren't obvious:

1. **It flattens `#include` itself.** glslangValidator refuses `#include` unless
   `GL_GOOGLE_include_directive` is requested — and that extension line would be
   wrong to ship, since Iris resolves includes on its own before the driver ever
   sees the source. So `check.sh` implements Iris's include rules directly:
   `"/lib/x.glsl"` resolves from the `shaders/` root, `"x.glsl"` from the
   including file's directory. Circular and missing includes fail loudly.

2. **It maps errors back to real file:line.** After flattening, glslang's line
   numbers refer to the concatenated source, which is useless for editing. A
   sidecar line map translates `ERROR: 0:222:` into
   `ERROR: lib/fog.glsl:21:`. Verified accurate for errors in both top-level
   programs and included libs.

`lib/settings.glsl` is included by everything. Iris requires an option macro to
be defined *identically* in every file that uses it — one shared file is the
only way to guarantee that as the option list grows.

---

## Verify before you launch

The jar versions could not be checked from the build container. Run this on the
machine that actually runs the game:

```sh
ls -1 ~/.minecraft/mods/ | grep -iE 'iris|sodium'
```

You need Iris `1.10.x` **and** Sodium `0.8.x` where the Sodium build is **not**
`0.8.13` (unless you are on an Iris newer than 1.10.7). Sodium 0.8.13 declares a
hard incompatibility with Iris ≤ 1.10.7 and the game will refuse to start with
"Some of your mods are incompatible with the game or each other!"

---

## Worked around / gotchas

- `texture` is a reserved word from GLSL 130 onward, so the main atlas sampler
  must be spelled `gtexture`. The `tex`/`texture` aliases some packs use are
  documented as undefined behaviour.
- The `RENDERTARGETS` directive **must** be a `/* */` block comment on its own
  line. A `//` comment is not recognised.
- Any buffer named in `RENDERTARGETS` but not written on some path through the
  shader receives garbage. Every output is assigned unconditionally.
