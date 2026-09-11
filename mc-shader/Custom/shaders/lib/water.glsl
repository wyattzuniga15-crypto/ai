#ifndef LIB_WATER_GLSL
#define LIB_WATER_GLSL

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"

/* ============================================================================
   water.glsl - wave displacement, the analytic normal that goes with it,
   Fresnel, and depth absorption.

   The waves are a sum of three directional travelling waves. Real Gerstner
   waves also displace horizontally, which sharpens crests properly - but
   Minecraft's water surface only has vertices at block corners, so horizontal
   displacement tears the mesh at chunk seams. Instead the crest sharpening is
   done by raising a sine to a power, which gives the same pointed-crest,
   flat-trough profile from vertical displacement alone and stays exactly
   differentiable.

   That differentiability is the point: the normal is the true analytic
   derivative of the displacement, not a separate noise texture that happens to
   look similar. A sampled normal map and a displaced mesh disagree about where
   the crests are, and the mismatch is visible as highlights sliding off the
   waves.
   ========================================================================= */

const int WAVE_OCTAVES = 3;

// Deliberately non-parallel and non-harmonic directions. Parallel waves make
// visible corduroy stripes; frequencies in small integer ratios re-synchronise
// into a repeating tile.
const vec2 WAVE_DIR[3] = vec2[3](
    vec2( 0.9436,  0.3310),
    vec2(-0.5150,  0.8572),
    vec2( 0.7492, -0.6623)
);

// Spatial frequency, radians per block.
const float WAVE_FREQ[3] = float[3](0.340, 0.735, 1.570);

// Relative amplitude. Each octave contributes less, so the large swell
// dominates and the small ripples only add detail.
const float WAVE_AMP[3] = float[3](1.000, 0.480, 0.215);

/* Temporal frequency, radians per second.

   These are snapped so that each wave completes a whole number of cycles in
   3600 seconds: frameTimeCounter resets at exactly 3600s, and any other value
   would make the whole surface visibly jump once an hour. The snap costs at
   most 0.04% of the intended speed.
        630 cycles -> 1.0995574,  934 -> 1.6301375,  1438 -> 2.5097835        */
const float WAVE_OMEGA[3] = float[3](1.0995574, 1.6301375, 2.5097835);

// Peak-to-trough height of the summed wave at WAVE_STRENGTH 1.0, in blocks.
// Kept well under half a block: water is a flat quad at the top of its block,
// so a taller wave pokes through the block above it.
const float WAVE_HEIGHT_BLOCKS = 0.075;

struct WaveSample {
    float height;   // 0..1, normalised
    vec2  slope;    // d(height)/d(xz), same normalisation
};

/* Crest shaping: w(p) = s^2 where s = sin(p)*0.5 + 0.5.

   s is in 0..1, so squaring pulls the troughs flat and leaves the crests
   relatively pointed. The derivative is exact:
       dw/dp = 2*s * ds/dp = 2*s * (0.5*cos(p)) = s*cos(p)                    */
WaveSample sampleWaves(vec2 worldXZ, float time) {
    WaveSample result;
    result.height = 0.0;
    result.slope  = vec2(0.0);

    float ampSum = 0.0;
    for (int i = 0; i < WAVE_OCTAVES; i++) {
        float freq  = WAVE_FREQ[i];
        float amp   = WAVE_AMP[i];
        vec2  dir   = WAVE_DIR[i];

        float phase = dot(dir, worldXZ) * freq + time * WAVE_OMEGA[i] * WAVE_SPEED;
        float s     = sin(phase) * 0.5 + 0.5;

        result.height += amp * s * s;
        // Chain rule through the spatial term: d(phase)/d(xz) = freq * dir.
        result.slope  += amp * (s * cos(phase)) * freq * dir;
        ampSum        += amp;
    }

    result.height /= ampSum;
    result.slope  /= ampSum;
    return result;
}

// Vertical displacement in blocks, centred on zero so the mean water level
// stays where vanilla put it.
float waveDisplacement(WaveSample w) {
    return (w.height - 0.5) * WAVE_HEIGHT_BLOCKS * WAVE_STRENGTH;
}

/* The surface normal implied by that displacement.

   For a height field y = A*h(x,z) the normal is normalize(-A*dh/dx, 1, -A*dh/dz).
   Using the same A as waveDisplacement keeps the normal and the geometry
   describing the same surface. WATER_NORMAL_STRENGTH then scales only the
   shading detail, which is a legitimate cheat: it adds ripple detail finer
   than the block-corner vertex grid could ever represent. */
vec3 waveNormal(WaveSample w) {
    float amp = WAVE_HEIGHT_BLOCKS * WAVE_STRENGTH * WATER_NORMAL_STRENGTH;
    return normalize(vec3(-w.slope.x * amp, 1.0, -w.slope.y * amp));
}

/* ---- Fresnel --------------------------------------------------------------

   Schlick's approximation. F0 for water is 0.02 - at a right angle only 2% of
   light reflects, which is why you can see straight down into still water, and
   why it turns mirror-like at a glancing angle. Getting this term right is
   most of what makes water read as water.                                    */
float fresnelSchlick(float cosTheta, float F0) {
    float m = clamp(1.0 - cosTheta, 0.0, 1.0);
    float m2 = m * m;
    return F0 + (1.0 - F0) * (m2 * m2 * m);   // m^5, without pow()
}

const float WATER_F0 = 0.02;

/* ---- Absorption -----------------------------------------------------------

   Beer-Lambert: light falls off exponentially with the distance travelled
   through the medium, at a different rate per wavelength. Water absorbs red
   fastest and blue-green slowest, which is why shallow water is clear and deep
   water goes blue-green before going black - not because it is "tinted blue",
   but because everything else has already been absorbed.

   Coefficients are per block of travel, roughly proportional to real water's
   absorption spectrum but compressed so the effect is visible over Minecraft
   depths rather than tens of metres.                                         */
const vec3 WATER_ABSORPTION_COEFF = vec3(0.52, 0.16, 0.09);

vec3 waterTransmittance(float distanceThroughWater) {
    float d = max(distanceThroughWater, 0.0) * WATER_ABSORPTION;
    return exp(-WATER_ABSORPTION_COEFF * d);
}

// What the water itself scatters back toward the eye. Without this, deep water
// is simply black rather than deep blue-green.
const vec3 WATER_SCATTER_COLOR = vec3(0.045, 0.150, 0.145);

/* Scatter is re-emitted ambient light, so it has to follow the ambient light
   level. Water at midnight that still glows the same blue-green as at noon is
   one of the most obvious tells of a shader faking it. */
float scatterLightScale(LightContext ctx) {
    return mix(0.08, 1.0, smoothstep(-0.20, 0.25, ctx.sunHeight));
}

/* ---- Caustics -------------------------------------------------------------

   Light refracting through the wavy surface converges into bright filaments on
   whatever is underneath. A proper simulation traces the refracted wavefront;
   the cheap standard trick is to take two copies of a cellular-ish noise
   scrolling in different directions and keep where both are bright, which
   produces the same branching filament structure.

   Driven by the same world position and time as the waves, so the caustics
   move with the surface above rather than sliding independently.             */
float waterCaustics(vec2 worldXZ, float time) {
    vec2 p = worldXZ * 0.85;
    float t = time * 0.65 * WAVE_SPEED;

    // Two layers, counter-rotating, at slightly different scales.
    float a = valueNoise(p + vec2( t * 0.7, -t * 0.5));
    float b = valueNoise(p * 1.37 + vec2(-t * 0.45, t * 0.8));
    float c = valueNoise(p * 2.11 + vec2( t * 0.9,  t * 0.3));

    // Ridged: fold the noise about its midpoint so the bright line is a thin
    // crest rather than a broad blob, then multiply the layers so only places
    // where several agree stay bright. That multiplication is what turns
    // blobs into filaments.
    float ra = 1.0 - abs(a * 2.0 - 1.0);
    float rb = 1.0 - abs(b * 2.0 - 1.0);
    float rc = 1.0 - abs(c * 2.0 - 1.0);

    float caustic = ra * rb * mix(1.0, rc, 0.6);
    return pow(clamp(caustic, 0.0, 1.0), 3.0);
}

#endif // LIB_WATER_GLSL
