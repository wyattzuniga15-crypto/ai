#ifndef LIB_SHADOWS_GLSL
#define LIB_SHADOWS_GLSL

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"

/* ============================================================================
   shadows.glsl - shadow map constants, bias, and PCF filtering.

   Including programs must declare:
       uniform sampler2D shadowtex0;     (all geometry)
       uniform sampler2D shadowtex1;     (opaque only - no translucents)
       uniform mat4      shadowModelView, shadowProjection;
   ========================================================================= */

// ---- Shadow pass constants -------------------------------------------------
// These are read by Iris directly out of the GLSL. The trailing value lists
// make them appear in the in-game options screen.
const int   shadowMapResolution      = 2048;  // [512 1024 2048 4096]
const float shadowDistance           = 128.0; // [64.0 96.0 128.0 192.0 256.0]
// Positive value enables culling of geometry beyond shadowDistance. Without
// this, terrain outside the shadow distance is still drawn into the shadow
// pass and thrown away - a large amount of wasted work.
const float shadowDistanceRenderMul  = 1.0;
// We do our own PCF, so the hardware comparison sampler stays off: it would
// turn shadowtex into a sampler2DShadow and hide the real depth values.
const bool  shadowHardwareFiltering  = false;

const float SHADOW_TEXEL = 1.0 / float(shadowMapResolution);

// ---- Poisson disk ----------------------------------------------------------
/* Generated with Mitchell's best-candidate algorithm (600 candidates per
   point, seed 20260911), then sorted by radius. Minimum separation 0.391 in
   the unit disk.

   The radius sort matters: SHADOW_QUALITY takes a prefix of this table, and an
   unsorted prefix would clump wherever generation happened to start, leaving
   the outer penumbra unsampled. Sorted, every prefix still covers the disk. */
const vec2 POISSON_DISK[16] = vec2[16](
    vec2(-0.198536, -0.068409),
    vec2( 0.267134,  0.270381),
    vec2(-0.203550,  0.411374),
    vec2( 0.160453, -0.484257),
    vec2(-0.493846, -0.376109),
    vec2(-0.655509, -0.019668),
    vec2( 0.617848, -0.275692),
    vec2( 0.163453,  0.893782),
    vec2( 0.611738, -0.715259),
    vec2( 0.824532,  0.463179),
    vec2(-0.506593,  0.803215),
    vec2(-0.476876, -0.830970),
    vec2( 0.965305,  0.055101),
    vec2(-0.922643, -0.336308),
    vec2( 0.192046, -0.970604),
    vec2(-0.949862,  0.302351)
);

#if SHADOW_QUALITY == 0
    #define SHADOW_SAMPLES 1
#elif SHADOW_QUALITY == 1
    #define SHADOW_SAMPLES 10
#else
    #define SHADOW_SAMPLES 16
#endif

/* ---- Normal-offset bias ---------------------------------------------------

   A flat depth bias trades acne for peter-panning directly: whatever constant
   you add to escape self-shadowing is exactly the distance the shadow detaches
   from its caster. There is no value that fixes both.

   Normal-offset bias instead moves the *lookup position* off the surface along
   its normal, by roughly one shadow texel's worth of world space. Acne happens
   because a single shadow texel covers a patch of sloped surface and stores
   one depth for all of it; stepping off the surface by that patch's size clears
   the comparison without shifting the shadow along the light direction, so the
   contact point stays put.

   Two things scale the offset:

   - Shadow texel world size. The distortion warp means this is not constant
     across the map: a texel near the player covers less world space than one
     at the edge, so the offset must shrink to match or near-field shadows
     detach visibly. shadowDistortFactor() gives exactly that ratio.

   - Surface slope relative to the light. At grazing angles one texel spans far
     more surface, so acne needs a larger offset there. tan(theta) is the right
     scaling and is clamped, since it runs to infinity at the terminator.  */
vec3 shadowNormalOffset(vec3 playerPos, vec3 normal, vec3 lightDir,
                        mat4 shadowMV, mat4 shadowProj) {
    vec3 clipPos = playerToShadowClip(playerPos, shadowMV, shadowProj);
    float distortFactor = shadowDistortFactor(clipPos.xy);

    // World size of one shadow texel here. Clip space spans 2 units over
    // 2*shadowDistance blocks, so one texel is shadowDistance*2/res blocks
    // before the warp, and distortFactor times that after it.
    float texelWorldSize = (2.0 * shadowDistance * SHADOW_TEXEL) * distortFactor;

    float NdotL = clamp(dot(normal, lightDir), 0.0, 1.0);
    float slope = clamp(sqrt(1.0 - NdotL * NdotL) / max(NdotL, 0.1), 0.0, 4.0);

    return normal * texelWorldSize * (1.0 + slope) * 1.4 * SHADOW_BIAS_SCALE;
}

/* ---- PCF ------------------------------------------------------------------

   Samples the shadow map on a Poisson disk rotated per-pixel. Without the
   rotation, every pixel samples the same fixed pattern and the penumbra shows
   the pattern's own shape as banding; rotating by a per-pixel angle turns that
   structured error into noise, which reads as a soft edge instead.

   Returns 1.0 fully lit, 0.0 fully shadowed. */
float sampleShadowPCF(sampler2D shadowTex, vec3 shadowScreenPos,
                      float radiusTexels, float rotation) {
    // Outside the shadow map there is no information, so treat it as lit
    // rather than stamping a hard dark edge at the shadow distance.
    if (any(lessThan(shadowScreenPos.xy, vec2(0.0))) ||
        any(greaterThan(shadowScreenPos.xy, vec2(1.0))) ||
        shadowScreenPos.z >= 1.0) {
        return 1.0;
    }

#if SHADOW_QUALITY == 0
    // Single tap, hard edges.
    float depth = texture(shadowTex, shadowScreenPos.xy).r;
    return step(shadowScreenPos.z, depth);
#else
    float s = sin(rotation);
    float c = cos(rotation);
    mat2 rot = mat2(c, -s, s, c);

    float radius = radiusTexels * SHADOW_TEXEL;
    float lit = 0.0;
    for (int i = 0; i < SHADOW_SAMPLES; i++) {
        vec2 offset = rot * POISSON_DISK[i] * radius;
        float depth = texture(shadowTex, shadowScreenPos.xy + offset).r;
        lit += step(shadowScreenPos.z, depth);
    }
    return lit / float(SHADOW_SAMPLES);
#endif
}

/* Full path: a player-space position and its normal in, a 0..1 lit factor out.

   dither should be a per-pixel value in 0..1 (interleaved gradient noise);
   it becomes the disk rotation.  */
float getShadow(vec3 playerPos, vec3 normal, vec3 lightDir, float dither,
                sampler2D shadowTex, mat4 shadowMV, mat4 shadowProj) {
    // Surfaces facing away from the light are shadowed by their own geometry.
    // Skipping the lookup here is both correct and the single biggest saving
    // in this function, since roughly half of visible surfaces qualify.
    float NdotL = dot(normal, lightDir);
    if (NdotL <= 0.0) return 0.0;

    vec3 offsetPos = playerPos + shadowNormalOffset(playerPos, normal, lightDir,
                                                    shadowMV, shadowProj);
    vec3 shadowScreenPos = playerToShadowScreen(offsetPos, shadowMV, shadowProj);

    float lit = sampleShadowPCF(shadowTex, shadowScreenPos,
                                SHADOW_SOFTNESS, dither * TAU);

    // Fade the shadow out at the edge of the shadow distance so the boundary
    // is a gradient rather than a visible circle around the player.
    float distFade = smoothstep(0.9, 1.0, length(playerPos.xz) / shadowDistance);
    return mix(lit, 1.0, distFade);
}

#endif // LIB_SHADOWS_GLSL
