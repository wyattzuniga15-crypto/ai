package dev.chronoly.event;

import dev.chronoly.ChTags;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.combat.MistCombatResolver;
import dev.chronoly.core.energy.EnergyProfile;
import dev.chronoly.core.energy.Surroundings;
import dev.chronoly.core.favor.Tier;
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
            player.serverLevel().playSound(null, player.blockPosition(),
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
        ServerLevel level = player.serverLevel();

        level.sendParticles(ParticleTypes.END_ROD,
                player.getX(), player.getY() + 2.4, player.getZ(), 120, 0.6, 1.2, 0.6, 0.02);
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_ACTIVATE,
                SoundSource.PLAYERS, 1.5f, 0.8f);

        String epithet = EPITHET.getOrDefault(god, "the Nameless");
        Component hail = Component.literal("§6§lHail, " + player.getGameProfile().getName()
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
        }
    }

    /** One sample per player per second; every predicate reads from this, never from the world. */
    private static Surroundings sample(ServerPlayer p) {
        ServerLevel level = p.serverLevel();
        var pos = p.blockPosition();
        boolean sky = level.canSeeSky(pos);
        boolean day = level.isDay();
        boolean nether = level.dimension() == net.minecraft.world.level.Level.NETHER;
        var biome = level.getBiome(pos);
        boolean desert = biome.is(net.minecraft.tags.BiomeTags.IS_BADLANDS)
                || biome.value().getBaseTemperature() > 1.5f;

        return new Surroundings(
                p.isUnderWater(), p.isInWater() || level.getFluidState(pos.below()).is(net.minecraft.tags.FluidTags.WATER),
                desert, nether, pos.getY(), pos.getY() < 50 && !sky,
                level.isRaining(), level.isThundering(), sky, day,
                !day && sky, biome.is(net.minecraft.tags.BiomeTags.IS_FOREST),
                level.getMaxLocalRawBrightness(pos),
                false, level.getBlockState(pos.below()).is(net.minecraft.tags.BlockTags.DIRT),
                false, level.getBlockState(pos.below()).is(net.minecraft.world.level.block.Blocks.MAGMA_BLOCK),
                false, false, false, 0, p.getLastHurtByMob() != null, 0d, false);
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
    }
}
