package dev.chronoly.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;

import java.util.Map;

/**
 * What each thing says about itself when you hold it.
 *
 * <p>The brief asks for tooltips in the books' register — wry, first-person-adjacent, and never
 * grimdark-generic. These are also load-bearing: several of them are the only place the game
 * explains a rule, so each one earns its line by teaching something as well as sounding right.
 *
 * <p>Kept as data rather than overridden per item class, so a wrong guess about 1.21.11's
 * tooltip signature costs one call site instead of fourteen.
 */
public final class Lore {

    private Lore() {}

    private static final Map<String, String> LINES = Map.ofEntries(
            Map.entry("celestial_bronze_ingot",
                    "Goes through mortals like they were fog. Bites everything else."),
            Map.entry("imperial_gold_ingot",
                    "Consecrated, and less stable for it. Roman work."),
            Map.entry("stygian_iron_ingot",
                    "Keeps a little of whatever it kills."),
            Map.entry("celestial_bronze_sword",
                    "The first thing they give you, and the only thing that works."),
            Map.entry("celestial_bronze_dagger",
                    "Short, fast, and better than nothing — which is what you had."),
            Map.entry("imperial_gold_sword",
                    "Heavier than bronze and angrier about it."),
            Map.entry("stygian_iron_sword",
                    "It gets better the more you use it. That is not a compliment."),
            Map.entry("riptide",
                    "A pen. Until it is not. It always comes back to your pocket."),
            Map.entry("backbiter",
                    "Half mortal steel, half celestial bronze. It cuts both ways, and it means to."),
            Map.entry("hunting_knives",
                    "Silver-quick. Somebody carried these a very long time."),
            Map.entry("electric_spear",
                    "It hums. People who have been hit by it do not talk about it much."),
            Map.entry("master_bolt",
                    "Everyone is looking for this. Everyone."),
            Map.entry("helm_of_darkness",
                    "Put it on and the world forgets there was anyone here."),
            Map.entry("golden_fleece",
                    "It fixes one problem and creates several."),
            Map.entry("aegis",
                    "Her face is still on it. Nothing that looks at it keeps moving."),
            Map.entry("yankees_cap",
                    "Simple. Works. Nobody knows why it has to be this one."),
            Map.entry("travelers_token",
                    "Two coins and a promise. Spend it where you are looking."),
            Map.entry("golden_drachma",
                    "The ferryman does not take anything else. Bring more than one."),
            Map.entry("ambrosia",
                    "Food of the gods. Do not have seconds. This is not a suggestion."),
            Map.entry("nectar",
                    "The same warning, in a bottle."),
            Map.entry("greek_fire",
                    "Water spreads it. That is the entire problem with Greek fire."),
            Map.entry("mist_glass",
                    "Worked Mist, held still. It is warm, and it should not be."),
            Map.entry("nemean_pelt",
                    "The hide that turned everything, until somebody found the mouth."),
            Map.entry("bronze_helmet", "Camp issue. Dented before you got it."),
            Map.entry("bronze_chestplate", "Camp issue. The dents are somebody else's."),
            Map.entry("bronze_leggings", "Camp issue. Nobody's fit properly."),
            Map.entry("bronze_boots", "Camp issue. Broken in by strangers.")
    );

    /** The line for an item path, or null when it has nothing to say. */
    public static Component lineFor(String path) {
        String text = LINES.get(path);
        return text == null ? null
                : Component.literal(text).withStyle(ChatFormatting.GRAY, ChatFormatting.ITALIC);
    }

    public static int count() {
        return LINES.size();
    }
}
