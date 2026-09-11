#version 330 compatibility

/* ============================================================================
   deferred - ambient occlusion.

   This runs before the lighting pass rather than in composite on purpose.
   Ambient occlusion describes how much of the sky hemisphere a point can see,
   so it belongs on the ambient term only. Applied after lighting - which is
   what a composite-pass AO multiply would do - it also darkens direct
   sunlight, putting dirty smudges on surfaces the sun demonstrably reaches.
   Splitting it out here keeps it a separate, skippable pass (disabled wholesale
   via program.deferred.enabled when SSAO is off) while still landing on the
   right term.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/spaces.glsl"
#include "/lib/ssao.glsl"

uniform sampler2D colortex1;
uniform sampler2D depthtex0;

uniform mat4  gbufferProjection;
uniform mat4  gbufferProjectionInverse;
uniform mat4  gbufferModelView;
uniform int   frameCounter;

in vec2 texcoord;

/* RENDERTARGETS: 3 */
layout(location = 0) out vec4 outAO;

void main() {
    float depth = texture(depthtex0, texcoord).r;
    vec4  gnorm = texture(colortex1, texcoord);

    // Sky and self-shaded geometry get no occlusion. 1.0 is "unoccluded" -
    // note colortex3 clears to 0.0, so writing unconditionally matters.
    if (depth >= 1.0 || matchMat(gnorm.a, MAT_SKY) ||
        matchMat(gnorm.a, MAT_OTHER) || matchMat(gnorm.a, MAT_HAND)) {
        outAO = vec4(1.0);
        return;
    }

    vec3 viewPos = screenToView(vec3(texcoord, depth), gbufferProjectionInverse);

    // The gbuffer stores player-space normals; SSAO works in view space.
    vec3 normalPlayer = decodeNormal(gnorm.rgb);
    vec3 viewNormal   = normalize(mat3(gbufferModelView) * normalPlayer);

    float dither = igNoise(gl_FragCoord.xy + float(frameCounter & 15) * 5.588);

    float ao = computeSSAO(depthtex0, texcoord, viewPos, viewNormal, dither,
                           gbufferProjection, gbufferProjectionInverse);

    outAO = vec4(ao, 0.0, 0.0, 1.0);
}
