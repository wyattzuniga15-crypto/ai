package dev.potatoclient.compat.modmenu;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;
import dev.potatoclient.screen.ConfigScreen;

/**
 * Puts a Config button next to the mod in Mod Menu.
 *
 * <p>Optional: the whole package is excluded from the source set when
 * {@code enable_modmenu=false} in gradle.properties, and Fabric ignores an
 * entrypoint whose class is absent, so the jar works with or without Mod Menu.
 */
public class ModMenuIntegration implements ModMenuApi {
	@Override
	public ConfigScreenFactory<?> getModConfigScreenFactory() {
		return ConfigScreen::new;
	}
}
