#version 330 compatibility

#include "/lib/common.glsl"

uniform mat4 gbufferModelViewInverse;

out vec4 glcolor;
out vec3 viewPos;
out vec3 playerPos;

void main() {
    vec4 viewSpace = gl_ModelViewMatrix * gl_Vertex;
    viewPos     = viewSpace.xyz;
    gl_Position = gl_ProjectionMatrix * viewSpace;
    glcolor     = gl_Color;

    // The sky dome is drawn at a fixed radius around the camera, so the
    // player-space position of a dome vertex IS the view direction for that
    // part of the sky.
    playerPos = (gbufferModelViewInverse * viewSpace).xyz;
}
