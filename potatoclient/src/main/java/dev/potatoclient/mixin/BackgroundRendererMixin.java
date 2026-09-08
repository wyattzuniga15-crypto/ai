package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.render.BackgroundRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/**
 * Pushes distance fog past the far plane, on top of flipping vanilla's fog flag.
 *
 * <p>Belt and braces. {@link BackgroundRendererAccessor} turns fog off the way
 * the game itself does; this widens the view distance the fog curve is built
 * from, so terrain fog stays gone even where that flag is not consulted.
 * {@code applyFog} is static, so parameter 3 is the fourth argument,
 * {@code viewDistance}.
 */
@Mixin(BackgroundRenderer.class)
public class BackgroundRendererMixin {
	/** Far enough that the fog curve never reaches the far plane at any render distance. */
	private static final float NO_FOG_VIEW_DISTANCE = 4096.0F;

	@ModifyVariable(method = "applyFog", at = @At("HEAD"), argsOnly = true, index = 3)
	private static float potatoclient$widenFog(float viewDistance) {
		return ConfigManager.get().potato.disableFog ? NO_FOG_VIEW_DISTANCE : viewDistance;
	}
}
