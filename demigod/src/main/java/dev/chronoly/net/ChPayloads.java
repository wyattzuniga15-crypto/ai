package dev.chronoly.net;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.net.s2c.DemigodSnapshotPayload;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

@EventBusSubscriber(modid = ChronolyConstants.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
public final class ChPayloads {

    private ChPayloads() {}

    @SubscribeEvent
    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");

        registrar.playToClient(
                DemigodSnapshotPayload.TYPE,
                DemigodSnapshotPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    // Phase 2 binds this to the client-side HUD state. The handler exists now so the
                    // payload round-trip is exercised rather than assumed.
                }));
    }
}
