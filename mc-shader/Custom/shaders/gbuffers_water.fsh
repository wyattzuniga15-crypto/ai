#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/fog.glsl"

uniform sampler2D gtexture;
uniform sampler2D lightmap;
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
    // Translucent geometry: no alpha test. Iris has alpha blending on for this
    // program, so the alpha we write is the blend weight and must survive.
    vec4 color = texture(gtexture, texcoord) * glcolor;

    color.rgb *= texture(lightmap, lmcoord).rgb;
    color.rgb  = applyVanillaFog(color.rgb, viewPos, fogColor,
                                 fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = color;
}
