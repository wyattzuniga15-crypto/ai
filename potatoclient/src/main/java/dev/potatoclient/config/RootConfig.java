package dev.potatoclient.config;

/** Everything Potato Client persists, in one serialisable tree. */
public class RootConfig {
	/** Bumped when a migration is needed; {@link ConfigManager} reads it on load. */
	public int configVersion = 1;

	public HudConfig hud = new HudConfig();
	public RenderConfig render = new RenderConfig();
	public PotatoConfig potato = new PotatoConfig();
}
