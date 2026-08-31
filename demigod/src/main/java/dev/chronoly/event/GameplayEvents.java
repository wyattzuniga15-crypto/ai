package dev.chronoly.event;

import dev.chronoly.ChTags;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.combat.MistCombatResolver;
import dev.chronoly.core.energy.EnergyProfile;
import dev.chronoly.core.energy.Surroundings;
import dev.chronoly.boss.BossKind;
import dev.chronoly.boss.Bosses;
import dev.chronoly.net.s2c.DemigodSnapshotPayload;
import dev.chronoly.registry.ChItems;
import net.neoforged.neoforge.network.PacketDistributor;
import dev.chronoly.world.spawn.SpawnDirector;
import net.minecraft.world.item.ItemStack;
import dev.chronoly.core.favor.Tier;
import dev.chronoly.world.ChDimensions;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.world.entity.LivingEntity;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

import java.util.List;
import java.util.Map;

/** Claiming, favour, and energy — the progression loop, running for real. */
public final class GameplayEvents {

    private GameplayEvents() {}

    /** DECISIONS.md D-15: weighted random, Big Three rare. You do not choose your parent. */
    private static final List<String> COMMON = List.of(
            "athena", "ares", "apollo", "hermes", "hecate");
    private static final List<String> BIG_THREE = List.of("poseidon", "zeus", "hades");

    private static final Map<String, String> EPITHET = Map.of(
            "poseidon", "the Earthshaker", "zeus", "the Sky Father", "hades", "the Lord of the Dead",
            "athena", "the Grey-Eyed", "ares", "the War God", "apollo", "the Far-Shooter",
            "hermes", "the Traveller", "hecate", "the Lady of the Crossroads");

    /** Killing a genuine monster is the commonest way the gods notice you. */
    public static void onDeath(LivingDeathEvent event) {
        LivingEntity dead = event.getEntity();
        if (dead.level().isClientSide()) return;

        // Named monsters come apart into golden dust and leave something worth having.
        if (Bosses.isBoss(dead)) {
            Bosses.onBossKilled((ServerLevel) dead.level(), dead);
            if (event.getSource().getEntity() instanceof ServerPlayer slayer) {
                DemigodData sd = slayer.getData(ChAttachments.DEMIGOD.get());
                if (sd.isClaimed()) {
                    sd.addFavor(sd.parentage().orElseThrow(), 90f);

                    // If the Oracle sent them after this one, that is the quest done.
                    for (BossKind kind : BossKind.values()) {
                        if (!sd.questTarget().equals(kind.id())) continue;
                        if (!dead.getName().getString().contains(kind.title)) continue;
                        sd.clearQuest();
                        sd.addFavor(sd.parentage().orElseThrow(), 120f);
                        slayer.sendSystemMessage(Component.literal(
                                "§6§lThe prophecy is spent. §7You did what it said, more or less."));
                        break;
                    }
                }
            }
        }
        if (!(event.getSource().getEntity() instanceof ServerPlayer player)) return;
        if (!dead.getType().is(ChTags.MONSTER)) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) {
            claim(player, data);
            return;
        }
        String god = data.parentage().orElseThrow();
        Tier before = Tier.forFavor(data.favorWith(god));
        data.addFavor(god, 6f);
        Tier after = Tier.forFavor(data.favorWith(god));
        if (after != before) {
            player.sendSystemMessage(Component.literal(
                    "§6Something in you settles and grows heavier. §e" + after
                    + "§6 — and whatever is out there can smell it."));
            ((ServerLevel) player.level()).playSound(null, player.blockPosition(),
                    SoundEvents.PLAYER_LEVELUP, SoundSource.PLAYERS, 1f, 0.7f);
        }
    }

    /** The claiming ceremony. The Lightning Thief, ch. 8 — everyone sees it, and everyone kneels. */
    public static void claim(ServerPlayer player, DemigodData data) {
        String god = roll(player);
        claimAs(player, data, god);
    }

    public static void claimAs(ServerPlayer player, DemigodData data, String god) {
        data.claim(god);
        data.setEnergy(data.maxEnergy());
        ServerLevel level = ((ServerLevel) player.level());

        level.sendParticles(ParticleTypes.END_ROD,
                player.getX(), player.getY() + 2.4, player.getZ(), 120, 0.6, 1.2, 0.6, 0.02);
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_ACTIVATE,
                SoundSource.PLAYERS, 1.5f, 0.8f);

        String epithet = EPITHET.getOrDefault(god, "the Nameless");
        Component hail = Component.literal("§6§lHail, " + player.getName().getString()
                + ", child of " + capitalise(god) + " — " + epithet + ".");
        for (ServerPlayer other : level.getServer().getPlayerList().getPlayers()) {
            other.sendSystemMessage(hail);
        }
        player.sendSystemMessage(Component.literal(
                "§7Press §fG§7 to use your birthright. §8/chronoly status tells you where you stand."));
    }

    private static String roll(ServerPlayer player) {
        var rng = player.getRandom();
        // 3% combined for the Big Three (BALANCE.md).
        if (rng.nextFloat() < 0.03f) return BIG_THREE.get(rng.nextInt(BIG_THREE.size()));
        return COMMON.get(rng.nextInt(COMMON.size()));
    }

    private static String capitalise(String s) {
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static int tick;

    /**
     * Energy regeneration, driven by the parent-specific profiles in core/. Cadenced at one second,
     * not every tick — ARCHITECTURE §14's performance rule, and the reason this scales.
     */
    public static void onServerTick(ServerTickEvent.Post event) {
        if (++tick % 20 != 0) return;

        for (ServerLevel level : event.getServer().getAllLevels()) {
            Bosses.tick(level);
            SpawnDirector.tick(level);
        }

        for (ServerPlayer player : event.getServer().getPlayerList().getPlayers()) {
            DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
            if (!data.isClaimed()) continue;

            EnergyProfile profile = profileFor(data.parentage().orElseThrow());
            float rate = profile.rateIn(sample(player));
            float max = data.maxEnergy();
            data.setEnergy(Math.min(max, data.energy() + rate));
            data.setOverdraw(data.overdraw() - 1.5f);

            // Ambrosia burn cools over real minutes — The Lightning Thief, ch. 4.
            if (data.ambrosiaBurn() > 0f) data.setAmbrosiaBurn(data.ambrosiaBurn() - 0.15f);

            returnRiptide(player, data);
            expireQuest(player, data);
            syncToClient(player, data);
        }
    }

    /** Push the player's own state so the HUD draws something true rather than something guessed. */
    private static void syncToClient(ServerPlayer player, DemigodData data) {
        String god = data.parentage().orElse("");
        PacketDistributor.sendToPlayer(player, new DemigodSnapshotPayload(
                god, data.energy(), data.overdraw(), data.maxEnergy(),
                god.isEmpty() ? 0f : data.favorWith(god)));
    }

    /**
     * The Lightning Thief, ch. 6 — Riptide always comes back to your pocket. Lose it, drop it,
     * leave it in a chest: it is a pen again and it is in your pocket.
     *
     * <p>The flag matters. Only somebody who has actually held it gets it back, so this is a
     * property of the sword rather than a free item.
     */
    private static void returnRiptide(ServerPlayer player, DemigodData data) {
        if (player.getInventory().contains(s -> s.is(ChItems.RIPTIDE.get()))) {
            data.raiseFlag("held_riptide");
            return;
        }
        if (!data.hasFlag("held_riptide")) return;

        player.getInventory().add(new ItemStack(ChItems.RIPTIDE.get()));
        if (data.raiseFlag("lesson_riptide")) {
            player.sendSystemMessage(Component.literal(
                    "§bYou put your hand in your pocket and the pen is there again. "
                    + "§7It was always going to be."));
        }
    }

    /** A quest with a deadline is a quest you can fail. */
    private static void expireQuest(ServerPlayer player, DemigodData data) {
        if (!data.hasQuest()) return;
        if (player.level().getGameTime() < data.questDeadline()) return;

        data.clearQuest();
        String god = data.parentage().orElse("");
        if (!god.isEmpty()) data.addFavor(god, -40f);
        player.sendSystemMessage(Component.literal(
                "§8The deadline passes. §7Whatever you were sent for, somebody else will have to go."));
    }

    /** One sample per player per second; every predicate reads from this, never from the world. */
    private static Surroundings sample(ServerPlayer p) {
        ServerLevel level = (ServerLevel) p.level();
        var pos = p.blockPosition();
        boolean sky = level.canSeeSky(pos);
        boolean day = level.getDayTime() % 24000L < 12000L;
        boolean nether = level.dimension() == net.minecraft.world.level.Level.NETHER;
        var biome = level.getBiome(pos);
        boolean desert = biome.is(net.minecraft.tags.BiomeTags.IS_BADLANDS)
                || biome.value().getBaseTemperature() > 1.5f;

        return new Surroundings(
                p.isUnderWater(), p.isInWater() || level.getFluidState(pos.below()).is(net.minecraft.tags.FluidTags.WATER),
                desert, nether, pos.getY(), pos.getY() < 50 && !sky,
                level.isRaining(), level.isThundering(), sky, day,
                !day && sky, biome.is(net.minecraft.tags.BiomeTags.IS_FOREST),
                level.getBrightness(net.minecraft.world.level.LightLayer.BLOCK, pos),
                false, level.getBlockState(pos.below()).is(net.minecraft.tags.BlockTags.DIRT),
                false, level.getBlockState(pos.below()).is(net.minecraft.world.level.block.Blocks.MAGMA_BLOCK),
                false, false, false, 0, p.getLastDamageSource() != null, 0d, false);
    }

    private static EnergyProfile profileFor(String god) {
        return switch (god) {
            case "poseidon" -> EnergyProfile.poseidon();
            case "zeus" -> EnergyProfile.zeus();
            case "hades" -> EnergyProfile.hades();
            case "apollo" -> EnergyProfile.apollo();
            case "athena" -> EnergyProfile.athena();
            case "ares" -> EnergyProfile.ares();
            case "hermes" -> EnergyProfile.hermes();
            default -> EnergyProfile.hecate();
        };
    }

    public static void onIncomingDamage(net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent e) {
        MistCombatResolver.onIncomingDamage(e);
        if (!e.isCanceled() && Bosses.isBoss(e.getEntity())) {
            Bosses.onBossDamaged(e.getEntity(), e.getSource(), e.getAmount());
        }
    }

    /**
     * Death sends a demigod to the Underworld rather than to a respawn screen.
     * ROADMAP Phase 9 in its first form: you arrive, and you have to walk out.
     */
    public static void onPlayerDeath(LivingDeathEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        if (player.level().isClientSide()) return;
        if (ChDimensions.isUnderworld(player.level())) return;   // already there

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;                            // mortals get the ordinary death

        event.setCanceled(true);
        player.setHealth(player.getMaxHealth() * 0.5f);
        player.clearFire();
        data.setEnergy(0f);
        data.setOverdraw(data.maxEnergy() * 0.5f);
        ChDimensions.sendToUnderworld(player,
                "You do not wake up. You arrive.");
    }
}
