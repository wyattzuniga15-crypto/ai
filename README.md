# Cube Roll

A single-file 3D block-rolling puzzle game. No build step, no dependencies, no
network calls — open one of the HTML files in any browser with WebGL2 and play.

| File | For |
| --- | --- |
| `CubeRoll.html` | Auto-detects: phone layout on a touch device, desktop layout otherwise |
| `CubeRoll.phone.html` | Always the phone layout |
| `CubeRoll.desktop.html` | Always the desktop layout |

**Open it in a real browser.** File previews inside chat apps, mail clients and
file managers usually render the HTML but block scripts, which leaves the menu
drawn and its buttons highlighting under a tap while nothing happens. The page
now says so rather than looking broken, but the cure is to open the file in
Safari or Chrome directly. `node tools/build.js out.html artifact` produces the
same game in Artifact page shape for hosting instead.

All three are built from the same source and play identically — only the
interface differs, so a save made in one carries over to the others.

Roll the block across floating islands and drop it **standing upright** into the
goal. A block lying down covers two tiles, and which two depends on how you got
there.

## What's in it

- **70 hand-checked islands** across seven chapters. Every one is verified
  solvable by a breadth-first search over the exact rules the game runs, and
  each level's par is its optimal move count.
- **A Daily Challenge and an Endless run** that forge brand-new islands in your
  browser from the same rules engine — proven solvable before you ever see them.
  The daily island is the same one for everybody; the endless run gets harder
  with every island you clear.
- **Eleven kinds of ground**, each with its own rule:

  | Tile | Rule |
  | --- | --- |
  | Floor | Safe in any position |
  | Glass | Shatters if the block stands upright on it |
  | Crumble | One use only — collapses the moment you roll off |
  | Ice | You keep sliding the same way until you leave it |
  | Pin | Holds the block upright, never lying down |
  | Portal | Throws you to its twin when you land upright |
  | Spring | Fires you three tiles on, straight over any gap |
  | Key / Gate | Red gates are thin air until you hold every key |
  | Switches | Round flips a bridge on contact; square needs your full weight |
  | Star / Star pad | Optional pickups; a pad needs you standing upright |

  Some levels also **seal the goal** until every star on the island is claimed.
- **22 missions** — long-running side quests (collect stars, clear levels
  hint-free, never fall, never break glass, ride springs, keep a daily streak,
  survive an endless run) tracked across the whole game.
- **32 skins** in four slots — cubes, tile sets, skies and particle trails —
  unlocked by collecting stars, earning ★★★ ratings and finishing missions.
- **A main menu** with Play, Levels, Challenge, Missions, Skins, Stats, How to
  play and Settings tabs, plus tutorial cards that explain each kind of ground
  the first time you meet it. Progress lives in `localStorage`.

## Phone

- **Swipe the island to roll.** One finger is the control: one swipe, one roll,
  fired the moment the direction is clear. There is no timing test, so a slow
  deliberate drag works exactly like a quick flick. Two fingers turn the view
  and pinch to zoom.
- Touches on the board are consumed by the game, so an app showing the page in
  a sheet cannot dismiss it on a downward swipe and a browser cannot pull to
  refresh. Fullscreen (the ⛶ button) puts it beyond the host's gestures
  entirely.
- Nothing sits on the board but a small thumb row (undo, restart, hint), which
  swaps sides for left-handed play. An on-screen d-pad is available in Settings
  for anyone who prefers one; it is off by default.
- In portrait the island turns a quarter turn so its long axis runs down the
  tall screen, and the view lifts clear of the controls.
- Haptics on rolls, falls and finds; safe-area insets for notches and home
  indicators; a lighter render budget (1024px shadows, capped pixel ratio).
- Add it to your home screen and it opens fullscreen with no browser chrome.

## Desktop

- Full keyboard control with a shortcut sheet on `?`.
- Drag to orbit, shift-drag to pan, scroll to zoom, double-click to recentre.
- A wider menu and a denser level grid; 2048px shadows and full pixel ratio.

## Controls

Arrows / WASD roll · swipe on touch · `Z` undo · `R` restart · `H` hint ·
`Esc` menu · `L` level select · `C` daily &amp; endless · `M` mute · `F` fullscreen ·
`?` shortcuts.

## Repository layout

- `CubeRoll.html` — the game. This is the only file you need to play.
- `tools/` — the level pipeline and the page builder. `rules.js` is the game
  core, byte-for-byte the same code the page runs; `gen.js` and `build_levels*.js` generate and validate
  levels against it; `part_forge.js` is the in-browser generator behind Daily and
  Endless; `build.js` assembles the page; `smoke.js` drives a headless browser
  that auto-solves all 70 levels plus a daily and three endless islands, and
  fails on any console error.

### Rebuilding

```sh
node tools/build_levels.js      # regenerate tools/newlevels.json  (slow)
node tools/build_levels2.js     # regenerate tools/newlevels2.json (slow)

node tools/build.js CubeRoll.html                    # auto-detecting
node tools/build.js CubeRoll.phone.html   phone
node tools/build.js CubeRoll.desktop.html desktop

node tools/smoke.js  CubeRoll.html                   # 70 islands + daily + endless
node tools/device.js CubeRoll.phone.html CubeRoll.desktop.html CubeRoll.html /tmp
```
