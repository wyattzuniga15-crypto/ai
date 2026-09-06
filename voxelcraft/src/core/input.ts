/** Keyboard, mouse and pointer-lock state with rebindable actions. */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint' | 'inventory' | 'drop' | 'chat'
  | 'command' | 'debug' | 'swapHands' | 'pause' | 'perspective' | 'pick'
  | 'hotbar1' | 'hotbar2' | 'hotbar3' | 'hotbar4' | 'hotbar5' | 'hotbar6' | 'hotbar7' | 'hotbar8' | 'hotbar9';

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', debug: 'F3', swapHands: 'KeyF', pause: 'Escape',
  perspective: 'F5', pick: 'MouseMiddle',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5', hotbar6: 'Digit6',
  hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

export class Input {
  readonly down = new Set<string>();
  private readonly pressedNow = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  wheel = 0;
  readonly mouseDown = new Set<number>();
  private readonly mouseClicked = new Set<number>();
  locked = false;
  /** When false, game actions are ignored (a menu or text field has focus). */
  enabled = true;
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  onLockChange: ((locked: boolean) => void) | null = null;
  private lastLockRequest = 0;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || e.code === 'F5' || e.code === 'F11' || (e.code === 'Tab' && this.locked)) e.preventDefault();
      if (isTextTarget(e.target)) return;
      if (!this.down.has(e.code)) this.pressedNow.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.mouseDown.add(e.button);
      this.mouseClicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    element.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) {
        this.down.clear();
        this.mouseDown.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock(): void {
    const now = performance.now();
    if (now - this.lastLockRequest < 100) return;
    this.lastLockRequest = now;
    try {
      const p = this.element.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void> | undefined;
      p?.catch?.(() => this.element.requestPointerLock());
    } catch {
      this.element.requestPointerLock();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    const code = this.bindings[action];
    if (code === 'MouseMiddle') return this.mouseDown.has(1);
    return this.down.has(code);
  }

  wasPressed(action: Action): boolean {
    if (!this.enabled) return false;
    const code = this.bindings[action];
    if (code === 'MouseMiddle') return this.mouseClicked.has(1);
    return this.pressedNow.has(code);
  }

  /** Raw key press check that ignores `enabled` (for menus). */
  keyPressed(code: string): boolean {
    return this.pressedNow.has(code);
  }

  clicked(button: number): boolean {
    return this.enabled && this.mouseClicked.has(button);
  }

  isMouseDown(button: number): boolean {
    return this.enabled && this.mouseDown.has(button);
  }

  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call at the end of every frame to clear edge-triggered state. */
  endFrame(): void {
    this.pressedNow.clear();
    this.mouseClicked.clear();
  }
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
