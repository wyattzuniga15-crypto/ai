package dev.chronoly.config;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The machine-readable twin of BALANCE.md. Every coefficient an ability reads lives here, so
 * "no hardcoded numbers" is enforced by there being nowhere else to put them.
 */
public final class ChCommonConfig {

    public static final ModConfigSpec SPEC;

    public static final ModConfigSpec.DoubleValue TIER_2_FAVOR;
    public static final ModConfigSpec.DoubleValue TIER_3_FAVOR;
    public static final ModConfigSpec.DoubleValue TIER_4_FAVOR;
    public static final ModConfigSpec.DoubleValue ENERGY_POOL_BASE;
    public static final ModConfigSpec.DoubleValue ENERGY_POOL_PER_FAVOR;
    public static final ModConfigSpec.DoubleValue STYX_OATH_PENALTY;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();

        b.comment("Ability tier thresholds. Higher tiers change what an ability is, not just its",
                  "numbers.").push("tiers");
        TIER_2_FAVOR = b.defineInRange("tier_2", 200d, 0d, 1000d);
        TIER_3_FAVOR = b.defineInRange("tier_3", 500d, 0d, 1000d);
        TIER_4_FAVOR = b.defineInRange("tier_4", 850d, 0d, 1000d);
        b.pop();

        b.comment("Divine Energy. Overdraw is debt, not a wall: a spend is never refused.").push("energy");
        ENERGY_POOL_BASE = b.defineInRange("pool_base", 100d, 1d, 10000d);
        ENERGY_POOL_PER_FAVOR = b.defineInRange("pool_per_favor", 0.4d, 0d, 10d);
        b.pop();

        b.comment("Favor. The Last Olympian ch. 4 — an oath on the Styx is a mechanism, not a",
                  "promise, and this is deliberately the heaviest penalty in the game.").push("favor");
        STYX_OATH_PENALTY = b.defineInRange("break_styx_oath", -150d, -1000d, 0d);
        b.pop();

        SPEC = b.build();
    }

    private ChCommonConfig() {}
}
