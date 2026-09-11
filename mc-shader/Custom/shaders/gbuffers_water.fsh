#version 330 compatibility

/* Translucent terrain. This runs AFTER the deferred passes, so it cannot be
   deferred-lit and shades itself forward against the already-lit opaque
   image in colortex0. */

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"
#include "/lib/shadows.glsl"
#include "/lib/fog.glsl"

uniform sampler2D gtexture;
uniform sampler2D shadowtex0;

uniform mat4  shadowModelView;
uniform mat4  shadowProjection;
uniform mat4  gbufferModelViewInverse;
uniform vec3  shadowLightPosition;
uniform vec3  sunPosition;
uniform vec3  upPosition;
uniform float nightVision;
uniform int   frameCounter;

uniform vec3  fogColor;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform int   fogMode;
uniform int   fogShape;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 normalPlayer;
in vec3 playerPos;
in vec3 viewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    // No alpha test: this is the translucent program and the alpha we write is
    // the blend weight.
    vec4 color = texture(gtexture, texcoord) * glcolor;

    vec3 normal   = normalize(normalPlayer);
    LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                       upPosition, gbufferModelViewInverse);

    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);
    float shadowLit = getShadow(playerPos, normal, ctx.lightDir, dither,
                                shadowtex0, shadowModelView, shadowProjection);

    vec3 lit = computeLighting(color.rgb, normal, normalizeLightmap(lmcoord),
                               shadowLit, 1.0, ctx, nightVision);

    lit = applyVanillaFog(lit, viewPos, fogColor,
                          fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = vec4(lit, color.a);
}
