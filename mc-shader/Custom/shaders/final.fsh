#version 330 compatibility

/* ============================================================================
   final - exposure, bloom composite, tonemap, vignette, out to the screen.

   Order is not arbitrary, and follows what a real camera does:

     exposure -> white balance -> bloom -> tonemap -> saturation/vibrance/
     contrast -> vignette

   Bloom is added in HDR BEFORE tonemapping, because glow is light that
   physically reached the sensor; adding it after the curve would let it blow
   past white with no roll-off and produce flat white blobs. White balance is
   also pre-curve, in linear light, for the same reason - that is where a
   sensor applies it.

   Saturation, vibrance and contrast come AFTER the curve, in display space,
   where 0.5 is genuinely the middle of the range. Applying contrast in linear
   light pivots around a value that means nothing perceptually and crushes
   shadows. Vignette is last, being a lens effect rather than part of the
   scene.
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

    // ---- white balance (linear light, pre-curve) ----
#ifdef COLOR_GRADING
    color = applyWhiteBalance(color, WHITE_BALANCE);
#endif

    // ---- bloom ----
#ifdef BLOOM
    vec3 bloom = texture(colortex6, texcoord).rgb * exposure;
    color = mix(color, bloom, BLOOM_STRENGTH);
#endif

    // ---- tonemap ----
    color = applyTonemap(color);

    // ---- grading (display space, post-curve) ----
#ifdef COLOR_GRADING
    // Vibrance first: it lifts the dull majority of the frame. A flat
    // saturation pass afterwards then scales everything together without
    // having to be large enough to rescue the dull parts on its own, which is
    // what would push the already-vivid parts into clipping.
    color = applyVibrance(color, VIBRANCE);
    color = applySaturation(color, SATURATION);
    color = applyContrast(color, CONTRAST);
    color = clamp(color, 0.0, 1.0);
#endif

    // ---- vignette ----
#ifdef VIGNETTE
    color = applyVignette(color, texcoord, viewWidth / max(viewHeight, 1.0));
#endif

    outColor0 = vec4(color, 1.0);
}
