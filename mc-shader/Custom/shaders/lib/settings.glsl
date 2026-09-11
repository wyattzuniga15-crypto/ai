#ifndef LIB_SETTINGS_GLSL
#define LIB_SETTINGS_GLSL

/* ============================================================================
   settings.glsl - every user-facing option lives here, and ONLY here.
   Iris requires an option macro to be defined identically in every file that
   uses it; including this one file everywhere guarantees that.
   The value list in each trailing comment is what Iris turns into the GUI
   control. Do not reformat those comments.
   ========================================================================= */

// ---- Shadows ---------------------------------------------------------------
#define SHADOW_QUALITY 1            // [0 1 2] Shadow filter quality. 0 = hard edges (fastest), 1 = PCF, 2 = wide PCF.
#define SHADOW_SOFTNESS 1.0         // [0.4 0.6 0.8 1.0 1.5 2.0 3.0] Radius of the soft shadow penumbra, in shadow texels.
#define SHADOW_BIAS_SCALE 1.0       // [0.5 0.75 1.0 1.5 2.0 3.0] Normal-offset bias strength. Raise if you see shadow acne, lower if shadows detach from their caster.
#define SHADOW_DISTORTION 0.85      // [0.0 0.5 0.7 0.85 0.95] Shadow map distortion. Higher pushes more texels toward the player.

// ---- Lighting --------------------------------------------------------------
#define SSAO                        // Screen-space ambient occlusion in the corners of geometry.
#define SSAO_QUALITY 1              // [0 1 2] SSAO sample count. 0 = 6 samples, 1 = 10, 2 = 16.
#define SSAO_STRENGTH 1.0           // [0.0 0.5 0.75 1.0 1.5 2.0] How dark the ambient occlusion gets.
#define SSAO_RADIUS 0.6             // [0.3 0.45 0.6 0.9 1.2] SSAO sample radius in blocks.

#define BLOCKLIGHT_STRENGTH 1.0     // [0.0 0.5 0.75 1.0 1.25 1.5 2.0] Brightness of torch/lava light.
#define SKYLIGHT_STRENGTH 1.0       // [0.0 0.5 0.75 1.0 1.25 1.5 2.0] Brightness of ambient sky light.
#define SUNLIGHT_STRENGTH 1.0       // [0.0 0.5 0.75 1.0 1.25 1.5 2.0] Brightness of direct sun/moon light.

// ---- Water -----------------------------------------------------------------
#define WATER_WAVES                 // Vertex displacement on the water surface.
#define WAVE_STRENGTH 1.0           // [0.0 0.25 0.5 0.75 1.0 1.5 2.0 3.0] Height of the water waves.
#define WAVE_SPEED 1.0              // [0.0 0.5 0.75 1.0 1.5 2.0] How fast the waves travel.
#define WATER_NORMAL_STRENGTH 1.0   // [0.25 0.5 0.75 1.0 1.5 2.0] Strength of the analytic water normal map.

#define SSR                         // Screen-space reflections on water.
#define SSR_QUALITY 1               // [0 1 2] Reflection ray steps. 0 = 12 steps, 1 = 20, 2 = 32.
#define WATER_ABSORPTION 1.0        // [0.0 0.5 0.75 1.0 1.5 2.0] How quickly water darkens with depth.
#define WATER_REFRACTION            // Bend what you see through the water surface.
#define WATER_CAUSTICS              // Animated light patterns when underwater.

// ---- Sky and clouds --------------------------------------------------------
#define CUSTOM_SKY                  // Analytic sky gradient driven by sun position, instead of the vanilla texture.
#define VOLUMETRIC_CLOUDS           // Raymarched cloud layer. This is the single most expensive option here.
#define CLOUD_QUALITY 1             // [0 1 2 3] Cloud raymarch steps. 0 = 8 (fastest), 1 = 12, 2 = 20, 3 = 32.
#define CLOUD_COVERAGE 0.5          // [0.3 0.4 0.5 0.6 0.7] How much of the sky the clouds fill.
#define CLOUD_HEIGHT 300.0          // [160.0 220.0 300.0 400.0] Altitude of the cloud layer, in blocks.
#define CLOUD_SPEED 1.0             // [0.0 0.5 1.0 2.0 4.0] How fast clouds drift.

// ---- Post processing -------------------------------------------------------
#define BLOOM                       // Glow around bright things.
#define BLOOM_STRENGTH 0.35         // [0.0 0.1 0.2 0.35 0.5 0.75 1.0] How much bloom is mixed into the image.
#define AUTO_EXPOSURE               // Adapt overall brightness to the scene, like an eye.
#define EXPOSURE 1.0                // [0.25 0.5 0.75 1.0 1.25 1.5 2.0 3.0] Manual exposure multiplier, applied on top of auto-exposure.
#define EXPOSURE_SPEED 1.0          // [0.25 0.5 1.0 2.0 4.0] How fast auto-exposure adapts.
#define TONEMAP 1                   // [0 1 2] Tonemap curve. 0 = none (clip), 1 = Uchimura, 2 = ACES fitted.
#define VIGNETTE                    // Slight darkening toward the edges of the screen.
#define VIGNETTE_STRENGTH 0.25      // [0.0 0.1 0.25 0.4 0.6] How strong the vignette is.

#endif // LIB_SETTINGS_GLSL
