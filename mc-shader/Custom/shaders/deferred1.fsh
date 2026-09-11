#version 330 compatibility

/* ============================================================================
   BUFFER LAYOUT
   ----------------------------------------------------------------------------
   colortex0  RGBA16F  rgb  scene colour. Albedo out of gbuffers, lit HDR
                            colour after this pass. Cleared to fogColor.
   colortex1  RGBA16F  rgb  player-space normal, remapped to 0..1
                       a    material id (see MAT_* in lib/common.glsl)
   colortex2  RGBA16F  rg   lightmap, normalised 0..1 (r block, g sky)
                       ba   unused
   colortex3  R16F     r    ambient occlusion, 1.0 = unoccluded
   ----------------------------------------------------------------------------
   depthtex0  all geometry. At deferred time translucents have not drawn yet,
              so this is opaque depth - exactly the surface to light.
   depthtex1  excludes translucents.
   shadowtex0 shadow depth, all geometry.
   shadowtex1 shadow depth, opaque only.
   ----------------------------------------------------------------------------
   Note: colortex0-3 cannot be READ from a gbuffers program. Sampling them
   there silently returns the texture atlas instead of the buffer. Any
   gbuffer-to-gbuffer channel would have to live in colortex4 or above.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"
#include "/lib/lighting.glsl"
#include "/lib/shadows.glsl"
#include "/lib/ssao.glsl"
#include "/lib/fog.glsl"

uniform sampler2D colortex0;   // albedo
uniform sampler2D colortex1;   // normal + material id
uniform sampler2D colortex2;   // lightmap
uniform sampler2D colortex3;   // ambient occlusion
uniform sampler2D depthtex0;
uniform sampler2D shadowtex0;

uniform mat4  gbufferProjection;
uniform mat4  gbufferProjectionInverse;
uniform mat4  gbufferModelView;
uniform mat4  gbufferModelViewInverse;
uniform mat4  shadowModelView;
uniform mat4  shadowProjection;

uniform vec3  shadowLightPosition;
uniform vec3  sunPosition;
uniform vec3  upPosition;
uniform float nightVision;
uniform int   frameCounter;
uniform float near;
uniform float far;
uniform float viewWidth;
uniform float viewHeight;

uniform vec3  fogColor;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform int   fogMode;
uniform int   fogShape;

in vec2 texcoord;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    vec4  gbufferNormal = texture(colortex1, texcoord);
    float material      = gbufferNormal.a;
    vec3  albedo        = texture(colortex0, texcoord).rgb;

    // Sky, clouds, particles and the hand shade themselves in their own
    // gbuffer program. Deferred lighting would double-light them.
    if (matchMat(material, MAT_SKY)   ||
        matchMat(material, MAT_OTHER) ||
        matchMat(material, MAT_HAND)) {
        outColor0 = vec4(albedo, 1.0);
        return;
    }

    float depth = texture(depthtex0, texcoord).r;
    if (depth >= 1.0) {           // nothing was drawn here
        outColor0 = vec4(albedo, 1.0);
        return;
    }

    // Reconstruct where this pixel is in the world. At deferred time
    // depthtex0 holds opaque depth only - translucents have not drawn yet -
    // which is exactly the surface we want to light.
    vec3 viewPos   = screenToView(vec3(texcoord, depth), gbufferProjectionInverse);
    vec3 playerPos = viewToPlayer(viewPos, gbufferModelViewInverse);

    vec3 normal = decodeNormal(gbufferNormal.rgb);
    vec2 lm     = texture(colortex2, texcoord).rg;

    LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                       upPosition, gbufferModelViewInverse);

    // Rotating the PCF disk per pixel AND per frame: the spatial term breaks
    // up banding within a frame, the frame term lets the remaining noise
    // average out over time instead of sitting still as a fixed pattern.
    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);

    float shadowLit = getShadow(playerPos, normal, ctx.lightDir, dither,
                                shadowtex0, shadowModelView, shadowProjection);

    // Ambient occlusion, smoothed. The kernel rotation in the SSAO pass turns
    // banding into noise; this blur is what turns the noise into shading.
    float ao = 1.0;
#ifdef SSAO
    ao = blurSSAO(colortex3, depthtex0, texcoord,
                  1.0 / vec2(viewWidth, viewHeight), depth, near, far);
#endif

    vec3 color = computeLighting(albedo, normal, lm, shadowLit, ao, ctx, nightVision);

    color = applyVanillaFog(color, viewPos, fogColor,
                            fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = vec4(color, 1.0);
}
