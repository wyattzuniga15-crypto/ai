package dev.chronoly.client.render;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.boss.BossKind;
import dev.chronoly.entity.ChBossEntity;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;
import net.minecraft.resources.Identifier;

/**
 * One renderer for all nine, told apart by texture and baked layer.
 *
 * <p>No animation yet — these bodies stand, walk and loom, which is already a different game from
 * a re-skinned witch. Articulated limbs are the next art pass and belong to the model layer, not
 * here.
 */
public class ChBossRenderer extends MobRenderer<ChBossEntity, ChBossRenderer.BossRenderState, ChBossRenderer.BossModel> {

    /** The base state has no attack fields, so this one carries the swing across the wire. */
    public static class BossRenderState extends LivingEntityRenderState {
        public float attackAnim;
    }

    /**
     * The first motion these bodies have had. Everything is driven off three numbers the render
     * state already carries — walk position, walk speed, age — and every rotation is assigned
     * rather than accumulated, so a frame owes nothing to the one before it.
     */
    public static class BossModel extends EntityModel<BossRenderState> {

        private static final String[] LEG_PAIRS = {"leg0", "leg3", "left_leg", "right_arm"};
        private static final String[] LEG_PAIRS_B = {"leg1", "leg2", "right_leg", "left_arm"};

        public BossModel(ModelPart root) {
            super(root);
        }

        @Override
        public void setupAnim(BossRenderState state) {
            super.setupAnim(state);
            ModelPart root = root();
            // The lunge: while the entity swings, everything leans into the blow and the arms
            // come down. sin(anim * PI) rises and falls over the swing, so it self-clears.
            float lunge = net.minecraft.util.Mth.sin(state.attackAnim * (float) Math.PI);
            float swing = net.minecraft.util.Mth.cos(state.walkAnimationPos * 0.6662f)
                    * 1.1f * state.walkAnimationSpeed;
            float age = state.ageInTicks;

            // Diagonal gait: leg0+leg3 against leg1+leg2, and arms against their legs.
            for (String name : LEG_PAIRS) {
                if (root.hasChild(name)) root.getChild(name).xRot = swing;
            }
            for (String name : LEG_PAIRS_B) {
                if (root.hasChild(name)) root.getChild(name).xRot = -swing;
            }
            for (String name : new String[]{"left_arm", "right_arm"}) {
                if (root.hasChild(name)) root.getChild(name).xRot -= lunge * 1.6f;
            }
            if (root.hasChild("body")) root.getChild("body").xRot = lunge * 0.25f;

            // Heads breathe; the crowd of them on Cerberus disagrees slightly. In a swing they
            // all pitch down into the bite instead.
            int h = 0;
            for (String name : new String[]{"head", "head_mid", "head_left", "head_right", "goat_head"}) {
                if (!root.hasChild(name)) continue;
                ModelPart part = root.getChild(name);
                part.xRot = net.minecraft.util.Mth.sin(age * 0.06f + h) * 0.06f + lunge * 0.5f;
                part.yRot = net.minecraft.util.Mth.sin(age * 0.045f + h * 2f) * 0.10f;
                h++;
            }

            // Hydra necks weave out of phase, which is most of why three heads feel like three.
            for (int n = 0; n < 3; n++) {
                if (!root.hasChild("neck" + n)) continue;
                ModelPart neck = root.getChild("neck" + n);
                neck.xRot = net.minecraft.util.Mth.sin(age * 0.09f + n * 2.1f) * 0.14f;
                neck.zRot = net.minecraft.util.Mth.cos(age * 0.07f + n * 1.7f) * 0.08f;
            }

            if (root.hasChild("snakes")) {
                ModelPart snakes = root.getChild("snakes");
                snakes.yRot = net.minecraft.util.Mth.sin(age * 0.15f) * 0.25f;
                snakes.zRot = net.minecraft.util.Mth.cos(age * 0.11f) * 0.10f;
            }
            for (String name : new String[]{"tail", "snake_tail"}) {
                if (!root.hasChild(name)) continue;
                root.getChild(name).yRot = swing * 0.25f
                        + net.minecraft.util.Mth.sin(age * 0.07f) * 0.12f;
            }
            if (root.hasChild("left_wing")) {
                float flap = 0.35f + net.minecraft.util.Mth.cos(age * 0.35f) * 0.45f;
                root.getChild("left_wing").yRot = flap;
                root.getChild("right_wing").yRot = -flap;
            }
            // The maw grinds. Slowly. It does not need to hurry.
            if (root.hasChild("teeth")) root.getChild("teeth").yRot = age * 0.06f;
            if (root.hasChild("fins")) root.getChild("fins").yRot = -age * 0.03f;

            // The serpent's spine follows the walk laterally.
            for (int seg = 1; seg <= 3; seg++) {
                if (!root.hasChild("seg" + seg)) continue;
                root.getChild("seg" + seg).yRot =
                        net.minecraft.util.Mth.sin(state.walkAnimationPos * 0.4f - seg * 0.6f)
                                * 0.10f * Math.min(1f, state.walkAnimationSpeed * 3f);
            }
        }
    }

    private final Identifier texture;

    public ChBossRenderer(EntityRendererProvider.Context ctx, BossKind kind) {
        super(ctx, new BossModel(ctx.bakeLayer(BossModels.layer(kind))), shadowFor(kind));
        this.texture = ChronolyConstants.id("textures/entity/" + kind.id() + ".png");
    }

    private static float shadowFor(BossKind kind) {
        return switch (kind) {
            case FURY, MEDUSA -> 0.5f;
            case LYDIAN_DRAKON, CHARYBDIS -> 1.4f;
            default -> 1.0f;
        };
    }

    @Override
    public Identifier getTextureLocation(BossRenderState state) {
        return texture;
    }

    @Override
    public BossRenderState createRenderState() {
        return new BossRenderState();
    }

    @Override
    public void extractRenderState(ChBossEntity entity, BossRenderState state, float partialTick) {
        super.extractRenderState(entity, state, partialTick);
        state.attackAnim = entity.getAttackAnim(partialTick);
    }
}
