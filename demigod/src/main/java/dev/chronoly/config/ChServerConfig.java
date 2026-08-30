package dev.chronoly.config;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * Server-authoritative settings. Per-world, and the client never gets a vote.
 *
 * <p>The kill-switches are here rather than scattered through the abilities because a server owner
 * disabling Charmspeak should be one line in one file, not a hunt.
 */
public final class ChServerConfig {

    public static final ModConfigSpec SPEC;

    /** DECISIONS.md D-09 / brief §4.4 — strict by default, and it should stay that way. */
    public static final ModConfigSpec.BooleanValue STRICT_MIST;
    /** DECISIONS.md D-15 — you do not choose your parent. */
    public static final ModConfigSpec.BooleanValue WEIGHTED_RANDOM_PARENTAGE;
    public static final ModConfigSpec.DoubleValue BIG_THREE_WEIGHT;
    /** DECISIONS.md D-06 — the most abusable ability in the mod. Off against players by default. */
    public static final ModConfigSpec.BooleanValue CHARMSPEAK_VS_PLAYERS;
    /** DECISIONS.md D-07 — sending a player to another dimension against their will. */
    public static final ModConfigSpec.BooleanValue FISSURE_VS_PLAYERS;
    public static final ModConfigSpec.BooleanValue CURSE_OF_ACHILLES;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();

        b.comment("The Mist. Celestial bronze passes through mortals; mortal steel passes through",
                  "monsters. This is the mod's most important rule.").push("mist");
        STRICT_MIST = b.comment("Enforce the rule. Disabling it makes every weapon hurt everything.")
                .define("strict", true);
        b.pop();

        b.comment("Claiming").push("parentage");
        WEIGHTED_RANDOM_PARENTAGE = b
                .comment("Random by weight, as in the books. False uses the Altar of Offering.")
                .define("weighted_random", true);
        BIG_THREE_WEIGHT = b
                .comment("Combined chance of Poseidon, Zeus or Hades. Rare on purpose.")
                .defineInRange("big_three_weight", 0.03d, 0d, 1d);
        b.pop();

        b.comment("Individually kill-switchable abilities. Each is here because it can ruin a",
                  "server, not because it is strong.").push("kill_switches");
        CHARMSPEAK_VS_PLAYERS = b.define("charmspeak_vs_players", false);
        FISSURE_VS_PLAYERS = b.define("fissure_vs_players", false);
        CURSE_OF_ACHILLES = b.define("curse_of_achilles", true);
        b.pop();

        SPEC = b.build();
    }

    private ChServerConfig() {}
}
