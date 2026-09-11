#version 330 compatibility

/* Bloom chain, step 1 of 5: prefilter and halve.

   Also stashes log2(luminance) of the UNFILTERED scene in .a. The downsample
   filter averages it along with the colour for free, so by the last mip .a
   holds a box-filtered average of log luminance over the whole frame - which
   is exactly the geometric mean auto-exposure wants, at no extra cost.
   Log space matters: a linear average is dominated by a handful of bright
   pixels, so a single lamp in a dark cave would crush the whole exposure. */

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex0;
uniform float viewWidth;
uniform float viewHeight;

in vec2 texcoord;

/* RENDERTARGETS: 6 */
layout(location = 0) out vec4 outBloom;

void main() {
    vec2 texelSize = 1.0 / vec2(viewWidth, viewHeight);

    // Karis weighting on this step only - see lib/post.glsl.
    vec4 down = downsample13(colortex0, texcoord, texelSize, true);

    vec3 bloom = bloomPrefilter(down.rgb);
    float logLuminance = log2(max(luminance(down.rgb), 1e-4));

    outBloom = vec4(bloom, logLuminance);
}
