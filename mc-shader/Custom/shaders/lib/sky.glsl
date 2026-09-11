#ifndef LIB_SKY_GLSL
#define LIB_SKY_GLSL

#include "/lib/common.glsl"
#include "/lib/lighting.glsl"

/* ============================================================================
   sky.glsl - analytic sky gradient.

   A two-colour zenith/horizon mix driven by sun height, plus forward-scattered
   glow around the sun itself. Not a full atmospheric scattering integral -
   that costs far more than it is worth here - but it reproduces the parts that
   read as "sky": the horizon stays brighter and warmer than the zenith, the
   whole dome shifts through orange at low sun, and looking toward the sun is
   brighter than looking away from it.

   Used by the sky programs, and as the fallback colour wherever a screen-space
   reflection ray leaves the screen without hitting anything.
   ========================================================================= */

/* Daytime endpoints. Deeper, more saturated blue at the zenith and a
   brighter horizon than before - the old pair sat close together in both
   value and saturation, which flattened the dome into one wash of pale blue
   with no sense of depth. */
const vec3 SKY_ZENITH_DAY  = vec3(0.10, 0.30, 0.82);
const vec3 SKY_HORIZON_DAY = vec3(0.62, 0.80, 1.00);

// Around sunrise/sunset.
const vec3 SKY_ZENITH_DUSK  = vec3(0.14, 0.14, 0.44);
const vec3 SKY_HORIZON_DUSK = vec3(1.00, 0.42, 0.16);

// Night.
const vec3 SKY_ZENITH_NIGHT  = vec3(0.010, 0.018, 0.048);
const vec3 SKY_HORIZON_NIGHT = vec3(0.035, 0.052, 0.105);

/* dir must be a normalised player-space direction. */
vec3 getSkyColor(vec3 dir, LightContext ctx) {
    float sunHeight = ctx.sunHeight;

    // Two blends rather than one: day->dusk peaks as the sun crosses the
    // horizon, dusk->night finishes after it is well below. A single mix
    // would slide straight from blue to black and skip the orange entirely.
    float dayAmount   = smoothstep(-0.02, 0.28, sunHeight);
    float nightAmount = smoothstep(0.06, -0.22, sunHeight);

    vec3 zenith  = mix(SKY_ZENITH_DUSK,  SKY_ZENITH_DAY,  dayAmount);
    vec3 horizon = mix(SKY_HORIZON_DUSK, SKY_HORIZON_DAY, dayAmount);
    zenith  = mix(zenith,  SKY_ZENITH_NIGHT,  nightAmount);
    horizon = mix(horizon, SKY_HORIZON_NIGHT, nightAmount);

    /* Horizon concentration. A linear mix on dir.y puts the transition
       halfway up the dome, which looks like a painted backdrop. Real sky
       compresses the gradient into the last few degrees above the horizon
       because that is where the line of sight passes through the most air,
       so the falloff is steep. */
    float up = clamp(dir.y, 0.0, 1.0);
    float horizonBlend = exp(-up * 4.5);

    vec3 sky = mix(zenith, horizon, horizonBlend);

    /* Forward scatter around the sun. Two lobes: a wide one that lifts the
       whole quarter of the sky the sun is in, and a tight one for the bright
       core. The wide lobe is what sells low sun - at sunset the glow spreads
       across a huge span of horizon, not just a disc. */
    float sunCos = clamp(dot(dir, ctx.sunDir), 0.0, 1.0);
    float wide   = pow(sunCos, 4.0);
    float tight  = pow(sunCos, 90.0);

    vec3 glowColor = sunlightColor(max(sunHeight, 0.0));
    // Stronger near the horizon, where the light travels furthest through air.
    float lowSun = 1.0 - smoothstep(0.0, 0.45, sunHeight);
    sky += glowColor * (wide * (0.18 + 0.55 * lowSun) + tight * 1.6);

    // A matching, much weaker term for the moon.
    float moonCos = clamp(dot(dir, -ctx.sunDir), 0.0, 1.0);
    sky += vec3(0.10, 0.13, 0.22) * pow(moonCos, 24.0) * nightAmount * 0.35;

    return max(sky, vec3(0.0));
}

/* Below the horizon there is no sky, but a reflection ray can still point
   down. Fading to a darkened horizon colour there is cheaper and more stable
   than letting the gradient run negative. */
vec3 getSkyColorWithGround(vec3 dir, LightContext ctx, vec3 groundTint) {
    vec3 sky = getSkyColor(vec3(dir.x, abs(dir.y), dir.z), ctx);
    float below = smoothstep(0.0, -0.15, dir.y);
    return mix(sky, sky * groundTint, below);
}

#endif // LIB_SKY_GLSL
