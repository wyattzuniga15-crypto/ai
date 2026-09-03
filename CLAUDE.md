# CLAUDE.md — Visual Consistency Rules (desktop)

You are building single-file HTML5 canvas games for desktop browsers: a mouse that hovers before it clicks, a keyboard, and a resizable landscape window. The #1 rule of this project: **every menu, HUD, overlay, and in-world texture must look like it came from the same artist on the same day.** Consistency is enforced by structure, not by taste — and that goes for input too: one object tracks the mouse, one function maps it onto the canvas, one kit reacts to it.

## How to work with me
- Build first. Don't ask clarifying questions unless something is truly blocking.
- Pick the most effective option and go. If I'm wrong, say so in one sentence, then do the right thing.

## Project baseline
- One `.html` file, no build step, no external assets unless I hand you an image.
- 960×540 logical canvas (16:9), letterboxed into the window at one uniform scale, then multiplied by `Math.min(devicePixelRatio, 2)`. Everything is drawn in logical units. `fit()` owns the transform (section 6) and re-runs on `resize` and `fullscreenchange`; the letterbox bars are the page background, set once from THEME.ink.
- Input is mouse + keyboard through Pointer Events (section 6). No touch code paths, no on-screen d-pad, no safe-area insets, no haptics. A touchscreen laptop works for free because pointer events cover it — don't add anything for it.
- States: `ready` → `playing` → `paused` / `dead`. Each state is a screen; each screen uses the same UI kit below. Window `blur` or a hidden tab while `playing` → `paused`, always.
- Keyboard: `Esc` pauses/resumes, `F` toggles fullscreen, `M` mutes. Every button is also reachable by keyboard (section 2).
- WebAudio synth for music/SFX, unlocked on the first `pointerdown` or `keydown`. No `localStorage` — best scores live in memory only.

## 1. One THEME object. Nothing else defines a color.
Put this near the top of the file and route every visual decision through it. Defaults below are a warm tropical look — swap the values per game, never the structure.

```js
const THEME = {
  // palette — 5-7 colors, named by ROLE not hue
  bg:      '#FFB74D',  // sky / far background
  ground:  '#F4D9A6',  // sand / floor
  accent:  '#FFD23F',  // player / primary action
  accent2: '#2EC4B6',  // secondary (water, highlights, keyboard focus ring)
  ink:     '#3A2A1A',  // outlines AND text — same color for both
  paper:   '#FFF3D6',  // panel / card / button fill
  danger:  '#E63946',
  // shape language
  outline: 3,          // px — used on characters AND buttons
  radius:  14,         // panel/button corner radius
  shadow:  { dx: 0, dy: 4, color: 'rgba(0,0,0,.25)' },  // hard-edged, offset
  // one light direction for world bevels AND UI bevels
  light:   { x: -0.6, y: -0.8 },
  // pointer feedback — the only place hover and cursors are defined
  hover:   { tint: 0.08, lift: 2 },   // shade() amount and px rise while the mouse is over a control
  cursor:  { idle: 'default', hot: 'pointer', drag: 'grabbing', hidden: 'none' },
  // type
  font:    '"Arial Rounded MT Bold", "Nunito", system-ui, sans-serif',
  size:    { title: 40, body: 20, small: 14 },
};
```

Rules:
- **No hex / rgb / hsl literal appears anywhere outside THEME.** Need a tint? Derive it: `shade(THEME.accent, -0.2)`. Never invent a new literal.
- Outline width, radius, shadow, font, hover, and cursor names are read from THEME every time. Never type `3`, `14`, or `'pointer'` inline.
- Hover is a tint and a lift, read from THEME.hover — never a new color, a new shape, or a heavier outline. A world object that reacts to the mouse uses the same THEME.hover as a button.
- When I ask for a restyle ("make it neon", "make it tropical"), you change THEME and the texture generators only. If a restyle forces you to edit a screen's draw code, that screen was built wrong — fix the structure.

## 2. One UI kit. Every screen is built from it.
Write these once, use them everywhere (title, pause, game over, HUD, toasts):

- `drawPanel(x, y, w, h, { texture, fill, shadow })` — THEME.paper fill (or texture), THEME.ink outline at THEME.outline, THEME.radius corners, THEME.shadow unless `shadow: false`.
- `drawButton(id, x, y, w, h, label)` — built on `drawPanel`. Reads MOUSE itself and returns `true` on the one frame it is clicked (press **and** release both inside its rect). Its states all derive from THEME: hover = fill `shade(THEME.paper, THEME.hover.tint)` and the whole button rises by THEME.hover.lift; pressed = shifts down by `shadow.dy` and drops the shadow; focused = a THEME.accent2 ring at THEME.outline. `id` is a short string, unique within the screen.
- `drawLabel(text, x, y, size, align)` — THEME.font, THEME.ink stroke at THEME.outline behind the fill. **This is the only way text is drawn.**
- `drawMeter(x, y, w, h, pct, color)` — HUD bars. Same outline, same radius.
- `drawIcon(name, x, y, size)` — vector icons in THEME.ink strokes at THEME.outline.

Hard rules:
- A screen is a layout of kit calls: `if (drawButton('start', …)) setState('playing');`. That return value is the only way a screen learns about a click. If you're writing `ctx.fillRect`, `ctx.strokeText`, or a `MOUSE.x` comparison inside a screen function, stop and move it into the kit.
- Title screen, pause overlay, and game-over card share the same panel width, same button size, same spacing rhythm (multiples of 8). With the text removed, they should be indistinguishable in style.
- HUD uses the same kit at a smaller scale — not a different style.
- Keyboard focus: the kit records the buttons drawn each frame, in draw order. `Tab` / `Shift+Tab` and the arrow keys move `FOCUS.id` through that list; `Enter` / `Space` activate it through the same `drawButton` return value. Mouse hover never moves keyboard focus; a click does. The kit draws the focus ring, so no screen ever draws one.

## 3. Textures come from THEME and are shared by the world AND the menus.
- Generate every texture once at load in an offscreen canvas: `makeTexture(name)` → `CanvasPattern`, cached in `TEX = {}`.
- Texture generators only use THEME colors and `shade()`.
- **Menus are made of the world's materials.** If the ground is sand, the menu card is sand-grained paper with the same grain size. If platforms are wood, buttons are wood. Never a flat UI floating over a textured world.
- One texel density everywhere: pick one noise scale / stroke scale and reuse it. Menu grain is never finer or coarser than ground grain.
- Bevels, drop shadows, and highlights on characters, platforms, and buttons all use `THEME.light`.

## 4. Shape language stays constant
- One outline style: cel outline in THEME.ink at THEME.outline on every character, prop, platform, panel, and button. No outline-free elements mixed with outlined ones.
- One corner style: THEME.radius everywhere. No sharp corners mixed with rounded.
- One shadow: THEME.shadow, hard-edged and offset — same on world objects and menus. No blurred shadow on one and hard on the other.
- One hover: THEME.hover on buttons and on any world object the mouse can pick. No glow on one and a lift on the other.
- Character faces and UI icons share the same stroke weight.

## 5. Typography
- One font family (THEME.font). Three sizes only: title / body / small. No fourth size.
- Text always has the ink stroke behind it — score pops in the world and button labels in menus alike.
- If you load a web font, load it once and wait for it before the first draw so nothing pops from fallback to real.

## 6. Mouse tracking — one object, one mapping, one frame order
The mouse is state, not events. Handlers write `MOUSE`; `update()` and the kit read it. Nothing else touches a pointer event.

```js
const INPUT = { dragPx: 6, hideMs: 2000, lineWheel: 16 };   // the only input constants
const MOUSE = {
  x: -1, y: -1,     // logical canvas units; keeps the last known position while outside
  inside: false,    // pointer is over the canvas
  down: false,      // primary button held
  buttons: 0,       // raw e.buttons bitmask — right = 2, middle = 4
  press: null,      // {x, y} where the current primary press began
  release: null,    // {x, y} of a primary release this frame; cleared at end of frame
  drag: false,      // moved more than INPUT.dragPx since press
  wheel: 0,         // vertical wheel this frame in logical px; cleared at end of frame
  hot: null,        // id of the kit control under the pointer this frame
  movedAt: 0,       // performance.now() of the last move — drives cursor hiding
};
```

**Mapping.** `fit()` computes `VIEW = { scale, ox, oy }` from the letterbox, sizes the canvas, and sets the root transform so 1 unit = 1 logical px. `toLogical(e)` is the **only** function that reads `clientX` / `clientY` or calls `getBoundingClientRect()`:

```js
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - VIEW.ox) / VIEW.scale,
           y: (e.clientY - r.top  - VIEW.oy) / VIEW.scale };
}
```

**Events** — Pointer Events on the canvas, never `mouse*` or `touch*`:
- `pointerdown`: ignore non-primary pointers; `setPointerCapture` inside try/catch (a failed capture must never kill the gesture); write the position; if `e.button === 0` set `down`, `press`, and `drag = false`. The first one unlocks audio.
- `pointermove`: write position, `inside = true`, `buttons`, `movedAt`; set `drag` once the distance from `press` exceeds INPUT.dragPx. Do no game work here — moves can arrive several times per frame.
- `pointerup`: set `release` if `down`, then clear `down`. `pointercancel`: the same but no `release`, and clear `press`. Both go through one `endPointer(e, cancelled)`.
- `pointerleave`: `inside = false`, `hot = null`. The position keeps its last value so a followed object doesn't jump.
- `wheel` with `{ passive: true }`: accumulate into `MOUSE.wheel`, normalised to logical px by `deltaMode` (pixels ÷ VIEW.scale, lines × INPUT.lineWheel, pages × canvas height). Never `preventDefault` it.
- `contextmenu` on the canvas: `preventDefault`. The right button is a secondary action read from `MOUSE.buttons & 2`; it never opens a menu.
- `blur` / `visibilitychange`: release everything (`down = false`, `press = release = null`, `inside = false`) and pause. Nothing may stay stuck down while the window is away.
- CSS: `canvas { touch-action: none; user-select: none; }` so a touchscreen laptop's scroll gesture can't steal the pointer.

**Frame order** — the same every frame:
1. `fit()` if the window size changed; re-apply the root transform and clip to the logical rect so nothing draws on the bars.
2. `MOUSE.hot = null`.
3. `update(dt)` — the world reads `MOUSE.x/y`, `wheel`, `buttons`, `drag`. Objects that follow the pointer lerp toward it here; they never snap inside a handler.
4. `draw()` — kit calls read `MOUSE`, set `MOUSE.hot`, and return clicks.
5. `applyCursor()` — the **only** line that assigns `canvas.style.cursor`: dragging → THEME.cursor.drag; `hot` → THEME.cursor.hot; no movement for INPUT.hideMs while `playing` → THEME.cursor.hidden; otherwise THEME.cursor.idle.
6. Clear `MOUSE.wheel`; if `release` was set, clear `release` and `press`.

**Hit testing lives in the kit.** `drawButton` compares MOUSE to its own rect: `over` = pointer inside now; `armed` = `press` began inside; pressed = `armed && down && over`; clicked = `armed` and `release` inside. A press that began elsewhere never lights a button, and a press that drags out and releases elsewhere never fires. Screens never compare `MOUSE.x` to anything.

**The world speaks the same language.** A hovered pickable object gets `shade(color, THEME.hover.tint)` exactly as a button does, a drag is a drag only after INPUT.dragPx, and world clicks are resolved in `update()` from `press` / `release` the same way buttons resolve theirs.

**Debug readout.** `const DEBUG = false;` at the top of the file. When true, the HUD draws `MOUSE` (x, y, inside, down, drag, hot, wheel) with `drawLabel` at THEME.size.small. That is how you prove tracking works — on while you work, off before you say you're done.

## 7. Before you say you're done — consistency check
Run this every time you finish a change:
1. Search the file for `#`, `rgb(`, `hsl(` outside THEME and `shade()`. Any hit is a bug.
2. Search for `ctx.font =` outside `drawLabel`. Any hit is a bug.
3. Search for `clientX`, `offsetX`, `getBoundingClientRect` outside `toLogical`; `style.cursor` outside `applyCursor`; `addEventListener('mouse` or `addEventListener('touch` anywhere. Any hit is a bug.
4. Cycle `ready` → `playing` → `paused` → `dead` with the mouse. Confirm: same panel style, same button style, same texture, same outline weight, same font — and on every button: hover tints and lifts with the pointer cursor, press sinks, release inside fires once, press-drag-out-release fires nothing, leaving the canvas mid-press leaves nothing stuck.
5. Resize the window narrow, wide, and tiny, then go fullscreen: the letterbox holds and every button still hits where it is drawn. Blur the window while playing: it pauses.
6. Picture a menu panel sitting next to a world object: same material, same light, same line weight, same hover? If not, fix the kit, not the screen.
7. Report what you checked in one line.

## 8. When I change my mind
- "Undo that" = restore the exact previous THEME and texture generators. Keep the previous THEME in a comment block until I approve the new one.
- Restyles are diffs to THEME + `makeTexture`, nothing else. If you need more than that, tell me why in one sentence before doing it.
