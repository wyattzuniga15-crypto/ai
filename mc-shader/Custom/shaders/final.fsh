#version 330 compatibility

/* ============================================================================
   final - exposure, bloom composite, tonemap, vignette, out to the screen.

   Order is not arbitrary. Bloom is added in HDR, BEFORE tonemapping, because
   glow is light that physically reached the sensor - adding it after the curve
   would let it blow past white with no roll-off and produce flat white blobs.
   Exposure comes before both, since it is what decides where "white" sits.
   Vignette is last, after the curve, because it is a lens effect rather than
   a property of the scene.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex0;    // HDR scene
uniform sampler2D colortex6;    // bloom, half res, fully accumulated
uniform sampler2D colortex11;   // exposure
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

layout(location = 0) out vec4 outColor0;

void main() {
    vec3 color = texture(colortex0, texcoord).rgb;

    // ---- exposure ----
    float exposure = EXPOSURE;
#ifdef AUTO_EXPOSURE
    exposure *= max(texture(colortex11, vec2(0.5)).r, 1e-3);
#endif
    color *= exposure;

    // ---- bloom ----
#ifdef BLOOM
    vec3 bloom = texture(colortex6, texcoord).rgb * exposure;
    color = mix(color, bloom, BLOOM_STRENGTH);
#endif

    // ---- tonemap ----
    color = applyTonemap(color);

    // ---- vignette ----
#ifdef VIGNETTE
    color = applyVignette(color, texcoord, viewWidth / max(viewHeight, 1.0));
#endif

    outColor0 = vec4(color, 1.0);
}
