#version 330 compatibility

// Bloom chain: downsample colortex9 -> colortex10.

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex9;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 10 */
layout(location = 0) out vec4 outBloom;

void main() {
    // Texel size of the SOURCE buffer, which is 0.0625 of the screen.
    vec2 texelSize = 1.0 / (vec2(viewWidth, viewHeight) * 0.0625);
    outBloom = downsample13(colortex9, texcoord, texelSize, false);
}
