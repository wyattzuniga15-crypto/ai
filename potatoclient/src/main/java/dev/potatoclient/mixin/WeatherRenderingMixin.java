package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.WeatherRendering;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.particle.ParticlesMode;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Skips rain and snow.
 *
 * <p>Both the geometry pass and the splash particles/sound pass are cancelled;
 * in a thunderstorm the particle pass is the more expensive of the two.
 */
@Mixin(WeatherRendering.class)
public class WeatherRenderingMixin {
	@Inject(
			method = "renderPrecipitation(Lnet/minecraft/world/World;Lnet/minecraft/client/render/VertexConsumerProvider;IFLnet/minecraft/util/math/Vec3d;)V",
			at = @At("HEAD"),
			cancellable = true)
	private void potatoclient$skipWeather(World world, VertexConsumerProvider vertexConsumers, int ticks,
			float delta, Vec3d pos, CallbackInfo ci) {
		if (ConfigManager.get().potato.disableWeather) {
			ci.cancel();
		}
	}

	@Inject(method = "addParticlesAndSound", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipWeatherParticles(ClientWorld world, Camera camera, int ticks,
			ParticlesMode particlesMode, CallbackInfo ci) {
		if (ConfigManager.get().potato.disableWeather) {
			ci.cancel();
		}
	}
}
