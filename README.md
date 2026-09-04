# Bean Baron

A single-file idle coffee-shop game, also in this repository: open
`BeanBaron.html` in a browser. It is a React app (React 18, Tailwind, lucide
icons, all pulled from jsDelivr at load, so it needs a network connection the
first time) with the whole game in one file.

- **A low-poly 3D café** in the style of the mobile idle-restaurant games,
  rendered with Three.js (loaded from jsDelivr): round-headed customers and
  chefs with real shadows, coin bursts when an order is served, a black
  coin bar, floating buttons over the room and white pop-up panels with blue
  cost buttons. If WebGL is unavailable the page falls back to a 2D canvas
  drawing of the same scene: customers walk in off the street,
  queue with an order bubble, get served by baristas who run to the drip
  machines and espresso bars on the back wall, sit at tables with their cup
  and leave; roasters turn, delivery vans drive the road, franchises light
  up across town, plantations fill the hills, and the empire grows a skyline.
  A day-night cycle runs every eight minutes. Tap anywhere on it to brew, or
  open the **Café** tab for the full-size view with a live order ticker.
- **Start on a coffee cart and move up.** Each premises caps how many of
  each machine fit and which tiers exist at all: cart → Corner Kiosk →
  Neighborhood Café → Grand Café → Coffee Palace, at $8K, $1M, $100M and
  $10B. Moving keeps your cash and resets everything else, and every bigger
  place sells each cup for more (×1.2 up to ×2.5). The scene redraws the
  actual building each time, "for lease" neighbours included.
- **Order tickets.** Customers put in tickets (two lattes and a croissant,
  say) that wait about 90 seconds. Stock the pantry in the Shop with beans,
  milk, cups, syrup and pastries, then fill the ticket for ingredients ×3
  plus six seconds of your income; a ticket can also buy its missing stock
  in one tap. Filling tickets in a row builds a streak up to ×2; a missed
  ticket resets it.
- **Staff.** Hire and promote five roles in the Shop: a Tapper who taps for
  you, an Order Runner who hands over any ticket the pantry covers, a Stock
  Clerk who keeps the pantry topped up, a Greeter who catches golden beans,
  and a Shift Manager who adds income. Each one gets a figure with a job in
  the café. Food critics drop in with tickets that pay triple and, if served
  in time, a rave review that doubles income for 45 seconds.
- **Premises.** You start on a coffee cart. Each size caps how many of each
  machine fit and which tiers exist; moving up costs money, keeps your
  money, and resets machines, pantry and upgrades.
- **Sound.** A procedural lo-fi café loop (four chords, lazy bass, wandering
  melody, brushed hats) starts on your first tap and picks up the tempo
  during a rush; a bell rings when a ticket arrives. Music and effects each
  have a toggle in the header.
- Tap the café to brew (space bar works too). Buy eight tiers of generators,
  from Drip Machine to Coffee Empire, each `1.15×` dearer per unit and
  doubling in output at 10, 25, 50 and 100 owned.
- Cash upgrades: a ladder of ever-better beans (`×1.5` all income), tap
  multipliers, per-machine gear, and Night Shift for better offline earnings.
- **Golden beans** roll onto the screen every few minutes. Catch one for a
  rush (`×5` income for 25 s), a tap frenzy (`×12` per tap for 15 s) or a
  big tip.
- **43 achievements**, each worth +1% income for good, from "First Drip
  Machine" to "Money Printer".
- **Sell the Chain** once you have earned $1T all-time for Roast Points,
  `floor(√(lifetime ÷ 1e12))` in total, each worth +2% on every cup forever.
  Points also buy eight permanent **perks** (head starts, longer rushes,
  extra milestones, upgrades that survive the reset) without shrinking the
  bonus.
- Away for more than 30 seconds (hidden tab, or a loaded save) pays out at 50%
  of your rate for up to 4 hours. Saves live in memory only; **Stats → Copy
  save code** carries a game across reloads or devices.

**Play it as a site.** The repository is ready for GitHub Pages: enable it
once under *Settings → Pages → Build and deployment → Deploy from a branch*,
pick this branch and the root folder, and the game is at
`https://wyattzuniga15-crypto.github.io/ai/`. On an iPhone open that in
Safari and use *Share → Add to Home Screen*: it launches full-screen with its
own bean icon and keeps working offline (`manifest.json`, `sw.js`,
`icons/`, regenerated with `node tools/beanbaron_icons.js`).

`node tools/beanbaron_sim.js 70` plays a greedy bot against the exact economy
block in the page and prints when each tier and upgrade is bought and when the
first prestige unlocks (about 39 minutes for a bot that catches most golden
beans, 48 for one that ignores them, so 45–60 for a person).
`node tools/beanbaron_artifact.js out.html` produces the Artifact page shape.

---

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
