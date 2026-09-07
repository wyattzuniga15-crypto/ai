/**
 * Procedural sound effects on Web Audio. Every sound is synthesized (no recorded samples) and
 * spatialized by distance from the listener.
 */
export interface PlayOptions {
  x?: number;
  y?: number;
  z?: number;
  volume?: number;
  pitch?: number;
}

type Synth = (ctx: AudioContext, out: AudioNode, pitch: number, t0: number) => void;

let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: AudioContext): AudioBufferSourceNode {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

function env(ctx: AudioContext, t0: number, attack: number, decay: number, peak = 1): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return g;
}

function burst(ctx: AudioContext, out: AudioNode, t0: number, type: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak: number, pitch: number): void {
  const n = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq * pitch;
  f.Q.value = q;
  const g = env(ctx, t0, attack, decay, peak);
  n.connect(f).connect(g).connect(out);
  n.start(t0);
  n.stop(t0 + attack + decay + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, type: OscillatorType, f1: number, f2: number, dur: number, peak: number, pitch: number, attack = 0.01): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f1 * pitch, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2 * pitch), t0 + dur);
  const g = env(ctx, t0, attack, dur, peak);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
  return o;
}

const SOUNDS: Record<string, Synth> = {
  dig_stone: (c, o, p, t) => burst(c, o, t, 'lowpass', 700, 1, 0.005, 0.12, 0.6, p),
  dig_wood: (c, o, p, t) => { burst(c, o, t, 'bandpass', 450, 2, 0.005, 0.14, 0.5, p); tone(c, o, t, 'sine', 180, 90, 0.08, 0.3, p); },
  dig_gravel: (c, o, p, t) => burst(c, o, t, 'highpass', 1200, 0.7, 0.005, 0.18, 0.5, p),
  dig_sand: (c, o, p, t) => burst(c, o, t, 'bandpass', 2500, 0.5, 0.01, 0.16, 0.35, p),
  dig_grass: (c, o, p, t) => burst(c, o, t, 'bandpass', 1400, 1, 0.005, 0.1, 0.4, p),
  dig_wool: (c, o, p, t) => burst(c, o, t, 'lowpass', 400, 0.5, 0.01, 0.1, 0.3, p),
  dig_glass: (c, o, p, t) => { burst(c, o, t, 'highpass', 3500, 1, 0.002, 0.25, 0.6, p); tone(c, o, t, 'sine', 2600, 2400, 0.15, 0.2, p); },
  dig_water: (c, o, p, t) => burst(c, o, t, 'bandpass', 900, 1.5, 0.02, 0.3, 0.4, p),
  step: (c, o, p, t) => burst(c, o, t, 'lowpass', 900, 1, 0.003, 0.06, 0.25, p),
  hurt: (c, o, p, t) => tone(c, o, t, 'sawtooth', 420, 180, 0.2, 0.35, p),
  death: (c, o, p, t) => tone(c, o, t, 'sawtooth', 300, 60, 0.6, 0.4, p),
  eat: (c, o, p, t) => { for (let i = 0; i < 3; i++) burst(c, o, t + i * 0.11, 'bandpass', 600, 2, 0.01, 0.06, 0.35, p * (1 + i * 0.1)); },
  burp: (c, o, p, t) => tone(c, o, t, 'sawtooth', 130, 70, 0.35, 0.35, p),
  levelup: (c, o, p, t) => { [523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.1, 'sine', f, f, 0.35, 0.25, p)); },
  orb: (c, o, p, t) => tone(c, o, t, 'sine', 1400 + Math.random() * 800, 2600, 0.12, 0.15, p),
  pop: (c, o, p, t) => tone(c, o, t, 'sine', 700, 1500, 0.06, 0.25, p),
  explosion: (c, o, p, t) => { burst(c, o, t, 'lowpass', 320, 0.5, 0.01, 1.2, 1.0, p); tone(c, o, t, 'sine', 70, 30, 0.8, 0.8, p); },
  bow: (c, o, p, t) => { burst(c, o, t, 'bandpass', 1800, 3, 0.005, 0.12, 0.3, p); tone(c, o, t, 'triangle', 500, 900, 0.1, 0.15, p); },
  arrow_hit: (c, o, p, t) => burst(c, o, t, 'highpass', 2500, 1, 0.002, 0.05, 0.4, p),
  creeper_hiss: (c, o, p, t) => burst(c, o, t, 'highpass', 2200, 0.5, 1.2, 0.3, 0.7, p),
  zombie: (c, o, p, t) => { const os = tone(c, o, t, 'sawtooth', 120, 95, 0.7, 0.3, p, 0.1); const lfo = c.createOscillator(); lfo.frequency.value = 6; const lg = c.createGain(); lg.gain.value = 8; lfo.connect(lg).connect(os.frequency); lfo.start(t); lfo.stop(t + 0.9); },
  skeleton: (c, o, p, t) => { for (let i = 0; i < 4; i++) burst(c, o, t + i * 0.07, 'bandpass', 1500, 4, 0.002, 0.05, 0.3, p); },
  spider: (c, o, p, t) => { for (let i = 0; i < 3; i++) burst(c, o, t + i * 0.12, 'highpass', 3000, 1, 0.005, 0.08, 0.2, p); },
  cow: (c, o, p, t) => { const os = tone(c, o, t, 'sawtooth', 160, 120, 0.7, 0.3, p, 0.08); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; os.disconnect(); os.connect(f).connect(env(c, t, 0.08, 0.7, 0.3)).connect(o); },
  pig: (c, o, p, t) => { tone(c, o, t, 'square', 320, 240, 0.12, 0.15, p); tone(c, o, t + 0.16, 'square', 300, 220, 0.1, 0.15, p); },
  sheep: (c, o, p, t) => { const os = tone(c, o, t, 'triangle', 360, 330, 0.5, 0.3, p, 0.05); const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 30; lfo.connect(lg).connect(os.frequency); lfo.start(t); lfo.stop(t + 0.6); },
  chicken: (c, o, p, t) => { tone(c, o, t, 'square', 1100, 800, 0.08, 0.12, p); tone(c, o, t + 0.12, 'square', 1000, 700, 0.1, 0.12, p); },
  door: (c, o, p, t) => { burst(c, o, t, 'bandpass', 300, 2, 0.005, 0.07, 0.4, p); tone(c, o, t + 0.02, 'sawtooth', 220, 320, 0.15, 0.08, p); },
  chest: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 180, 260, 0.25, 0.1, p); burst(c, o, t, 'bandpass', 400, 2, 0.005, 0.1, 0.2, p); },
  splash: (c, o, p, t) => burst(c, o, t, 'bandpass', 1100, 1, 0.02, 0.4, 0.4, p),
  click: (c, o, p, t) => burst(c, o, t, 'bandpass', 2000, 3, 0.002, 0.04, 0.4, p),
  fuse: (c, o, p, t) => burst(c, o, t, 'highpass', 3000, 0.5, 0.05, 0.4, 0.3, p),
  fizz: (c, o, p, t) => burst(c, o, t, 'highpass', 4000, 0.5, 0.05, 0.6, 0.4, p),
  lava_pop: (c, o, p, t) => tone(c, o, t, 'sine', 300, 120, 0.15, 0.3, p),
  anvil: (c, o, p, t) => { tone(c, o, t, 'square', 1200, 1150, 0.4, 0.2, p); burst(c, o, t, 'highpass', 4000, 1, 0.002, 0.1, 0.3, p); },
  enchant: (c, o, p, t) => { [880, 1108, 1318, 1760].forEach((f, i) => tone(c, o, t + i * 0.06, 'sine', f, f * 1.01, 0.4, 0.15, p)); },  // ui.stonecutter.take_result / select_recipe and block.smithing_table.use
  stonecutter: (c, o, p, t) => { burst(c, o, t, 'bandpass', 1800, 1.5, 0.002, 0.16, 0.5, p); tone(c, o, t, 'square', 900, 400, 0.12, 0.08, p); },
  stonecutter_select: (c, o, p, t) => burst(c, o, t, 'bandpass', 2600, 2, 0.002, 0.06, 0.35, p),
  smithing: (c, o, p, t) => { tone(c, o, t, 'square', 700, 650, 0.25, 0.15, p); burst(c, o, t, 'highpass', 3000, 1, 0.002, 0.12, 0.3, p); },
  // wet squelch for slime hops and deaths
  slime: (c, o, p, t) => { burst(c, o, t, 'lowpass', 500, 1.5, 0.01, 0.18, 0.5, p); tone(c, o, t, 'sine', 260, 120, 0.15, 0.25, p); },
  // enderman: low rumbling voice, a hiss and pop for teleports, a long scream when provoked
  enderman: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 90, 160, 0.5, 0.25, p); burst(c, o, t, 'lowpass', 300, 1, 0.05, 0.5, 0.2, p); },
  enderman_teleport: (c, o, p, t) => { burst(c, o, t, 'highpass', 2500, 0.7, 0.005, 0.3, 0.35, p); tone(c, o, t, 'sine', 400, 1400, 0.25, 0.15, p); },
  witch: (c, o, p, t) => { [0, 0.09, 0.18].forEach((d, i) => tone(c, o, t + d, 'square', 520 - i * 40, 480 - i * 40, 0.08, 0.15, p)); },
  phantom: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 1400, 900, 0.5, 0.15, p); burst(c, o, t, 'highpass', 2500, 0.8, 0.02, 0.5, 0.25, p); },
  // equines: a breathy whinny, an angrier version, a snort while eating and the saddle creak
  horse: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 380, 220, 0.5, 0.18, p); tone(c, o, t + 0.12, 'sawtooth', 300, 180, 0.4, 0.12, p); burst(c, o, t, 'bandpass', 700, 1.2, 0.02, 0.4, 0.12, p); },
  horse_ambient: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 340, 200, 0.45, 0.14, p); burst(c, o, t + 0.05, 'bandpass', 600, 1.5, 0.02, 0.3, 0.1, p); },
  horse_angry: (c, o, p, t) => { tone(c, o, t, 'square', 460, 200, 0.5, 0.2, p); tone(c, o, t + 0.15, 'sawtooth', 380, 160, 0.35, 0.15, p); },
  horse_eat: (c, o, p, t) => { burst(c, o, t, 'lowpass', 900, 1, 0.01, 0.25, 0.15, p); burst(c, o, t + 0.15, 'lowpass', 800, 1, 0.01, 0.2, 0.12, p); },
  horse_jump: (c, o, p, t) => { burst(c, o, t, 'bandpass', 300, 1.2, 0.005, 0.18, 0.2, p); tone(c, o, t, 'sine', 160, 90, 0.2, 0.15, p); },
  horse_gallop: (c, o, p, t) => { [0, 0.07, 0.16, 0.22].forEach((d) => burst(c, o, t + d, 'lowpass', 260, 1, 0.004, 0.09, 0.16, p)); },
  donkey: (c, o, p, t) => { [0, 0.18].forEach((d, i) => { tone(c, o, t + d, 'square', i ? 240 : 520, i ? 140 : 300, 0.28, 0.16, p); }); },
  saddle: (c, o, p, t) => { burst(c, o, t, 'bandpass', 1200, 1.5, 0.01, 0.2, 0.15, p); tone(c, o, t, 'sine', 220, 160, 0.15, 0.08, p); },
  wolf: (c, o, p, t) => { tone(c, o, t, 'square', 420, 300, 0.12, 0.25, p); burst(c, o, t, 'bandpass', 900, 1.5, 0.005, 0.1, 0.3, p); },
  wolf_growl: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 110, 90, 0.6, 0.2, p); burst(c, o, t, 'lowpass', 400, 1, 0.05, 0.5, 0.15, p); },
  shear: (c, o, p, t) => { burst(c, o, t, 'highpass', 3500, 1.5, 0.002, 0.12, 0.4, p); burst(c, o, t + 0.08, 'highpass', 3000, 1.5, 0.002, 0.1, 0.3, p); },
  enderman_scream: (c, o, p, t) => { tone(c, o, t, 'sawtooth', 220, 110, 1.2, 0.3, p); tone(c, o, t + 0.1, 'square', 330, 140, 1.0, 0.12, p); },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 1;
  listener = { x: 0, y: 0, z: 0 };
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture at least once (browsers block audio otherwise). */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  play(name: string, opts: PlayOptions = {}): void {
    if (!this.ctx || !this.master || this.volume <= 0) return;
    const synth = SOUNDS[name];
    if (!synth) return;
    let gain = opts.volume ?? 1;
    if (opts.x !== undefined) {
      const d = Math.hypot(opts.x - this.listener.x, (opts.y ?? this.listener.y) - this.listener.y, (opts.z ?? this.listener.z) - this.listener.z);
      gain *= Math.max(0, 1 - d / 16);
      if (gain <= 0.01) return;
    }
    // avoid stacking the same sound many times per frame
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < 30) return;
    this.lastPlayed.set(name, now);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    try {
      synth(this.ctx, g, opts.pitch ?? 1, this.ctx.currentTime);
    } catch (e) {
      console.warn('sound failed', name, e);
    }
  }

  get enabled(): boolean {
    return !!this.ctx;
  }
}

/** Sound group for digging/stepping on a block, by its id and tool class. */
export function blockSoundGroup(id: string, tool: string | null, behavior: string): string {
  if (behavior === 'fluid') return 'water';
  if (behavior === 'glass' || behavior === 'pane' || id === 'ice' || id === 'packed_ice' || id.endsWith('_stained_glass')) return 'glass';
  if (id.endsWith('_wool') || id.endsWith('_carpet') || behavior === 'leaves' || behavior === 'plant' || behavior === 'sapling' || behavior === 'crop') return id.endsWith('_wool') || id.endsWith('_carpet') ? 'wool' : 'grass';
  if (id === 'grass_block' || id === 'dirt' || id === 'podzol' || id === 'mycelium' || id === 'farmland' || id === 'dirt_path' || id === 'coarse_dirt' || id === 'rooted_dirt' || id === 'moss_block') return 'grass';
  if (id === 'sand' || id === 'red_sand' || id.endsWith('concrete_powder') || id === 'soul_sand' || id === 'soul_soil') return 'sand';
  if (id === 'gravel' || id === 'clay' || behavior === 'snow_layer' || id === 'snow_block') return 'gravel';
  if (tool === 'axe' || behavior === 'log' || behavior === 'door' || behavior === 'trapdoor' || behavior === 'fence' || behavior === 'fence_gate' || behavior === 'sign' || behavior === 'container' || behavior === 'workstation') return 'wood';
  if (tool === 'shovel') return 'gravel';
  return 'stone';
}
