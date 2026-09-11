#version 330 compatibility

// Bloom chain: downsample colortex6 -> colortex7.

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex6;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 7 */
layout(location = 0) out vec4 outBloom;

void main() {
    // Texel size of the SOURCE buffer, which is 0.5 of the screen.
    vec2 texelSize = 1.0 / (vec2(viewWidth, viewHeight) * 0.5);
    outBloom = downsample13(colortex6, texcoord, texelSize, false);
}
