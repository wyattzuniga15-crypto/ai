package dev.chronoly.core.mist;

/**
 * Everything {@link MistRule} needs to know about an incoming blow, with no Minecraft types in
 * sight so the rule can be tested exhaustively.
 *
 * @param weaponTaggedDivine  the held stack is in {@code chronoly:divine_weapon}
 * @param damageTypeDivine    the damage type is in {@code chronoly:is_divine} — in 1.21.11 this
 *                            usually comes straight off the weapon's vanilla {@code DAMAGE_TYPE}
 *                            data component
 * @param damageTypeBypasses  the damage type is in {@code chronoly:bypasses_mist}
 */
public record Attack(boolean weaponTaggedDivine, boolean damageTypeDivine, boolean damageTypeBypasses) {

    /** A plain swing of something a hardware store would sell. */
    public static Attack mortalSteel() {
        return new Attack(false, false, false);
    }

    /** Celestial bronze, imperial gold, Stygian iron. */
    public static Attack divine() {
        return new Attack(true, false, false);
    }

    /** Fire, falling, drowning, Greek fire — the world hurting you rather than a weapon. */
    public static Attack bypassing() {
        return new Attack(false, false, true);
    }

    /**
     * Classifies the blow.
     *
     * <p>Note the order and the default. Bypassing wins outright; divine is recognised from either
     * the weapon tag or the damage type; and <em>everything else is mortal steel</em>. That default
     * is deliberate: enumerating "every mortal weapon" would go stale the moment another mod adds a
     * sword, and that sword would then hurt a hellhound. By excluding instead of enumerating, a
     * weapon nobody has written yet still fails against a monster, which is what the lore wants.
     */
    public DamageAxis axis() {
        if (damageTypeBypasses) return DamageAxis.BYPASSING;
        if (weaponTaggedDivine || damageTypeDivine) return DamageAxis.DIVINE;
        return DamageAxis.MORTAL_STEEL;
    }
}
