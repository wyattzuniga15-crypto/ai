package dev.chronoly.flaw;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;

/**
 * Every hero's fatal flaw, as a real mechanical double edge.
 *
 * <p>The brief is emphatic that these must genuinely cut both ways, and it is right: a flaw that
 * is only a downside is a punishment, and one that is only an upside is a perk. Each of these is
 * strong enough that you would choose it and dangerous enough that it will kill you.
 */
public final class FatalFlaws {

    private FatalFlaws() {}

    /** Which flaw a parent's blood carries. The Titan's Curse — flaws run in the family. */
    public static String flawOf(String god) {
        return switch (god) {
            case "athena" -> "hubris";
            case "poseidon" -> "loyalty";
            case "hades" -> "grudges";
            case "ares" -> "wrath";
            case "apollo" -> "vanity";
            case "hermes" -> "recklessness";
            case "hecate" -> "curiosity";
            default -> "fear_of_failure";
        };
    }

    public static String describe(String flaw) {
        return switch (flaw) {
            case "hubris" -> "§eHubris §7— you hit a quarter harder, and being struck while barely "
                    + "scratched staggers you badly. The Titan's Curse: the deadliest flaw of all.";
            case "loyalty" -> "§bPersonal loyalty §7— near a hurt ally you are formidable. "
                    + "Watch one die and you are nearly useless for a while.";
            case "grudges" -> "§5Holding grudges §7— anything that has killed you takes far more "
                    + "from you forever after, and everything else takes less.";
            case "wrath" -> "§cWrath §7— the lower your health the harder you hit, "
                    + "and you cannot bring yourself to run.";
            case "vanity" -> "§6Vanity §7— you are stronger with an audience and weaker alone.";
            case "recklessness" -> "§aRecklessness §7— faster and freer in the open, "
                    + "and falling hurts a great deal more.";
            case "curiosity" -> "§dCuriosity §7— you find more than other people do, "
                    + "and the dark is more interested in you.";
            default -> "§7Fear of failure §7— your first blow in any fight lands hard; "
                    + "miss it and you are shaken.";
        };
    }

    /** Applied when a flaw'd player takes a hit. Both directions live here. */
    public static void onDamaged(LivingIncomingDamageEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;

        String flaw = flawOf(data.parentage().orElseThrow());
        ServerLevel level = (ServerLevel) player.level();

        switch (flaw) {
            case "hubris" -> {
                // Struck while barely scratched: the fall is the whole point of the flaw.
                if (player.getHealth() > player.getMaxHealth() * 0.9f) {
                    player.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 80, 3));
                    player.addEffect(new MobEffectInstance(MobEffects.MINING_FATIGUE, 80, 2));
                    event.setAmount(event.getAmount() * 1.6f);
                    if (data.raiseFlag("lesson_hubris")) {
                        player.sendSystemMessage(Component.literal(
                                "§eYou were not expecting that. §7You are never expecting that."));
                    }
                }
            }
            case "recklessness" -> {
                if (event.getSource().is(net.minecraft.tags.DamageTypeTags.IS_FALL)) {
                    event.setAmount(event.getAmount() * 2.0f);
                }
            }
            case "vanity" -> {
                boolean alone = level.players().stream()
                        .noneMatch(p -> p != player && p.distanceToSqr(player) < 32 * 32);
                if (alone) event.setAmount(event.getAmount() * 1.25f);
            }
            default -> { }
        }
    }

    /** Applied when a flaw'd player deals a hit. */
    public static void onDealDamage(LivingIncomingDamageEvent event) {
        if (!(event.getSource().getEntity() instanceof ServerPlayer player)) return;
        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;

        String flaw = flawOf(data.parentage().orElseThrow());
        ServerLevel level = (ServerLevel) player.level();
        float amount = event.getAmount();

        switch (flaw) {
            case "hubris" -> event.setAmount(amount * 1.25f);
            case "wrath" -> {
                float missing = 1f - (player.getHealth() / player.getMaxHealth());
                event.setAmount(amount * (1f + missing * 0.9f));
            }
            case "grudges" -> {
                String type = event.getEntity().getType().toShortString();
                if (data.hasFlag("killed_by_" + type)) {
                    event.setAmount(amount * 1.75f);
                } else {
                    event.setAmount(amount * 0.85f);
                }
            }
            case "loyalty" -> {
                boolean alliedHurt = level.players().stream().anyMatch(p ->
                        p != player && p.distanceToSqr(player) < 20 * 20
                                && p.getHealth() < p.getMaxHealth() * 0.5f);
                if (alliedHurt) event.setAmount(amount * 1.5f);
            }
            case "vanity" -> {
                boolean watched = level.players().stream()
                        .anyMatch(p -> p != player && p.distanceToSqr(player) < 32 * 32);
                event.setAmount(amount * (watched ? 1.3f : 0.85f));
            }
            default -> { }
        }
    }

    /** Hades' children remember what killed them; that is what makes the grudge mechanical. */
    public static void rememberKiller(ServerPlayer player, DemigodData data, LivingEntity killer) {
        if (killer == null) return;
        data.raiseFlag("killed_by_" + killer.getType().toShortString());
    }

    /** Loyalty's downside: watching an ally die takes the fight out of you. */
    public static void onAllyDeath(ServerLevel level, Player dead) {
        for (ServerPlayer near : level.players()) {
            if (near == dead) continue;
            if (near.distanceToSqr(dead) > 48 * 48) continue;
            DemigodData d = near.getData(ChAttachments.DEMIGOD.get());
            if (!d.isClaimed() || !flawOf(d.parentage().orElseThrow()).equals("loyalty")) continue;

            near.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 1200, 1));
            near.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 600, 0));
            near.sendSystemMessage(Component.literal(
                    "§bYou saw that happen. §7You are not going to be much use for a while."));
        }
    }

    /** Curiosity finds things; the dark notices. */
    public static void curiosityTick(ServerPlayer player, DemigodData data, ServerLevel level) {
        if (!flawOf(data.parentage().orElse("")).equals("curiosity")) return;
        if (level.getBrightness(net.minecraft.world.level.LightLayer.BLOCK, player.blockPosition()) > 6) return;
        player.addEffect(new MobEffectInstance(MobEffects.NIGHT_VISION, 260, 0));
    }

    public static AABB near(ServerPlayer p, double r) {
        return new AABB(p.position(), p.position()).inflate(r);
    }
}
