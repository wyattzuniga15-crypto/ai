package dev.chronoly;

import net.minecraft.resources.Identifier;

/**
 * Mod id and the one place a namespaced id is constructed.
 *
 * <p>ARCHITECTURE §17.1: 1.21.11 renamed {@code ResourceLocation} to {@code Identifier}. Every
 * such construction in the mod goes through {@link #id(String)}, so the next time Mojang moves
 * this class the port is one file.
 */
public final class ChronolyConstants {

    public static final String MOD_ID = "chronoly";

    private ChronolyConstants() {}

    public static Identifier id(String path) {
        return Identifier.fromNamespaceAndPath(MOD_ID, path);
    }
}
