#version 330 compatibility

// Bloom chain: downsample colortex7 -> colortex8.

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex7;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 8 */
layout(location = 0) out vec4 outBloom;

void main() {
    // Texel size of the SOURCE buffer, which is 0.25 of the screen.
    vec2 texelSize = 1.0 / (vec2(viewWidth, viewHeight) * 0.25);
    outBloom = downsample13(colortex7, texcoord, texelSize, false);
}
