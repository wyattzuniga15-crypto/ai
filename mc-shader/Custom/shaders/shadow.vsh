#version 330 compatibility

#include "/lib/common.glsl"
#include "/lib/shadows.glsl"
#include "/lib/water.glsl"

uniform mat4  shadowModelView;
uniform mat4  shadowModelViewInverse;
uniform vec3  cameraPosition;
uniform float frameTimeCounter;

in vec2 mc_Entity;

out vec2 texcoord;
out vec4 glcolor;

void main() {
    // In the shadow pass gl_ModelViewMatrix/gl_ProjectionMatrix already ARE
    // the shadow camera's matrices, so this is shadow view space.
    vec3 shadowViewPos = (gl_ModelViewMatrix * gl_Vertex).xyz;

#ifdef WATER_WAVES
    /* Water has to wave here too, by exactly the same amount as in
       gbuffers_water. If the shadow map holds the undisplaced surface while
       the visible geometry is displaced, water compares against a depth
       belonging to a slightly different surface and stripes itself with
       self-shadowing. */
    if (mc_Entity.x == MAT_ID_WATER) {
        vec3 playerPos = (shadowModelViewInverse * vec4(shadowViewPos, 1.0)).xyz;
        vec3 worldPos  = playerPos + cameraPosition;

        WaveSample wave = sampleWaves(worldPos.xz, frameTimeCounter);

        /* The displacement is along world Y, and the shadow camera is not
           aligned with the world, so it cannot simply be added to
           shadowViewPos.y. Rotating world-up into shadow view space gives the
           right direction for one mat3 multiply - and no per-vertex matrix
           inverse. */
        vec3 upInShadowView = mat3(shadowModelView) * vec3(0.0, 1.0, 0.0);
        shadowViewPos += upInShadowView * waveDisplacement(wave);
    }
#endif

    vec4 clipPos = gl_ProjectionMatrix * vec4(shadowViewPos, 1.0);

    // Apply the same warp the reading side will apply. The divide/multiply by
    // w is a no-op for the default orthographic projection (w == 1), but keeps
    // this correct if shadowMapFov is ever set to make it perspective.
    clipPos.xyz = distortShadowClip(clipPos.xyz / clipPos.w) * clipPos.w;

    gl_Position = clipPos;
    texcoord    = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    glcolor     = gl_Color;
}
