package dev.potatoclient.mixin;

import net.minecraft.client.render.debug.DebugRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * Drives the vanilla chunk-border renderer.
 *
 * <p>{@code showChunkBorder} is the field F3+G toggles, and it is private, so
 * setting it takes an accessor. Using vanilla's own flag means the lines are
 * identical to F3+G and cost nothing when off.
 */
@Mixin(DebugRenderer.class)
public interface DebugRendererAccessor {
	@Accessor("showChunkBorder")
	void setShowChunkBorder(boolean value);
}
