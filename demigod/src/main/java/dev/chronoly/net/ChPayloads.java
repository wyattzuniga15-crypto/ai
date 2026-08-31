package dev.chronoly.net;

import dev.chronoly.ability.Abilities;
import dev.chronoly.net.c2s.CastAbilityPayload;
import dev.chronoly.net.s2c.DemigodSnapshotPayload;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

/**
 * Payload registration.
 *
 * <p>Wired explicitly from the mod constructor rather than through {@code @EventBusSubscriber}:
 * the annotation's {@code bus} attribute is gone in 21.11, and an explicit listener says which bus
 * this lands on without depending on an annotation's defaults.
 */
public final class ChPayloads {

    private ChPayloads() {}

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");

        registrar.playToClient(
                DemigodSnapshotPayload.TYPE,
                DemigodSnapshotPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    // Phase 2 binds this to client-side HUD state. The handler exists now so the
                    // payload round-trip is exercised rather than assumed.
                }));

        registrar.playToServer(
                CastAbilityPayload.TYPE,
                CastAbilityPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    if (context.player() instanceof ServerPlayer player) {
                        Abilities.Result result = Abilities.cast(player);
                        player.sendSystemMessage(Component.literal(result.message()));
                    }
                }));
    }
}
