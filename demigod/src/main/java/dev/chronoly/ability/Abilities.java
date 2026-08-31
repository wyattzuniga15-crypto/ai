package dev.chronoly.ability;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.skeleton.Skeleton;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.List;

/**
 * The signature power of each parent, doing something you can feel.
 *
 * <p>Honest note on architecture: ARCHITECTURE §6 specifies an ability framework with charge
 * phases, traits and a sim layer. This is a direct dispatch instead — real abilities with real
 * costs and consequences, written so the framework can absorb them later rather than the framework
 * being built before anything was playable. The debt is recorded in ROADMAP.md.
 */
public final class Abilities {

    private Abilities() {}

    public record Result(boolean cast, String message) {
        static Result no(String why) { return new Result(false, why); }
        static Result yes(String what) { return new Result(true, what); }
    }

    /** Every parent's signature power, its cost, and what it is called. */
    public static Result cast(ServerPlayer player) {
        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) {
            return Result.no("§7You are unclaimed. No god has spoken for you yet.");
        }
        String god = data.parentage().orElseThrow();
        float cost = costFor(god);

        if (data.overdraw() > data.maxEnergy() * 0.9f) {
            return Result.no("§8You are too spent. Everything is grey and far away.");
        }

        ServerLevel level = ((ServerLevel) player.level());
        String name = switch (god) {
            case "poseidon" -> { earthshaker(player, level); yield "Earthshaker"; }
            case "zeus"     -> { lightning(player, level);   yield "Lightning Bolt"; }
            case "hades"    -> { shadowTravel(player, level); yield "Shadow Travel"; }
            case "apollo"   -> { healingHymn(player, level); yield "Healing Hymn"; }
            case "ares"     -> { warCry(player, level);      yield "War Cry"; }
            case "hermes"   -> { blink(player, level);       yield "Blink"; }
            case "athena"   -> { tacticalSight(player, level); yield "Tactical Sight"; }
            case "hecate"   -> { witchlight(player, level);  yield "Witchlight"; }
            default         -> null;
        };
        if (name == null) return Result.no("§7Your parent has granted you nothing yet.");

        data.spend(cost);
        boolean overdrew = data.overdraw() > 0f;
        return Result.yes("§b" + name + (overdrew ? " §8— and it cost you more than you had." : ""));
    }

    private static float costFor(String god) {
        return switch (god) {
            case "poseidon", "zeus" -> 45f;
            case "hades" -> 35f;
            case "ares", "apollo" -> 30f;
            default -> 25f;
        };
    }

    // ---- Poseidon ---------------------------------------------------------------------------

    /** A localised quake. Everything touching the ground goes down. */
    private static void earthshaker(ServerPlayer player, ServerLevel level) {
        Vec3 c = player.position();
        for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class,
                new AABB(c, c).inflate(7.0), e -> e != player && e.onGround())) {
            e.hurt(level.damageSources().playerAttack(player), 8.0f);
            Vec3 away = e.position().subtract(c).normalize();
            e.push(away.x * 1.1, 0.75, away.z * 1.1);
            e.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 80, 2));
        }
        level.sendParticles(ParticleTypes.EXPLOSION, c.x, c.y, c.z, 12, 3.0, 0.2, 3.0, 0.0);
        level.playSound(null, player.blockPosition(), SoundEvents.GENERIC_EXPLODE.value(),
                SoundSource.PLAYERS, 1.2f, 0.5f);
    }

    // ---- Zeus -------------------------------------------------------------------------------

    /** Calls down a real bolt where you are looking. */
    private static void lightning(ServerPlayer player, ServerLevel level) {
        BlockPos target = lookedAtBlock(player, 48);
        Entity bolt = EntityType.LIGHTNING_BOLT.create(level, net.minecraft.world.entity.EntitySpawnReason.TRIGGERED);
        if (bolt != null) {
            bolt.moveTo(target.getX() + 0.5, (double) target.getY(), target.getZ() + 0.5);
            level.addFreshEntity(bolt);
        }
    }

    // ---- Hades ------------------------------------------------------------------------------

    /** Step into one shadow and out of another. Nauseating, and it should be. */
    private static void shadowTravel(ServerPlayer player, ServerLevel level) {
        BlockPos dest = lookedAtBlock(player, 32).above();
        Vec3 from = player.position();
        level.sendParticles(ParticleTypes.LARGE_SMOKE, from.x, from.y + 1, from.z, 30, 0.3, 0.6, 0.3, 0.02);
        player.teleportTo(dest.getX() + 0.5, dest.getY(), dest.getZ() + 0.5);
        level.sendParticles(ParticleTypes.LARGE_SMOKE, dest.getX() + 0.5, dest.getY() + 1, dest.getZ() + 0.5,
                30, 0.3, 0.6, 0.3, 0.02);
        player.addEffect(new MobEffectInstance(MobEffects.NAUSEA, 60, 0));
        level.playSound(null, dest, SoundEvents.ENDERMAN_TELEPORT, SoundSource.PLAYERS, 0.9f, 0.6f);
    }

    // ---- Apollo -----------------------------------------------------------------------------

    /** Heals you and everyone near you. Standing still is the cost. */
    private static void healingHymn(ServerPlayer player, ServerLevel level) {
        Vec3 c = player.position();
        for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, new AABB(c, c).inflate(8.0))) {
            if (e instanceof net.minecraft.world.entity.monster.Monster) continue;
            e.heal(8.0f);
            e.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 120, 1));
        }
        level.sendParticles(ParticleTypes.HAPPY_VILLAGER, c.x, c.y + 1, c.z, 40, 3.0, 1.5, 3.0, 0.0);
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_ACTIVATE, SoundSource.PLAYERS, 0.8f, 1.6f);
    }

    // ---- Ares -------------------------------------------------------------------------------

    /** Fear in a cone, rage for you. */
    private static void warCry(ServerPlayer player, ServerLevel level) {
        Vec3 c = player.position();
        for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, new AABB(c, c).inflate(10.0),
                e -> e instanceof net.minecraft.world.entity.monster.Monster)) {
            e.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 200, 1));
            e.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 100, 1));
        }
        player.addEffect(new MobEffectInstance(MobEffects.STRENGTH, 300, 1));
        player.addEffect(new MobEffectInstance(MobEffects.RESISTANCE, 300, 0));
        level.sendParticles(ParticleTypes.ANGRY_VILLAGER, c.x, c.y + 1.5, c.z, 25, 2.0, 1.0, 2.0, 0.0);
        level.playSound(null, player.blockPosition(), SoundEvents.RAVAGER_ROAR, SoundSource.PLAYERS, 1.2f, 1.0f);
    }

    // ---- Hermes -----------------------------------------------------------------------------

    /** Short instant translocation, chainable while your energy holds. */
    private static void blink(ServerPlayer player, ServerLevel level) {
        BlockPos dest = lookedAtBlock(player, 20).above();
        player.teleportTo(dest.getX() + 0.5, dest.getY(), dest.getZ() + 0.5);
        player.addEffect(new MobEffectInstance(MobEffects.SPEED, 200, 1));
        level.sendParticles(ParticleTypes.CLOUD, dest.getX() + 0.5, dest.getY() + 1, dest.getZ() + 0.5,
                20, 0.3, 0.5, 0.3, 0.05);
        level.playSound(null, dest, SoundEvents.ENDERMAN_TELEPORT, SoundSource.PLAYERS, 0.6f, 1.8f);
    }

    // ---- Athena -----------------------------------------------------------------------------

    /** Every hostile within reach lights up, through walls. */
    private static void tacticalSight(ServerPlayer player, ServerLevel level) {
        Vec3 c = player.position();
        List<LivingEntity> seen = level.getEntitiesOfClass(LivingEntity.class, new AABB(c, c).inflate(28.0),
                e -> e instanceof net.minecraft.world.entity.monster.Monster);
        for (LivingEntity e : seen) {
            e.addEffect(new MobEffectInstance(MobEffects.GLOWING, 600, 0));
        }
        player.addEffect(new MobEffectInstance(MobEffects.NIGHT_VISION, 1200, 0));
        player.sendSystemMessage(Component.literal("§9You count " + seen.size()
                + " of them, and where each one is standing."));
    }

    // ---- Hecate -----------------------------------------------------------------------------

    /** Conjured light, and the dead pressed into service. */
    private static void witchlight(ServerPlayer player, ServerLevel level) {
        Vec3 c = player.position();
        for (int i = 0; i < 2; i++) {
            Skeleton ally = EntityType.SKELETON.create(level, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
            if (ally == null) continue;
            ally.moveTo(c.x + (i == 0 ? 1.5 : -1.5), c.y, c.z, player.getYRot(), 0f);
            ally.addEffect(new MobEffectInstance(MobEffects.GLOWING, 1200, 0));
            level.addFreshEntity(ally);
        }
        player.addEffect(new MobEffectInstance(MobEffects.NIGHT_VISION, 2400, 0));
        level.sendParticles(ParticleTypes.SOUL_FIRE_FLAME, c.x, c.y + 1, c.z, 30, 1.5, 1.0, 1.5, 0.01);
        level.playSound(null, player.blockPosition(), SoundEvents.EVOKER_CAST_SPELL, SoundSource.PLAYERS, 1.0f, 0.8f);
    }

    // ---- shared -----------------------------------------------------------------------------

    private static BlockPos lookedAtBlock(ServerPlayer player, double reach) {
        Vec3 eye = player.getEyePosition();
        Vec3 end = eye.add(player.getLookAngle().scale(reach));
        BlockHitResult hit = player.level().clip(new ClipContext(
                eye, end, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player));
        return hit.getBlockPos();
    }
}
