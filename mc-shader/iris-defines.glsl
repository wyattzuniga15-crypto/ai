/* ============================================================================
   iris-defines.glsl - macros that IRIS injects, reproduced for offline
   validation only.

   THIS FILE IS NOT PART OF THE SHADERPACK and must never be #included by it.
   check.sh splices it in after the #version line of each stage before handing
   the source to glslangValidator. Iris supplies the real values at load time;
   if this file were inside Custom/shaders/ it would shadow them.

   Values are taken from the Iris docs (Reference/Macros/*). Where a value is
   environment-dependent, the setting chosen here is the one this pack targets:
   Minecraft 1.21.11, Iris 1.10.7, OpenGL 3.3+.
   ========================================================================= */

#define IS_IRIS
#define IRIS_VERSION 11007          // 1.10.7, encoded 1-major 2-minor 2-release
#define MC_VERSION   12111          // 1.21.11
#define MC_GL_VERSION   330
#define MC_GLSL_VERSION 330
#define MAX_COLOR_BUFFERS 32        // 32 since Iris 1.10.5 (16 before)
#define MC_MIPMAP_LEVEL 4
#define MC_HAND_DEPTH 0.125
#define IRIS_TAG_SUPPORT 2

/* Render stages, in the order the Iris docs list them. The exact ordinals are
   Iris's business - what matters for validation is that each name exists and
   is a distinct integer constant. */
#define MC_RENDER_STAGE_NONE                   0
#define MC_RENDER_STAGE_SKY                    1
#define MC_RENDER_STAGE_SUNSET                 2
#define MC_RENDER_STAGE_CUSTOM_SKY             3
#define MC_RENDER_STAGE_SUN                    4
#define MC_RENDER_STAGE_MOON                   5
#define MC_RENDER_STAGE_STARS                  6
#define MC_RENDER_STAGE_VOID                   7
#define MC_RENDER_STAGE_TERRAIN_SOLID          8
#define MC_RENDER_STAGE_TERRAIN_CUTOUT_MIPPED  9
#define MC_RENDER_STAGE_TERRAIN_CUTOUT        10
#define MC_RENDER_STAGE_ENTITIES              11
#define MC_RENDER_STAGE_BLOCK_ENTITIES        12
#define MC_RENDER_STAGE_DESTROY               13
#define MC_RENDER_STAGE_OUTLINE               14
#define MC_RENDER_STAGE_DEBUG                 15
#define MC_RENDER_STAGE_HAND_SOLID            16
#define MC_RENDER_STAGE_TERRAIN_TRANSLUCENT   17
#define MC_RENDER_STAGE_TRIPWIRE              18
#define MC_RENDER_STAGE_PARTICLES             19
#define MC_RENDER_STAGE_CLOUDS                20
#define MC_RENDER_STAGE_RAIN_SNOW             21
#define MC_RENDER_STAGE_WORLD_BORDER          22
#define MC_RENDER_STAGE_HAND_TRANSLUCENT      23
