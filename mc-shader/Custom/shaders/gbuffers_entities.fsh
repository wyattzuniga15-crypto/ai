#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/fog.glsl"

uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform float alphaTestRef;
uniform vec4  entityColor;
uniform vec3  fogColor;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform int   fogMode;
uniform int   fogShape;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 viewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    vec4 color = texture(gtexture, texcoord) * glcolor;

    // entityColor.rgb is the overlay tint (red hurt flash, creeper charge),
    // entityColor.a how much of it to apply.
    color.rgb = mix(color.rgb, entityColor.rgb, entityColor.a);
    if (color.a < alphaTestRef) discard;

    // Step 1 is deliberately pass-through: vanilla's own lightmap texture,
    // vanilla's own fog. Nothing here should change the image.
    color.rgb *= texture(lightmap, lmcoord).rgb;
    color.rgb  = applyVanillaFog(color.rgb, viewPos, fogColor,
                                 fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = color;
}
