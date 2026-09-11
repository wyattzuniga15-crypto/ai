#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/fog.glsl"

uniform sampler2D gtexture;
uniform float alphaTestRef;
uniform vec3  fogColor;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform int   fogMode;
uniform int   fogShape;

in vec2 texcoord;
in vec4 glcolor;
in vec3 viewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    vec4 color = texture(gtexture, texcoord) * glcolor;
    if (color.a < alphaTestRef) discard;

    color.rgb = applyVanillaFog(color.rgb, viewPos, fogColor,
                                fogStart, fogEnd, fogDensity, fogMode, fogShape);
    outColor0 = color;
}
