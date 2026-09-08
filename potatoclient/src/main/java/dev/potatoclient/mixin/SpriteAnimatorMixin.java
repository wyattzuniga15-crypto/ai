package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Stops animated sprites from advancing.
 *
 * <p>Targeted by name because {@code SpriteContents$AnimatorImpl} is not public.
 * Cancelling the tick removes the per-tick sub-image upload that water, lava,
 * fire and portals each do every frame or two, which is the real cost; the
 * frames themselves are almost free.
 *
 * <p>With the option already on at launch, sprites never leave the frame the
 * atlas was built with, which is frame 0. Turning it on mid-session freezes each
 * sprite where it is until the next resource reload.
 */
@Mixin(targets = "net.minecraft.client.texture.SpriteContents$AnimatorImpl")
public class SpriteAnimatorMixin {
	@Shadow
	private int frame;

	@Shadow
	private int currentTime;

	@Inject(method = "tick(II)V", at = @At("HEAD"), cancellable = true)
	private void potatoclient$freezeAnimation(int x, int y, CallbackInfo ci) {
		if (!ConfigManager.get().potato.freezeAnimatedTextures) {
			return;
		}

		// Park the clock as well as the frame, so unfreezing resumes from a
		// frame boundary instead of instantly flipping to the next frame.
		this.currentTime = 0;
		this.frame = 0;
		ci.cancel();
	}
}
