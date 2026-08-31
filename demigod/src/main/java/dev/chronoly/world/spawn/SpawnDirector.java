package dev.chronoly.world.spawn;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.core.scent.ScentModel;
import dev.chronoly.core.scent.ThreatTier;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.level.block.Blocks;

import java.util.List;

/**
 * Power attracts danger.
 *
 * <p>The brief calls this the single most important mechanic in the mod: growing stronger makes
 * your scent stronger, which makes worse things come looking. The model has been tested in
 * {@code core/scent} from the start; this is what finally makes it bite.
 *
 * <p>Digging down does not help past a threshold. That is the point — it is a deliberate answer
 * to the usual Minecraft response to danger.
 */
public final class SpawnDirector {

    private SpawnDirector() {}

    private static int tick;

    /** Cadenced: one sweep every eight seconds, and it early-outs before touching the world. */
    public static void tick(ServerLevel level) {
        if (++tick % 160 != 0) return;

        for (ServerPlayer player : level.players()) {
            DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
            if (!data.isClaimed()) continue;

            String god = data.parentage().orElseThrow();
            float scent = ScentModel.compute(new ScentModel.Inputs(
                    data.favorWith(god), rarity(god), countRelics(player), 0, insideWard(level, player)));
            ThreatTier tier = ScentModel.threat(scent);
            if (tier == ThreatTier.UNSEEN) continue;

            // Underground is not a hiding place once you smell strongly enough.
            boolean hidden = level.canSeeSky(player.blockPosition());
            if (!hidden && ScentModel.canHideUnderground(scent)) continue;

            if (level.random.nextFloat() > chanceFor(tier)) continue;
            send(level, player, tier);
        }
    }

    private static float chanceFor(ThreatTier tier) {
        return switch (tier) {
            case UNSEEN -> 0f;
            case FAINT -> 0.25f;
            case NOTICED -> 0.5f;
            case HUNTED -> 0.85f;
        };
    }

    private static void send(ServerLevel level, ServerPlayer player, ThreatTier tier) {
        int count = switch (tier) {
            case HUNTED -> 3;
            case NOTICED -> 2;
            default -> 1;
        };

        List<EntityType<?>> table = switch (tier) {
            case HUNTED -> List.of(EntityType.RAVAGER, EntityType.VINDICATOR, EntityType.WITHER_SKELETON);
            case NOTICED -> List.of(EntityType.VINDICATOR, EntityType.HUSK, EntityType.STRAY);
            default -> List.of(EntityType.ZOMBIE, EntityType.SKELETON, EntityType.SPIDER);
        };

        int sent = 0;
        for (int i = 0; i < count; i++) {
            BlockPos at = findSpot(level, player.blockPosition());
            if (at == null) continue;

            EntityType<?> type = table.get(level.random.nextInt(table.size()));
            Entity raw = type.create(level, EntitySpawnReason.NATURAL);
            if (!(raw instanceof Mob mob)) continue;

            mob.setPos(at.getX() + 0.5, at.getY(), at.getZ() + 0.5);
            mob.setPersistenceRequired();
            mob.setTarget(player);

            // Things that come for a demigod are worse than the ones that wander in.
            scale(mob, Attributes.MAX_HEALTH, tier == ThreatTier.HUNTED ? 1.8 : 1.35);
            scale(mob, Attributes.ATTACK_DAMAGE, tier == ThreatTier.HUNTED ? 1.6 : 1.25);
            mob.setHealth(mob.getMaxHealth());
            if (tier == ThreatTier.HUNTED) {
                mob.addEffect(new MobEffectInstance(MobEffects.SPEED, 20000, 0));
            }

            level.addFreshEntity(mob);
            level.sendParticles(ParticleTypes.LARGE_SMOKE,
                    at.getX() + 0.5, at.getY() + 0.5, at.getZ() + 0.5, 15, 0.3, 0.5, 0.3, 0.02);
            sent++;
        }

        if (sent > 0 && !player.getData(ChAttachments.DEMIGOD.get()).hasFlag("lesson_scent")) {
            player.getData(ChAttachments.DEMIGOD.get()).raiseFlag("lesson_scent");
            player.sendSystemMessage(Component.literal(
                    "§cSomething found you. §7They can smell what you are, and you smell stronger "
                    + "every time you get better at this."));
        }
    }

    private static void scale(Mob mob, net.minecraft.core.Holder<net.minecraft.world.entity.ai.attributes.Attribute> attr, double factor) {
        var inst = mob.getAttribute(attr);
        if (inst != null) inst.setBaseValue(inst.getBaseValue() * factor);
    }

    /** Somewhere out of sight but close enough to matter. */
    private static BlockPos findSpot(ServerLevel level, BlockPos around) {
        for (int attempt = 0; attempt < 12; attempt++) {
            int dx = level.random.nextInt(33) - 16;
            int dz = level.random.nextInt(33) - 16;
            if (Math.abs(dx) < 8 && Math.abs(dz) < 8) continue;

            BlockPos candidate = around.offset(dx, 0, dz);
            for (int dy = 3; dy >= -4; dy--) {
                BlockPos at = candidate.offset(0, dy, 0);
                if (level.getBlockState(at).isAir()
                        && level.getBlockState(at.above()).isAir()
                        && !level.getBlockState(at.below()).isAir()) {
                    return at;
                }
            }
        }
        return null;
    }

    private static float rarity(String god) {
        return switch (god) {
            case "poseidon", "zeus", "hades" -> 1.0f;
            case "hecate", "ares" -> 0.55f;
            default -> 0.35f;
        };
    }

    private static int countRelics(ServerPlayer player) {
        int n = 0;
        for (var stack : player.getInventory().getNonEquipmentItems()) {
            if (stack.is(dev.chronoly.ChTags.DIVINE_WEAPON)) n++;
        }
        return n;
    }

    /**
     * Camp's borders, in their first form: standing on gold blocks quiets your scent entirely.
     * A placeholder for Thalia's Pine, but the mechanic — a ward zeroes scent rather than
     * reducing it — is the real one.
     */
    private static boolean insideWard(ServerLevel level, ServerPlayer player) {
        BlockPos below = player.blockPosition().below();
        return level.getBlockState(below).is(Blocks.GOLD_BLOCK)
                || level.getBlockState(below.below()).is(Blocks.GOLD_BLOCK);
    }
}
