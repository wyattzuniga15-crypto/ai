package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.item.ItemRenderer;
import net.minecraft.client.util.math.MatrixStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Drops the enchantment glint.
 *
 * <p>Each glint is a second pass with a scrolling texture matrix, so an
 * enchanted armour set is several extra draws per frame. Returning the plain
 * buffer keeps the item rendering normally, just without the overlay.
 */
@Mixin(ItemRenderer.class)
public class ItemRendererMixin {
	private static boolean potatoclient$glintDisabled() {
		return ConfigManager.get().potato.disableGlint;
	}

	@Inject(method = "getItemGlintConsumer", at = @At("HEAD"), cancellable = true)
	private static void potatoclient$plainItem(VertexConsumerProvider provider, RenderLayer layer,
			boolean solid, boolean glint, CallbackInfoReturnable<VertexConsumer> cir) {
		if (potatoclient$glintDisabled()) {
			cir.setReturnValue(provider.getBuffer(layer));
		}
	}

	@Inject(method = "getArmorGlintConsumer", at = @At("HEAD"), cancellable = true)
	private static void potatoclient$plainArmor(VertexConsumerProvider provider, RenderLayer layer,
			boolean solid, CallbackInfoReturnable<VertexConsumer> cir) {
		if (potatoclient$glintDisabled()) {
			cir.setReturnValue(provider.getBuffer(layer));
		}
	}

	@Inject(method = "getDynamicDisplayGlintConsumer", at = @At("HEAD"), cancellable = true)
	private static void potatoclient$plainDynamicDisplay(VertexConsumerProvider provider, RenderLayer layer,
			MatrixStack.Entry entry, CallbackInfoReturnable<VertexConsumer> cir) {
		if (potatoclient$glintDisabled()) {
			cir.setReturnValue(provider.getBuffer(layer));
		}
	}
}
