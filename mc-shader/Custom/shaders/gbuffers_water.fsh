#version 330 compatibility

/* ============================================================================
   gbuffers_water - translucent terrain.

   This does NOT blend itself into the scene. Blending is off for this program
   (see shaders.properties) and the surface is instead written to colortex4/5
   for the composite pass to resolve.

   The reason is refraction and absorption: both need the scene *behind* the
   water, and once water has blended into colortex0 that is gone. Writing the
   surface out separately keeps colortex0 as the intact opaque image, and
   leaves depthtex0 (with water) and depthtex1 (without) as a free measurement
   of exactly how much water each pixel looks through.

   The cost of blending being off is that only the nearest translucent surface
   survives per pixel - two panes of stacked glass resolve as one. That is the
   standard trade and it is worth it here.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"
#include "/lib/shadows.glsl"
#include "/lib/water.glsl"

uniform sampler2D gtexture;
uniform sampler2D shadowtex0;

uniform mat4  shadowModelView;
uniform mat4  shadowProjection;
uniform mat4  gbufferModelViewInverse;
uniform vec3  shadowLightPosition;
uniform vec3  sunPosition;
uniform vec3  upPosition;
uniform float nightVision;
uniform float frameTimeCounter;
uniform float alphaTestRef;
uniform int   frameCounter;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 normalPlayer;
in vec3 playerPos;
in vec3 viewPos;
in vec3 worldPos;
flat in float blockId;

/* RENDERTARGETS: 4,5 */
layout(location = 0) out vec4 outTranslucent;  // colortex4: colour + alpha
layout(location = 1) out vec4 outWaterNormal;  // colortex5: normal + id

void main() {
    bool isWater = abs(blockId - MAT_ID_WATER) < 0.5;

    vec4 color = texture(gtexture, texcoord) * glcolor;

    // Non-water translucents are still cutout-tested (e.g. the transparent
    // parts of a glass pane's frame); water has no cutout.
    if (!isWater && color.a < alphaTestRef) discard;

    vec3 normal = normalize(normalPlayer);

    if (isWater) {
        // Rebuild the wave at this exact fragment. Sampling per-fragment
        // rather than interpolating the vertex normal is what gives ripples
        // finer than the block-corner vertex grid.
        WaveSample wave = sampleWaves(worldPos.xz, frameTimeCounter);
        vec3 waveN = waveNormal(wave);

        /* The wave normal is defined in a Y-up frame. Apply it in the
           surface's own frame so that vertical water (waterfalls) is not
           given a normal pointing straight up. For the flat top surface -
           which is nearly all water - this reduces to the wave normal
           unchanged. */
        vec3 up = vec3(0.0, 1.0, 0.0);
        if (abs(normal.y) > 0.95) {
            normal = normalize(vec3(waveN.x, waveN.y * sign(normal.y), waveN.z));
        } else {
            vec3 tangent   = normalize(cross(up, normal));
            vec3 bitangent = cross(normal, tangent);
            normal = normalize(tangent * waveN.x + normal * waveN.y + bitangent * waveN.z);
        }
    }

    LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                       upPosition, gbufferModelViewInverse);

    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);
    float shadowLit = getShadow(playerPos, normal, ctx.lightDir, dither,
                                shadowtex0, shadowModelView, shadowProjection);

    vec3 lit = computeLighting(color.rgb, normal, normalizeLightmap(lmcoord),
                               shadowLit, 1.0, ctx, nightVision);

    // Water's own texture alpha is nearly opaque in modern resource packs,
    // which would hide everything underneath. The transparency of water comes
    // from absorption in composite, not from this alpha, so water is written
    // fully transparent here and composite decides how much shows through.
    float alpha = isWater ? 0.0 : color.a;

    outTranslucent = vec4(lit, alpha);
    outWaterNormal = vec4(encodeNormal(normal),
                          isWater ? MAT_WATER : MAT_TRANSLUCENT);
}
