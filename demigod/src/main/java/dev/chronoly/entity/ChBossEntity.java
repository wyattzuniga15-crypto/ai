package dev.chronoly.entity;

import dev.chronoly.boss.BossKind;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

/**
 * The named monsters' own body.
 *
 * <p>Until now every boss wore a vanilla mob — Medusa was a witch, the Minotaur a ravager — which
 * the manual listed first under "what doesn't work yet." The mechanics never lived here and still
 * don't: {@link dev.chronoly.boss.Bosses} runs the fights off events, keyed by UUID, exactly as it
 * did for the borrowed bodies. This class only gives those fights something of their own to stand
 * in, so the art can stop apologising.
 */
public class ChBossEntity extends Monster {

    private final BossKind kind;

    public ChBossEntity(EntityType<? extends Monster> type, Level level, BossKind kind) {
        super(type, level);
        this.kind = kind;
        setPersistenceRequired();
    }

    public BossKind kind() {
        return kind;
    }

    /** A floor to stand on; Bosses#spawn immediately overwrites with the per-kind numbers. */
    public static AttributeSupplier.Builder baseAttributes() {
        return Monster.createMonsterAttributes()
                .add(Attributes.MAX_HEALTH, 100.0)
                .add(Attributes.ATTACK_DAMAGE, 8.0)
                .add(Attributes.MOVEMENT_SPEED, 0.3)
                .add(Attributes.FOLLOW_RANGE, 48.0)
                .add(Attributes.KNOCKBACK_RESISTANCE, 0.8);
    }

    /**
     * Voices, chosen from constants this project has already compiled against — a growl for the
     * dog, a roar for the bulls and cats, the conduit's hum for the thing in the water.
     */
    @Override
    protected net.minecraft.sounds.SoundEvent getAmbientSound() {
        return switch (kind) {
            case CERBERUS -> net.minecraft.sounds.SoundEvents.ENDER_DRAGON_GROWL;
            case CHARYBDIS -> net.minecraft.sounds.SoundEvents.CONDUIT_AMBIENT;
            case CHIMERA -> net.minecraft.sounds.SoundEvents.BLAZE_AMBIENT;
            case FURY, MEDUSA -> null;   // the quiet ones are worse
            default -> net.minecraft.sounds.SoundEvents.RAVAGER_ROAR;
        };
    }

    @Override
    protected void registerGoals() {
        goalSelector.addGoal(0, new FloatGoal(this));
        goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.1, false));
        goalSelector.addGoal(6, new WaterAvoidingRandomStrollGoal(this, 0.8));
        goalSelector.addGoal(7, new LookAtPlayerGoal(this, Player.class, 16.0f));
        goalSelector.addGoal(8, new RandomLookAroundGoal(this));
        targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, true));
    }
}
