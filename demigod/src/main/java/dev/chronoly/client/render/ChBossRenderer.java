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
public class ChBossRenderer extends MobRenderer<ChBossEntity, LivingEntityRenderState, ChBossRenderer.BossModel> {

    /** EntityModel's constructor is protected; this subclass exists to make it reachable. */
    public static class BossModel extends EntityModel<LivingEntityRenderState> {
        public BossModel(ModelPart root) {
            super(root);
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
    public Identifier getTextureLocation(LivingEntityRenderState state) {
        return texture;
    }

    @Override
    public LivingEntityRenderState createRenderState() {
        return new LivingEntityRenderState();
    }
}
