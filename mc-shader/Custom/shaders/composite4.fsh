#version 330 compatibility

// Bloom chain: downsample colortex8 -> colortex9.

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex8;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 9 */
layout(location = 0) out vec4 outBloom;

void main() {
    // Texel size of the SOURCE buffer, which is 0.125 of the screen.
    vec2 texelSize = 1.0 / (vec2(viewWidth, viewHeight) * 0.125);
    outBloom = downsample13(colortex8, texcoord, texelSize, false);
}
