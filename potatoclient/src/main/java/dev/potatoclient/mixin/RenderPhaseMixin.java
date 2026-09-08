package dev.potatoclient.mixin;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.potatoclient.render.RenderUtil;
import net.minecraft.client.render.RenderPhase;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Makes the hitbox line thickness configurable.
 *
 * <p>The line layer used for hitboxes carries a line-width phase with no width of
 * its own, so vanilla picks one from the framebuffer size and any earlier
 * {@code RenderSystem.lineWidth} call is overwritten. A render layer is a
 * composite phase whose {@code startDrawing} runs its sub-phases and then
 * returns, so injecting at the tail runs after the width has been chosen.
 *
 * <p>The override is only non-zero while one of the mod's own line batches is
 * being flushed, so no other layer is affected.
 */
@Mixin(RenderPhase.class)
public class RenderPhaseMixin {
	@Inject(method = "startDrawing", at = @At("TAIL"))
	private void potatoclient$applyLineWidth(CallbackInfo ci) {
		float width = RenderUtil.widthOverride();
		if (width > 0.0F) {
			RenderSystem.lineWidth(width);
		}
	}
}
