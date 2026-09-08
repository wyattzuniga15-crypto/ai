package dev.potatoclient.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonSyntaxException;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** Loads and saves {@link RootConfig} as pretty-printed JSON in the Fabric config dir. */
public final class ConfigManager {
	private static final Logger LOGGER = LoggerFactory.getLogger("potatoclient/config");
	private static final Gson GSON = new GsonBuilder()
			.setPrettyPrinting()
			.serializeNulls()
			.disableHtmlEscaping()
			.create();

	private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("potatoclient.json");

	private static RootConfig config = new RootConfig();
	private static boolean dirty;

	private ConfigManager() {
	}

	public static RootConfig get() {
		return config;
	}

	/** Marks the config for a save on the next tick, so dragging a HUD element is not one write per frame. */
	public static void markDirty() {
		dirty = true;
	}

	public static void saveIfDirty() {
		if (dirty) {
			dirty = false;
			save();
		}
	}

	public static void load() {
		if (!Files.exists(FILE)) {
			config = new RootConfig();
			save();
			return;
		}

		try (Reader reader = Files.newBufferedReader(FILE, StandardCharsets.UTF_8)) {
			RootConfig loaded = GSON.fromJson(reader, RootConfig.class);
			// GSON leaves fields absent from the file at their default, but a file
			// containing only "null" or "{}" deserialises to null / empty branches.
			config = loaded == null ? new RootConfig() : loaded;
			fillMissingBranches(config);
		} catch (IOException | JsonSyntaxException e) {
			LOGGER.error("Could not read {}, falling back to defaults. The broken file is kept as .bak", FILE, e);
			backupBrokenFile();
			config = new RootConfig();
		}
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			Path tmp = FILE.resolveSibling(FILE.getFileName() + ".tmp");
			try (Writer writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
				GSON.toJson(config, writer);
			}
			// Write-then-move so a crash mid-write cannot truncate a good config.
			Files.move(tmp, FILE, StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException e) {
			LOGGER.error("Could not write {}", FILE, e);
		}
	}

	public static void resetToDefaults() {
		config = new RootConfig();
		save();
	}

	private static void backupBrokenFile() {
		try {
			Files.move(FILE, FILE.resolveSibling(FILE.getFileName() + ".bak"), StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException ignored) {
			// Losing the backup is not worth failing startup over.
		}
	}

	/** A hand-edited file can omit whole objects; restore them so nothing NPEs later. */
	private static void fillMissingBranches(RootConfig cfg) {
		if (cfg.hud == null) {
			cfg.hud = new HudConfig();
		}
		if (cfg.render == null) {
			cfg.render = new RenderConfig();
		}
		if (cfg.potato == null) {
			cfg.potato = new PotatoConfig();
		}

		HudConfig hud = cfg.hud;
		if (hud.fps == null) {
			hud.fps = new HudConfig.Fps();
		}
		if (hud.coordinates == null) {
			hud.coordinates = new HudConfig.Coordinates();
		}
		if (hud.ping == null) {
			hud.ping = new HudConfig.Ping();
		}
		if (hud.cps == null) {
			hud.cps = new HudConfig.Cps();
		}
		if (hud.keystrokes == null) {
			hud.keystrokes = new HudConfig.Keystrokes();
		}
		if (hud.armor == null) {
			hud.armor = new HudConfig.Armor();
		}
		if (hud.potions == null) {
			hud.potions = new HudConfig.Potions();
		}
		if (hud.reach == null) {
			hud.reach = new HudConfig.Reach();
		}
		if (hud.memory == null) {
			hud.memory = new HudConfig.Memory();
		}

		if (hud.fps.element == null) {
			hud.fps.element = new HudElementConfig(true, 0.006F, 0.006F);
		}
		if (hud.coordinates.element == null) {
			hud.coordinates.element = new HudElementConfig(true, 0.006F, 0.055F);
		}
		if (hud.ping.element == null) {
			hud.ping.element = new HudElementConfig(true, 0.006F, 0.155F);
		}
		if (hud.cps.element == null) {
			hud.cps.element = new HudElementConfig(false, 0.006F, 0.195F);
		}
		if (hud.keystrokes.element == null) {
			hud.keystrokes.element = new HudElementConfig(false, 0.006F, 0.62F);
		}
		if (hud.armor.element == null) {
			hud.armor.element = new HudElementConfig(false, 0.42F, 0.86F);
		}
		if (hud.potions.element == null) {
			hud.potions.element = new HudElementConfig(false, 0.88F, 0.06F);
		}
		if (hud.reach.element == null) {
			hud.reach.element = new HudElementConfig(false, 0.006F, 0.235F);
		}
		if (hud.memory.element == null) {
			hud.memory.element = new HudElementConfig(false, 0.006F, 0.275F);
		}

		RenderConfig render = cfg.render;
		if (render.hitboxes == null) {
			render.hitboxes = new RenderConfig.Hitboxes();
		}
		if (render.chunkBorders == null) {
			render.chunkBorders = new RenderConfig.ChunkBorders();
		}
		if (render.blockOutline == null) {
			render.blockOutline = new RenderConfig.BlockOutline();
		}
		if (render.esp == null) {
			render.esp = new RenderConfig.Esp();
		}
		if (render.fullbright == null) {
			render.fullbright = new RenderConfig.Fullbright();
		}
	}
}
