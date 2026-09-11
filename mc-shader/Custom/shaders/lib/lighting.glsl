#ifndef LIB_LIGHTING_GLSL
#define LIB_LIGHTING_GLSL

#include "/lib/common.glsl"

/* ============================================================================
   lighting.glsl - the light model.

   Rather than sampling vanilla's baked lightmap texture, the two lightmap
   coordinates are treated as what they physically are - exposure to block
   light and exposure to sky light - and each is given its own colour and
   falloff. Direct sun/moon is a third, separate term gated by the shadow map.

   That separation is the whole point: vanilla's lightmap fuses all three into
   one lookup, so you cannot tint torchlight warm without also tinting
   moonlight warm, and shadowed ground would still receive "sun" light.

   Including programs must declare whichever uniforms they use.
   ========================================================================= */

// ---- Lightmap conditioning -------------------------------------------------
/* gl_TextureMatrix[1] * gl_MultiTexCoord1 lands in roughly [0.033, 0.969],
   because the lightmap texture is 16x16 and the matrix targets texel centres.
   Undo that to get a clean 0..1 light level. */
vec2 normalizeLightmap(vec2 lm) {
    return clamp((lm - (1.0 / 32.0)) / (30.0 / 32.0), 0.0, 1.0);
}

/* Blocklight falloff.

   The quadratic term keeps the near-source falloff feeling physical; the
   linear term is what stops mid-range light levels collapsing. A pure x^4
   curve is more "correct" for a point source but reads as murk: at light
   level 7/15 it returns 0.15, so a torch-lit room is a brown smear. This
   returns 0.33 there, which is what a torch-lit room actually looks like. */
float blocklightFalloff(float x) {
    return x * x * 0.70 + x * 0.30;
}

float skylightFalloff(float x) {
    // Sky light falls off much more gently - it is ambient, not point-source.
    return x * x * (3.0 - 2.0 * x);
}

/* A separate, much gentler curve for gating DIRECT sunlight by sky exposure.

   The gate exists so the sun cannot reach into caves past the shadow map's
   far plane, but reusing the ambient falloff for it is too aggressive: under
   a tree or beside a wall, sky exposure drops to ~0.6 and takes 40% of the
   sunlight with it, which is why partly-covered ground looked so flat. The
   sun does not dim because you stepped near a wall. This stays near 1.0
   across the whole usable range and only collapses where sky exposure is
   genuinely near zero, i.e. actually enclosed. */
float directSkyGate(float x) {
    return smoothstep(0.0, 0.32, x);
}

// ---- Light colours ---------------------------------------------------------
/* Warm blocklight. Pushed a little away from pure orange toward yellow so
   torch-lit stone reads as lit rather than as stained. */
const vec3 BLOCKLIGHT_COLOR = vec3(1.00, 0.62, 0.32);

/* Sky ambient.

   The old values were (0.42, 0.58, 0.92) - a 0.50 spread between the blue and
   red channels. Since shaded surfaces receive essentially only this term, that
   spread WAS the gloom: everything out of direct sun turned the same dead
   blue-grey regardless of its own colour. Real skylight is blue, but nowhere
   near that blue, and it is much brighter relative to the sun.

   These are brighter and far less saturated. The colour that makes shade look
   interesting now comes from the bounce term below instead, which is the
   physically honest place for it. */
const vec3 SKYLIGHT_DAY   = vec3(0.62, 0.74, 0.98);
const vec3 SKYLIGHT_NIGHT = vec3(0.14, 0.19, 0.34);

/* Indirect bounce - sunlight that hit something else first.

   This is the term the pack was missing, and it is why shadows looked dead.
   In the real world a shadowed wall is lit by sunlight bouncing off the lit
   ground nearby, so it carries the SUN's colour, not the sky's - which is why
   real shadows are warm at golden hour rather than turning blue.

   It is deliberately NOT gated by the shadow map: bounced light is precisely
   the light that reaches places the sun does not. Gating it by the shadow
   would defeat the entire point. A crude single-bounce approximation, but the
   difference between having it and not having it is enormous. */
const float BOUNCE_AMOUNT = 0.24;

/* Sun colour as a function of how high the sun is.

   sunHeight is dot(sunDir, up), so +1 is noon and 0 is exactly on the horizon.
   At low sun the light has travelled through far more atmosphere, which
   scatters out the short wavelengths - so the colour shifts toward orange and
   red, and dims. This is what makes sunrise and sunset actually shift rather
   than just dimming a fixed yellow. */
vec3 sunlightColor(float sunHeight) {
    float h = clamp(sunHeight, 0.0, 1.0);

    // Horizon -> zenith colour ramp, in two stages so sunrise passes through
    // orange rather than interpolating straight from red to white.
    vec3 horizon = vec3(1.00, 0.38, 0.16);
    vec3 low     = vec3(1.00, 0.72, 0.45);
    vec3 high    = vec3(1.00, 0.97, 0.92);

    vec3 c = mix(horizon, low,  smoothstep(0.0, 0.18, h));
    c      = mix(c,       high, smoothstep(0.15, 0.55, h));

    // Intensity also falls off near the horizon. Without this, a sunset is
    // the same brightness as noon and only the hue changes, which looks wrong.
    float intensity = smoothstep(-0.05, 0.22, sunHeight);
    return c * intensity;
}

vec3 moonlightColor(float moonHeight) {
    float intensity = smoothstep(-0.05, 0.25, moonHeight);
    // Cool and dim. Moonlight is reflected sunlight, but the eye's scotopic
    // response makes it read blue, which is the look everyone expects.
    return vec3(0.18, 0.26, 0.46) * intensity;
}

/* Ambient sky colour reaching a surface. Blends day to night on sun height
   and lifts slightly with the surface normal facing up, since an upward-facing
   surface sees more of the sky dome. */
vec3 skyAmbientColor(float sunHeight, vec3 normal) {
    vec3 base = mix(SKYLIGHT_NIGHT, SKYLIGHT_DAY, smoothstep(-0.15, 0.25, sunHeight));
    float upness = normal.y * 0.5 + 0.5;
    // Floor raised from 0.55 to 0.72: a downward-facing surface still sees
    // light bounced off the ground, so crushing it to half was overdone and
    // made every overhang read as a black hole.
    return base * mix(0.72, 1.0, upness);
}


/* ---- Light context --------------------------------------------------------

   The same handful of direction vectors are needed by the deferred pass and by
   every forward-shaded program (hand, water). Deriving them once here keeps
   those three in step - and in particular keeps them agreeing about when night
   starts.

   isNight is taken from the light vectors rather than a worldTime range: if
   the shadow-casting light points away from the sun, it is the moon. That is
   true by construction and switches at exactly the same instant Iris switches
   shadowLightPosition, which a hand-picked tick range would not.  */
struct LightContext {
    vec3  lightDir;    // toward the shadow-casting light, player space
    vec3  sunDir;      // toward the sun, player space
    vec3  upDir;       // world up, player space
    float sunHeight;   // dot(sunDir, upDir): +1 noon, 0 horizon, -1 midnight
    bool  isNight;     // the moon is the shadow-casting light
};

LightContext getLightContext(vec3 shadowLightPosition, vec3 sunPosition,
                             vec3 upPosition, mat4 gbufferModelViewInverse) {
    LightContext ctx;
    mat3 viewToPlayerRot = mat3(gbufferModelViewInverse);

    ctx.lightDir  = normalize(viewToPlayerRot * shadowLightPosition);
    ctx.sunDir    = normalize(viewToPlayerRot * sunPosition);
    ctx.upDir     = normalize(viewToPlayerRot * upPosition);
    ctx.sunHeight = dot(ctx.sunDir, ctx.upDir);
    ctx.isNight   = dot(ctx.lightDir, ctx.sunDir) < 0.0;
    return ctx;
}

/* Sun-coloured indirect bounce.

   Weighted toward surfaces facing AWAY from the light: those are exactly the
   ones the direct term never reaches, and the ones that in reality are lit by
   light bounced off whatever is in front of them. A surface facing the sun
   already has direct light and needs no help.

   Uses the sun colour even at night (scaled right down), because moonlight
   bounces too and a hard switch to a different hue at dusk is visible. */
vec3 bounceColor(LightContext ctx, vec3 normal) {
    vec3 sunTint = sunlightColor(max(ctx.sunHeight, 0.0));

    // At night there is almost no bounce, but not zero.
    float nightScale = mix(0.10, 1.0, smoothstep(-0.10, 0.22, ctx.sunHeight));

    // 1 when facing straight away from the light, 0 when facing into it.
    float facing = 1.0 - clamp(dot(normal, ctx.lightDir), 0.0, 1.0);
    float weight = mix(0.45, 1.0, facing);

    // Ground bounce is stronger on downward-facing surfaces, which is where
    // light coming back up off the terrain actually lands.
    float downness = 1.0 - (normal.y * 0.5 + 0.5);
    weight *= mix(1.0, 1.35, downness);

    return sunTint * (BOUNCE_AMOUNT * nightScale * weight);
}

/* ---- The combined model ---------------------------------------------------

   albedo     surface colour, with vanilla AO already multiplied in via the
              vertex colour attribute
   normal     player/world space, normalised
   lm         normalised 0..1 lightmap (x = block, y = sky)
   shadowLit  0..1 from the shadow map; 0 = fully shadowed
   ao         extra ambient occlusion (SSAO); 1.0 = unoccluded
   ctx        light directions and sun height, from getLightContext()
*/
vec3 computeLighting(vec3 albedo, vec3 normal, vec2 lm, float shadowLit,
                     float ao, LightContext ctx, float nightVisionAmount) {
    vec3  lightDir  = ctx.lightDir;
    float sunHeight = ctx.sunHeight;
    bool  isNight   = ctx.isNight;

    float blockAmount = blocklightFalloff(lm.x);
    float skyAmount   = skylightFalloff(lm.y);

    // --- direct sun/moon ---
    float NdotL = clamp(dot(normal, lightDir), 0.0, 1.0);
    vec3 directColor = isNight ? moonlightColor(abs(sunHeight))
                               : sunlightColor(sunHeight);
    // Direct light is gated by sky exposure too, otherwise the sun reaches
    // into caves through the shadow map's far plane.
    // directSkyGate, not skylightFalloff: the gate only needs to stop sunlight
    // leaking into enclosed spaces, not dim the sun every time you stand near
    // a wall.
    vec3 direct = directColor * NdotL * shadowLit * directSkyGate(lm.y)
                * SUNLIGHT_STRENGTH;

    // --- ambient sky ---
    // SSAO applies to ambient only. Occlusion describes how much of the sky
    // hemisphere a point can see; applying it to direct light as well would
    // darken surfaces the sun demonstrably reaches.
    vec3 ambient = skyAmbientColor(sunHeight, normal) * skyAmount * ao
                 * SKYLIGHT_STRENGTH;

    // --- indirect bounce ---
    // Not gated by shadowLit on purpose: bounced light is the light that
    // reaches where the sun does not. See bounceColor().
    vec3 bounce = bounceColor(ctx, normal) * skyAmount * ao * SKYLIGHT_STRENGTH;

    // --- block light ---
    vec3 block = BLOCKLIGHT_COLOR * blockAmount * BLOCKLIGHT_STRENGTH
               * mix(1.0, ao, 0.5);

    // --- floor ---
    // A small constant so pitch-black caves stay navigable, matching vanilla's
    // minimum light. Night vision lifts this a long way.
    vec3 minimumLight = vec3(0.020, 0.023, 0.032)
                      + vec3(0.55, 0.55, 0.60) * nightVisionAmount;

    return albedo * (direct + ambient + bounce + block + minimumLight);
}

#endif // LIB_LIGHTING_GLSL
