package dev.chronoly.item;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/**
 * The Lightning Thief, ch. 4 — food of the gods. It heals a demigod and burns a mortal to ash, and
 * too much of it, too quickly, burns the demigod too.
 *
 * <p>The burn counter is the point. The books are unambiguous that ambrosia kills if you overdo it,
 * and the brief says not to soften it, so this does not.
 */
public class AmbrosiaItem extends Item {

    private final float heal;
    private final float burnPerDose;
    private final float safeDose;

    public AmbrosiaItem(Properties properties, float heal, float burnPerDose, float safeDose) {
        super(properties);
        this.heal = heal;
        this.burnPerDose = burnPerDose;
        this.safeDose = safeDose;
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide() || !(player instanceof ServerPlayer sp)) {
            return InteractionResult.SUCCESS;
        }

        DemigodData data = sp.getData(ChAttachments.DEMIGOD.get());

        if (!data.isClaimed()) {
            // A mortal eating the food of the gods. This goes exactly as the books say it does.
            sp.igniteForSeconds(8);
            sp.hurt(level.damageSources().onFire(), 6.0f);
            sp.sendSystemMessage(Component.literal(
                    "§cIt tastes like a memory, and then like burning. This was never meant for you."));
            stack.shrink(1);
            return InteractionResult.CONSUME;
        }

        sp.heal(heal);
        data.setEnergy(Math.min(data.maxEnergy(), data.energy() + 40f));
        sp.removeEffect(MobEffects.POISON);
        sp.removeEffect(MobEffects.WITHER);
        data.setAmbrosiaBurn(data.ambrosiaBurn() + burnPerDose);

        if (!data.hasFlag("lesson_ambrosia")) {
            data.raiseFlag("lesson_ambrosia");
            sp.sendSystemMessage(Component.literal(
                    "§6It tastes like your mother's cooking, whatever that was. §7Do not have much more."));
        }

        if (data.ambrosiaBurn() > safeDose) {
            // Golden fire. Over the line, and the line was real.
            sp.igniteForSeconds(10);
            sp.hurt(level.damageSources().onFire(), 12.0f);
            sp.addEffect(new MobEffectInstance(MobEffects.NAUSEA, 200, 1));
            sp.sendSystemMessage(Component.literal(
                    "§6§lYou are burning from the inside out. §cYou had too much."));
            ((ServerLevel) sp.level()).playSound(null, sp.blockPosition(), SoundEvents.BLAZE_SHOOT,
                    SoundSource.PLAYERS, 1.4f, 0.6f);
        } else {
            ((ServerLevel) sp.level()).playSound(null, sp.blockPosition(), SoundEvents.PLAYER_LEVELUP,
                    SoundSource.PLAYERS, 0.6f, 1.8f);
        }

        stack.shrink(1);
        return InteractionResult.CONSUME;
    }
}
