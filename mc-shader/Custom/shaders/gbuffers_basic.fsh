#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/fog.glsl"

uniform float alphaTestRef;
uniform vec3  fogColor;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform int   fogMode;
uniform int   fogShape;

in vec4 glcolor;
in vec3 viewPos;

/* RENDERTARGETS: 0,1 */
layout(location = 0) out vec4 outColor0;
layout(location = 1) out vec4 outColor1;

void main() {
    vec4 color = glcolor;
    if (color.a < alphaTestRef) discard;
    color.rgb = applyVanillaFog(color.rgb, viewPos, fogColor,
                                fogStart, fogEnd, fogDensity, fogMode, fogShape);

    outColor0 = color;
    // Normal is meaningless for this geometry; only the material id is read,
    // and it tells the deferred pass to pass this pixel through untouched.
    outColor1 = vec4(0.5, 0.5, 1.0, MAT_OTHER);
}
