#ifndef LIB_SSR_GLSL
#define LIB_SSR_GLSL

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"

/* ============================================================================
   ssr.glsl - screen-space reflections.

   Marches the reflected ray through the depth buffer looking for the first
   place the ray passes behind a surface. The march is in view space with the
   step projected to the screen each iteration, rather than marching in screen
   space directly: a screen-space march has to deal with perspective making
   equal screen steps mean wildly different world distances, which either
   over-steps near geometry or wastes iterations far away.

   Marches against depthtex1 (opaque only). Marching depthtex0 would let the
   ray hit the water surface it just left.
   ========================================================================= */

#if SSR_QUALITY == 0
    #define SSR_STEPS 12
#elif SSR_QUALITY == 1
    #define SSR_STEPS 20
#else
    #define SSR_STEPS 32
#endif

// Binary refinement after the coarse hit. Five halvings take the residual
// error to 1/32 of a coarse step, which is well under a pixel at these ranges.
#define SSR_REFINE_STEPS 5

struct SSRHit {
    bool  hit;
    vec2  uv;
    float fade;   // 0..1, for fading out at the screen edge
};

SSRHit traceReflection(sampler2D depthTex, vec3 viewPos, vec3 reflectDir,
                       mat4 proj, mat4 projInverse, float dither) {
    SSRHit result;
    result.hit  = false;
    result.uv   = vec2(0.0);
    result.fade = 0.0;

    // Step length grows with distance so near reflections stay accurate while
    // far ones still reach. The initial jitter breaks up the banding a fixed
    // start position would otherwise stamp across the reflection.
    float rayLength = max(1.0, -viewPos.z * 0.06);
    vec3  rayPos    = viewPos + reflectDir * rayLength * (0.4 + dither * 0.6);

    for (int i = 0; i < SSR_STEPS; i++) {
        vec3 screenPos = viewToScreen(rayPos, proj);

        if (any(lessThan(screenPos.xy, vec2(0.0))) ||
            any(greaterThan(screenPos.xy, vec2(1.0))) ||
            screenPos.z > 1.0) {
            return result;                      // left the screen
        }

        float sceneDepth = texture(depthTex, screenPos.xy).r;

        if (sceneDepth < screenPos.z && sceneDepth < 1.0) {
            /* The ray is now behind a surface. Reject the hit if it is behind
               by far more than the current step: that means the ray jumped
               past a thin object into empty space behind it, and accepting it
               would smear that object's colour across the reflection. */
            vec3 sceneView = screenToView(vec3(screenPos.xy, sceneDepth), projInverse);
            float behind = sceneView.z - rayPos.z;
            if (behind > rayLength * 2.0) {
                rayPos    += reflectDir * rayLength;
                rayLength *= 1.35;
                continue;
            }

            // Binary refine between the last miss and this hit.
            vec3 lo = rayPos - reflectDir * rayLength;
            vec3 hi = rayPos;
            for (int j = 0; j < SSR_REFINE_STEPS; j++) {
                vec3 mid    = (lo + hi) * 0.5;
                vec3 midScr = viewToScreen(mid, proj);
                float midDepth = texture(depthTex, midScr.xy).r;
                if (midDepth < midScr.z) hi = mid; else lo = mid;
            }

            vec2 finalUV = viewToScreen(hi, proj).xy;

            // Fade near the screen border. A reflection that ends abruptly at
            // the edge of the frame is more distracting than no reflection.
            vec2 edge = smoothstep(vec2(0.0), vec2(0.12), finalUV) *
                        smoothstep(vec2(0.0), vec2(0.12), 1.0 - finalUV);

            result.hit  = true;
            result.uv   = finalUV;
            result.fade = edge.x * edge.y;
            return result;
        }

        rayPos    += reflectDir * rayLength;
        rayLength *= 1.35;
    }
    return result;
}

#endif // LIB_SSR_GLSL
