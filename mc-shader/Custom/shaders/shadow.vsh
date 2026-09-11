#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/shadows.glsl"

out vec2 texcoord;
out vec4 glcolor;

void main() {
    // In the shadow pass gl_ModelViewMatrix/gl_ProjectionMatrix already ARE
    // the shadow camera's matrices, so ftransform() lands us in shadow clip
    // space directly.
    vec4 clipPos = ftransform();

    // Apply the same warp the reading side will apply. The divide/multiply by
    // w is a no-op for the default orthographic projection (w == 1), but keeps
    // this correct if shadowMapFov is ever set to make it perspective.
    clipPos.xyz = distortShadowClip(clipPos.xyz / clipPos.w) * clipPos.w;

    gl_Position = clipPos;
    texcoord    = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    glcolor     = gl_Color;
}
