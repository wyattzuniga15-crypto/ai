#version 330 compatibility

/* ============================================================================
   gbuffers_skybasic - the sky dome, the sunset band, stars and the void.

   Which of those is being drawn is distinguished with renderStage rather than
   guessed at from geometry: stars are small quads on the same dome and would
   otherwise be overwritten by the sky gradient.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"
#include "/lib/sky.glsl"
#include "/lib/clouds.glsl"

uniform mat4  gbufferModelViewInverse;
uniform vec3  shadowLightPosition;
uniform vec3  sunPosition;
uniform vec3  upPosition;
uniform vec3  cameraPosition;
uniform vec3  fogColor;
uniform float frameTimeCounter;
uniform float rainStrength;
uniform int   frameCounter;
uniform int   renderStage;
uniform int   isEyeInWater;

in vec4 glcolor;
in vec3 viewPos;
in vec3 playerPos;

/* RENDERTARGETS: 0,1 */
layout(location = 0) out vec4 outColor0;
layout(location = 1) out vec4 outColor1;

void main() {
    vec3 color;

    if (renderStage == MC_RENDER_STAGE_STARS) {
        // Vanilla star geometry. Left as vanilla draws it, just dimmed as the
        // sky brightens so stars fade out at dawn instead of staying visible
        // against a blue sky.
        LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                           upPosition, gbufferModelViewInverse);
        float nightAmount = smoothstep(0.08, -0.18, ctx.sunHeight);
        color = glcolor.rgb * nightAmount * (1.0 - rainStrength * 0.8);

    } else if (renderStage == MC_RENDER_STAGE_VOID) {
        color = glcolor.rgb;

    } else {
#ifdef CUSTOM_SKY
        /* Vanilla draws the sunset as a separate alpha-blended band over the
           dome. The analytic sky already produces that glow from the sun
           scattering term, so drawing the band as well would blend one sunset
           on top of another and leave a visible seam where the band's alpha
           ramps out. Drop it and let the dome speak. */
        if (renderStage == MC_RENDER_STAGE_SUNSET) discard;
#endif
        // MC_RENDER_STAGE_SKY (and SUNSET when the analytic sky is off).
        LightContext ctx = getLightContext(shadowLightPosition, sunPosition,
                                           upPosition, gbufferModelViewInverse);

#ifdef CUSTOM_SKY
        vec3 dir = normalize(playerPos);
        color = getSkyColor(dir, ctx);

        // Rain flattens the sky toward the fog colour. Without this a
        // thunderstorm still has a clear blue gradient behind the rain.
        color = mix(color, fogColor * 0.7, rainStrength * 0.85);

#ifdef VOLUMETRIC_CLOUDS
        // Underwater the sky is barely visible and the clouds are not worth
        // marching for; skipping keeps the cost off a case nobody sees.
        if (isEyeInWater != 1) {
            float dither = igNoise(gl_FragCoord.xy
                                   + float(frameCounter & 15) * 5.588);
            vec4 clouds = raymarchClouds(cameraPosition, dir, ctx,
                                         frameTimeCounter, dither);
            // Clouds thin out toward the horizon, where the line of sight runs
            // so far through the layer that it would otherwise saturate into a
            // hard band.
            float horizonFade = smoothstep(0.0, 0.14, dir.y);
            color = mix(color, clouds.rgb, clouds.a * horizonFade);
        }
#endif
#else
        color = glcolor.rgb;
#endif
    }

    outColor0 = vec4(color, 1.0);
    outColor1 = vec4(0.5, 0.5, 1.0, MAT_SKY);
}
