package dev.chronoly.boss;

import dev.chronoly.registry.ChItems;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.BossEvent;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraft.server.level.ServerBossEvent;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Boss spawning, boss bars, phase mechanics, and the golden dust they leave.
 *
 * <p>Every monster in the books dissolves rather than leaving a corpse, and the named ones come
 * back out of Tartarus eventually. Death here is a dust plume and a drop, never a body.
 */
public final class Bosses {

    private Bosses() {}

    /** Live fights, keyed by the entity carrying them. */
    private static final Map<UUID, Fight> ACTIVE = new HashMap<>();

    public static final class Fight {
        public final BossKind kind;
        public final ServerBossEvent bar;
        public int phase = 1;
        public int hydraHeads;
        public boolean hornBroken;
        public int cooldown;

        Fight(BossKind kind, ServerBossEvent bar) {
            this.kind = kind;
            this.bar = bar;
        }
    }

    public static Mob spawn(ServerLevel level, BossKind kind, double x, double y, double z) {
        Entity raw = kind.base.create(level, EntitySpawnReason.COMMAND);
        if (!(raw instanceof Mob mob)) return null;

        mob.setPos(x, y, z);
        mob.setCustomName(Component.literal("§6" + kind.title + " §7— " + kind.epithet));
        mob.setCustomNameVisible(true);
        mob.setPersistenceRequired();

        setAttribute(mob, Attributes.MAX_HEALTH, kind.health);
        mob.setHealth(kind.health);
        setAttribute(mob, Attributes.ATTACK_DAMAGE, kind.damage);
        setAttribute(mob, Attributes.MOVEMENT_SPEED, kind.speed);
        setAttribute(mob, Attributes.KNOCKBACK_RESISTANCE, 0.85);
        setAttribute(mob, Attributes.FOLLOW_RANGE, 48.0);

        if (kind == BossKind.CERBERUS) {
            setAttribute(mob, Attributes.SCALE, 3.0);
        }

        ServerBossEvent bar = new ServerBossEvent(
                Component.literal("§6" + kind.title), kind.colour, BossEvent.BossBarOverlay.PROGRESS);
        bar.setProgress(1.0f);
        ACTIVE.put(mob.getUUID(), new Fight(kind, bar));

        level.addFreshEntity(mob);
        level.playSound(null, mob.blockPosition(), SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 1.4f, 0.7f);
        level.sendParticles(ParticleTypes.LARGE_SMOKE, x, y + 1, z, 60, 1.2, 1.2, 1.2, 0.05);

        for (ServerPlayer p : level.players()) {
            p.sendSystemMessage(Component.literal(
                    "§4§l" + kind.title + " §chas found you."));
        }
        return mob;
    }

    private static void setAttribute(Mob mob, net.minecraft.core.Holder<net.minecraft.world.entity.ai.attributes.Attribute> attr, double value) {
        var instance = mob.getAttribute(attr);
        if (instance != null) instance.setBaseValue(value);
    }

    public static boolean isBoss(Entity entity) {
        return ACTIVE.containsKey(entity.getUUID());
    }

    /** Boss bars follow health and visibility every tick the fight is alive. */
    public static void tick(ServerLevel level) {
        if (ACTIVE.isEmpty()) return;

        ACTIVE.entrySet().removeIf(entry -> {
            Entity e = level.getEntity(entry.getKey());
            if (!(e instanceof LivingEntity boss) || !boss.isAlive()) {
                if (level.getEntity(entry.getKey()) == null) {
                    entry.getValue().bar.removeAllPlayers();
                    return true;
                }
                return false;
            }
            Fight fight = entry.getValue();
            fight.bar.setProgress(Math.max(0f, boss.getHealth() / boss.getMaxHealth()));

            // Anyone within 64 blocks is in the fight, and sees the bar.
            fight.bar.removeAllPlayers();
            for (ServerPlayer p : level.players()) {
                if (p.distanceToSqr(boss) < 64 * 64) fight.bar.addPlayer(p);
            }

            if (fight.cooldown > 0) fight.cooldown--;
            mechanic(level, boss, fight);
            return false;
        });
    }

    /** What makes each fight its own thing rather than a bigger health bar. */
    private static void mechanic(ServerLevel level, LivingEntity boss, Fight fight) {
        float frac = boss.getHealth() / boss.getMaxHealth();

        switch (fight.kind) {
            case MINOTAUR -> {
                // Half health: a horn breaks. Less damage, far more speed — the books' second wind.
                if (!fight.hornBroken && frac < 0.5f) {
                    fight.hornBroken = true;
                    setLiving(boss, Attributes.MOVEMENT_SPEED, 0.5);
                    boss.addEffect(new MobEffectInstance(MobEffects.STRENGTH, 20000, 0));
                    announce(level, "§6The Minotaur's horn snaps off in your hands. §cIt does not care.");
                    level.sendParticles(ParticleTypes.CRIT, boss.getX(), boss.getY() + 1.5, boss.getZ(),
                            40, 0.6, 0.6, 0.6, 0.2);
                }
            }
            case HYDRA -> {
                // Heads regrow on a timer unless the wound was cauterised — see onBossDamaged.
                if (fight.cooldown == 0 && fight.hydraHeads > 0) {
                    fight.cooldown = 100;
                    boss.heal(fight.hydraHeads * 4f);
                    announce(level, "§2Another head pushes its way out. §7Fire. It has to be fire.");
                }
            }
            case CERBERUS -> {
                // Three heads, three phases; each one calls the pack.
                int wanted = frac < 0.33f ? 3 : frac < 0.66f ? 2 : 1;
                if (wanted > fight.phase) {
                    fight.phase = wanted;
                    summonPack(level, boss, 2);
                    announce(level, "§5A second head starts barking, and then a third.");
                }
            }
            case FURY -> {
                if (fight.cooldown == 0) {
                    fight.cooldown = 160;
                    boss.addEffect(new MobEffectInstance(MobEffects.SPEED, 120, 2));
                    level.sendParticles(ParticleTypes.SMOKE, boss.getX(), boss.getY() + 1, boss.getZ(),
                            25, 0.5, 0.5, 0.5, 0.1);
                }
            }
            case LYDIAN_DRAKON -> {
                if (fight.cooldown == 0) {
                    fight.cooldown = 120;
                    for (ServerPlayer p : level.players()) {
                        if (p.distanceToSqr(boss) < 12 * 12) {
                            p.addEffect(new MobEffectInstance(MobEffects.POISON, 100, 1));
                        }
                    }
                    level.sendParticles(ParticleTypes.SNEEZE, boss.getX(), boss.getY() + 1.5, boss.getZ(),
                            40, 2.0, 0.5, 2.0, 0.02);
                }
            }
        }
    }

    private static void setLiving(LivingEntity e, net.minecraft.core.Holder<net.minecraft.world.entity.ai.attributes.Attribute> attr, double v) {
        var inst = e.getAttribute(attr);
        if (inst != null) inst.setBaseValue(v);
    }

    private static void summonPack(ServerLevel level, LivingEntity boss, int count) {
        for (int i = 0; i < count; i++) {
            Entity pup = net.minecraft.world.entity.EntityType.WOLF.create(level, EntitySpawnReason.MOB_SUMMONED);
            if (pup == null) continue;
            pup.setPos(boss.getX() + (i - 0.5) * 2, boss.getY(), boss.getZ());
            level.addFreshEntity(pup);
        }
    }

    private static void announce(ServerLevel level, String message) {
        for (ServerPlayer p : level.players()) p.sendSystemMessage(Component.literal(message));
    }

    /**
     * The Hydra's rule, applied where damage lands: anything that is not fire grows it back.
     * Cauterise, or you are just making more of it.
     */
    public static void onBossDamaged(LivingEntity boss, DamageSource source, float amount) {
        Fight fight = ACTIVE.get(boss.getUUID());
        if (fight == null || fight.kind != BossKind.HYDRA) return;

        boolean fire = source.is(net.minecraft.tags.DamageTypeTags.IS_FIRE)
                || (source.getEntity() instanceof LivingEntity a && a.isOnFire());
        if (fire) {
            if (fight.hydraHeads > 0) fight.hydraHeads--;
        } else if (amount > 6f) {
            fight.hydraHeads = Math.min(6, fight.hydraHeads + 1);
        }
    }

    /** Golden dust, a drop worth having, and the bar goes away. */
    public static void onBossKilled(ServerLevel level, LivingEntity boss) {
        Fight fight = ACTIVE.remove(boss.getUUID());
        if (fight == null) return;

        fight.bar.removeAllPlayers();
        Vec3 at = boss.position();
        level.sendParticles(ParticleTypes.END_ROD, at.x, at.y + 1, at.z, 150, 1.0, 1.5, 1.0, 0.06);
        level.playSound(null, boss.blockPosition(), SoundEvents.WITHER_DEATH, SoundSource.HOSTILE, 1.2f, 1.4f);

        drop(level, at, new ItemStack(ChItems.GOLDEN_DRACHMA.get(), 8 + level.random.nextInt(9)));
        drop(level, at, new ItemStack(ChItems.CELESTIAL_BRONZE_INGOT.get(), 3 + level.random.nextInt(4)));
        if (fight.kind == BossKind.LYDIAN_DRAKON || fight.kind == BossKind.HYDRA) {
            drop(level, at, new ItemStack(ChItems.STYGIAN_IRON_INGOT.get(), 2));
        }
        if (fight.kind == BossKind.CERBERUS) {
            drop(level, at, new ItemStack(ChItems.AMBROSIA.get(), 4));
        }

        announce(level, "§6§l" + fight.kind.title + " comes apart into golden dust. §7It will be back.");
    }

    private static void drop(ServerLevel level, Vec3 at, ItemStack stack) {
        var item = new net.minecraft.world.entity.item.ItemEntity(level, at.x, at.y + 0.5, at.z, stack);
        level.addFreshEntity(item);
    }

    /** Bosses are monsters for the Mist rule, whatever body they are wearing. */
    public static boolean countsAsMonster(Entity entity) {
        return isBoss(entity);
    }

    public static AABB arena(Vec3 centre, double r) {
        return new AABB(centre, centre).inflate(r);
    }
}
