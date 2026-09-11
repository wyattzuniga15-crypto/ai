#version 330 compatibility

#include "/lib/common.glsl"

uniform sampler2D colortex0;

in vec2 texcoord;

layout(location = 0) out vec4 outColor0;

void main() {
    // Step 1: nothing but a copy. Tonemapping and post land here later.
    outColor0 = vec4(texture(colortex0, texcoord).rgb, 1.0);
}
