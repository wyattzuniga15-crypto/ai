#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/water.glsl"

uniform mat4  gbufferModelViewInverse;
uniform mat4  gbufferModelView;
uniform vec3  cameraPosition;
uniform float frameTimeCounter;

in vec2 mc_Entity;

out vec2 texcoord;
out vec2 lmcoord;
out vec4 glcolor;
out vec3 normalPlayer;
out vec3 playerPos;
out vec3 viewPos;
out vec3 worldPos;
flat out float blockId;

void main() {
    blockId = mc_Entity.x;

    vec4 viewSpace  = gl_ModelViewMatrix * gl_Vertex;
    vec3 playerSpace = (gbufferModelViewInverse * viewSpace).xyz;

    // World space, so waves stay anchored to the world instead of swimming
    // along with the camera.
    worldPos = playerSpace + cameraPosition;

#ifdef WATER_WAVES
    if (mc_Entity.x == MAT_ID_WATER) {
        WaveSample wave = sampleWaves(worldPos.xz, frameTimeCounter);
        float displacement = waveDisplacement(wave);

        playerSpace.y += displacement;
        worldPos.y    += displacement;
        viewSpace      = gbufferModelView * vec4(playerSpace, 1.0);
    }
#endif

    playerPos   = playerSpace;
    viewPos     = viewSpace.xyz;
    gl_Position = gl_ProjectionMatrix * viewSpace;

    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    lmcoord  = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
    glcolor  = gl_Color;

    vec3 viewNormal = gl_NormalMatrix * gl_Normal;
    normalPlayer    = normalize(mat3(gbufferModelViewInverse) * viewNormal);
}
