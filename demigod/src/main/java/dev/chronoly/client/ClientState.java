package dev.chronoly.client;

import dev.chronoly.net.s2c.DemigodSnapshotPayload;

/**
 * What this client believes about its own player, as last told by the server.
 *
 * <p>Presentation only. Nothing here is authoritative and nothing here is trusted — if it drifts
 * from the server the server simply overwrites it on the next snapshot.
 */
public final class ClientState {

    private ClientState() {}

    private static volatile String parentage = "";
    private static volatile float energy;
    private static volatile float maxEnergy = 100f;
    private static volatile float overdraw;
    private static volatile float favor;

    public static void accept(DemigodSnapshotPayload payload) {
        parentage = payload.parentage();
        energy = payload.energy();
        overdraw = payload.overdraw();
        maxEnergy = Math.max(1f, payload.maxEnergy());
        favor = payload.favor();
    }

    public static boolean claimed() { return !parentage.isEmpty(); }

    public static String parentage() { return parentage; }

    public static float energy() { return energy; }

    public static float maxEnergy() { return maxEnergy; }

    public static float overdraw() { return overdraw; }

    public static float favor() { return favor; }
}
