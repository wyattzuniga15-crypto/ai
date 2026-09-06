/** Entry point: loads assets, shows the title screen, starts games. */
import { Menus } from './ui/menus.ts';
import { SaveManager, loadOptions, saveOptions, type Options, type WorldMeta } from './core/save.ts';
import { loadAtlas, type LoadedAtlas } from './render/atlas.ts';
import type { ModelsJson } from './world/models.ts';
import { Game } from './core/game.ts';
import { parseSeed } from './core/rng.ts';
import { blocks } from './blocks/registry.ts';
import { items } from './items/registry.ts';

const BASE = import.meta.env.BASE_URL;

async function main() {
  const app = document.getElementById('app')!;
  const save = new SaveManager();
  const options: Options = loadOptions();
  document.documentElement.style.setProperty('--gui', String(options.guiScale));
  let game: Game | null = null;
  let assets: { blocks: LoadedAtlas; items: LoadedAtlas; models: ModelsJson } | null = null;

  const menus = new Menus(app, {
    listWorlds: () => save.listWorlds(),
    onPlay: (meta) => void startGame(meta),
    onCreate: async (name, seedText, gamemode) => {
      const meta = await save.createWorld(name, parseSeed(seedText), seedText, gamemode);
      await startGame(meta);
    },
    onDelete: (meta) => save.deleteWorld(meta.id),
    onExport: async (meta) => {
      const blob = await save.exportWorld(meta.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${meta.name.replace(/[^a-z0-9_-]+/gi, '_') || 'world'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    onImport: async (file) => {
      try {
        await save.importWorld(await file.arrayBuffer());
      } catch (e) {
        alert(`Import failed: ${(e as Error).message}`);
      }
    },
    onResume: () => game?.resume(),
    onQuitToTitle: () => void quitToTitle(),
    onOptionsChanged: (o) => {
      saveOptions(o);
      document.documentElement.style.setProperty('--gui', String(o.guiScale));
      game?.applyOptions(o);
    },
    onRespawn: () => game?.respawn(),
  }, options);

  async function loadAssets() {
    if (assets) return assets;
    menus.showLoading('Loading textures...', 0.1);
    const [b, i, models] = await Promise.all([
      loadAtlas(BASE, 'blocks'),
      loadAtlas(BASE, 'items'),
      fetch(`${BASE}models.json`).then((r) => {
        if (!r.ok) throw new Error('models.json missing – run `npm run assets`');
        return r.json() as Promise<ModelsJson>;
      }),
    ]);
    assets = { blocks: b, items: i, models };
    menus.hideLoading();
    return assets;
  }

  async function startGame(meta: WorldMeta) {
    const a = await loadAssets();
    menus.hide();
    menus.showLoading('Building terrain...', 0);
    game = new Game({ container: app, assets: a, save, meta, options, menus });
    (window as unknown as { voxelcraft: unknown }).voxelcraft = { game, blocks, items };
    await game.start((text, p) => menus.showLoading(text, p));
    menus.hideLoading();
  }

  async function quitToTitle() {
    if (game) {
      menus.showLoading('Saving world...', 0.5);
      await game.quit();
      game = null;
      menus.hideLoading();
    }
    menus.showTitle();
  }

  try {
    await loadAssets();
    menus.showTitle();
  } catch (e) {
    menus.showLoading(`Failed to load assets: ${(e as Error).message}`, 0);
    console.error(e);
  }
}

void main();
