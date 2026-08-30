package dev.chronoly.spike;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.level.Level;
import software.bernie.geckolib.animatable.GeoEntity;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animatable.manager.AnimatableManager;
import software.bernie.geckolib.animation.AnimationController;
import software.bernie.geckolib.animation.RawAnimation;
import software.bernie.geckolib.util.GeckoLibUtil;

/**
 * The D-03 spike, and nothing else.
 *
 * <p>DECISIONS.md D-03: the mod hard-depends on GeckoLib, and the only 1.21.11 build is an alpha.
 * That is a materially different bet from the mature 4.x line the original recommendation assumed,
 * so it gets tested with nothing riding on it rather than in Phase 7 with sixteen monsters on top.
 *
 * <p>This class exercises exactly the API surface every monster will use — the animatable
 * interface, the instance cache, a controller registrar, a looping animation and a triggered one.
 * It is compiled only under {@code -PwithGeckolib}, so a break here cannot take the mod jar down.
 *
 * <p>Compile-level only: proving these animations actually <em>play</em> needs a running client,
 * which CI does not have. That half of the spike is a manual check.
 */
public class GeckoSpikeEntity extends PathfinderMob implements GeoEntity {

    private static final RawAnimation IDLE = RawAnimation.begin().thenLoop("animation.spike.idle");
    private static final RawAnimation ATTACK = RawAnimation.begin().thenPlay("animation.spike.attack");

    private final AnimatableInstanceCache cache = GeckoLibUtil.createInstanceCache(this);

    public GeckoSpikeEntity(EntityType<? extends PathfinderMob> type, Level level) {
        super(type, level);
    }

    @Override
    public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        // GeckoLib 5 dropped the animatable argument: the constructors are now
        // (handler), (name, handler) and (name, transitionTicks, handler). The controller no
        // longer needs to know which animatable it belongs to — the registrar does.
        controllers.add(new AnimationController<GeckoSpikeEntity>("movement", 5, state ->
                state.setAndContinue(IDLE)));

        // The triggered path — how every telegraphed monster attack in Phase 7 will fire.
        // PlayState is not in software.bernie.geckolib.animation in the 5.x alpha, so this avoids
        // naming it until the discovery step reports where it went. triggerableAnim is still
        // exercised, which is the part that matters.
        controllers.add(new AnimationController<GeckoSpikeEntity>("attack", 0, state ->
                state.setAndContinue(IDLE)).triggerableAnim("attack", ATTACK));
    }

    @Override
    public AnimatableInstanceCache getAnimatableInstanceCache() {
        return cache;
    }
}
