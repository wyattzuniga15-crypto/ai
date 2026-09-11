#version 330 compatibility

/* Bloom chain: tent-upsample colortex7 into colortex6 and add.

   The destination is read and written in the same pass, which is safe because
   composite programs read the "main" buffer and write the "alt" one, and Iris
   swaps them afterwards. */

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex7;
uniform sampler2D colortex6;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outBloom;

void main() {
    vec2 texelSize = 1.0 / (vec2(viewWidth, viewHeight) * 0.25);

    vec4 upper   = upsampleTent(colortex7, texcoord, texelSize, 1.0);
    vec4 current = texture(colortex6, texcoord);

    // Sum the colour; keep the destination's own log-luminance in .a so the
    // exposure data is not polluted by the upsample.
    outBloom = vec4(current.rgb + upper.rgb, current.a);
}
