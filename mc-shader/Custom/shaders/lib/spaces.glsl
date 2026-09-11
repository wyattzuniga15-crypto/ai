#ifndef LIB_SPACES_GLSL
#define LIB_SPACES_GLSL

/* ============================================================================
   spaces.glsl - coordinate space conversions.

   The programs that include this must declare whichever of these uniforms
   they use:
       gbufferProjection, gbufferProjectionInverse,
       gbufferModelView,  gbufferModelViewInverse,
       shadowProjection,  shadowModelView
   They are NOT declared here, because declaring an unused sampler/uniform in
   a program is wasteful and makes Iris bind things it doesn't need.

   Naming follows the Iris docs:
     view space   - relative to camera, axes follow camera orientation, -z forward
     player space - relative to camera, axes follow world axes ("feet player space")
     world space  - player space + cameraPosition
   ========================================================================= */

// Undo the projection matrix. Takes NDC (-1..1) in, gives view space out.
vec3 ndcToView(vec3 ndc, mat4 projInverse) {
    vec4 v = projInverse * vec4(ndc, 1.0);
    return v.xyz / v.w;
}

// screenPos: xy = screen uv (0..1), z = raw depth buffer value (0..1)
vec3 screenToView(vec3 screenPos, mat4 projInverse) {
    return ndcToView(screenPos * 2.0 - 1.0, projInverse);
}

vec3 viewToScreen(vec3 viewPos, mat4 proj) {
    vec4 clip = proj * vec4(viewPos, 1.0);
    return (clip.xyz / clip.w) * 0.5 + 0.5;
}

vec3 viewToPlayer(vec3 viewPos, mat4 mvInverse) {
    return (mvInverse * vec4(viewPos, 1.0)).xyz;
}

vec3 playerToView(vec3 playerPos, mat4 mv) {
    return (mv * vec4(playerPos, 1.0)).xyz;
}

// Directions ignore translation, so only the rotation part matters.
vec3 viewDirToPlayer(vec3 dir, mat4 mvInverse) { return mat3(mvInverse) * dir; }
vec3 playerDirToView(vec3 dir, mat4 mv)        { return mat3(mv) * dir; }

// Linearise a hardware depth value into a positive distance along the view
// axis. near/far are the Iris uniforms of the same name.
float linearizeDepth(float depth, float near, float far) {
    return (near * far) / (depth * (near - far) + far);
}

/* ---- Shadow space ---------------------------------------------------------
   Player space -> shadow clip space. Distortion is applied separately so that
   the same distortion function can be used in shadow.vsh (to write) and in the
   deferred pass (to read); they must agree exactly or shadows land in the
   wrong texels.
   ------------------------------------------------------------------------- */
vec3 playerToShadowClip(vec3 playerPos, mat4 shadowMV, mat4 shadowProj) {
    vec4 shadowViewPos = shadowMV * vec4(playerPos, 1.0);
    vec4 clip = shadowProj * shadowViewPos;
    return clip.xyz / clip.w;
}

/* Shadow distortion.

   An orthographic shadow map spreads its texels evenly over the whole shadow
   distance, which wastes most of them on terrain far behind the player. This
   warps shadow-clip XY toward the centre so that near geometry - which is what
   you actually look at - gets a much larger share of the texels.

   The warp has to be cheap and, critically, exactly invertible in the sense
   that both the writing and reading side apply the identical function. z is
   scaled down separately: the warp compresses xy, which would otherwise make
   the depth slope across a texel steeper and reintroduce acne.

   SHADOW_DISTORTION of 0 disables the warp entirely. */
float shadowDistortFactor(vec2 clipXY) {
    return mix(1.0, length(clipXY), SHADOW_DISTORTION) + 0.08;
}

vec3 distortShadowClip(vec3 clipPos) {
#if SHADOW_DISTORTION == 0
    return clipPos;
#else
    float f = shadowDistortFactor(clipPos.xy);
    return vec3(clipPos.xy / f, clipPos.z * 0.2);
#endif
}

// Full path: player space -> distorted shadow screen space (0..1), ready to
// compare against shadowtex.
vec3 playerToShadowScreen(vec3 playerPos, mat4 shadowMV, mat4 shadowProj) {
    vec3 clip = playerToShadowClip(playerPos, shadowMV, shadowProj);
    return distortShadowClip(clip) * 0.5 + 0.5;
}

#endif // LIB_SPACES_GLSL
