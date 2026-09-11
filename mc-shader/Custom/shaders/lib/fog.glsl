#ifndef LIB_FOG_GLSL
#define LIB_FOG_GLSL

/* ============================================================================
   fog.glsl - reproduction of vanilla's fog.

   Iris hands us the exact fog parameters the vanilla renderer would have used
   (fogStart/fogEnd/fogMode/fogShape/fogDensity/fogColor), so matching vanilla
   is a matter of applying them rather than inventing a curve.

   Including programs must declare:
       uniform vec3  fogColor;
       uniform float fogStart, fogEnd, fogDensity;
       uniform int   fogMode, fogShape;
   ========================================================================= */

// LWJGL GL11 constants, per the Iris fogMode docs.
#define FOG_MODE_EXP    2048
#define FOG_MODE_EXP2   2049
#define FOG_MODE_LINEAR 9729

// Returns 1.0 for "no fog here", 0.0 for "fully fogged".
float vanillaFogFactor(vec3 viewPos, float fStart, float fEnd, float fDensity,
                       int mode, int shape) {
    // shape 0 = spherical (plain distance), 1 = cylindrical (horizontal
    // distance vs height, whichever is greater). Cylindrical is what vanilla
    // uses at the world height limits so the sky doesn't fog out overhead.
    float dist;
    if (shape == 1) {
        dist = max(length(viewPos.xz), abs(viewPos.y));
    } else {
        dist = length(viewPos);
    }

    float f;
    if (mode == FOG_MODE_LINEAR) {
        f = (fEnd - dist) / max(fEnd - fStart, 1e-4);
    } else if (mode == FOG_MODE_EXP) {
        f = exp(-fDensity * dist);
    } else if (mode == FOG_MODE_EXP2) {
        float fd = fDensity * dist;
        f = exp(-fd * fd);
    } else {
        f = 1.0;
    }
    return clamp(f, 0.0, 1.0);
}

vec3 applyVanillaFog(vec3 color, vec3 viewPos, vec3 fColor, float fStart,
                     float fEnd, float fDensity, int mode, int shape) {
    float f = vanillaFogFactor(viewPos, fStart, fEnd, fDensity, mode, shape);
    return mix(fColor, color, f);
}

#endif // LIB_FOG_GLSL
