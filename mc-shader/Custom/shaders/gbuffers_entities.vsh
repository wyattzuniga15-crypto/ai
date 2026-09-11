#version 330 compatibility

#include "/lib/common.glsl"

uniform mat4 gbufferModelViewInverse;

out vec2 texcoord;
out vec2 lmcoord;
out vec4 glcolor;
out vec3 normalPlayer;

void main() {
    gl_Position = ftransform();

    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord  = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    glcolor  = gl_Color;

    // gl_Normal is model space; the normal matrix takes it to view space, and
    // gbufferModelViewInverse's rotation takes it to player space. Player
    // space is what the deferred pass and the shadow lookup both work in.
    vec3 viewNormal = gl_NormalMatrix * gl_Normal;
    normalPlayer    = normalize(mat3(gbufferModelViewInverse) * viewNormal);
}
