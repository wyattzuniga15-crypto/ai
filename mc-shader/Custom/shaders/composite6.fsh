#version 330 compatibility

/* Auto-exposure.

   Reads the averaged log-luminance carried in colortex10's alpha channel -
   accumulated for free by the bloom downsample chain - and writes a single
   smoothed exposure value into colortex11, which is a tiny buffer with
   clearing disabled so it survives into the next frame.

   Only the first texel does the work. The buffer is 8x8 rather than 1x1 so
   that a 1-pixel viewport is never relied on; the rest of the texels just copy
   the previous value, which costs nothing and keeps the pass bounded no matter
   how Iris sizes the viewport.
   ========================================================================= */

#include "/lib/common.glsl"
#include "/lib/post.glsl"

uniform sampler2D colortex10;   // smallest bloom mip; .a = mean log luminance
uniform sampler2D colortex11;   // previous frame's exposure
uniform float frameTime;

in vec2 texcoord;

/* RENDERTARGETS: 11 */
layout(location = 0) out vec4 outExposure;

// colortex11 must survive between frames - it IS the adaptation history.
const bool colortex11Clear = false;

void main() {
    float previous = texture(colortex11, vec2(0.5)).r;

    // First frame: the buffer starts at zero, which would divide out to an
    // absurd exposure. Start from neutral instead.
    if (previous <= 0.0) previous = 1.0;

    if (gl_FragCoord.x > 1.0 || gl_FragCoord.y > 1.0) {
        outExposure = vec4(previous);
        return;
    }

    /* Average what is already a heavily box-filtered 1/32-scale buffer. A 6x6
       grid over it is a good estimate of the whole frame and keeps this pass
       to 36 fetches. */
    float total = 0.0;
    for (int x = 0; x < 6; x++) {
        for (int y = 0; y < 6; y++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / 6.0;
            total += texture(colortex10, uv).a;
        }
    }
    float avgLogLuminance = total / 36.0;

    float target = exposureFromLogLuminance(avgLogLuminance);
    float adapted = adaptExposure(previous, target, frameTime);

    outExposure = vec4(adapted);
}
