package dev.potatoclient.mixin;

import net.minecraft.client.render.BackgroundRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * Drives vanilla's own fog switch.
 *
 * <p>1.21.4 added {@code fogEnabled} and {@code toggleFog()} to
 * {@link BackgroundRenderer}, so removing fog means flipping the flag the game
 * already honours rather than fabricating a {@code Fog} value whose record
 * components are not part of the mapped API.
 */
@Mixin(BackgroundRenderer.class)
public interface BackgroundRendererAccessor {
	@Accessor("fogEnabled")
	static void setFogEnabled(boolean value) {
		throw new AssertionError("Replaced by Mixin at load time");
	}

	@Accessor("fogEnabled")
	static boolean isFogEnabled() {
		throw new AssertionError("Replaced by Mixin at load time");
	}
}
