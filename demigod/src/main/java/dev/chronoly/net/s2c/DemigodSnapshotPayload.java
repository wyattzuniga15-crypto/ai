package dev.chronoly.net.s2c;

import dev.chronoly.ChronolyConstants;
import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * The full private view of a player's own state, sent on join, respawn, and dimension change.
 *
 * <p>ARCHITECTURE §5.1 — the server owns all game state; the client owns only presentation. This
 * payload is a snapshot, never a request.
 */
public record DemigodSnapshotPayload(String parentage, float energy, float overdraw)
        implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<DemigodSnapshotPayload> TYPE =
            new CustomPacketPayload.Type<>(ChronolyConstants.id("demigod_snapshot"));

    public static final StreamCodec<ByteBuf, DemigodSnapshotPayload> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.STRING_UTF8, DemigodSnapshotPayload::parentage,
                    ByteBufCodecs.FLOAT, DemigodSnapshotPayload::energy,
                    ByteBufCodecs.FLOAT, DemigodSnapshotPayload::overdraw,
                    DemigodSnapshotPayload::new);

    @Override
    public CustomPacketPayload.Type<DemigodSnapshotPayload> type() {
        return TYPE;
    }
}
