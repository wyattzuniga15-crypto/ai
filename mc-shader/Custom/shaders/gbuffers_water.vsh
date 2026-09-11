#version 330 compatibility

#include "/lib/common.glsl"

uniform mat4 gbufferModelViewInverse;

out vec2 texcoord;
out vec2 lmcoord;
out vec4 glcolor;
out vec3 normalPlayer;
out vec3 playerPos;
out vec3 viewPos;

void main() {
    vec4 viewSpace = gl_ModelViewMatrix * gl_Vertex;
    viewPos     = viewSpace.xyz;
    gl_Position = gl_ProjectionMatrix * viewSpace;

    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord  = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    glcolor  = gl_Color;

    vec3 viewNormal = gl_NormalMatrix * gl_Normal;
    normalPlayer    = normalize(mat3(gbufferModelViewInverse) * viewNormal);

    playerPos = (gbufferModelViewInverse * viewSpace).xyz;
}
