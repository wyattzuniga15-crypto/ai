/** Keyboard, mouse and pointer-lock state with rebindable actions. */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint' | 'inventory' | 'drop' | 'chat'
  | 'command' | 'debug' | 'swapHands' | 'pause' | 'perspective' | 'pick' | 'attack' | 'use'
  | 'hotbar1' | 'hotbar2' | 'hotbar3' | 'hotbar4' | 'hotbar5' | 'hotbar6' | 'hotbar7' | 'hotbar8' | 'hotbar9';

/** Key codes are `KeyboardEvent.code` values; mouse buttons are `Mouse0` (left), `Mouse1` (middle), `Mouse2` (right). */
export const UNBOUND = 'Unbound';

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', debug: 'F3', swapHands: 'KeyF', pause: 'Escape',
  perspective: 'F5', pick: 'Mouse1', attack: 'Mouse0', use: 'Mouse2',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5', hotbar6: 'Digit6',
  hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

/** Vanilla "Controls" screen order, names and categories. */
export const ACTION_INFO: { action: Action; name: string; category: string }[] = [
  { action: 'forward', name: 'Walk Forwards', category: 'Movement' },
  { action: 'back', name: 'Walk Backwards', category: 'Movement' },
  { action: 'left', name: 'Strafe Left', category: 'Movement' },
  { action: 'right', name: 'Strafe Right', category: 'Movement' },
  { action: 'jump', name: 'Jump', category: 'Movement' },
  { action: 'sneak', name: 'Sneak', category: 'Movement' },
  { action: 'sprint', name: 'Sprint', category: 'Movement' },
  { action: 'attack', name: 'Attack/Destroy', category: 'Gameplay' },
  { action: 'pick', name: 'Pick Block', category: 'Gameplay' },
  { action: 'use', name: 'Use Item/Place Block', category: 'Gameplay' },
  { action: 'drop', name: 'Drop Selected Item', category: 'Inventory' },
  { action: 'hotbar1', name: 'Hotbar Slot 1', category: 'Inventory' },
  { action: 'hotbar2', name: 'Hotbar Slot 2', category: 'Inventory' },
  { action: 'hotbar3', name: 'Hotbar Slot 3', category: 'Inventory' },
  { action: 'hotbar4', name: 'Hotbar Slot 4', category: 'Inventory' },
  { action: 'hotbar5', name: 'Hotbar Slot 5', category: 'Inventory' },
  { action: 'hotbar6', name: 'Hotbar Slot 6', category: 'Inventory' },
  { action: 'hotbar7', name: 'Hotbar Slot 7', category: 'Inventory' },
  { action: 'hotbar8', name: 'Hotbar Slot 8', category: 'Inventory' },
  { action: 'hotbar9', name: 'Hotbar Slot 9', category: 'Inventory' },
  { action: 'inventory', name: 'Open/Close Inventory', category: 'Inventory' },
  { action: 'swapHands', name: 'Swap Item With Offhand', category: 'Inventory' },
  { action: 'chat', name: 'Open Chat', category: 'Multiplayer' },
  { action: 'command', name: 'Open Command', category: 'Multiplayer' },
  { action: 'pause', name: 'Pause/Open Menu', category: 'Miscellaneous' },
  { action: 'perspective', name: 'Toggle Perspective', category: 'Miscellaneous' },
  { action: 'debug', name: 'Toggle Debug Screen', category: 'Miscellaneous' },
];

/** Mouse button index for a binding code, or -1 for keyboard codes. */
export function mouseButtonOf(code: string): number {
  if (code === 'MouseMiddle') return 1; // legacy saves
  const m = /^Mouse(\d+)$/.exec(code);
  return m ? Number(m[1]) : -1;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Escape: 'Escape', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock', Slash: '/', Backslash: '\\',
  Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow', Insert: 'Insert', Delete: 'Delete',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', ContextMenu: 'Menu', PrintScreen: 'Print Screen', ScrollLock: 'Scroll Lock',
  Pause: 'Pause', NumLock: 'Num Lock', NumpadEnter: 'Keypad Enter', NumpadAdd: 'Keypad +', NumpadSubtract: 'Keypad -', NumpadMultiply: 'Keypad *',
  NumpadDivide: 'Keypad /', NumpadDecimal: 'Keypad .',
};

/** Vanilla-style display name for a binding code ("W", "Left Shift", "Middle Button", "Not Bound"). */
export function keyName(code: string): string {
  if (!code || code === UNBOUND) return 'Not Bound';
  const mb = mouseButtonOf(code);
  if (mb >= 0) return mb === 0 ? 'Left Button' : mb === 1 ? 'Middle Button' : mb === 2 ? 'Right Button' : `Button ${mb + 1}`;
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Keypad ${code.slice(6)}`;
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (side) return `${side[2]} ${side[1]}`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Full binding table from saved overrides (unknown actions ignored, legacy mouse codes normalised). */
export function mergeBindings(overrides?: Partial<Record<string, string>> | null): Record<Action, string> {
  const out: Record<Action, string> = { ...DEFAULT_BINDINGS };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (!(k in DEFAULT_BINDINGS) || typeof v !== 'string' || !v) continue;
    out[k as Action] = v === 'MouseMiddle' ? 'Mouse1' : v;
  }
  return out;
}

export class Input {
  readonly down = new Set<string>();
  /** Keys pressed since the last frame (render-side edges). */
  private readonly pressedNow = new Set<string>();
  /** Keys pressed since the last simulation tick (tick-side edges). */
  private readonly pressedTick = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  wheel = 0;
  readonly mouseDown = new Set<number>();
  private readonly mouseClicked = new Set<number>();
  private readonly mouseClickedTick = new Set<number>();
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
      if (!this.down.has(e.code)) {
        this.pressedNow.add(e.code);
        this.pressedTick.add(e.code);
      }
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
      this.mouseClickedTick.add(e.button);
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

  /** Replaces the binding table with defaults plus the given overrides. */
  setBindings(overrides?: Partial<Record<string, string>> | null): void {
    this.bindings = mergeBindings(overrides);
  }

  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    const code = this.bindings[action];
    const mb = mouseButtonOf(code);
    if (mb >= 0) return this.mouseDown.has(mb);
    return this.down.has(code);
  }

  wasPressed(action: Action): boolean {
    if (!this.enabled) return false;
    const code = this.bindings[action];
    const mb = mouseButtonOf(code);
    if (mb >= 0) return this.mouseClicked.has(mb);
    return this.pressedNow.has(code);
  }

  /** Edge-triggered press as seen by the 20 TPS simulation (cleared by `endTick`). */
  tickPressed(action: Action): boolean {
    if (!this.enabled) return false;
    const code = this.bindings[action];
    const mb = mouseButtonOf(code);
    if (mb >= 0) return this.mouseClickedTick.has(mb);
    return this.pressedTick.has(code);
  }

  tickClicked(button: number): boolean {
    return this.enabled && this.mouseClickedTick.has(button);
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

  /** Call at the end of every frame to clear frame-side edge state. */
  endFrame(): void {
    this.pressedNow.clear();
    this.mouseClicked.clear();
  }

  /** Call at the end of every simulation tick to clear tick-side edge state. */
  endTick(): void {
    this.pressedTick.clear();
    this.mouseClickedTick.clear();
  }
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
