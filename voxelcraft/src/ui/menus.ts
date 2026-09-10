/** Title screen, world list, world creation, pause menu, options and death screen. */
import { button, h, slider, textField } from './dom.ts';
import type { WorldMeta, Options } from '../core/save.ts';
import { ACTION_INFO, DEFAULT_BINDINGS, UNBOUND, keyName, mergeBindings, mouseButtonOf, type Action } from '../core/input.ts';
import { parseSeed } from '../core/rng.ts';

export interface MenuCallbacks {
  onPlay(meta: WorldMeta): void;
  onCreate(name: string, seedText: string, gamemode: 'survival' | 'creative'): Promise<void>;
  onDelete(meta: WorldMeta): Promise<void>;
  onExport(meta: WorldMeta): Promise<void>;
  onImport(file: File): Promise<void>;
  listWorlds(): Promise<WorldMeta[]>;
  onResume(): void;
  onQuitToTitle(): void;
  onOptionsChanged(o: Options): void;
  onRespawn(): void;
}

export class Menus {
  readonly root: HTMLElement;
  private current: HTMLElement | null = null;
  private loading: HTMLElement | null = null;
  inGame = false;

  constructor(container: HTMLElement, private readonly cb: MenuCallbacks, private options: Options) {
    this.root = h('div', { id: 'overlay' });
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  private show(screen: HTMLElement): void {
    this.hide();
    this.current = screen;
    this.root.append(screen);
  }

  hide(): void {
    this.current?.remove();
    this.current = null;
  }

  showLoading(text: string, progress = 0): void {
    // the screen behind is done with: leaving the title's panorama running costs the world
    // generator half a second of frames it could be using
    if (!this.loading) this.hide();
    if (!this.loading) {
      this.loading = h('div', { id: 'loading' }, h('div', { class: 'msg', text }), h('div', { class: 'bar' }, h('div')));
      this.root.append(this.loading);
    }
    (this.loading.querySelector('.msg') as HTMLElement).textContent = text;
    (this.loading.querySelector('.bar > div') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  hideLoading(): void {
    this.loading?.remove();
    this.loading = null;
  }

  showTitle(): void {
    this.inGame = false;
    const desktop = /Electron/i.test(navigator.userAgent);
    const screen = h('div', { class: 'screen title' },
      panorama(),
      h('div', { class: 'title-logo' },
        h('div', { class: 'wordmark', text: 'VOXELCRAFT' }),
        h('div', { class: 'edition', text: 'Java Edition rules' }),
        h('div', { class: 'splash', text: splashText() }),
      ),
      h('div', { class: 'panel' },
        button('Singleplayer', () => void this.showWorlds()),
        button('Multiplayer', () => {}, 'disabled'),
        h('div', { class: 'row' },
          button('Options...', () => this.showOptions(() => this.showTitle()), 'half'),
          button(desktop ? 'Quit Game' : 'Minecraft Realms', () => { if (desktop) window.close(); }, desktop ? 'half' : 'half disabled'),
        ),
      ),
      h('div', { class: 'corner left', text: 'Voxelcraft 0.1 (Minecraft Java 1.21.11 rules)' }),
      h('div', { class: 'corner right', text: 'A private, non-commercial project. Not affiliated with Mojang.' }),
    );
    (screen.querySelector('.btn.disabled') as HTMLButtonElement | null)?.setAttribute('disabled', '');
    for (const b of screen.querySelectorAll('.btn.disabled')) (b as HTMLButtonElement).disabled = true;
    this.show(screen);
    bounceSplash(screen.querySelector('.splash') as HTMLElement);
  }

  async showWorlds(): Promise<void> {
    const worlds = await this.cb.listWorlds();
    let selected: WorldMeta | null = worlds[0] ?? null;
    const list = h('div', { class: 'list' });
    const playBtn = button('Play Selected World', () => selected && this.cb.onPlay(selected), 'small');
    const deleteBtn = button('Delete', async () => {
      if (selected && confirm(`Delete "${selected.name}"? This cannot be undone.`)) {
        await this.cb.onDelete(selected);
        void this.showWorlds();
      }
    }, 'tiny');
    const exportBtn = button('Export', () => selected && void this.cb.onExport(selected), 'tiny');
    const render = () => {
      list.replaceChildren();
      if (!worlds.length) list.append(h('div', { class: 'empty', text: 'No worlds yet. Create one!' }));
      for (const w of worlds) {
        const item = h('div', { class: `item ${w === selected ? 'sel' : ''}` },
          h('div', { class: 'name', text: w.name }),
          h('div', { class: 'meta', text: `${new Date(w.lastPlayed).toLocaleString()} · ${w.gamemode} · seed ${w.seedText || w.seed}` }),
        );
        item.addEventListener('click', () => {
          selected = w;
          render();
        });
        item.addEventListener('dblclick', () => this.cb.onPlay(w));
        list.append(item);
      }
      playBtn.disabled = !selected;
      deleteBtn.disabled = !selected;
      exportBtn.disabled = !selected;
    };
    render();
    const fileInput = h('input', { type: 'file', accept: '.zip', style: 'display:none' }) as HTMLInputElement;
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (f) {
        await this.cb.onImport(f);
        void this.showWorlds();
      }
    });
    this.show(h('div', { class: 'screen sheet' },
      backdrop(this.inGame),
      h('h2', { text: 'Select World' }),
      list,
      h('div', { class: 'buttons' },
        h('div', { class: 'row' }, playBtn, button('Create New World', () => this.showCreate(), 'half')),
        h('div', { class: 'row' }, deleteBtn, exportBtn, button('Import', () => fileInput.click(), 'quarter'), button('Cancel', () => this.showTitle(), 'quarter')),
      ),
      fileInput,
    ));
  }

  showCreate(): void {
    const name = textField('World Name', 'New World');
    const seed = textField('Seed for the world generator', '', 'Leave blank for a random seed');
    let mode: 'survival' | 'creative' = 'survival';
    const modeBtn = button('Game Mode: Survival', () => {
      mode = mode === 'survival' ? 'creative' : 'survival';
      modeBtn.textContent = `Game Mode: ${mode === 'survival' ? 'Survival' : 'Creative'}`;
    });
    const create = button('Create New World', async () => {
      create.disabled = true;
      await this.cb.onCreate(name.input.value.trim() || 'New World', seed.input.value, mode);
    });
    this.show(h('div', { class: 'screen sheet' },
      backdrop(this.inGame),
      h('h2', { text: 'Create New World' }),
      name.el, seed.el,
      h('div', { class: 'field' }, h('label', { text: 'Seed preview' }), h('div', { style: 'font-size:12px;color:#ccc', text: seed.input.value ? String(parseSeed(seed.input.value)) : 'random' })),
      modeBtn,
      h('div', { class: 'row' }, create, button('Cancel', () => void this.showWorlds(), 'small')),
    ));
    setTimeout(() => name.input.focus(), 0);
  }

  showPause(): void {
    this.inGame = true;
    this.show(h('div', { class: 'screen sheet' },
      backdrop(true),
      h('h2', { text: 'Game Menu' }),
      button('Back to Game', () => this.cb.onResume()),
      button('Options...', () => this.showOptions(() => this.showPause())),
      button('Save and Quit to Title', () => this.cb.onQuitToTitle()),
    ));
  }

  showOptions(back: () => void): void {
    const o = this.options;
    const change = () => this.cb.onOptionsChanged(o);
    this.show(h('div', { class: 'screen sheet' },
      backdrop(this.inGame),
      h('h2', { text: 'Options' }),
      slider((v) => `Render Distance: ${v} chunks`, 2, 16, 1, o.renderDistance, (v) => { o.renderDistance = v; change(); }),
      slider((v) => `FOV: ${v === 70 ? 'Normal' : v}`, 30, 110, 1, o.fov, (v) => { o.fov = v; change(); }),
      slider((v) => `Sensitivity: ${Math.round(v * 100)}%`, 0.1, 3, 0.05, o.sensitivity, (v) => { o.sensitivity = v; change(); }),
      slider((v) => `GUI Scale: ${v}`, 1, 4, 1, o.guiScale, (v) => { o.guiScale = v; change(); }),
      slider((v) => `Brightness: ${v <= 0 ? 'Moody' : v >= 1 ? 'Bright' : Math.round(v * 100) + '%'}`, 0, 1, 0.05, o.gamma, (v) => { o.gamma = v; change(); }),
      slider((v) => `Master Volume: ${Math.round(v * 100)}%`, 0, 1, 0.05, o.volume, (v) => { o.volume = v; change(); }),
      button('Controls...', () => this.showControls(() => this.showOptions(back))),
      button('Done', back),
    ));
  }

  /** Vanilla "Key Binds" screen: click a key button, press the new key (Escape = Not Bound). */
  showControls(back: () => void): void {
    const o = this.options;
    const bindings = mergeBindings(o.bindings);
    const keyButtons = new Map<Action, HTMLButtonElement>();
    let waiting: Action | null = null;
    const commit = () => {
      const overrides: Partial<Record<string, string>> = {};
      for (const [k, v] of Object.entries(bindings)) if (DEFAULT_BINDINGS[k as Action] !== v) overrides[k] = v;
      o.bindings = Object.keys(overrides).length ? overrides : undefined;
      this.cb.onOptionsChanged(o);
      refresh();
    };
    const refresh = () => {
      const counts = new Map<string, number>();
      for (const v of Object.values(bindings)) if (v !== UNBOUND) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const [action, btn] of keyButtons) {
        const code = bindings[action];
        const dup = (counts.get(code) ?? 0) > 1;
        btn.textContent = waiting === action ? `> ${keyName(code)} <` : keyName(code);
        btn.classList.toggle('waiting', waiting === action);
        btn.classList.toggle('dup', dup && waiting !== action);
        btn.title = dup ? 'Also bound to another action' : '';
      }
      resetAll.disabled = Object.entries(bindings).every(([k, v]) => DEFAULT_BINDINGS[k as Action] === v);
    };
    const assign = (code: string) => {
      if (!waiting) return;
      // the pause key must stay reachable, everything else may be unbound like vanilla
      bindings[waiting] = code === UNBOUND && waiting === 'pause' ? bindings[waiting] : code;
      waiting = null;
      commit();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!waiting) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      assign(e.code === 'Escape' ? UNBOUND : e.code);
    };
    const onMouse = (e: MouseEvent) => {
      if (!waiting) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      assign(`Mouse${e.button}`);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
    const list = h('div', { class: 'controls' });
    let lastCategory = '';
    for (const info of ACTION_INFO) {
      if (info.category !== lastCategory) {
        lastCategory = info.category;
        list.append(h('div', { class: 'category', text: info.category }));
      }
      const keyBtn = button(keyName(bindings[info.action]), () => {
        waiting = waiting === info.action ? null : info.action;
        refresh();
      }, 'key');
      keyBtn.addEventListener('mousedown', (e) => e.stopPropagation()); // clicking a key button never binds a mouse button
      keyButtons.set(info.action, keyBtn);
      const resetBtn = button('Reset', () => {
        bindings[info.action] = DEFAULT_BINDINGS[info.action];
        waiting = null;
        commit();
      }, 'reset');
      list.append(h('div', { class: 'keyrow' }, h('span', { class: 'name', text: info.name }), keyBtn, resetBtn));
    }
    const resetAll = button('Reset Keys', () => {
      for (const k of Object.keys(bindings) as Action[]) bindings[k] = DEFAULT_BINDINGS[k];
      waiting = null;
      commit();
    }, 'small');
    void mouseButtonOf;
    this.show(h('div', { class: `screen ${this.inGame ? '' : 'dirt'}` },
      h('h2', { text: 'Key Binds' }),
      list,
      h('div', { class: 'row' }, resetAll, button('Done', () => { cleanup(); back(); }, 'small')),
    ));
    refresh();
  }

  showDeath(): void {
    this.show(h('div', { class: 'screen death' },
      h('h1', { text: 'You died!' }),
      button('Respawn', () => this.cb.onRespawn()),
      button('Title Screen', () => this.cb.onQuitToTitle()),
    ));
  }

  setOptions(o: Options): void {
    this.options = o;
  }
}

/**
 * The title screen's rolling background. Vanilla stands the camera inside a cube of six pictures
 * and turns it slowly; six faces of a box and one long rotation come out at the same place.
 */
/**
 * What sits behind a screen. Vanilla blurs what was already there: the world when the screen was
 * opened from inside one, and the rolling panorama when it was opened from the title.
 */
function backdrop(inGame: boolean): HTMLElement {
  if (inGame) return h('div', { class: 'backdrop in-world' });
  // vanilla blurs a still of what was behind, not a moving picture: one face, held, costs nothing
  const still = h('div', { class: 'backdrop still' });
  still.style.backgroundImage = `url('${import.meta.env.BASE_URL}textures/gui/title/background/panorama_0.png')`;
  return still;
}

function panorama(): HTMLElement {
  const base = `${import.meta.env.BASE_URL}textures/gui/title/background/panorama_`;
  // 0, 1, 2 and 3 are the four walls in order, so laying them side by side and sliding the strip
  // along by exactly its own width comes back round to where it started without a seam
  const strip = h('div', { class: 'panorama-strip' });
  for (const n of ['0', '1', '2', '3', '0']) {
    const face = h('div', { class: 'panorama-face' });
    face.style.backgroundImage = `url('${base}${n}.png')`;
    strip.append(face);
  }
  return h('div', { class: 'panorama' }, strip, h('div', { class: 'panorama-overlay' }));
}

/** Mojang's own splash list, once it has been fetched; otherwise one of our own. */
let splashes: string[] | null = null;
void fetch(`${import.meta.env.BASE_URL}texts/splashes.txt`)
  .then((r) => (r.ok ? r.text() : ''))
  // the font is Mojang's ascii page, so the lines in other alphabets are left out of the draw
  .then((t) => { splashes = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /^[\x20-\x7e]+$/.test(l)); })
  .catch(() => { splashes = null; });

function splashText(): string {
  const own = ['Voxels ahoy!', 'Also try Minecraft!', 'Made in a browser!', 'Now with real sounds!'];
  const list = splashes?.length ? splashes : own;
  return list[Math.floor(Math.random() * list.length)];
}

/** Vanilla bounces the splash on a sine of the clock, and turns it twenty degrees. */
function bounceSplash(el: HTMLElement | null): void {
  if (!el) return;
  const start = performance.now();
  const tick = () => {
    if (!el.isConnected) return;
    const t = (performance.now() - start) / 1000;
    const scale = 1 - Math.abs(Math.sin(t * 2)) * 0.1;
    el.style.transform = `rotate(-20deg) scale(${scale.toFixed(3)})`;
    requestAnimationFrame(tick);
  };
  tick();
}
