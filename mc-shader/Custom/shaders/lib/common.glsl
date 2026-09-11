#ifndef LIB_COMMON_GLSL
#define LIB_COMMON_GLSL

#include "/lib/settings.glsl"

/* ============================================================================
   common.glsl - constants, small math helpers, and encode/decode shared by
   every program. No uniform declarations live here: each program declares the
   uniforms it actually uses, so an unused uniform never ends up in a program
   that Iris would then have to bind.
   ========================================================================= */

const float PI      = 3.14159265358979;
const float TAU     = 6.28318530717959;
const float HALF_PI = 1.57079632679490;

// ---- Material IDs ----------------------------------------------------------
// Stored in colortex1.a, quantised so an RGBA16F round-trip is exact.
// Read back with matchMat(). Keep these sparse enough that half-float
// precision can never alias two of them together.
#define MAT_OTHER   0.0
#define MAT_TERRAIN 0.1
#define MAT_ENTITY  0.3
#define MAT_HAND    0.5
#define MAT_WATER   0.7
#define MAT_SKY     0.9

bool matchMat(float stored, float id) { return abs(stored - id) < 0.05; }

// ---- Small math ------------------------------------------------------------
float sq(float x)  { return x * x; }
float cube(float x) { return x * x * x; }
float maxOf(vec3 v) { return max(v.x, max(v.y, v.z)); }

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2 v)  { return clamp(v, 0.0, 1.0); }
vec3  saturate(vec3 v)  { return clamp(v, 0.0, 1.0); }

// Rec.709 luma. Used by bloom thresholding and auto-exposure.
float luminance(vec3 c) { return dot(c, vec3(0.2125, 0.7154, 0.0721)); }

// ---- Normal packing --------------------------------------------------------
// colortex1 is RGBA16F, so a plain remap is lossless enough and far cheaper
// than octahedral encoding. Nothing here needs sub-degree normal accuracy.
vec3 encodeNormal(vec3 n) { return n * 0.5 + 0.5; }
vec3 decodeNormal(vec3 e) { return normalize(e * 2.0 - 1.0); }

// ---- Hashes and noise ------------------------------------------------------
// Cheap, no texture fetch. Used for dither and for the cloud/caustic FBM.
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise with quintic interpolation - smooth enough for cloud FBM
// without the banding you get from plain smoothstep.
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Interleaved gradient noise - the standard cheap per-pixel dither. Used to
// rotate sampling kernels so banding turns into noise the eye ignores.
float igNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

#endif // LIB_COMMON_GLSL
