package dev.chronoly.client.render;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.boss.BossKind;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;

import java.util.EnumMap;
import java.util.Map;

/**
 * Every named monster's actual shape, cube by cube.
 *
 * <p>Hand-authored geometry against a hand-painted 128×128 per boss. These are not the final art —
 * they are the first bodies these fights have ever had that were their own: the Minotaur is a
 * horned bulk instead of a ravager, Medusa a snake-haired figure instead of a witch, Charybdis a
 * ring of teeth instead of an elder guardian. Model space: 16 units to the block, y grows
 * downward, feet at 24.
 */
public final class BossModels {

    private BossModels() {}

    private static final Map<BossKind, ModelLayerLocation> LAYERS = new EnumMap<>(BossKind.class);

    public static ModelLayerLocation layer(BossKind kind) {
        return LAYERS.computeIfAbsent(kind,
                k -> new ModelLayerLocation(ChronolyConstants.id(k.id()), "main"));
    }

    /** Face pixels live at (0,0); mottled hide at (0,40); limbs at (64,40); extras at (64,0). */
    private static final int FACE_U = 0, FACE_V = 0;
    private static final int HIDE_U = 0, HIDE_V = 40;
    private static final int LIMB_U = 64, LIMB_V = 40;
    private static final int EXTRA_U = 64, EXTRA_V = 0;

    public static LayerDefinition of(BossKind kind) {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition root = mesh.getRoot();
        switch (kind) {
            case MINOTAUR -> minotaur(root);
            case HYDRA -> hydra(root);
            case CERBERUS -> cerberus(root);
            case FURY -> fury(root);
            case LYDIAN_DRAKON -> drakon(root);
            case MEDUSA -> medusa(root);
            case NEMEAN_LION -> lion(root, true);
            case CHIMERA -> chimera(root);
            case CHARYBDIS -> charybdis(root);
        }
        return LayerDefinition.create(mesh, 128, 128);
    }

    /** A horned bulk that walks like a man. The horns are the whole silhouette. */
    private static void minotaur(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-9f, -16f, -6f, 18f, 16f, 12f),
                PartPose.offset(0f, 8f, 0f));
        root.addOrReplaceChild("head", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-5f, -10f, -5f, 10f, 10f, 10f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-8f, -14f, -1f, 3f, 6f, 3f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(5f, -14f, -1f, 3f, 6f, 3f),
                PartPose.offset(0f, -8f, 0f));
        root.addOrReplaceChild("left_arm", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-2.5f, 0f, -2.5f, 5f, 16f, 5f),
                PartPose.offset(11.5f, -6f, 0f));
        root.addOrReplaceChild("right_arm", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-2.5f, 0f, -2.5f, 5f, 16f, 5f),
                PartPose.offset(-11.5f, -6f, 0f));
        root.addOrReplaceChild("left_leg", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-3f, 0f, -3f, 6f, 16f, 6f),
                PartPose.offset(5f, 8f, 0f));
        root.addOrReplaceChild("right_leg", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-3f, 0f, -3f, 6f, 16f, 6f),
                PartPose.offset(-5f, 8f, 0f));
    }

    /** Three necks out of one low body; the heads jut forward hungry. */
    private static void hydra(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-10f, -8f, -9f, 20f, 12f, 18f),
                PartPose.offset(0f, 10f, 0f));
        int i = 0;
        for (float x : new float[]{-7f, 0f, 7f}) {
            root.addOrReplaceChild("neck" + (i++), CubeListBuilder.create()
                            .texOffs(LIMB_U, LIMB_V).addBox(-2f, -16f, -2f, 4f, 16f, 4f)
                            .texOffs(FACE_U, FACE_V).addBox(-3.5f, -22f, -8f, 7f, 6f, 9f),
                    PartPose.offset(x, 2f, -6f));
        }
        legs(root, 7f, 14f, 6f, 10f);
    }

    /** One dog, three heads, all barking. */
    private static void cerberus(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-7f, -6f, -12f, 14f, 12f, 24f),
                PartPose.offset(0f, 6f, 0f));
        root.addOrReplaceChild("head_mid", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-4f, -8f, -10f, 8f, 8f, 10f),
                PartPose.offset(0f, -1f, -10f));
        root.addOrReplaceChild("head_left", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-3f, -6f, -8f, 6f, 6f, 8f),
                PartPose.offset(-7f, 1f, -10f));
        root.addOrReplaceChild("head_right", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-3f, -6f, -8f, 6f, 6f, 8f),
                PartPose.offset(7f, 1f, -10f));
        legs(root, 5f, 12f, 8f, 12f);
    }

    /** A slight winged figure. She is fast, and the model says so by being small. */
    private static void fury(PartDefinition root) {
        biped(root);
        root.addOrReplaceChild("left_wing", CubeListBuilder.create()
                        .texOffs(EXTRA_U, EXTRA_V).addBox(0f, -4f, 0f, 12f, 10f, 1f),
                PartPose.offset(2f, 2f, 3f));
        root.addOrReplaceChild("right_wing", CubeListBuilder.create()
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-12f, -4f, 0f, 12f, 10f, 1f),
                PartPose.offset(-2f, 2f, 3f));
    }

    /** A long armoured serpent, thickest at the shoulder, tapering to the tail. */
    private static void drakon(PartDefinition root) {
        root.addOrReplaceChild("head", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-6f, -5f, -14f, 12f, 10f, 14f),
                PartPose.offset(0f, 14f, -4f));
        root.addOrReplaceChild("seg1", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-7f, -6f, 0f, 14f, 12f, 18f),
                PartPose.offset(0f, 13f, -4f));
        root.addOrReplaceChild("seg2", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-6f, -5f, 0f, 12f, 10f, 16f),
                PartPose.offset(0f, 14f, 14f));
        root.addOrReplaceChild("seg3", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-4f, -4f, 0f, 8f, 8f, 14f),
                PartPose.offset(0f, 16f, 30f));
        root.addOrReplaceChild("tail", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-2f, -2f, 0f, 4f, 4f, 12f),
                PartPose.offset(0f, 18f, 44f));
        legs(root, 5f, 19f, 4f, 5f);
    }

    /** A woman-shaped thing with a head full of snakes. Do not look. */
    private static void medusa(PartDefinition root) {
        biped(root);
        root.addOrReplaceChild("snakes", CubeListBuilder.create()
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-4f, -15f, -1f, 2f, 7f, 2f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-1f, -16f, -3f, 2f, 8f, 2f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(2f, -15f, 0f, 2f, 7f, 2f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-3f, -14f, 2f, 2f, 6f, 2f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(1f, -14f, -5f, 2f, 6f, 2f),
                PartPose.offset(0f, 0f, 0f));
    }

    /** The lion: a lot of animal, and a mane you could hide in. */
    private static void lion(PartDefinition root, boolean mane) {
        root.addOrReplaceChild("body", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-8f, -7f, -13f, 16f, 14f, 26f),
                PartPose.offset(0f, 4f, 0f));
        if (mane) {
            root.addOrReplaceChild("mane", CubeListBuilder.create()
                            .texOffs(EXTRA_U, EXTRA_V).addBox(-8f, -8f, -4f, 16f, 16f, 8f),
                    PartPose.offset(0f, -2f, -11f));
        }
        root.addOrReplaceChild("head", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-5f, -6f, -9f, 10f, 10f, 9f),
                PartPose.offset(0f, -3f, -14f));
        root.addOrReplaceChild("tail", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-1f, -1f, 0f, 2f, 2f, 12f),
                PartPose.offset(0f, -2f, 13f));
        legs(root, 6f, 11f, 9f, 13f);
    }

    /** Fire, lion, goat, snake: the lion body, a second head, and a tail that ends in one too. */
    private static void chimera(PartDefinition root) {
        lion(root, false);
        root.addOrReplaceChild("goat_head", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-3f, -8f, -6f, 6f, 8f, 7f),
                PartPose.offset(-6f, -4f, -12f));
        root.addOrReplaceChild("snake_tail", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-1f, -1f, 0f, 2f, 2f, 14f)
                        .texOffs(FACE_U, FACE_V).addBox(-2f, -2f, 14f, 4f, 3f, 4f),
                PartPose.offset(0f, -4f, 13f));
    }

    /** Not an animal — a mouth the sea happens to stand in. A column ringed with teeth. */
    private static void charybdis(PartDefinition root) {
        root.addOrReplaceChild("column", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-5f, 0f, -5f, 10f, 20f, 10f),
                PartPose.offset(0f, 4f, 0f));
        CubeListBuilder teeth = CubeListBuilder.create();
        float[][] ring = {{-9f, -2f}, {6f, -2f}, {-2f, -9f}, {-2f, 6f},
                          {-8f, -8f}, {5f, -8f}, {-8f, 5f}, {5f, 5f}};
        for (float[] t : ring) {
            teeth.texOffs(EXTRA_U, EXTRA_V).addBox(t[0], -6f, t[1], 3f, 6f, 3f);
        }
        root.addOrReplaceChild("teeth", teeth, PartPose.offset(0f, 4f, 0f));
        root.addOrReplaceChild("fins", CubeListBuilder.create()
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-14f, -1f, -3f, 10f, 2f, 6f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(4f, -1f, -3f, 10f, 2f, 6f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-3f, -1f, -14f, 6f, 2f, 10f)
                        .texOffs(EXTRA_U, EXTRA_V).addBox(-3f, -1f, 4f, 6f, 2f, 10f),
                PartPose.offset(0f, 10f, 0f));
    }

    // ---- shared pieces ----------------------------------------------------------------------

    /** The human frame Medusa and Alecto share; each adds what makes her herself. */
    private static void biped(PartDefinition root) {
        root.addOrReplaceChild("head", CubeListBuilder.create()
                        .texOffs(FACE_U, FACE_V).addBox(-4f, -8f, -4f, 8f, 8f, 8f),
                PartPose.offset(0f, 0f, 0f));
        root.addOrReplaceChild("body", CubeListBuilder.create()
                        .texOffs(HIDE_U, HIDE_V).addBox(-4f, 0f, -2f, 8f, 12f, 4f),
                PartPose.offset(0f, 0f, 0f));
        root.addOrReplaceChild("left_arm", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-1.5f, -2f, -1.5f, 3f, 12f, 3f),
                PartPose.offset(5.5f, 2f, 0f));
        root.addOrReplaceChild("right_arm", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-1.5f, -2f, -1.5f, 3f, 12f, 3f),
                PartPose.offset(-5.5f, 2f, 0f));
        root.addOrReplaceChild("left_leg", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-2f, 0f, -2f, 4f, 12f, 4f),
                PartPose.offset(1.9f, 12f, 0f));
        root.addOrReplaceChild("right_leg", CubeListBuilder.create()
                        .texOffs(LIMB_U, LIMB_V).addBox(-2f, 0f, -2f, 4f, 12f, 4f),
                PartPose.offset(-1.9f, 12f, 0f));
    }

    /** Four legs in the usual places. */
    private static void legs(PartDefinition root, float spreadX, float top, float spreadZ, float len) {
        int i = 0;
        for (float sx : new float[]{-spreadX, spreadX}) {
            for (float sz : new float[]{-spreadZ, spreadZ}) {
                root.addOrReplaceChild("leg" + (i++), CubeListBuilder.create()
                                .texOffs(LIMB_U, LIMB_V).addBox(-2.5f, 0f, -2.5f, 5f, len, 5f),
                        PartPose.offset(sx, top, sz));
            }
        }
    }
}
