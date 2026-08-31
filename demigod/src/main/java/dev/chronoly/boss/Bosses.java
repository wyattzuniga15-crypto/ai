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
        /** Nemean Lion: ticks left with the mouth open, the only window damage lands. */
        public int mouthOpen;

        Fight(BossKind kind, ServerBossEvent bar) {
            this.kind = kind;
            this.bar = bar;
        }
    }

    public static Mob spawn(ServerLevel level, BossKind kind, double x, double y, double z) {
        // The named monsters wear their own bodies now; kind.base survives as documentation of
        // what each fight was prototyped on, and as the fallback shape of the mechanics.
        Entity raw = dev.chronoly.registry.ChEntities.typeFor(kind).create(level, EntitySpawnReason.COMMAND);
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
            // Sized for the old wolf body; the custom body is already a dog the size of a truck.
            setAttribute(mob, Attributes.SCALE, 1.4);
        }

        if (kind == BossKind.CHARYBDIS) {
            // The mouth of the strait needs a strait. A pool under her, so the pull has water
            // to drag you through and "get to land" means something.
            var centre = net.minecraft.core.BlockPos.containing(x, y - 1, z);
            for (int dx = -9; dx <= 9; dx++) {
                for (int dz = -9; dz <= 9; dz++) {
                    if (dx * dx + dz * dz > 81) continue;
                    level.setBlock(centre.offset(dx, 0, dz),
                            net.minecraft.world.level.block.Blocks.WATER.defaultBlockState(), 2);
                    level.setBlock(centre.offset(dx, -1, dz),
                            net.minecraft.world.level.block.Blocks.WATER.defaultBlockState(), 2);
                }
            }
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
            case MEDUSA -> {
                // Look at her and you start to set. Look away and it stops. Nothing else works.
                for (ServerPlayer p : level.players()) {
                    if (p.distanceToSqr(boss) > 24 * 24) continue;
                    if (!p.hasLineOfSight(boss)) continue;

                    Vec3 toBoss = boss.position().subtract(p.getEyePosition()).normalize();
                    double facing = toBoss.dot(p.getLookAngle());
                    if (facing < 0.86) continue;   // not looking at her

                    p.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 60, 3));
                    p.addEffect(new MobEffectInstance(MobEffects.MINING_FATIGUE, 60, 2));
                    p.hurt(level.damageSources().magic(), 2.0f);
                    if (fight.cooldown == 0) {
                        fight.cooldown = 40;
                        p.sendSystemMessage(Component.literal(
                                "§2Your legs are getting heavy. §7Stop looking at her."));
                    }
                }
            }
            case NEMEAN_LION -> {
                // The hide turns everything. Every few seconds it roars, and for two of them the
                // mouth is open — see onBossDamaged, which is where the rule is enforced.
                if (fight.mouthOpen > 0) {
                    fight.mouthOpen--;
                    level.sendParticles(ParticleTypes.FLAME, boss.getX(), boss.getY() + 1.6, boss.getZ(),
                            8, 0.3, 0.2, 0.3, 0.01);
                } else if (fight.cooldown == 0) {
                    fight.cooldown = 140;
                    fight.mouthOpen = 40;
                    boss.addEffect(new MobEffectInstance(MobEffects.GLOWING, 40, 0));
                    level.playSound(null, boss.blockPosition(), SoundEvents.RAVAGER_ROAR,
                            SoundSource.HOSTILE, 1.3f, 0.6f);
                    announce(level, "§eThe lion roars — §7its mouth is open. That is the only way in.");
                }
            }
            case CHIMERA -> {
                if (fight.cooldown == 0) {
                    fight.cooldown = 110;
                    for (ServerPlayer p : level.players()) {
                        if (p.distanceToSqr(boss) > 14 * 14) continue;
                        p.igniteForSeconds(5);
                        p.addEffect(new MobEffectInstance(MobEffects.POISON, 120, 1));
                    }
                    level.sendParticles(ParticleTypes.FLAME, boss.getX(), boss.getY() + 1.2, boss.getZ(),
                            60, 2.5, 0.6, 2.5, 0.05);
                    level.playSound(null, boss.blockPosition(), SoundEvents.BLAZE_SHOOT,
                            SoundSource.HOSTILE, 1.4f, 0.7f);
                }
            }
            case CHARYBDIS -> {
                // The pull is the fight. Everything within twenty blocks is dragged toward the
                // centre, and standing in it drowns you — get to land, or get eaten.
                // She, of course, does not drown in herself.
                boss.setAirSupply(boss.getMaxAirSupply());
                Vec3 centre = boss.position();
                for (ServerPlayer p : level.players()) {
                    double dist = p.distanceTo(boss);
                    if (dist > 20 || dist < 1.5) continue;

                    Vec3 pull = centre.subtract(p.position()).normalize().scale(0.42);
                    p.push(pull.x, pull.y * 0.2, pull.z);
                    p.hurtMarked = true;

                    if (dist < 6) {
                        p.hurt(level.damageSources().drown(), 4.0f);
                        p.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 40, 2));
                    }
                }
                if (fight.cooldown == 0) {
                    fight.cooldown = 60;
                    level.sendParticles(ParticleTypes.BUBBLE_COLUMN_UP,
                            centre.x, centre.y, centre.z, 120, 4.0, 1.0, 4.0, 0.2);
                    level.playSound(null, boss.blockPosition(), SoundEvents.CONDUIT_AMBIENT,
                            SoundSource.HOSTILE, 1.6f, 0.5f);
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
        if (fight == null) return;

        if (fight.kind == BossKind.HYDRA) {
            boolean fire = source.is(net.minecraft.tags.DamageTypeTags.IS_FIRE)
                    || (source.getEntity() instanceof LivingEntity a && a.isOnFire());
            if (fire) {
                if (fight.hydraHeads > 0) fight.hydraHeads--;
            } else if (amount > 6f) {
                fight.hydraHeads = Math.min(6, fight.hydraHeads + 1);
            }
        }
    }

    /**
     * The Nemean Lion's hide. Returns true when the blow should simply not land.
     *
     * <p>The Titan's Curse, ch. 9 — everything glances off except what goes in the open mouth,
     * so the fight is about waiting for the roar rather than out-damaging it.
     */
    public static boolean deflects(LivingEntity boss, DamageSource source) {
        Fight fight = ACTIVE.get(boss.getUUID());
        if (fight == null || fight.kind != BossKind.NEMEAN_LION) return false;
        if (fight.mouthOpen > 0) return false;
        return !source.is(net.minecraft.tags.DamageTypeTags.BYPASSES_ARMOR);
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

        // The named relics are not craftable. Each one comes off the thing that guarded it, which
        // is both the lore and the only reason to fight the harder bosses twice.
        switch (fight.kind) {
            case NEMEAN_LION -> drop(level, at, new ItemStack(ChItems.NEMEAN_PELT.get()));
            case CERBERUS -> drop(level, at, new ItemStack(ChItems.HELM_OF_DARKNESS.get()));
            case HYDRA -> drop(level, at, new ItemStack(ChItems.GOLDEN_FLEECE.get()));
            case MEDUSA -> drop(level, at, new ItemStack(ChItems.AEGIS.get()));
            case LYDIAN_DRAKON -> drop(level, at, new ItemStack(ChItems.MASTER_BOLT.get()));
            case CHARYBDIS -> drop(level, at, new ItemStack(ChItems.MIST_GLASS.get(), 8));
            default -> { }
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
