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

/* Vanilla's light falloff is close to inverse-square with a floor. A plain
   linear ramp looks flat and washed out, while a raw x^4 goes black too fast
   near torches. This curve is steep in the middle and tapers at both ends. */
float blocklightFalloff(float x) {
    float x2 = x * x;
    return x2 * x2 * 0.55 + x2 * 0.45;
}

float skylightFalloff(float x) {
    // Sky light falls off much more gently - it is ambient, not point-source.
    return x * x * (3.0 - 2.0 * x);
}

// ---- Light colours ---------------------------------------------------------
// Warm blocklight, cool skylight. Deliberately not normalised to luminance 1:
// blocklight reads as "fire" partly because it is dimmer than daylight.
const vec3 BLOCKLIGHT_COLOR = vec3(1.00, 0.56, 0.24);
const vec3 SKYLIGHT_DAY     = vec3(0.42, 0.58, 0.92);
const vec3 SKYLIGHT_NIGHT   = vec3(0.12, 0.17, 0.32);

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
    return base * mix(0.55, 1.0, upness);
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
    vec3 direct = directColor * NdotL * shadowLit * skyAmount * SUNLIGHT_STRENGTH;

    // --- ambient sky ---
    // SSAO applies to ambient only. Occlusion describes how much of the sky
    // hemisphere a point can see; applying it to direct light as well would
    // darken surfaces the sun demonstrably reaches.
    vec3 ambient = skyAmbientColor(sunHeight, normal) * skyAmount * ao
                 * SKYLIGHT_STRENGTH;

    // --- block light ---
    vec3 block = BLOCKLIGHT_COLOR * blockAmount * BLOCKLIGHT_STRENGTH
               * mix(1.0, ao, 0.5);

    // --- floor ---
    // A small constant so pitch-black caves stay navigable, matching vanilla's
    // minimum light. Night vision lifts this a long way.
    vec3 minimumLight = vec3(0.006, 0.007, 0.010)
                      + vec3(0.55, 0.55, 0.60) * nightVisionAmount;

    return albedo * (direct + ambient + block + minimumLight);
}

#endif // LIB_LIGHTING_GLSL
