#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"
#include "/lib/shadows.glsl"
#include "/lib/fog.glsl"

uniform sampler2D gtexture;
uniform sampler2D shadowtex0;
uniform float alphaTestRef;

uniform mat4  shadowModelView;
uniform mat4  shadowProjection;
uniform mat4  gbufferModelViewInverse;
uniform vec3  shadowLightPosition;
uniform vec3  upPosition;
uniform vec3  sunPosition;
uniform float nightVision;
uniform int   worldTime;
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

/* RENDERTARGETS: 0,1 */
layout(location = 0) out vec4 outColor0;
layout(location = 1) out vec4 outColor1;

void main() {
    vec4 color = texture(gtexture, texcoord) * glcolor;
    if (color.a < alphaTestRef) discard;

    vec3 normal   = normalize(normalPlayer);
    vec3 lightDir = normalize(mat3(gbufferModelViewInverse) * shadowLightPosition);
    vec3 sunDir   = normalize(mat3(gbufferModelViewInverse) * sunPosition);
    vec3 upDir    = normalize(mat3(gbufferModelViewInverse) * upPosition);

    float sunHeight = dot(sunDir, upDir);
    bool  isNight   = worldTime > 12700 && worldTime < 23300;

    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);
    float shadowLit = getShadow(playerPos, normal, lightDir, dither,
                                shadowtex0, shadowModelView, shadowProjection);

    vec3 lit = computeLighting(color.rgb, normal, normalizeLightmap(lmcoord),
                               shadowLit, 1.0, lightDir, sunHeight, isNight,
                               nightVision);

    lit = applyVanillaFog(lit, viewPos, fogColor,
                          fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = vec4(lit, color.a);
    // Tagged so the deferred pass leaves it alone - it is already shaded.
    outColor1 = vec4(encodeNormal(normal), MAT_HAND);
}
