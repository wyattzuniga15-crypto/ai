package dev.chronoly.attachment;

import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import dev.chronoly.core.favor.Tier;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Everything the mod knows about one player.
 *
 * <p>ARCHITECTURE §4.1 — one attachment, not twelve. Twelve attachments means twelve serialisation
 * round-trips and twelve chances at a partial save.
 *
 * <p>{@link #SCHEMA_VERSION} and the migration in the deserialising constructor exist from the
 * first commit on purpose: save format churn in a progression mod is fatal, and an upgrade chain
 * retrofitted later has already lost the worlds it needed to migrate.
 */
public final class DemigodData {

    public static final int SCHEMA_VERSION = 1;

    private int schemaVersion = SCHEMA_VERSION;
    private Optional<String> parentage = Optional.empty();
    private final Map<String, Float> favor = new HashMap<>();
    private float energy;
    private float overdraw;
    private float ambrosiaBurn;
    private String questTarget = "";
    private String questPlace = "";
    private long questDeadline;
    private final Set<String> flags = new HashSet<>();

    public DemigodData() {}

    /**
     * Deserialising constructor. Migration happens here rather than in an {@code xmap} so there is
     * exactly one path by which a loaded save becomes a live object.
     */
    private DemigodData(int schemaVersion, Optional<String> parentage, Map<String, Float> favor,
                        float energy, float overdraw, float ambrosiaBurn, List<String> flags,
                        String questTarget, String questPlace, long questDeadline) {
        this.parentage = parentage;
        this.favor.putAll(favor);
        this.energy = energy;
        this.overdraw = overdraw;
        this.ambrosiaBurn = ambrosiaBurn;
        this.flags.addAll(flags);
        this.questTarget = questTarget;
        this.questPlace = questPlace;
        this.questDeadline = questDeadline;
        this.schemaVersion = migrate(schemaVersion);
    }

    /**
     * Migrates an older save forward, one branch per version step. No prior versions exist yet;
     * when they do, each step lands here in order and none of them rewrites what it does not own.
     */
    private int migrate(int loaded) {
        return SCHEMA_VERSION;
    }

    /**
     * A {@link MapCodec}, not a {@link Codec} — NeoForge's {@code AttachmentType.Builder#serialize}
     * takes a MapCodec or an IAttachmentSerializer, because an attachment is serialised into an
     * existing compound rather than as a standalone value.
     */
    public static final MapCodec<DemigodData> MAP_CODEC = RecordCodecBuilder.mapCodec(i -> i.group(
            Codec.INT.optionalFieldOf("schema_version", SCHEMA_VERSION).forGetter(DemigodData::schemaVersion),
            Codec.STRING.optionalFieldOf("parentage").forGetter(DemigodData::parentage),
            Codec.unboundedMap(Codec.STRING, Codec.FLOAT)
                    .optionalFieldOf("favor", Map.<String, Float>of()).forGetter(DemigodData::favor),
            Codec.FLOAT.optionalFieldOf("energy", 0f).forGetter(DemigodData::energy),
            Codec.FLOAT.optionalFieldOf("overdraw", 0f).forGetter(DemigodData::overdraw),
            Codec.FLOAT.optionalFieldOf("ambrosia_burn", 0f).forGetter(DemigodData::ambrosiaBurn),
            Codec.STRING.listOf().optionalFieldOf("flags", List.<String>of()).forGetter(DemigodData::flagList),
            Codec.STRING.optionalFieldOf("quest_target", "").forGetter(DemigodData::questTarget),
            Codec.STRING.optionalFieldOf("quest_place", "").forGetter(DemigodData::questPlace),
            Codec.LONG.optionalFieldOf("quest_deadline", 0L).forGetter(DemigodData::questDeadline)
    ).apply(i, DemigodData::new));

    /** The standalone form, for tests and for anywhere a full Codec is wanted. */
    public static final Codec<DemigodData> CODEC = MAP_CODEC.codec();

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

    public void setOverdraw(float overdraw) { this.overdraw = Math.max(0f, overdraw); }

    public float ambrosiaBurn() { return ambrosiaBurn; }

    public void setAmbrosiaBurn(float v) { this.ambrosiaBurn = Math.max(0f, v); }

    public List<String> flagList() { return List.copyOf(flags); }

    /** Raises a one-shot flag. Returns true only the first time, so lessons fire exactly once. */
    public boolean raiseFlag(String flag) { return flags.add(flag); }

    public boolean hasFlag(String flag) { return flags.contains(flag); }

    public void addFavor(String god, float amount) {
        setFavor(god, Math.max(0f, Math.min(1000f, favorWith(god) + amount)));
    }

    /** Spends energy, allowing overdraw as debt. Never refuses — see BALANCE.md. */
    public void spend(float cost) {
        float fromPool = Math.min(energy, cost);
        energy -= fromPool;
        overdraw += (cost - fromPool);
    }

    public String questTarget() { return questTarget; }

    public String questPlace() { return questPlace; }

    public long questDeadline() { return questDeadline; }

    public boolean hasQuest() { return !questTarget.isEmpty(); }

    public void setQuest(String target, String place, long deadline) {
        this.questTarget = target;
        this.questPlace = place;
        this.questDeadline = deadline;
    }

    public void clearQuest() {
        this.questTarget = "";
        this.questPlace = "";
        this.questDeadline = 0L;
    }

    public float maxEnergy() {
        float f = parentage.map(this::favorWith).orElse(0f);
        return 100f + f * 0.4f;
    }
}
