#version 330 compatibility

/* ============================================================================
   BUFFER LAYOUT
   ----------------------------------------------------------------------------
   colortex0  RGBA16F  rgb  scene colour (HDR). Opaque-only on entry to this
                            pass; translucents are resolved here.
                            Cleared to fogColor.
   colortex1  RGBA16F  rgb  opaque player-space normal, remapped to 0..1
                       a    material id: MAT_TERRAIN / ENTITY / HAND / SKY /
                            OTHER  (see lib/common.glsl)
   colortex2  RGBA16F  rg   opaque lightmap, normalised 0..1 (r block, g sky)
                       ba   unused
   colortex3  R16F     r    ambient occlusion, 1.0 = unoccluded
   colortex4  RGBA16F  rgb  translucent surface colour, already lit
                       a    translucent alpha (0 for water - see below)
   colortex5  RGBA16F  rgb  translucent player-space normal, remapped to 0..1
                       a    MAT_WATER or MAT_TRANSLUCENT; 0 where there is none
   ----------------------------------------------------------------------------
   depthtex0  includes translucents -> the WATER SURFACE depth
   depthtex1  excludes translucents -> the depth of whatever is BEHIND it
              The difference between the two is the path length through water,
              which is what drives absorption. This is why gbuffers_water does
              not blend: doing so would destroy both the background colour and
              this measurement.
   shadowtex0 shadow depth, all geometry.   shadowtex1  opaque only.
   ----------------------------------------------------------------------------
   Water alpha is written as 0 in gbuffers_water on purpose. Modern resource
   packs give water a nearly opaque texture alpha, which would hide the bottom
   entirely; water's transparency here comes from Beer-Lambert absorption over
   the measured path length, not from a texture constant.

   Note: colortex0-3 cannot be READ from a gbuffers program - sampling them
   there silently returns the texture atlas. That is why the translucent
   surface goes to colortex4/5 rather than a lower index.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"
#include "/lib/lighting.glsl"
#include "/lib/water.glsl"
#include "/lib/sky.glsl"
#include "/lib/ssr.glsl"

uniform sampler2D colortex0;
uniform sampler2D colortex2;
uniform sampler2D colortex4;
uniform sampler2D colortex5;
uniform sampler2D depthtex0;
uniform sampler2D depthtex1;

uniform mat4  gbufferProjection;
uniform mat4  gbufferProjectionInverse;
uniform mat4  gbufferModelView;
uniform mat4  gbufferModelViewInverse;

uniform vec3  cameraPosition;
uniform vec3  shadowLightPosition;
uniform vec3  sunPosition;
uniform vec3  upPosition;
uniform float frameTimeCounter;
uniform int   frameCounter;
uniform int   isEyeInWater;

in vec2 texcoord;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

// ---------------------------------------------------------------------------
// Reflection: SSR where the ray finds something, sky where it doesn't.
// ---------------------------------------------------------------------------
vec3 getReflection(vec3 viewPos, vec3 viewNormal, LightContext ctx, float dither) {
    vec3 viewDir    = normalize(viewPos);
    vec3 reflectDir = reflect(viewDir, viewNormal);

    // Sky fallback is computed regardless: it is what a missed ray fades into,
    // so it has to be available to blend toward rather than a hard cutover.
    vec3 reflectPlayer = normalize(mat3(gbufferModelViewInverse) * reflectDir);
    vec3 skyReflection = getSkyColorWithGround(reflectPlayer, ctx, vec3(0.35));

#ifdef SSR
    SSRHit hit = traceReflection(depthtex1, viewPos, reflectDir,
                                 gbufferProjection, gbufferProjectionInverse,
                                 dither);
    if (hit.hit) {
        vec3 hitColor = texture(colortex0, hit.uv).rgb;
        return mix(skyReflection, hitColor, hit.fade);
    }
#endif
    return skyReflection;
}

void main() {
    vec3  color      = texture(colortex0, texcoord).rgb;
    float waterDepth = texture(depthtex0, texcoord).r;   // surface
    float solidDepth = texture(depthtex1, texcoord).r;   // behind it

    vec4  translucent = texture(colortex4, texcoord);
    vec4  tnormal     = texture(colortex5, texcoord);
    float tmat        = tnormal.a;

    LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                       upPosition, gbufferModelViewInverse);
    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);

    bool isWater       = matchMat(tmat, MAT_WATER);
    bool isTranslucent = matchMat(tmat, MAT_TRANSLUCENT);

    // ---- 1. Translucent surfaces seen from outside ------------------------
    if ((isWater || isTranslucent) && waterDepth < 1.0) {
        vec3 surfaceView = screenToView(vec3(texcoord, waterDepth),
                                        gbufferProjectionInverse);
        vec3 normalPlayer = decodeNormal(tnormal.rgb);
        vec3 viewNormal   = normalize(mat3(gbufferModelView) * normalPlayer);
        vec3 viewDir      = normalize(surfaceView);

        float surfaceDist = -surfaceView.z;
        float solidDist   = (solidDepth >= 1.0)
                          ? surfaceDist + 64.0     // nothing behind: open water
                          : linearizeDepth(solidDepth, gbufferProjection);

        // Path length through the medium, along the view ray. Clamped because
        // an open horizon would otherwise give a near-infinite value.
        float thickness = clamp(solidDist - surfaceDist, 0.0, 48.0);

        // ---- refraction --------------------------------------------------
        vec2 sampleUV = texcoord;
#ifdef WATER_REFRACTION
        if (isWater) {
            /* A point at path length t below a tilted surface appears shifted
               sideways by about t*(1 - 1/eta)*tan(tilt). For the small tilts
               waves produce, tan(tilt) is approximated by the normal's
               screen-aligned components. Converting that world shift to UV
               needs the projection scale over distance. */
            const float BEND = 1.0 - 1.0 / 1.33;     // water, eta = 1.33
            float lateral = thickness * BEND;
            vec2 offset = viewNormal.xy * lateral
                        * vec2(gbufferProjection[0][0], gbufferProjection[1][1])
                        / (2.0 * max(surfaceDist, 0.5));

            offset = clamp(offset, vec2(-0.05), vec2(0.05));
            vec2 candidate = clamp(texcoord + offset, vec2(0.0), vec2(1.0));

            /* Only accept the offset if what it lands on is actually behind
               the water. Otherwise a boat or a fish in front of the surface
               gets smeared across it. */
            float candidateDepth = texture(depthtex1, candidate).r;
            float candidateDist = (candidateDepth >= 1.0)
                                ? surfaceDist + 64.0
                                : linearizeDepth(candidateDepth, gbufferProjection);
            if (candidateDist >= surfaceDist) sampleUV = candidate;
        }
#endif
        vec3 background = texture(colortex0, sampleUV).rgb;

        // ---- absorption --------------------------------------------------
        if (isWater) {
            vec3 transmittance = waterTransmittance(thickness);
            // Sky exposure at the surface gates how much light there is to
            // scatter back: water in a dark cave should not glow blue-green.
            float skyAmount = texture(colortex2, texcoord).g;
            vec3 scatter = WATER_SCATTER_COLOR
                         * (scatterLightScale(ctx) * (0.25 + 0.75 * skyAmount));
            background = background * transmittance
                       + scatter * (1.0 - transmittance);
        } else {
            background = mix(background, translucent.rgb, translucent.a);
        }

        // ---- Fresnel + reflection ----------------------------------------
        if (isWater) {
            float cosTheta = clamp(dot(-viewDir, viewNormal), 0.0, 1.0);
            float fresnel  = fresnelSchlick(cosTheta, WATER_F0);

            // Seen from underneath, past the critical angle the surface is a
            // perfect mirror. Approximated by driving Fresnel to 1 there.
            if (isEyeInWater == 1) {
                fresnel = mix(fresnel, 1.0, smoothstep(0.75, 0.5, cosTheta));
            }

            vec3 reflection = getReflection(surfaceView, viewNormal, ctx, dither);
            color = mix(background, reflection, fresnel);

            // A little of the surface's own lit colour, so water is not purely
            // a mirror over a tinted background.
            color += translucent.rgb * 0.06;
        } else {
            color = background;
        }
    }

    // ---- 2. Underwater ----------------------------------------------------
    if (isEyeInWater == 1) {
        /* Measured against depthtex0, which INCLUDES the water surface.
           Looking up from below, the water volume ends at the surface, not at
           whatever opaque thing is beyond it - using depthtex1 here would fog
           the air above the surface as if it were water. */
        float nearestDepth = texture(depthtex0, texcoord).r;
        vec3  nearestView  = screenToView(vec3(texcoord, nearestDepth),
                                          gbufferProjectionInverse);
        float dist = (nearestDepth >= 1.0) ? 64.0 : length(nearestView);

#ifdef WATER_CAUSTICS
        // Only on opaque geometry. The underside of the surface has already
        // been resolved as a reflection above; stamping caustics on it too
        // would be drawing the pattern on the wrong surface.
        if (nearestDepth < 1.0 && !isWater) {
            vec3 scenePlayer = viewToPlayer(nearestView, gbufferModelViewInverse);
            vec3 sceneWorld  = scenePlayer + cameraPosition;

            // Caustics are cast by light coming down through the surface, so
            // they are gated by sky exposure: no sun through a cave roof, no
            // caustics on its floor.
            float skyAmount = texture(colortex2, texcoord).g;
            float caustic = waterCaustics(sceneWorld.xz, frameTimeCounter);
            color *= 1.0 + caustic * 2.2 * skyAmount
                         * clamp(ctx.sunHeight + 0.2, 0.0, 1.0);
        }
#endif

        /* Fog scaling with distance, using the same Beer-Lambert coefficients
           as the above-water case so both agree about what colour water is.
           The 1.4 accounts for the light having travelled from its source to
           the surface as well as from the surface to the eye. */
        vec3 transmittance = waterTransmittance(dist * 1.4);
        color = color * transmittance
              + WATER_SCATTER_COLOR * scatterLightScale(ctx) * 1.6
              * (1.0 - transmittance);
    }

    outColor0 = vec4(color, 1.0);
}
