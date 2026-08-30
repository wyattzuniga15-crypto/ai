package dev.chronoly.attachment;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import dev.chronoly.core.favor.Tier;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Everything the mod knows about one player.
 *
 * <p>ARCHITECTURE §4.1 — one attachment, not twelve. Twelve attachments means twelve serialisation
 * round-trips and twelve chances at a partial save.
 *
 * <p>{@link #SCHEMA_VERSION} and {@link #upgrade} exist from the first commit on purpose: save
 * format churn in a progression mod is fatal, and an upgrade chain retrofitted later has already
 * lost the worlds it needed to migrate.
 */
public final class DemigodData {

    public static final int SCHEMA_VERSION = 1;

    private int schemaVersion = SCHEMA_VERSION;
    private Optional<String> parentage = Optional.empty();
    private Map<String, Float> favor = new HashMap<>();
    private float energy;
    private float overdraw;

    public DemigodData() {}

    private DemigodData(int schemaVersion, Optional<String> parentage, Map<String, Float> favor,
                        float energy, float overdraw) {
        this.schemaVersion = schemaVersion;
        this.parentage = parentage;
        this.favor = new HashMap<>(favor);
        this.energy = energy;
        this.overdraw = overdraw;
    }

    public static final Codec<DemigodData> CODEC = RecordCodecBuilder.create(i -> i.group(
            Codec.INT.optionalFieldOf("schema_version", SCHEMA_VERSION).forGetter(DemigodData::schemaVersion),
            Codec.STRING.optionalFieldOf("parentage").forGetter(DemigodData::parentage),
            Codec.unboundedMap(Codec.STRING, Codec.FLOAT).optionalFieldOf("favor", Map.of()).forGetter(DemigodData::favor),
            Codec.FLOAT.optionalFieldOf("energy", 0f).forGetter(DemigodData::energy),
            Codec.FLOAT.optionalFieldOf("overdraw", 0f).forGetter(DemigodData::overdraw)
    ).apply(i, DemigodData::new)).xmap(DemigodData::upgrade, d -> d);

    /**
     * Migrates older saves forward. One branch per version step, never a rewrite — a player's world
     * is not a place to be clever.
     */
    private static DemigodData upgrade(DemigodData data) {
        if (data.schemaVersion == SCHEMA_VERSION) return data;
        // No prior versions exist yet. When they do, each step lands here in order.
        data.schemaVersion = SCHEMA_VERSION;
        return data;
    }

    public int schemaVersion() { return schemaVersion; }

    public Optional<String> parentage() { return parentage; }

    public void claim(String god) { this.parentage = Optional.of(god); }

    public boolean isClaimed() { return parentage.isPresent(); }

    public Map<String, Float> favor() { return favor; }

    public float favorWith(String god) { return favor.getOrDefault(god, 0f); }

    public void setFavor(String god, float value) { favor.put(god, value); }

    /** Derived, never stored — see {@link Tier}. */
    public Tier tier() {
        return Tier.forFavor(parentage.map(this::favorWith).orElse(0f));
    }

    public float energy() { return energy; }

    public void setEnergy(float energy) { this.energy = energy; }

    public float overdraw() { return overdraw; }

    public void setOverdraw(float overdraw) { this.overdraw = overdraw; }
}
