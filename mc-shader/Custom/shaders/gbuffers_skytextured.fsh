#version 330 compatibility

#include "/lib/common.glsl"

uniform sampler2D gtexture;

in vec2 texcoord;
in vec4 glcolor;
in vec3 viewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    // Sun/moon are additively blended by Iris; no alpha test, no fog.
    outColor0 = texture(gtexture, texcoord) * glcolor;
}
