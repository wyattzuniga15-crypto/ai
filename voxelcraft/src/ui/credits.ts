/**
 * The screen that plays when a traveller walks back out of the End: vanilla's end poem, then the
 * credits, scrolling up over black. Both texts are Mojang's own, read at runtime from the files the
 * asset fetcher unpacks; with neither of them there the screen simply says the game is over.
 */
import { h } from './dom.ts';

/** Vanilla's sixteen formatting colours, by the character that selects them. */
const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa',
  '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

/** One run of text in the poem, with the colour vanilla asked for and whether it is scrambled. */
export interface PoemRun {
  text: string;
  color: string;
  obfuscated: boolean;
}

/**
 * Splits vanilla's `end.txt` into its paragraphs, each a list of runs. The file is plain text with
 * the section sign selecting a colour or the scrambling that vanilla draws as flickering glyphs,
 * and `PLAYERNAME` standing in for whoever is reading it.
 */
export function parseEndPoem(text: string, playerName: string): PoemRun[][] {
  const out: PoemRun[][] = [];
  for (const para of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const body = para.trim();
    if (!body) continue;
    const runs: PoemRun[] = [];
    let color = COLORS.f;
    let obfuscated = false;
    for (const part of body.split('§')) {
      if (!part) continue;
      const code = part[0].toLowerCase();
      let rest = part;
      if (COLORS[code]) {
        // a colour ends whatever formatting was running, as vanilla's does
        color = COLORS[code];
        obfuscated = false;
        rest = part.slice(1);
      } else if (code === 'k') {
        obfuscated = true;
        rest = part.slice(1);
      } else if (code === 'r') {
        color = COLORS.f;
        obfuscated = false;
        rest = part.slice(1);
      }
      if (rest) runs.push({ text: rest.replace(/PLAYERNAME/g, playerName), color, obfuscated });
    }
    if (runs.length) out.push(runs);
  }
  return out;
}

/** A section of the credits, as `credits.json` files them: a heading and the lines under it. */
export interface CreditsSection {
  title: string;
  lines: { text: string; heading: boolean }[];
}

interface CreditsJson {
  section: string;
  disciplines: { discipline: string; titles: { title: string; names: string[] }[] }[];
}

/** Flattens vanilla's `credits.json` into the headings and names it draws under each section. */
export function parseCredits(json: unknown): CreditsSection[] {
  if (!Array.isArray(json)) return [];
  const out: CreditsSection[] = [];
  for (const s of json as CreditsJson[]) {
    if (!s || typeof s.section !== 'string') continue;
    const lines: CreditsSection['lines'] = [];
    for (const d of s.disciplines ?? []) {
      if (d.discipline) lines.push({ text: d.discipline, heading: true });
      for (const t of d.titles ?? []) {
        if (t.title) lines.push({ text: t.title, heading: true });
        for (const n of t.names ?? []) lines.push({ text: n, heading: false });
      }
    }
    out.push({ title: s.section, lines });
  }
  return out;
}

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Vanilla's obfuscated text: the same shape, redrawn out of random glyphs every few frames. */
function scramble(s: string, rng: () => number): string {
  let out = '';
  for (const ch of s) out += ch === ' ' ? ' ' : SCRAMBLE[Math.floor(rng() * SCRAMBLE.length)];
  return out;
}

export interface CreditsOptions {
  /** Where the texts live, usually the site's base URL. */
  base: string;
  playerName: string;
  onDone(): void;
}

/**
 * The rolling credits. It scrolls itself, runs faster while a key is held the way vanilla's does,
 * and closes on Escape or when the last line has gone by.
 */
export class CreditsScreen {
  readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private offset = 0;
  private speed = 1;
  private held = false;
  private raf = 0;
  private last = 0;
  private closed = false;
  private readonly obfuscated: { el: HTMLElement; text: string }[] = [];
  private flicker = 0;

  constructor(container: HTMLElement, private readonly opts: CreditsOptions) {
    this.scroller = h('div', { class: 'roll' });
    this.root = h('div', { id: 'credits' }, this.scroller);
    container.append(this.root);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    void this.load();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    this.held = true;
  };

  private onKeyUp = (): void => {
    this.held = false;
  };

  /** Reads the two texts, and shows what it can of them: neither one is required to be there. */
  private async load(): Promise<void> {
    const read = async (path: string): Promise<string | null> => {
      try {
        const r = await fetch(`${this.opts.base}texts/${path}`);
        return r.ok ? await r.text() : null;
      } catch {
        return null;
      }
    };
    const [poem, credits] = await Promise.all([read('end.txt'), read('credits.json')]);
    if (this.closed) return;
    this.scroller.append(h('div', { class: 'spacer' }));
    if (poem) {
      for (const para of parseEndPoem(poem, this.opts.playerName)) {
        const p = h('p', {});
        for (const run of para) {
          const span = h('span', { text: run.text });
          span.style.color = run.color;
          if (run.obfuscated) this.obfuscated.push({ el: span, text: run.text });
          p.append(span);
        }
        this.scroller.append(p);
      }
    }
    this.scroller.append(h('h1', { text: 'Voxelcraft' }));
    if (credits) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(credits);
      } catch {
        parsed = null;
      }
      for (const section of parseCredits(parsed)) {
        this.scroller.append(h('h2', { text: section.title }));
        for (const line of section.lines) this.scroller.append(h('div', { class: line.heading ? 'role' : 'name', text: line.text }));
      }
    }
    if (!poem && !credits) this.scroller.append(h('p', { text: 'The End.' }));
    this.scroller.append(h('div', { class: 'spacer' }));
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // vanilla rolls the poem slowly and lets a held key run it up to six times faster
    this.offset += dt * (this.held ? 150 : 25) * this.speed;
    this.scroller.style.transform = `translateY(${-this.offset}px)`;
    if (this.obfuscated.length && (this.flicker += dt) > 0.05) {
      this.flicker = 0;
      for (const o of this.obfuscated) o.el.textContent = scramble(o.text, Math.random);
    }
    if (this.offset > this.scroller.scrollHeight) {
      this.close();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.root.remove();
    this.opts.onDone();
  }
}
