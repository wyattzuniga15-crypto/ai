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

    /* Depth is what this pass exists for, and it is written automatically.

       The colour output is here because the alternative is worse: with no
       RENDERTARGETS directive at all, Iris falls back to binding buffers in
       order, so declaring exactly one is the *minimum* it will allocate.
       Nothing reads shadowcolor0 today - it is what coloured shadows through
       stained glass would be built on, by comparing shadowtex0 (all geometry)
       against shadowtex1 (opaques only) - but that is not implemented. */
    shadowcolor0Out = color;
}
