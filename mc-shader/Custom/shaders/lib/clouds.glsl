#ifndef LIB_CLOUDS_GLSL
#define LIB_CLOUDS_GLSL

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"

/* ============================================================================
   clouds.glsl - raymarched 2D-noise cloud layer.

   Density is separable: a 2D FBM over world XZ, multiplied by a vertical
   profile through a slab. That is what "2D noise" buys - the expensive part
   (the FBM) is evaluated per march step but never needs a third dimension, and
   the vertical shape is a closed-form curve.

   The march is deliberately short. This is the single easiest place in the
   whole pack to destroy the framerate, so the step count is an exposed option
   and the whole thing is switchable off.
   ========================================================================= */

#if CLOUD_QUALITY == 0
    #define CLOUD_STEPS 12
#elif CLOUD_QUALITY == 1
    #define CLOUD_STEPS 18
#elif CLOUD_QUALITY == 2
    #define CLOUD_STEPS 28
#else
    #define CLOUD_STEPS 40
#endif

const float CLOUD_THICKNESS = 42.0;

/* Feature size.

   This was 0.0016 - one noise lattice cell every 625 blocks. With the layer
   300 blocks up, a single cell then spanned roughly 50 degrees of sky, so the
   whole visible cloudscape was two or three enormous blobs smeared across the
   view. That is what made them look like oil slicks rather than clouds.

   0.012 puts a cell every ~83 blocks, which at a realistic layer height reads
   as a puff about 10 degrees across - the scale actual cumulus appears at. */
const float CLOUD_NOISE_SCALE = 0.012;

const float CLOUD_EXTINCTION = 0.095;

/* Longest ray the march will follow. Near-horizontal rays would otherwise run
   for kilometres and force step lengths far longer than a cloud feature,
   undersampling into streaks. Truncating here costs only the far horizon,
   which horizonFade is already dissolving anyway. */
const float CLOUD_MAX_DISTANCE = 1600.0;

// Hard ceiling on step length, in blocks. Guarantees several samples per
// feature no matter which way the camera points.
const float CLOUD_MAX_STEP = 26.0;

/* Rotating between octaves matters. Doubling the frequency on the same axes
   leaves every octave's lattice aligned with the last, and the result shows
   obvious horizontal and vertical streaks. The 2.03 rather than an exact 2.0
   is for the same reason: exact doubling re-registers the lattice. */
const mat2 FBM_ROT = mat2(0.80, 0.60, -0.60, 0.80);

/* Normalised to 0..1.

   The amplitudes sum to 0.875, not 1.0, so the raw sum only ever reaches 0.875
   and averages ~0.44. The coverage threshold ramps up to (1 - COVERAGE + 0.28),
   which at the default lands at 0.78 - so clouds could never become fully
   dense, and at low coverage settings the upper end of the ramp was above the
   maximum the noise could produce at all. Dividing by the amplitude sum makes
   the threshold mean what it says. */
float cloudFBM3(vec2 p) {
    float value = 0.0;
    float amp   = 0.5;
    float total = 0.0;
    // Five octaves rather than three. Three gave smooth blobs with no edge
    // detail; the upper octaves are what produce the ragged, wispy borders
    // that read as cloud instead of as fog.
    for (int i = 0; i < 5; i++) {
        value += amp * valueNoise(p);
        total += amp;
        p      = FBM_ROT * p * 2.03;
        amp   *= 0.5;
    }
    return value / total;
}

// Two octaves, for the light-direction taps. The sun's optical depth only
// needs the broad shape - spending a third octave on it is not visible.
float cloudFBM2(vec2 p) {
    float value = 0.5 * valueNoise(p);
    p = FBM_ROT * p * 2.03;
    value += 0.25 * valueNoise(p);
    return value / 0.75;          // normalised, as above
}

/* Wind offset, expressed directly in noise-lattice cells per hour.

   frameTimeCounter resets at 3600s. Expressing the drift as an integer number
   of lattice cells over exactly that period means the noise field is bit-identical
   either side of the reset, so the entire cloudscape does not jump once an
   hour. The base is even so that every CLOUD_SPEED in the option list
   (0, 0.5, 1, 2, 4) still lands on whole cells. */
vec2 cloudWind(float time) {
    return vec2(38.0, 12.0) * (time / 3600.0) * CLOUD_SPEED;
}

float cloudDensity(vec3 worldPos, vec2 wind, bool cheap) {
    vec2 p = worldPos.xz * CLOUD_NOISE_SCALE + wind;

    float n = cheap ? cloudFBM2(p) : cloudFBM3(p);

    // Coverage threshold. Everything below it is clear sky; the soft width
    // above it is what gives clouds wispy edges rather than hard cutouts.
    // The window is wider than before (0.34) so edges dissolve gradually
    // instead of ending on a visible contour line.
    float coverage = smoothstep(1.0 - CLOUD_COVERAGE,
                                1.0 - CLOUD_COVERAGE + 0.34, n);

    // Vertical profile through the slab: fades in at the base, out at the top,
    // with the top fade broader so clouds look flat-bottomed and billowed on
    // top, the way real cumulus does.
    float h = clamp((worldPos.y - CLOUD_HEIGHT) / CLOUD_THICKNESS, 0.0, 1.0);
    float profile = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.55, h);

    return coverage * profile;
}

// Ray/slab intersection. Returns false if the ray never enters the layer.
bool cloudSlabRange(vec3 origin, vec3 dir, out float tNear, out float tFar) {
    tNear = 0.0;
    tFar  = 0.0;

    float bottom = CLOUD_HEIGHT;
    float top    = CLOUD_HEIGHT + CLOUD_THICKNESS;

    // Looking along the layer: the ray is inside forever, or never.
    if (abs(dir.y) < 1e-4) {
        if (origin.y < bottom || origin.y > top) return false;
        tNear = 0.0;
        tFar  = CLOUD_MAX_DISTANCE;
        return true;
    }

    float t0 = (bottom - origin.y) / dir.y;
    float t1 = (top    - origin.y) / dir.y;
    tNear = max(min(t0, t1), 0.0);
    tFar  = max(t0, t1);

    if (tFar <= tNear) return false;

    // Near-horizontal rays cross an enormous span of the layer. Capping it
    // keeps the step size sane; beyond this the clouds are a flat haze anyway.
    tFar = min(tFar, tNear + CLOUD_MAX_DISTANCE);
    return true;
}

/* Henyey-Greenstein phase function.

   Cloud droplets scatter strongly forward, which is why a cloud with the sun
   behind it has a bright silver lining and the same cloud lit from behind you
   looks flat grey. Without a phase function clouds are uniformly lit blobs and
   the whole sky reads as fake. */
float hgPhase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return (1.0 - g2) / (4.0 * PI * denom * sqrt(max(denom, 1e-4)));
}

// Optical depth from a point toward the sun, two taps. Enough to make the lit
// side of a cloud brighter than its core, which is most of the self-shadowing
// that reads at this scale.
float cloudSunDepth(vec3 p, vec3 sunDir, vec2 wind) {
    float stepLen = CLOUD_THICKNESS * 0.45;
    float depth = 0.0;
    for (int i = 1; i <= 2; i++) {
        vec3 sp = p + sunDir * (stepLen * float(i));
        depth += cloudDensity(sp, wind, true) * stepLen;
    }
    return depth;
}

/* Returns rgb = scattered light, a = coverage (1 - transmittance).
   camPos and dir are world space; dir must be normalised. */
vec4 raymarchClouds(vec3 camPos, vec3 dir, LightContext ctx,
                    float time, float dither) {
    float tNear, tFar;
    if (!cloudSlabRange(camPos, dir, tNear, tFar)) return vec4(0.0);

    // Bound the span so step length can never exceed CLOUD_MAX_STEP. Without
    // this, a near-horizontal ray divides a 1600-block span by the step count
    // and takes 130-block strides through 83-block features, which aliases
    // into horizontal streaks.
    float span    = min(tFar - tNear, CLOUD_MAX_STEP * float(CLOUD_STEPS));
    float stepLen = span / float(CLOUD_STEPS);
    tFar          = tNear + span;

    vec2  wind    = cloudWind(time);

    float cosTheta = dot(dir, ctx.sunDir);
    // Two lobes: strong forward scatter for the silver lining, plus a weak
    // near-isotropic term so clouds away from the sun are not black.
    float phase = mix(hgPhase(cosTheta, 0.76), hgPhase(cosTheta, -0.15), 0.30);

    vec3 sunColor = ctx.isNight
                  ? moonlightColor(abs(ctx.sunHeight)) * 1.5
                  : sunlightColor(ctx.sunHeight);

    /* Ambient/multiple-scattering floor.

       Clouds are white. Not because they are lit hard, but because their
       droplets scatter light dozens of times before it leaves - so even the
       shaded underside of a cumulus is bright grey, never the dark blue a
       single-scatter model gives it. This floor is deliberately generous and
       only lightly tinted; it is what separates "cloud" from "smoke". */
    vec3 ambient = mix(skyAmbientColor(ctx.sunHeight, vec3(0.0, 1.0, 0.0)),
                       vec3(1.0), 0.45) * 1.15;

    float transmittance = 1.0;
    vec3  scattered     = vec3(0.0);

    for (int i = 0; i < CLOUD_STEPS; i++) {
        // The dither offsets the whole sample set per pixel. Without it, the
        // fixed step positions print themselves across the sky as concentric
        // banding wherever the layer is thin.
        float t = tNear + (float(i) + dither) * stepLen;
        if (t > tFar) break;

        vec3  p = camPos + dir * t;
        float density = cloudDensity(p, wind, false);
        if (density < 0.002) continue;

        float sunDepth = cloudSunDepth(p, ctx.sunDir, wind);

        /* Multiple scattering, as a sum of Beer terms.

           A single exp(-d) is single-scattering: it says light either gets
           through or is absorbed, so anything optically thick goes black. In a
           real cloud that "absorbed" light is not gone, it has just bounced,
           and most of it eventually comes back out. Summing octaves with
           progressively weaker extinction and contribution approximates those
           later bounces cheaply, and is the difference between clouds that
           look white and fluffy and clouds that look like storm smoke. */
        float d = sunDepth * CLOUD_EXTINCTION;
        float beer = exp(-d)
                   + 0.62 * exp(-d * 0.28)
                   + 0.32 * exp(-d * 0.07);
        vec3 sunLight = sunColor * beer * 0.55;

        /* Powder term. Beer's law alone makes the lit edge of a cloud its
           brightest point, but real clouds darken right at the edge because
           there is too little material there to scatter much back. This
           reintroduces that, and is what stops clouds looking like fog. */
        float powder = 1.0 - exp(-density * stepLen * CLOUD_EXTINCTION * 4.0);

        vec3 luminance = sunLight * phase * powder * 7.0 + ambient;

        // Analytic integration of the constant-density segment, rather than a
        // rectangle rule: exact for the step, and stays stable at low step
        // counts where a rectangle rule visibly under-integrates.
        float stepTrans = exp(-density * stepLen * CLOUD_EXTINCTION);
        scattered     += transmittance * (1.0 - stepTrans) * luminance;
        transmittance *= stepTrans;

        if (transmittance < 0.01) break;
    }

    return vec4(scattered, 1.0 - transmittance);
}

#endif // LIB_CLOUDS_GLSL
