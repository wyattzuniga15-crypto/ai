#version 330 compatibility

#include "/lib/common.glsl"

uniform sampler2D gtexture;
uniform float alphaTestRef;

in vec2 texcoord;
in vec4 glcolor;

/* RENDERTARGETS: 0 */
layout(location = 0) out vec4 shadowcolor0Out;

void main() {
    vec4 color = texture(gtexture, texcoord) * glcolor;

    // The alpha test matters more here than it looks: without it every leaf
    // block casts a solid cube shadow instead of a dappled one, and glass
    // goes opaque.
    if (color.a < alphaTestRef) discard;

    // Depth is written automatically. The colour goes to shadowcolor0 so that
    // translucent casters can tint light later; shadowtex1 excludes them, so
    // comparing the two buffers is what makes coloured shadows possible.
    shadowcolor0Out = color;
}
