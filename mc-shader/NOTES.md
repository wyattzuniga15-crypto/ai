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
| `colortex0` | RGBA16F | Scene colour. Albedo out of gbuffers, lit HDR colour after `deferred`. Cleared to `fogColor` by Iris. |
| `colortex1` | RGBA16F | `rgb` player-space normal remapped to 0..1, `a` material id |
| `colortex2` | RGBA16F | `rg` normalised 0..1 lightmap (block, sky), `ba` unused |
| `colortex3` | R16F | `r` ambient occlusion, 1.0 = unoccluded |
| `colortex4` | RGBA16F | `rgb` translucent surface colour (lit), `a` alpha (0 for water) |
| `colortex5` | RGBA16F | `rgb` translucent player-space normal, `a` `MAT_WATER`/`MAT_TRANSLUCENT` |

*(rows are added as later steps land)*

Material ids (`MAT_*` in `lib/common.glsl`) are how `deferred` knows which
pixels it owns. Sky, clouds, particles and the hand shade themselves in their
own gbuffer program and are tagged so the deferred pass skips them — without
that they would be lit twice.

**Gotcha from the docs:** `colortex0`–`colortex3` **cannot be read** from a
gbuffers program — sampling them there silently returns the texture atlas
instead. Any gbuffer→gbuffer communication has to go through `colortex4`+.

---

## Passes

| Pass | Does |
|---|---|
| `shadow` | Renders depth from the sun/moon into `shadowtex`, distortion applied. |
| `gbuffers_*` | Writes albedo + normal + lightmap, or self-shades and tags itself. |
| `deferred` | SSAO into `colortex3`. Skipped entirely when SSAO is off. |
| `deferred1` | Reconstructs position from depth, samples the shadow map, lights opaque geometry, applies fog. |
| `composite` | Resolves translucents: refraction, absorption, Fresnel, SSR. Underwater caustics and fog. |
| `final` | Copies `colortex0` to the backbuffer. |

### Step 1 — pass-through skeleton ✅ (`check.sh` clean)

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

### Step 2 — shadow map ✅ (`check.sh` clean)

`shadowMapResolution` 2048, `shadowDistance` 128, sampled once in `deferred`
rather than per-gbuffer. Sampling per-gbuffer would run the PCF loop for every
fragment drawn including ones later overdrawn; in `deferred` it runs once per
*visible* pixel.

**Distortion.** An orthographic shadow map spreads texels evenly over the whole
shadow distance, wasting most of them behind the player. The warp is

    factor(p) = (1 - k) + k*|p|,   warped(p) = p / factor(p),   k = SHADOW_DISTORTION

picked so `|p|=0` magnifies the centre by `1/(1-k)` (6.7× at the default 0.85)
while `|p|=1` maps exactly to the edge, so the map is filled rather than
wasting a border. Monotonic in `|p|`, so it never folds over itself. `k` is
capped at 0.95 by the option list, keeping `factor ≥ 0.05`.

Depth is scaled by 0.5 separately (`SHADOW_DEPTH_SCALE`). Iris's default shadow
projection clips tall terrain — and anything with a low sun — against the
near/far planes, which shows up as shadows that simply vanish. Halving z doubles
the surviving depth range for one bit of precision, which the bias absorbs.

The warp lives in `lib/spaces.glsl` and *both* `shadow.vsh` and `deferred.fsh`
call the same function. If the writing and reading sides ever disagree, shadows
land in the wrong texels.

**Bias — normal-offset, not flat depth.** A flat depth bias trades acne for
peter-panning one-for-one: whatever constant escapes self-shadowing is exactly
how far the shadow detaches from its caster. Instead the *lookup position* moves
off the surface along its normal by about one shadow texel of world space. Acne
happens because one texel covers a patch of sloped surface and stores a single
depth for all of it; stepping off by that patch's size clears the comparison
without shifting the shadow along the light direction, so the contact point
stays put.

Two things scale it, and both matter:
- **Texel world size**, which is *not* constant — the distortion warp makes
  near texels cover less world than far ones. `shadowDistortFactor()` gives the
  ratio. Ignore it and near-field shadows visibly detach.
- **Slope relative to the light**, as `tan(theta)`, clamped since it runs to
  infinity at the terminator.

**PCF.** A 16-point Poisson disk generated with Mitchell's best-candidate
(600 candidates/point, seed 20260911, min separation 0.391), **sorted by
radius**. The sort is load-bearing: `SHADOW_QUALITY` takes a *prefix*, and an
unsorted prefix clumps wherever generation started, leaving the outer penumbra
unsampled.

The disk is rotated per pixel *and* per frame by interleaved gradient noise.
Without rotation every pixel samples the same fixed pattern and the penumbra
shows that pattern's own shape as banding; rotating turns structured error into
noise, which reads as a soft edge. The per-frame term lets it average out over
time instead of sitting still.

`getShadow()` returns early for `NdotL <= 0` — surfaces facing away are
shadowed by their own geometry. That is both correct and the largest single
saving here, since roughly half of visible surfaces qualify.

**The hand is shaded forward, not deferred.** `gbuffers_hand` computes its own
player-space position from the modelview matrix. Reconstructing it from the
depth buffer would go through the hand's compressed depth range
(`MC_HAND_DEPTH`) and land a few centimetres from the camera, putting its
shadow lookup somewhere else entirely.

### Step 3 — lighting ✅ (`check.sh` clean)

The two lightmap coordinates are treated as what they physically are — exposure
to block light and exposure to sky light — and each gets its own colour and
falloff, with direct sun/moon as a third term gated by the shadow map. That
separation is the entire point: vanilla's lightmap fuses all three into one
texture lookup, so you cannot warm up torchlight without also warming moonlight,
and shadowed ground would still be receiving "sun".

- **Blocklight** warm (`1.00, 0.56, 0.24`), falloff `0.55x⁴ + 0.45x²` — a linear
  ramp looks flat and washed out, a raw `x⁴` goes black too fast near torches.
- **Skylight** cool, day/night blended on sun height, lifted slightly for
  upward-facing normals since they see more of the sky dome.
- **Sun colour by sun angle.** Low sun means more atmosphere, which scatters out
  the short wavelengths, so the ramp runs red → orange → white in two stages
  (a single mix would interpolate straight from red to white and skip orange).
  Intensity falls off near the horizon too — without that, a sunset is noon
  brightness with a different hue, which reads as wrong.
- **Direct light is gated by sky exposure** as well as the shadow map, otherwise
  sun leaks into caves past the shadow map's far plane.
- **Vanilla AO is kept for free** — it rides inside `gl_Color.rgb` and multiplies
  into albedo in the gbuffer.

`isNight` comes from the light vectors, not a `worldTime` tick range: if the
shadow-casting light points away from the sun, it is the moon. True by
construction, and it switches at the same instant Iris switches
`shadowLightPosition`, which a hand-picked tick range would not.

`getLightContext()` derives the direction vectors once and is shared by
`deferred1` and both forward-shaded programs (hand, water), so the three cannot
drift apart on when night starts.

**SSAO** is Alchemy/SAO style:

    AO += max(0, dot(v,n) - beta*|v|) / (dot(v,v) + eps)

`dot(v,n)` is how far a neighbour rises above the tangent plane — only geometry
in front of the surface can occlude it — and the `1/|v|²` falloff is the
solid-angle term. `beta*|v|` subtracts a slope-proportional floor, which is what
stops a flat surface viewed at an angle from occluding itself under depth-buffer
quantisation. Cheaper than a hemisphere kernel: one depth fetch per sample, no
per-sample matrix work.

The radius is scaled by `1/depth` through the projection matrix diagonal, so it
stays a fixed size *in the world* rather than on screen — a screen-constant
radius over-occludes distant geometry absurdly. It is also clamped on screen, or
very close surfaces would sample half the frame.

**Deviation worth flagging: SSAO runs in `deferred`, not `composite`.** AO
describes how much of the sky hemisphere a point can see, so it belongs on the
*ambient* term only. A composite-pass AO multiply lands after lighting and
therefore also darkens direct sunlight, smudging surfaces the sun demonstrably
reaches. Putting it before the lighting pass keeps it a separate, skippable pass
(`program.deferred.enabled = SSAO`) while still applying to the right term.
Blocklight takes it at half strength — a torch is a local source that AO
shouldn't fully occlude.

The AO is blurred with 4 diagonal taps, depth-weighted. Diagonals cover the same
footprint as a 3×3 box for under half the bandwidth, and the depth weighting is
required — a plain blur drags AO across silhouettes and leaves a bright halo
around every object.

### Step 4 — water ✅ (`check.sh` clean)

**`gbuffers_water` does not blend.** `blend.gbuffers_water = off`; the surface
goes to `colortex4`/`colortex5` and `composite` resolves it. Both refraction and
absorption need the scene *behind* the water, and blending destroys it. It also
leaves `depthtex0` (with water) and `depthtex1` (without) as a free measurement
of the path length through the water — which is exactly what Beer-Lambert wants.

*Cost:* only the nearest translucent survives per pixel, so two stacked panes of
glass resolve as one. Standard trade, worth it here.

**Water identifies itself** through `block.properties` → `mc_Entity.x`.
`gbuffers_water` receives *all* translucent terrain — stained glass, ice, slime,
honey — so waves and absorption would otherwise apply to a pane of glass.

**Waves.** Three travelling waves, non-parallel directions and non-harmonic
frequencies (parallel waves make corduroy stripes; small-integer frequency
ratios re-synchronise into a visibly repeating tile).

Real Gerstner waves also displace *horizontally*, which is what sharpens their
crests — but Minecraft's water surface only has vertices at block corners, so
horizontal displacement tears the mesh at chunk seams. The crest shaping is
instead `w = s²` where `s = sin(p)*0.5+0.5`: same pointed-crest, flat-trough
profile from vertical displacement alone, and exactly differentiable.

**The normal is the analytic derivative of that displacement**, not a separate
noise texture — `dw/dp = 2s·ds/dp = s·cos(p)`, chained through
`d(phase)/d(xz) = freq·dir`. A sampled normal map and a displaced mesh disagree
about where the crests are, and the mismatch shows up as highlights sliding off
the waves. `WATER_NORMAL_STRENGTH` scales only the shading normal, which is a
legitimate cheat — it adds ripple detail finer than the block-corner vertex grid
can represent.

**Wave phase is continuous across the `frameTimeCounter` wrap.** That uniform
resets at exactly 3600s. The temporal frequencies are snapped so each wave
completes a whole number of cycles in that period (630, 934, 1438), costing at
most 0.04% of the intended speed and avoiding the whole ocean jumping once an
hour.

**Water waves in the shadow pass too**, by the identical amount. If the shadow
map held the undisplaced surface while the visible geometry was displaced, water
would compare against a depth belonging to a slightly different surface and
stripe itself with self-shadowing. The displacement is along world Y and the
shadow camera is not world-aligned, so world-up is rotated into shadow view
space — one `mat3` multiply, no per-vertex matrix inverse.

**Absorption** is Beer-Lambert with per-channel coefficients
`(0.52, 0.16, 0.09)` per block. Red is absorbed fastest and blue-green slowest,
which is *why* deep water goes blue-green — not because it is "tinted blue" but
because everything else has already been absorbed. Shallow water is clear for
free, from the same equation. Scatter follows ambient light level
(`scatterLightScale`), because water still glowing blue-green at midnight is one
of the most obvious tells of a shader faking it.

**Fresnel** is Schlick with `F0 = 0.02`. At normal incidence only 2% reflects —
which is why you can see straight down into still water and why it turns
mirror-like at a glancing angle. Seen from below, Fresnel is driven to 1 past
the critical angle to approximate total internal reflection.

**Refraction** shifts the background sample by `t·(1 − 1/η)·tan(tilt)` with
η = 1.33, converted to UV through the projection scale over distance. The offset
is rejected if what it lands on turns out to be *in front of* the water — a boat
on the surface would otherwise smear across it.

**SSR** marches in view space with the step projected to screen each iteration,
not in screen space directly: equal screen steps mean wildly different world
distances under perspective, which either over-steps near geometry or wastes
iterations far away. Step length grows 1.35× per iteration, with a dithered
start to break up banding, then 5 binary halvings to refine the hit.

It marches **`depthtex1`** (opaque only) — marching `depthtex0` would let the
ray immediately hit the water surface it just left. A hit is rejected if the ray
ended up more than two step-lengths *behind* the surface, which means it jumped
past a thin object into empty space and would otherwise smear that object's
colour across the reflection. Misses fall back to the analytic sky, and hits
fade toward it near the screen border rather than ending abruptly.

**Underwater** fog measures against `depthtex0` (which includes the water
surface), not `depthtex1`. Looking up from below, the water volume ends at the
surface — measuring past it would fog the air above as though it were water.
Caustics are two ridged noise layers multiplied together: ridging turns each
blob into a thin crest, and multiplying keeps only where several layers agree,
which is what turns blobs into the branching filaments real caustics make. They
are gated by sky exposure, so no sun through a cave roof means no caustics on
its floor, and skipped on the underside of the surface, which has already been
resolved as a reflection.

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

3. **It audits `shaders.properties` against the defined options.** A `screen`,
   `sliders` or `profile` entry naming an option no GLSL file defines is not an
   error in-game — Iris silently omits the row. That is the kind of bug you only
   find by scrolling the options screen hunting for a control that never
   appears, so it fails the build instead.

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
- **Vanilla AO is kept by doing nothing.** With `separateAo` at its default
  (off), vanilla ambient occlusion is baked into `gl_Color.rgb`, so multiplying
  it into albedo preserves it exactly. Turning `separateAo` on would move AO to
  `gl_Color.a` — which is fine for terrain, but `gbuffers_water` is also a
  terrain program, and there `.a` is the blend weight. Not worth the risk.
- Backslash line continuation is a Java `.properties` feature; Iris's parser is
  not documented as supporting it, so every directive in `shaders.properties`
  stays on one line. A wrapped `screen` list would misparse silently.
- Float-valued options cannot be tested with `#if` (only ints can). Only
  `SHADOW_QUALITY`, `SSAO_QUALITY`, `SSR_QUALITY`, `CLOUD_QUALITY` and
  `TONEMAP` are int options; everything else is used as a plain value.
