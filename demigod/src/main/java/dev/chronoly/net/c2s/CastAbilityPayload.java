package dev.chronoly.net.c2s;

import dev.chronoly.ChronolyConstants;
import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** "I pressed the key." Intent only — the server decides everything else (ARCHITECTURE §5.1). */
public record CastAbilityPayload() implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<CastAbilityPayload> TYPE =
            new CustomPacketPayload.Type<>(ChronolyConstants.id("cast_ability"));

    public static final StreamCodec<ByteBuf, CastAbilityPayload> STREAM_CODEC =
            StreamCodec.unit(new CastAbilityPayload());

    @Override
    public CustomPacketPayload.Type<CastAbilityPayload> type() {
        return TYPE;
    }
}
