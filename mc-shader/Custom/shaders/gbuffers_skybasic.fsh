#version 330 compatibility

#include "/lib/common.glsl"

in vec4 glcolor;
in vec3 viewPos;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 outColor0;

void main() {
    // Deliberately no fog. Vanilla draws the sky dome already tinted toward
    // fogColor at the horizon; applying distance fog on top would crush the
    // whole dome to a flat colour.
    outColor0 = glcolor;
}
