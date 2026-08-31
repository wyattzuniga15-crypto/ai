package dev.chronoly.combat;

import dev.chronoly.ChTags;
import dev.chronoly.core.mist.Attack;
import dev.chronoly.core.mist.Flesh;
import dev.chronoly.core.mist.MistRule;
import dev.chronoly.core.mist.Resolution;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;

/**
 * The mod's most important rule, finally attached to the game.
 *
 * <p>The Lightning Thief, ch. 6 — celestial bronze passes harmlessly through mortals; mortal steel
 * passes harmlessly through monsters; a demigod is hurt by both. The decision itself lives in
 * {@link MistRule}, which is exhaustively unit-tested; this class only translates between Minecraft
 * and that rule.
 */
public final class MistCombatResolver {

    private MistCombatResolver() {}

    public static void onIncomingDamage(LivingIncomingDamageEvent event) {
        LivingEntity target = event.getEntity();
        if (target.level().isClientSide()) return;

        var source = event.getSource();
        if (!(source.getEntity() instanceof LivingEntity attacker)) return;   // fire, falling, etc.

        ItemStack weapon = attacker.getMainHandItem();
        boolean divine = weapon.is(ChTags.DIVINE_WEAPON);
        boolean bypasses = weapon.is(ChTags.BYPASSES_MIST);
        Attack attack = new Attack(divine, false, bypasses);

        Flesh flesh = fleshOf(target);
        Resolution resolution = MistRule.resolve(attack.axis(), flesh);
        if (resolution != Resolution.PHASES_THROUGH) return;

        event.setCanceled(true);
        phaseThrough(target);

        if (attacker instanceof ServerPlayer player) {
            teachOnce(player, divine);
        }
    }

    /** What the Mist considers this thing to be made of. */
    public static Flesh fleshOf(LivingEntity entity) {
        if (entity instanceof Player p) {
            boolean claimed = p.getData(ChAttachments.DEMIGOD.get()).isClaimed();
            return claimed ? Flesh.DEMIGOD : Flesh.MORTAL;
        }
        if (entity.getType().is(ChTags.MONSTER)) return Flesh.MONSTER;
        if (entity.getType().is(ChTags.MORTAL)) return Flesh.MORTAL;
        return Flesh.MORTAL;
    }

    /** The blade goes through as though nothing were there. */
    private static void phaseThrough(LivingEntity target) {
        if (!(target.level() instanceof ServerLevel level)) return;
        BlockState glass = Blocks.GLASS.defaultBlockState();
        level.sendParticles(new BlockParticleOption(ParticleTypes.BLOCK, glass),
                target.getX(), target.getY() + target.getBbHeight() * 0.5, target.getZ(),
                12, 0.25, 0.35, 0.25, 0.0);
        level.playSound(null, target.blockPosition(), SoundEvents.PLAYER_ATTACK_NODAMAGE,
                SoundSource.PLAYERS, 0.7f, 1.6f);
    }

    /**
     * The world teaches the rule, once, in the books' register — not a wiki, not a tutorial book.
     */
    private static void teachOnce(ServerPlayer player, boolean divine) {
        var data = player.getData(ChAttachments.DEMIGOD.get());
        String flag = divine ? "lesson_bronze" : "lesson_steel";
        if (!data.raiseFlag(flag)) return;

        player.sendSystemMessage(Component.literal(divine
                ? "§6Your blade goes straight through them, like they were made of fog. "
                  + "Celestial bronze only bites the immortal."
                : "§cYour weapon passes through it without leaving a mark. "
                  + "Mortal steel cannot touch a monster — you need celestial bronze."));
    }
}
