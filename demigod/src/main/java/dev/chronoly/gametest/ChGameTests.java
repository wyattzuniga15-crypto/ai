package dev.chronoly.gametest;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.core.favor.Tier;
import dev.chronoly.registry.ChAttachments;
import dev.chronoly.registry.ChItems;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.ItemStack;

/**
 * The first tests that run inside a real server.
 *
 * <p>Everything verified until now was verified by a compiler or by a JUnit suite with no game
 * behind it. These are different in kind: a server boots, a world loads, entities exist, and the
 * assertions are about what actually happens. That closes the gap the guide has been honest about
 * — that nothing in this mod had ever been observed to run.
 *
 * <p>Deliberately small. The value is in the first one passing at all, because that proves the
 * registries load, the attachment attaches, and the tags resolve against a live registry.
 */
public final class ChGameTests {

    private ChGameTests() {}

    /** The mod's items exist in the live registry, not just in source. */
    @GameTest(template = "chronoly:empty")
    public static void itemsAreRegistered(GameTestHelper helper) {
        ItemStack bronze = new ItemStack(ChItems.CELESTIAL_BRONZE_INGOT.get());
        helper.assertTrue(!bronze.isEmpty(), "celestial bronze ingot did not resolve");

        ItemStack riptide = new ItemStack(ChItems.RIPTIDE.get());
        helper.assertTrue(!riptide.isEmpty(), "Riptide did not resolve");

        helper.assertTrue(ChItems.TAB_ORDER.size() >= 20,
                "expected the creative tab to carry the full roster");
        helper.succeed();
    }

    /** The divine weapon tag resolves against the live registry, which the Mist rule depends on. */
    @GameTest(template = "chronoly:empty")
    public static void divineWeaponTagResolves(GameTestHelper helper) {
        ItemStack sword = new ItemStack(ChItems.CELESTIAL_BRONZE_SWORD.get());
        helper.assertTrue(sword.is(dev.chronoly.ChTags.DIVINE_WEAPON),
                "celestial bronze sword is not in chronoly:divine_weapon — the Mist rule is inert");

        ItemStack ingot = new ItemStack(ChItems.CELESTIAL_BRONZE_INGOT.get());
        helper.assertFalse(ingot.is(dev.chronoly.ChTags.DIVINE_WEAPON),
                "an ingot should not count as a weapon");
        helper.succeed();
    }

    /** A live entity classifies correctly, which is the other half of the rule. */
    @GameTest(template = "chronoly:empty")
    public static void monstersAreTagged(GameTestHelper helper) {
        var zombie = helper.spawn(EntityType.ZOMBIE, 1, 2, 1);
        helper.assertTrue(zombie.getType().is(dev.chronoly.ChTags.MONSTER),
                "a zombie is not tagged as a monster — bronze would do nothing to it");

        var cow = helper.spawn(EntityType.COW, 3, 2, 1);
        helper.assertTrue(cow.getType().is(dev.chronoly.ChTags.MORTAL),
                "a cow is not tagged mortal — bronze would kill it");
        helper.succeed();
    }

    /**
     * The attachment attaches to a real entity, holds what it is given, and derives a tier.
     *
     * <p>This is the one that matters most. The whole progression system is one attachment, and
     * until now nothing had confirmed it survives contact with a running server.
     */
    @GameTest(template = "chronoly:empty")
    public static void demigodDataAttaches(GameTestHelper helper) {
        var cow = helper.spawn(EntityType.COW, 1, 2, 1);
        DemigodData data = cow.getData(ChAttachments.DEMIGOD.get());

        helper.assertFalse(data.isClaimed(), "a fresh attachment should be unclaimed");

        data.claim("poseidon");
        data.setFavor("poseidon", 640f);
        helper.assertTrue(data.isClaimed(), "claim did not take");
        helper.assertTrue(data.tier() == Tier.T3,
                "640 favour should be tier 3, got " + data.tier());
        helper.assertTrue(data.maxEnergy() > 100f,
                "max energy should grow with favour");

        data.spend(data.maxEnergy() + 50f);
        helper.assertTrue(data.overdraw() > 0f,
                "spending past empty should leave debt rather than refusing");
        helper.succeed();
    }
}
