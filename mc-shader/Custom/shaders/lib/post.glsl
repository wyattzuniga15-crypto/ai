#ifndef LIB_POST_GLSL
#define LIB_POST_GLSL

#include "/lib/common.glsl"

/* ============================================================================
   post.glsl - bloom mip-chain filters, tonemap curves, exposure, vignette.
   ========================================================================= */

// ---- Bloom prefilter -------------------------------------------------------
const float BLOOM_THRESHOLD = 1.0;
const float BLOOM_KNEE      = 0.55;

/* Soft-knee threshold rather than a hard cutoff.

   A hard `if (luma > threshold)` makes anything crossing the threshold pop
   into existence between frames - a light source drifting across the boundary
   flickers. The knee ramps contribution in quadratically over a band around
   the threshold, so brightness changes produce continuous bloom changes.      */
vec3 bloomPrefilter(vec3 color) {
    float brightness = maxOf(color);

    float soft = brightness - BLOOM_THRESHOLD + BLOOM_KNEE;
    soft = clamp(soft, 0.0, 2.0 * BLOOM_KNEE);
    soft = soft * soft / (4.0 * BLOOM_KNEE + 1e-4);

    float contribution = max(soft, brightness - BLOOM_THRESHOLD)
                       / max(brightness, 1e-4);
    return color * contribution;
}

/* Karis average weight, for the first downsample only.

   A single very bright pixel - a sun glint, a specular spark - survives a box
   downsample with its full energy and then gets spread into a large, crawling
   blob by the rest of the chain. Weighting by 1/(1+luma) before averaging
   caps how much any one pixel can contribute. Only the first step needs it;
   after that the fireflies are already gone and applying it again would just
   darken the bloom. */
float karisWeight(vec3 color) {
    return 1.0 / (1.0 + luminance(color));
}

/* 13-tap downsample (Jimenez / Call of Duty).

   A plain 2x2 box downsample aliases badly: a thin bright line can vanish
   entirely at one mip and reappear at the next as the camera moves, which
   reads as the bloom boiling. The 13-tap pattern samples an overlapping ring
   plus an inner quad, which is stable under motion for the cost of a few extra
   bilinear fetches.

   Weights: centre 0.125, inner quad 4x0.125, edge midpoints 4x0.0625,
   corners 4x0.03125 - summing to exactly 1.0.                                */
vec4 downsample13(sampler2D tex, vec2 uv, vec2 texelSize, bool useKaris) {
    vec2 t = texelSize;

    vec4 a = texture(tex, uv + t * vec2(-2.0,  2.0));
    vec4 b = texture(tex, uv + t * vec2( 0.0,  2.0));
    vec4 c = texture(tex, uv + t * vec2( 2.0,  2.0));
    vec4 d = texture(tex, uv + t * vec2(-2.0,  0.0));
    vec4 e = texture(tex, uv);
    vec4 f = texture(tex, uv + t * vec2( 2.0,  0.0));
    vec4 g = texture(tex, uv + t * vec2(-2.0, -2.0));
    vec4 h = texture(tex, uv + t * vec2( 0.0, -2.0));
    vec4 i = texture(tex, uv + t * vec2( 2.0, -2.0));
    vec4 j = texture(tex, uv + t * vec2(-1.0,  1.0));
    vec4 k = texture(tex, uv + t * vec2( 1.0,  1.0));
    vec4 l = texture(tex, uv + t * vec2(-1.0, -1.0));
    vec4 m = texture(tex, uv + t * vec2( 1.0, -1.0));

    if (useKaris) {
        // Each group is averaged with Karis weights, then the groups are
        // combined with the normal weights. Weighting the whole 13 at once
        // would bias the spatial filter as well as the energy.
        float wa = karisWeight(a.rgb), wb = karisWeight(b.rgb);
        float wc = karisWeight(c.rgb), wd = karisWeight(d.rgb);
        float we = karisWeight(e.rgb), wf = karisWeight(f.rgb);
        float wg = karisWeight(g.rgb), wh = karisWeight(h.rgb);
        float wi = karisWeight(i.rgb), wj = karisWeight(j.rgb);
        float wk = karisWeight(k.rgb), wl = karisWeight(l.rgb);
        float wm = karisWeight(m.rgb);

        vec4 inner  = (j*wj + k*wk + l*wl + m*wm) / max(wj+wk+wl+wm, 1e-4);
        vec4 corner = (a*wa + c*wc + g*wg + i*wi) / max(wa+wc+wg+wi, 1e-4);
        vec4 edge   = (b*wb + d*wd + f*wf + h*wh) / max(wb+wd+wf+wh, 1e-4);
        vec4 centre = e;

        return centre * 0.125 + inner * 0.5 + edge * 0.25 + corner * 0.125;
    }

    vec4 result = e * 0.125;
    result += (a + c + g + i) * 0.03125;
    result += (b + d + f + h) * 0.0625;
    result += (j + k + l + m) * 0.125;
    return result;
}

/* 3x3 tent upsample.

   Upsampling with plain bilinear leaves the lower mip's texel grid visible as
   blocky structure in the glow. The tent (weights 1,2,1 / 2,4,2 / 1,2,1 over
   16) is a second filtering pass that removes it, and progressively tenting
   each level on the way back up is what turns the chain into a wide, smooth
   falloff rather than a stack of distinct blur radii. */
vec4 upsampleTent(sampler2D tex, vec2 uv, vec2 texelSize, float radius) {
    vec4 d = vec4(texelSize.x, texelSize.y, -texelSize.x, 0.0) * radius;

    vec4 s  = texture(tex, uv - d.xy);
    s += texture(tex, uv - d.wy) * 2.0;
    s += texture(tex, uv - d.zy);
    s += texture(tex, uv + d.zw) * 2.0;
    s += texture(tex, uv       ) * 4.0;
    s += texture(tex, uv + d.xw) * 2.0;
    s += texture(tex, uv + d.zy);
    s += texture(tex, uv + d.wy) * 2.0;
    s += texture(tex, uv + d.xy);

    return s * (1.0 / 16.0);
}

// ---- Exposure --------------------------------------------------------------
/* Middle-grey target: the mean scene luminance is mapped to this.

   This value has to be chosen against the TONEMAP, not in isolation, and that
   is where this was previously wrong. It was 0.12, but Uchimura's toe maps
   0.12 to 0.098 in display space - so the whole frame averaged under 0.10 and
   every screenshot came out about 2.4x under-exposed, with bright sky over
   near-black terrain.

   0.25 lands inside the curve's linear section, where it passes through
   essentially unchanged, so the frame now averages ~0.25 - normal exposure. */
const float EXPOSURE_KEY = 0.25;
const float EXPOSURE_MIN = 0.25;
const float EXPOSURE_MAX = 8.0;

float exposureFromLogLuminance(float avgLogLuminance) {
    float avgLuminance = exp2(avgLogLuminance);
    return clamp(EXPOSURE_KEY / max(avgLuminance, 1e-4),
                 EXPOSURE_MIN, EXPOSURE_MAX);
}

/* Exponential smoothing toward the target, framerate-independent.

   Using a fixed per-frame lerp factor would make adaptation faster at high
   framerates, so the same scene would feel different on different hardware.
   1 - exp(-dt * rate) is the continuous form and behaves identically at any
   framerate.

   Eyes also dark-adapt far more slowly than they light-adapt, so brightening
   is deliberately given a slower rate than darkening. */
float adaptExposure(float previous, float target, float deltaTime) {
    float rate = (target < previous ? 2.2 : 0.9) * EXPOSURE_SPEED;
    float blend = 1.0 - exp(-max(deltaTime, 1e-4) * rate);
    return mix(previous, target, clamp(blend, 0.0, 1.0));
}

// ---- Tonemapping -----------------------------------------------------------
/* Uchimura's "Gran Turismo" curve.

   Three explicitly stitched regions: a toe with adjustable contrast, a linear
   midsection, and a shoulder that rolls off to the peak. Reinhard has neither
   a real toe nor a controllable linear section, so it desaturates everything
   bright and lifts blacks into grey - the washed-out look. Here the linear
   region means mid-tones pass through with their contrast intact.

   The toe exponent is 1.15 rather than the more common 1.33. At 1.33 the toe
   is steep enough to crush shadow detail into black, which was a large part of
   why terrain out of direct sun read as a silhouette.                        */
vec3 uchimura(vec3 x) {
    const float P = 1.0;    // maximum display brightness
    const float a = 1.0;    // contrast of the linear section
    const float m = 0.22;   // where the linear section starts
    const float l = 0.4;    // how much of the range is linear
    const float c = 1.15;   // toe contrast
    const float b = 0.0;    // black level

    float l0 = ((P - m) * l) / a;
    float S0 = m + l0;
    float S1 = m + a * l0;
    float C2 = (a * P) / (P - S1);
    float CP = -C2 / P;

    vec3 w0 = 1.0 - smoothstep(vec3(0.0), vec3(m), x);
    vec3 w2 = step(vec3(m + l0), x);
    vec3 w1 = 1.0 - w0 - w2;

    vec3 T = m * pow(max(x / m, 1e-5), vec3(c)) + b;   // toe
    vec3 L = m + a * (x - m);                          // linear
    vec3 S = P - (P - S1) * exp(CP * (x - S0));        // shoulder

    return T * w0 + L * w1 + S * w2;
}

/* ACES, Stephen Hill's fit of the RRT+ODT.

   More saturated and contrastier than Uchimura, with the characteristic ACES
   hue shift that pushes bright oranges toward yellow. Offered as the
   alternative because which one looks "right" is genuinely a taste call. */
const mat3 ACES_INPUT = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
);
const mat3 ACES_OUTPUT = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
);

vec3 rrtAndOdtFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 acesFitted(vec3 color) {
    color = ACES_INPUT * color;
    color = rrtAndOdtFit(color);
    color = ACES_OUTPUT * color;
    return clamp(color, 0.0, 1.0);
}

vec3 applyTonemap(vec3 color) {
#if TONEMAP == 1
    return clamp(uchimura(color), 0.0, 1.0);
#elif TONEMAP == 2
    return acesFitted(color);
#else
    return clamp(color, 0.0, 1.0);
#endif
}

// ---- Colour grading --------------------------------------------------------
/* Saturation, around the luminance the eye actually perceives rather than a
   plain channel average - so boosting it does not shift hues. */
vec3 applySaturation(vec3 color, float amount) {
    return mix(vec3(luminance(color)), color, amount);
}

/* Vibrance: saturation weighted toward colours that are not already saturated.

   A flat saturation boost drives already-vivid things (lava, redstone, a
   sunset) straight into clipped neon while barely helping the muted greens and
   browns that make up most of a Minecraft scene. Vibrance scales by how far a
   pixel currently is from grey, so it lifts the dull majority and leaves the
   vivid minority alone - which is what "colourful but not radioactive" means
   in practice. */
vec3 applyVibrance(vec3 color, float amount) {
    float mx  = maxOf(color);
    float mn  = min(color.r, min(color.g, color.b));
    float sat = mx - mn;                       // 0 = grey, 1 = fully saturated
    float boost = 1.0 + amount * (1.0 - sat);
    return mix(vec3(luminance(color)), color, boost);
}

/* Contrast about a mid-grey pivot. Done in display space after the tonemap,
   where 0.5 is genuinely the middle of the range. */
vec3 applyContrast(vec3 color, float amount) {
    return clamp((color - 0.5) * amount + 0.5, 0.0, 1.0);
}

/* White balance, applied in LINEAR light before the tonemap - which is where a
   real camera does it. Positive is warmer. Luminance-preserving, so it tints
   without also changing the exposure. */
vec3 applyWhiteBalance(vec3 color, float temperature) {
    vec3 tint = vec3(1.0 + temperature * 0.14,
                     1.0 + temperature * 0.01,
                     1.0 - temperature * 0.13);
    vec3 result = color * tint;
    float before = luminance(color);
    float after  = luminance(result);
    return result * (before / max(after, 1e-5));
}

// ---- Vignette --------------------------------------------------------------
/* Corrected for aspect ratio, or a widescreen display darkens the left and
   right edges far more than the top and bottom and the effect reads as a
   letterbox rather than a lens. */
vec3 applyVignette(vec3 color, vec2 texcoord, float aspect) {
    vec2 offset = (texcoord - 0.5) * vec2(aspect, 1.0);
    float r = length(offset) / length(vec2(aspect, 1.0) * 0.5);
    float v = 1.0 - VIGNETTE_STRENGTH * smoothstep(0.45, 1.15, r);
    return color * v;
}

#endif // LIB_POST_GLSL
