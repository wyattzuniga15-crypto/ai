package dev.chronoly.event;

import dev.chronoly.ChTags;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;

/**
 * The favour reasons that existed on paper and did nothing.
 *
 * <p>The core model has carried fifteen tested favour coefficients since the first day; until now
 * only four ever fired. These are the next five, chosen because each has an event that states its
 * meaning cleanly — the remainder (boasting, burial rites, oaths) need mechanics of their own and
 * are not worth faking.
 */
public final class PietyEvents {

    private PietyEvents() {}

    /**
     * The burnt offering. The Lightning Thief, ch. 7 — you scrape the best part of your meal into
     * the fire, and the books are specific that it is the best portion, not the leftovers. Scored
     * by nutrition, exactly as the brief asks: right-click a campfire holding food.
     */
    public static void onOffer(PlayerInteractEvent.RightClickBlock event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        ServerLevel level = (ServerLevel) player.level();
        if (!level.getBlockState(event.getPos()).is(Blocks.CAMPFIRE)
                && !level.getBlockState(event.getPos()).is(Blocks.SOUL_CAMPFIRE)) return;

        ItemStack held = event.getItemStack();
        FoodProperties food = held.get(net.minecraft.core.component.DataComponents.FOOD);
        if (food == null) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;

        // Nutrition 8+ is a real meal; a dried kelp offering is an insult priced accordingly.
        float worth = 12f * (food.nutrition() / 8f);
        held.shrink(1);
        data.addFavor(data.parentage().orElseThrow(), Math.max(1f, worth));

        var pos = event.getPos();
        level.sendParticles(ParticleTypes.SMOKE, pos.getX() + 0.5, pos.getY() + 1.2, pos.getZ() + 0.5,
                20, 0.2, 0.4, 0.2, 0.01);
        level.playSound(null, pos, SoundEvents.BLAZE_AMBIENT, SoundSource.BLOCKS, 0.5f, 1.6f);
        if (food.nutrition() >= 8) {
            player.sendSystemMessage(Component.literal(
                    "§6The smoke goes straight up. §7Somebody noticed."));
        } else {
            player.sendSystemMessage(Component.literal(
                    "§7The smoke wanders off sideways. §8It was not your best, and they know it."));
        }
        event.setCanceled(true);
    }

    /**
     * Invention pleases the gods; repetition bores them. First craft of any given item is worth
     * ten favour, the ten thousandth is worth nothing.
     */
    public static void onCraft(PlayerEvent.ItemCraftedEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        ItemStack made = event.getCrafting();
        if (made.isEmpty()) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;

        String key = "crafted_" + made.getItem().toString();
        if (!data.raiseFlag(key)) return;
        data.addFavor(data.parentage().orElseThrow(), 10f);
        player.sendSystemMessage(Component.literal(
                "§6Something new under the sun. §7Your parent appreciates invention."));
    }

    /**
     * Two verdicts on a kill, both from the core model's table: winning a fight you should have
     * lost is worth more than the kill itself, and killing what could not fight back costs you.
     */
    public static void onKill(LivingDeathEvent event) {
        LivingEntity dead = event.getEntity();
        if (dead.level().isClientSide()) return;
        if (!(event.getSource().getEntity() instanceof ServerPlayer player)) return;
        if (dead instanceof Player) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;
        String god = data.parentage().orElseThrow();
        noteKillSite(player, dead);

        if (dead.getType().is(ChTags.MONSTER)
                && player.getHealth() < player.getMaxHealth() * 0.2f) {
            data.addFavor(god, 15f);
            player.sendSystemMessage(Component.literal(
                    "§6You should not have won that. §7Winning anyway is the kind of thing "
                    + "that gets noticed."));
        }

        // "Could not fight back" means people, not livestock — a farm would bankrupt you
        // otherwise, and the books' heroes eat like teenagers.
        boolean person = dead.getType() == net.minecraft.world.entity.EntityType.VILLAGER
                || dead.getType() == net.minecraft.world.entity.EntityType.WANDERING_TRADER;
        if (person) {
            data.addFavor(god, -25f);
            data.raiseFlag("killed_helpless");   // Judgment reads this exact flag at the pavilion
            if (data.raiseFlag("lesson_helpless")) {
                player.sendSystemMessage(Component.literal(
                        "§cThey could not fight back. §7The gods keep a different ledger for that."));
            }
        }
    }

    /** Dying is embarrassing for everyone involved. The ledger says so: minus forty. */
    public static void onDemigodDeath(ServerPlayer player, DemigodData data) {
        data.addFavor(data.parentage().orElse(""), -40f);
    }

    // ---- burial rites -----------------------------------------------------------------------

    /** Where each player's recent kills fell. The dead are owed a minute of memory. */
    private static final java.util.Map<java.util.UUID, java.util.List<long[]>> RECENT_KILLS =
            new java.util.concurrent.ConcurrentHashMap<>();

    static void noteKillSite(ServerPlayer player, LivingEntity dead) {
        var list = RECENT_KILLS.computeIfAbsent(player.getUUID(),
                k -> java.util.Collections.synchronizedList(new java.util.ArrayList<>()));
        list.add(new long[]{dead.blockPosition().getX(), dead.blockPosition().getY(),
                dead.blockPosition().getZ(), player.level().getGameTime()});
        if (list.size() > 5) list.remove(0);
    }

    /**
     * The burial rite. The dead are Hades' and he notices who is careless: cover where something
     * fell with earth within a minute and the ledger credits you five. It has to be earth — the
     * rite is dirt over the dead, not cobblestone over an inconvenience.
     */
    public static void onPlace(net.neoforged.neoforge.event.level.BlockEvent.EntityPlaceEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        var state = event.getPlacedBlock();
        if (!state.is(net.minecraft.world.level.block.Blocks.DIRT)
                && !state.is(net.minecraft.world.level.block.Blocks.COARSE_DIRT)
                && !state.is(net.minecraft.world.level.block.Blocks.PODZOL)
                && !state.is(net.minecraft.world.level.block.Blocks.GRAVEL)
                && !state.is(net.minecraft.world.level.block.Blocks.MUD)) return;

        var list = RECENT_KILLS.get(player.getUUID());
        if (list == null || list.isEmpty()) return;
        long now = player.level().getGameTime();
        var pos = event.getPos();

        synchronized (list) {
            var it = list.iterator();
            while (it.hasNext()) {
                long[] site = it.next();
                if (now - site[3] > 1200) { it.remove(); continue; }
                long dx = pos.getX() - site[0], dy = pos.getY() - site[1], dz = pos.getZ() - site[2];
                if (dx * dx + dy * dy + dz * dz > 9) continue;

                it.remove();
                DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
                if (!data.isClaimed()) return;
                data.addFavor(data.parentage().orElseThrow(), 5f);
                if (data.raiseFlag("lesson_burial")) {
                    player.sendSystemMessage(Component.literal(
                            "§5Somewhere below, something nods. §7The dead are his, and he "
                            + "notices who is careful with them."));
                }
                return;
            }
        }
    }

    // ---- boasting ---------------------------------------------------------------------------

    /** Who was in a fight, and when. Twenty seconds of memory is enough to know a boast. */
    private static final java.util.Map<java.util.UUID, Long> LAST_COMBAT =
            new java.util.concurrent.ConcurrentHashMap<>();

    public static void noteCombat(Player player) {
        LAST_COMBAT.put(player.getUUID(), player.level().getGameTime());
    }

    /** Words that declare a fight won. Matched as whole words so "gaze" is not "ez". */
    private static final java.util.Set<String> BOAST_WORDS = java.util.Set.of(
            "ez", "easy", "gg", "rekt", "unstoppable", "invincible", "untouchable", "noob");
    private static final String[] BOAST_PHRASES = {
            "too easy", "i win", "i won", "cant touch me", "can't touch me",
            "no match", "already won", "cannot lose", "cant lose", "can't lose"};

    /**
     * Hubris, spoken aloud. The Lightning Thief and everything after it — the gods have opinions
     * about declarations, and they collect while the fight is still on. Only in combat's shadow:
     * the same words in camp small talk cost nothing.
     */
    public static void onChat(net.neoforged.neoforge.event.ServerChatEvent event) {
        ServerPlayer player = event.getPlayer();
        Long last = LAST_COMBAT.get(player.getUUID());
        if (last == null || player.level().getGameTime() - last > 400) return;

        String said = event.getMessage().getString().toLowerCase(java.util.Locale.ROOT);
        boolean boast = false;
        for (String phrase : BOAST_PHRASES) {
            if (said.contains(phrase)) { boast = true; break; }
        }
        if (!boast) {
            for (String word : said.split("[^a-z']+")) {
                if (BOAST_WORDS.contains(word)) { boast = true; break; }
            }
        }
        if (!boast) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) return;
        data.addFavor(data.parentage().orElseThrow(), -20f);
        player.sendSystemMessage(Component.literal(
                "§cSomething vast pauses to listen. §7The fight is not over, and now they are "
                + "watching to see if you were right."));
    }
}
