#version 330 compatibility

#include "/lib/common.glsl"

out vec2 texcoord;
out vec4 glcolor;
out vec3 viewPos;

void main() {
    vec4 viewSpace = gl_ModelViewMatrix * gl_Vertex;
    viewPos     = viewSpace.xyz;
    gl_Position = gl_ProjectionMatrix * viewSpace;

    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    glcolor  = gl_Color;
}
