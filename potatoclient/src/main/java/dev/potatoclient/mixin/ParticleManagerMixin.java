package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.PotatoConfig;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Collection;
import java.util.Map;
import java.util.Queue;

/**
 * Drops particles at the point they are queued.
 *
 * <p>Refusing them here, rather than skipping them at draw time, also removes
 * their per-tick physics, which is where most of the cost of a large particle
 * count actually lives.
 */
@Mixin(ParticleManager.class)
public class ParticleManagerMixin {
	@Shadow
	private Map<net.minecraft.client.particle.ParticleTextureSheet, Queue<Particle>> particles;

	@Inject(method = "addParticle(Lnet/minecraft/client/particle/Particle;)V", at = @At("HEAD"), cancellable = true)
	private void potatoclient$limitParticles(Particle particle, CallbackInfo ci) {
		PotatoConfig cfg = ConfigManager.get().potato;

		if (cfg.disableParticles) {
			ci.cancel();
			return;
		}

		if (cfg.particleCap >= 0 && liveParticleCount() >= cfg.particleCap) {
			ci.cancel();
		}
	}

	private int liveParticleCount() {
		int total = 0;
		for (Collection<Particle> queue : this.particles.values()) {
			total += queue.size();
		}
		return total;
	}
}
