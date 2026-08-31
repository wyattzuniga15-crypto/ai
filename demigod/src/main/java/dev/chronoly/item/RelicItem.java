package dev.chronoly.item;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import dev.chronoly.world.ChDimensions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** The named things. Each one does what the books say it does. */
public class RelicItem extends Item {

    public enum Power {
        /** The Lightning Thief, ch. 21 — the thing Zeus wants back. Do not point it at people. */
        MASTER_BOLT(180, 60f),
        /** The Lightning Thief, ch. 19 — Hades' helm. Nothing can see you, and nothing wants to. */
        HELM_OF_DARKNESS(400, 45f),
        /** The Sea of Monsters — it heals what is near it, and it is why the borders hold. */
        GOLDEN_FLEECE(200, 20f),
        /** The Titan's Curse — Medusa's face on a shield. Anything that looks at it stops. */
        AEGIS(160, 30f),
        /** The Lightning Thief, ch. 12 — Annabeth's cap. Simple, and it works. */
        YANKEES_CAP(300, 25f),
        /** Clarisse's spear, which the books are very clear hurts a lot. */
        ELECTRIC_SPEAR(80, 15f),
        /** A drachma spent well: you go where you are looking, once. */
        TRAVELERS_TOKEN(120, 30f);

        final int cooldownTicks;
        final float energyCost;

        Power(int cooldownTicks, float energyCost) {
            this.cooldownTicks = cooldownTicks;
            this.energyCost = energyCost;
        }
    }

    private final Power power;

    public RelicItem(Properties properties, Power power) {
        super(properties);
        this.power = power;
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide() || !(player instanceof ServerPlayer sp)) {
            return InteractionResult.SUCCESS;
        }

        DemigodData data = sp.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) {
            sp.sendSystemMessage(Component.literal(
                    "§7It is warm, and heavy, and it does not answer to you."));
            return InteractionResult.FAIL;
        }
        if (data.overdraw() > data.maxEnergy() * 0.9f) {
            sp.sendSystemMessage(Component.literal("§8You have nothing left to give it."));
            return InteractionResult.FAIL;
        }

        ServerLevel world = (ServerLevel) sp.level();
        switch (power) {
            case MASTER_BOLT -> masterBolt(sp, world);
            case HELM_OF_DARKNESS -> helm(sp, world);
            case GOLDEN_FLEECE -> fleece(sp, world);
            case AEGIS -> aegis(sp, world);
            case YANKEES_CAP -> cap(sp, world);
            case ELECTRIC_SPEAR -> spear(sp, world);
            case TRAVELERS_TOKEN -> token(sp, world);
        }

        data.spend(power.energyCost);
        player.getCooldowns().addCooldown(stack, power.cooldownTicks);
        return InteractionResult.CONSUME;
    }

    // -- the powers ---------------------------------------------------------------------------

    private void masterBolt(ServerPlayer sp, ServerLevel world) {
        Vec3 look = sp.getEyePosition().add(sp.getLookAngle().scale(40));
        for (int i = 0; i < 3; i++) {
            var bolt = EntityType.LIGHTNING_BOLT.create(world, EntitySpawnReason.TRIGGERED);
            if (bolt == null) continue;
            bolt.setPos(look.x + (i - 1) * 2.5, look.y, look.z + (i - 1) * 2.5);
            world.addFreshEntity(bolt);
        }
        world.sendParticles(ParticleTypes.ELECTRIC_SPARK, look.x, look.y + 2, look.z,
                120, 3.0, 3.0, 3.0, 0.4);
        sp.sendSystemMessage(Component.literal("§e§lThe sky does what you tell it."));
    }

    private void helm(ServerPlayer sp, ServerLevel world) {
        sp.addEffect(new MobEffectInstance(MobEffects.INVISIBILITY, 600, 0));
        for (LivingEntity e : world.getEntitiesOfClass(LivingEntity.class,
                new AABB(sp.position(), sp.position()).inflate(16))) {
            if (e == sp) continue;
            e.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 200, 1));
            e.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 200, 1));
        }
        world.sendParticles(ParticleTypes.LARGE_SMOKE, sp.getX(), sp.getY() + 1, sp.getZ(),
                60, 0.8, 1.2, 0.8, 0.02);
        sp.sendSystemMessage(Component.literal(
                "§8You put it on and the world forgets there was ever anyone here."));
    }

    private void fleece(ServerPlayer sp, ServerLevel world) {
        for (LivingEntity e : world.getEntitiesOfClass(LivingEntity.class,
                new AABB(sp.position(), sp.position()).inflate(12))) {
            if (e instanceof net.minecraft.world.entity.monster.Monster) continue;
            e.heal(14f);
            e.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 300, 2));
            e.clearFire();
        }
        world.sendParticles(ParticleTypes.HAPPY_VILLAGER, sp.getX(), sp.getY() + 1, sp.getZ(),
                80, 4.0, 2.0, 4.0, 0.0);
        sp.sendSystemMessage(Component.literal("§6Everything near it starts getting better."));
    }

    private void aegis(ServerPlayer sp, ServerLevel world) {
        for (LivingEntity e : world.getEntitiesOfClass(LivingEntity.class,
                new AABB(sp.position(), sp.position()).inflate(14),
                e -> e instanceof net.minecraft.world.entity.monster.Monster)) {
            e.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 200, 4));
            e.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 200, 2));
            e.addEffect(new MobEffectInstance(MobEffects.GLOWING, 200, 0));
        }
        sp.addEffect(new MobEffectInstance(MobEffects.RESISTANCE, 300, 1));
        world.playSound(null, sp.blockPosition(), SoundEvents.ENDER_DRAGON_GROWL, SoundSource.PLAYERS, 0.8f, 1.4f);
        sp.sendSystemMessage(Component.literal("§7Everything that looks at it stops looking at anything."));
    }

    private void cap(ServerPlayer sp, ServerLevel world) {
        sp.addEffect(new MobEffectInstance(MobEffects.INVISIBILITY, 1200, 0));
        sp.sendSystemMessage(Component.literal("§9You are not here. §7You have not been here for a while."));
    }

    private void spear(ServerPlayer sp, ServerLevel world) {
        Vec3 c = sp.position();
        for (LivingEntity e : world.getEntitiesOfClass(LivingEntity.class,
                new AABB(c, c).inflate(5), e -> e != sp)) {
            e.hurt(world.damageSources().lightningBolt(), 12f);
            e.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 60, 3));
            world.sendParticles(ParticleTypes.ELECTRIC_SPARK, e.getX(), e.getY() + 1, e.getZ(),
                    20, 0.3, 0.5, 0.3, 0.2);
        }
        world.playSound(null, sp.blockPosition(), SoundEvents.LIGHTNING_BOLT_IMPACT, SoundSource.PLAYERS, 0.7f, 1.6f);
    }

    private void token(ServerPlayer sp, ServerLevel world) {
        // Underworld and Olympus both refuse it — you do not get to shortcut those.
        if (ChDimensions.isUnderworld(world) || ChDimensions.isOlympus(world)) {
            sp.sendSystemMessage(Component.literal("§7Not here. This place has its own doors."));
            return;
        }
        Vec3 eye = sp.getEyePosition();
        Vec3 end = eye.add(sp.getLookAngle().scale(48));
        var hit = world.clip(new net.minecraft.world.level.ClipContext(
                eye, end, net.minecraft.world.level.ClipContext.Block.COLLIDER,
                net.minecraft.world.level.ClipContext.Fluid.NONE, sp));
        var dest = hit.getBlockPos().above();
        sp.teleportTo(dest.getX() + 0.5, dest.getY(), dest.getZ() + 0.5);
        world.sendParticles(ParticleTypes.PORTAL, dest.getX() + 0.5, dest.getY() + 1, dest.getZ() + 0.5,
                40, 0.4, 0.8, 0.4, 0.3);
        world.playSound(null, dest, SoundEvents.ENDERMAN_TELEPORT, SoundSource.PLAYERS, 0.8f, 1.2f);
    }
}
