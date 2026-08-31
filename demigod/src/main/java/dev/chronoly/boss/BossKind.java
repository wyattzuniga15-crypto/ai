package dev.chronoly.boss;

import net.minecraft.world.BossEvent;
import net.minecraft.world.entity.EntityType;

/**
 * The named monsters, and what makes each fight different.
 *
 * <p>Each is built on a vanilla entity type rather than a new one: a boss here is a vanilla body
 * carrying custom stats, a boss bar and its own mechanic. That is a deliberate trade — it means
 * these fights exist and are playable now, where custom models would have meant none of them
 * existing at all. Real models are the next art pass, and swapping the base type is one line.
 */
public enum BossKind {

    /**
     * The Lightning Thief, ch. 1 — the thing on the hill, which does not know how to turn.
     * Charges in straight lines; break a horn at half health and it gets faster and angrier.
     */
    MINOTAUR("The Minotaur", EntityType.RAVAGER, 220f, 12f, 0.34f,
            BossEvent.BossBarColor.RED, "Son of Pasiphaë"),

    /**
     * The Sea of Monsters, ch. 12 — cut a head and two grow back. Fire is the only answer, and
     * the fight teaches that by punishing everything else.
     */
    HYDRA("The Hydra", EntityType.RAVAGER, 300f, 9f, 0.24f,
            BossEvent.BossBarColor.GREEN, "Many-headed"),

    /**
     * The Lightning Thief, ch. 18 — three heads, one job, and no interest in negotiating.
     */
    CERBERUS("Cerberus", EntityType.WOLF, 260f, 10f, 0.38f,
            BossEvent.BossBarColor.PURPLE, "Guard of the Gate"),

    /**
     * The Lightning Thief, ch. 4 — she was your maths teacher, and then she was not.
     */
    FURY("Alecto", EntityType.VEX, 140f, 8f, 0.62f,
            BossEvent.BossBarColor.PINK, "Kindly One"),

    /**
     * The Last Olympian — armoured everywhere, and the prophecy says whose blade ends it.
     */
    LYDIAN_DRAKON("The Lydian Drakon", EntityType.RAVAGER, 420f, 16f, 0.26f,
            BossEvent.BossBarColor.YELLOW, "Older than the gods"),

    /**
     * The Lightning Thief, ch. 11 — Aunty Em. Look at her and you start turning to stone; the
     * fight is won by not looking, which is the hardest instruction in any game.
     */
    MEDUSA("Medusa", EntityType.WITCH, 180f, 7f, 0.3f,
            BossEvent.BossBarColor.GREEN, "Aunty Em"),

    /**
     * The Titan's Curse, ch. 9 — the hide turns everything. Only the open mouth can be hurt, so
     * the fight is about patience and timing rather than damage.
     */
    NEMEAN_LION("The Nemean Lion", EntityType.RAVAGER, 340f, 13f, 0.32f,
            BossEvent.BossBarColor.YELLOW, "Impervious"),

    /**
     * The Lightning Thief, ch. 20 — fire, lion, goat, snake, and none of it negotiable.
     */
    CHIMERA("The Chimera", EntityType.RAVAGER, 300f, 14f, 0.30f,
            BossEvent.BossBarColor.RED, "Three deaths in one body");

    public final String title;
    public final EntityType<?> base;
    public final float health;
    public final float damage;
    public final float speed;
    public final BossEvent.BossBarColor colour;
    public final String epithet;

    BossKind(String title, EntityType<?> base, float health, float damage, float speed,
             BossEvent.BossBarColor colour, String epithet) {
        this.title = title;
        this.base = base;
        this.health = health;
        this.damage = damage;
        this.speed = speed;
        this.colour = colour;
        this.epithet = epithet;
    }

    public String id() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }
}
