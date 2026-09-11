#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"

uniform sampler2D gtexture;
uniform float alphaTestRef;

in vec2 texcoord;
in vec2 lmcoord;
in vec4 glcolor;
in vec3 normalPlayer;

/* RENDERTARGETS: 0,1,2 */
layout(location = 0) out vec4 outColor0;  // albedo
layout(location = 1) out vec4 outColor1;  // normal + material id
layout(location = 2) out vec4 outColor2;  // lightmap

void main() {
    vec4 color = texture(gtexture, texcoord) * glcolor;

    if (color.a < alphaTestRef) discard;

    // Albedo only. No lighting and no fog here - both happen in deferred,
    // once, for whatever ends up actually visible. Vanilla ambient occlusion
    // rides along inside glcolor, which is exactly where we want it.
    outColor0 = vec4(color.rgb, 1.0);
    outColor1 = vec4(encodeNormal(normalize(normalPlayer)), MAT_TERRAIN);
    outColor2 = vec4(normalizeLightmap(lmcoord), 0.0, 1.0);
}
