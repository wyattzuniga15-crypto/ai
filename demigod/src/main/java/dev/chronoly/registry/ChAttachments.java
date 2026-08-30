package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.attachment.DemigodData;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.NeoForgeRegistries;

import java.util.function.Supplier;

public final class ChAttachments {

    public static final DeferredRegister<AttachmentType<?>> ATTACHMENTS =
            DeferredRegister.create(NeoForgeRegistries.Keys.ATTACHMENT_TYPES, ChronolyConstants.MOD_ID);

    /**
     * ARCHITECTURE §4.1 — deliberately NOT {@code copyOnDeath}. Death is a gameplay event that
     * edits the record rather than copying it, so it routes through the Phase 9 transition instead.
     */
    public static final Supplier<AttachmentType<DemigodData>> DEMIGOD =
            ATTACHMENTS.register("demigod", () -> AttachmentType
                    .builder(DemigodData::new)
                    .serialize(DemigodData.MAP_CODEC)
                    .build());

    private ChAttachments() {}

    public static void init(IEventBus bus) {
        ATTACHMENTS.register(bus);
    }
}
