package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.hud.HudManager;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.Hand;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Measures reach at the moment of the hit.
 *
 * <p>Hooking the attack itself rather than sampling the crosshair each frame is
 * what makes the number meaningful: it is the distance at the instant the packet
 * went out, which is what a server-side reach check sees.
 */
@Mixin(ClientPlayerInteractionManager.class)
public class PlayerInteractionManagerMixin {
	@Inject(method = "attackEntity", at = @At("HEAD"))
	private void potatoclient$recordAttackReach(PlayerEntity player, Entity target, CallbackInfo ci) {
		HudManager.reachTracker().recordHit(player, target);
	}

	@Inject(method = "interactEntity", at = @At("HEAD"))
	private void potatoclient$recordInteractReach(PlayerEntity player, Entity target, Hand hand,
			CallbackInfoReturnable<net.minecraft.util.ActionResult> cir) {
		if (ConfigManager.get().hud.reach.trackInteractions) {
			HudManager.reachTracker().recordHit(player, target);
		}
	}
}
