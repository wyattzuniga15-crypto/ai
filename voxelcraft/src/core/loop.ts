/** Fixed 20 TPS simulation loop with render interpolation. */
import { TICK_MS } from './constants.ts';

export class GameLoop {
  private last = 0;
  private acc = 0;
  private raf = 0;
  running = false;
  fps = 0;
  private frames = 0;
  private fpsTime = 0;

  constructor(
    private readonly tick: () => void,
    private readonly render: (alpha: number, dt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      let dt = now - this.last;
      this.last = now;
      if (dt > 250) dt = 250; // avoid spiral of death after a tab switch
      this.acc += dt;
      let ticks = 0;
      while (this.acc >= TICK_MS && ticks < 10) {
        this.tick();
        this.acc -= TICK_MS;
        ticks++;
      }
      this.render(this.acc / TICK_MS, dt / 1000);
      this.frames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 1000) {
        this.fps = Math.round((this.frames * 1000) / this.fpsTime);
        this.frames = 0;
        this.fpsTime = 0;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
