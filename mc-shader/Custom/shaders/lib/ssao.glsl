#ifndef LIB_SSAO_GLSL
#define LIB_SSAO_GLSL

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"
// shadows.glsl for POISSON_DISK, which the AO kernel reuses
#include "/lib/shadows.glsl"

/* ============================================================================
   ssao.glsl - screen-space ambient occlusion, Alchemy/SAO style.

   For each neighbour sample, v is the vector from the shading point to the
   sampled surface. The estimator is

       AO += max(0, dot(v, n) - beta*|v|) / (dot(v, v) + eps)

   dot(v, n) is how far the neighbour rises above the tangent plane - only
   geometry in front of the surface can occlude it. Dividing by |v|^2 falls off
   with distance the way a solid-angle term should. The beta*|v| term subtracts
   a slope-proportional floor, which is what stops a flat surface viewed at an
   angle from occluding itself under depth-buffer quantisation.

   Cheaper than a hemisphere-kernel SSAO because it needs no per-sample matrix
   work and no normal reconstruction for the neighbours - just a depth fetch.

   Including programs must declare:
       uniform sampler2D depthtex0;
       uniform mat4 gbufferProjection, gbufferProjectionInverse;
       uniform float near, far;
   ========================================================================= */

#if SSAO_QUALITY == 0
    #define SSAO_SAMPLES 6
#elif SSAO_QUALITY == 1
    #define SSAO_SAMPLES 10
#else
    #define SSAO_SAMPLES 16
#endif

const float SSAO_BIAS = 0.02;   // beta, in world units per unit distance

float computeSSAO(sampler2D depthTex, vec2 texcoord, vec3 viewPos,
                  vec3 viewNormal, float dither,
                  mat4 proj, mat4 projInverse) {
    float linearDepth = -viewPos.z;
    if (linearDepth <= 0.0) return 1.0;

    /* World radius -> screen radius.

       A world-space offset r at view depth z projects to an NDC offset of
       r * P[i][i] / z, so in 0..1 UV space that is half as much. Scaling by
       depth this way is what keeps the AO radius a constant size in the world
       instead of a constant size on screen, which would make distant geometry
       absurdly over-occluded. */
    vec2 radiusUV = vec2(proj[0][0], proj[1][1]) * (SSAO_RADIUS / linearDepth) * 0.5;

    // Clamp the on-screen radius. Very close surfaces would otherwise sample
    // most of the screen, which is both slow and meaningless.
    radiusUV = min(radiusUV, vec2(0.12));

    float s = sin(dither * TAU);
    float c = cos(dither * TAU);
    mat2 rot = mat2(c, -s, s, c);

    float occlusion = 0.0;
    for (int i = 0; i < SSAO_SAMPLES; i++) {
        vec2 offset = rot * POISSON_DISK[i] * radiusUV;
        vec2 sampleUV = texcoord + offset;

        // Off-screen neighbours carry no information; treating them as
        // unoccluded avoids a dark border around the whole image.
        if (any(lessThan(sampleUV, vec2(0.0))) ||
            any(greaterThan(sampleUV, vec2(1.0)))) continue;

        float sampleDepth = texture(depthTex, sampleUV).r;
        if (sampleDepth >= 1.0) continue;    // sky

        vec3 sampleView = screenToView(vec3(sampleUV, sampleDepth), projInverse);

        vec3 v   = sampleView - viewPos;
        float vv = dot(v, v);
        float vn = dot(v, viewNormal);

        // Ignore samples far outside the radius. Without this, a distant
        // object behind a thin foreground surface bleeds a dark halo onto it.
        float rangeCheck = step(vv, SSAO_RADIUS * SSAO_RADIUS * 4.0);

        occlusion += rangeCheck * max(0.0, vn - SSAO_BIAS * sqrt(vv))
                   / (vv + 0.0001);
    }

    float ao = 1.0 - (occlusion * 2.0 * SSAO_STRENGTH / float(SSAO_SAMPLES));
    return clamp(ao, 0.0, 1.0);
}

/* Depth-aware 4-tap blur.

   The per-pixel kernel rotation turns AO banding into noise, and this smooths
   that noise out. It has to be depth-aware: a plain blur pulls AO across
   silhouette edges and leaves a bright halo around every object. Weighting by
   depth similarity keeps the blur inside surfaces. */
float blurSSAO(sampler2D aoTex, sampler2D depthTex, vec2 texcoord,
               vec2 texelSize, float centerDepth, float nearP, float farP) {
    float centerLinear = linearizeDepth(centerDepth, nearP, farP);
    float total  = texture(aoTex, texcoord).r;
    float weight = 1.0;

    // Diagonal taps only: four fetches cover the same footprint a 3x3 box
    // would, for less than half the bandwidth.
    const vec2 offsets[4] = vec2[4](
        vec2(-1.0, -1.0), vec2( 1.0, -1.0),
        vec2(-1.0,  1.0), vec2( 1.0,  1.0)
    );

    for (int i = 0; i < 4; i++) {
        vec2 uv = texcoord + offsets[i] * texelSize * 1.5;
        float d = texture(depthTex, uv).r;
        if (d >= 1.0) continue;

        float linearD = linearizeDepth(d, nearP, farP);
        // Falls to zero across roughly a quarter block of depth difference,
        // which is tight enough to preserve block edges.
        float w = exp(-abs(linearD - centerLinear) * 8.0);
        total  += texture(aoTex, uv).r * w;
        weight += w;
    }
    return total / weight;
}

#endif // LIB_SSAO_GLSL
