# Pilot

A desktop agent for Windows. You type what you want in plain English — *"open
Spotify"*, *"launch Bonelab"*, *"open Chrome and go to YouTube"* — and Claude
looks at your screen and works your mouse and keyboard until it's done.

```
pilot> open notepad and type hello

  screen: 2560x1440 captured, sent as 1280x720 (scale 2.00x)
  ~ The desktop is visible. launch_app is more reliable than hunting for an icon.
  I'll open Notepad.
  > launch_app(name='notepad')
  Notepad is open and the cursor is already in the text area.
  > left click at (640, 360)
  > type 'hello'
  > screenshot
  Done — Notepad has "hello" in it.

  done in 3 steps
  12,418 in / 341 out (cache hit 9,204) ~ $0.0073
```

**Press F12 at any time and everything stops immediately.**

---

## Setup

**1. Install Python 3.11 or newer.** Get it from
[python.org/downloads](https://www.python.org/downloads/). On the first
installer screen, tick **"Add python.exe to PATH"** — otherwise the commands
below won't be found.

Check it worked, in PowerShell or Command Prompt:

```powershell
python --version
```

**2. Install the dependencies.**

```powershell
cd path\to\pilot
pip install -r requirements.txt
```

**3. Add your API key.** Copy `.env.example` to `.env` and paste in a key from
[console.anthropic.com](https://console.anthropic.com/settings/keys):

```powershell
copy .env.example .env
notepad .env
```

```ini
ANTHROPIC_API_KEY=sk-ant-...
```

The key is only ever read from `.env`, which is git-ignored.

**4. Check your screen coordinates line up** — do this before anything else:

```powershell
python test_scaling.py
```

Your mouse should jump to the exact centre of the screen and the script should
print `PASS`. If it doesn't, see [Troubleshooting](#troubleshooting); every
click the agent makes depends on this being right.

**5. Run it.**

```powershell
python main.py                          # interactive prompt
python main.py "open chrome and go to youtube"   # one task, then exit
python main.py --gui                    # small always-on-top window
```

---

## Using it

At the `pilot>` prompt, type a task. A few commands start with `/`:

| Command | Does |
| --- | --- |
| `/apps` | List apps Pilot can launch directly |
| `/cost` | Total spend this session |
| `/model claude-opus-5` | Switch model mid-session |
| `/steps 60` | Change the step limit |
| `/quit` | Exit |

Useful flags:

| Flag | Does |
| --- | --- |
| `--gui` | Always-on-top window with a Stop button |
| `--dry-run` | Log every action without touching the mouse or keyboard |
| `--yolo` | Skip confirmation prompts (hard blocks still apply) |
| `--model`, `--max-steps`, `--delay` | Override `.env` for one run |

### Teaching it your apps

`apps.json` maps names to paths or protocol URIs. This is the difference
between "find the Steam window, search the library, click the game" and one
instant launch:

```json
{
  "bonelab": "steam://rungameid/1592190",
  "spotify": "spotify:",
  "obsidian": "C:\\Users\\you\\AppData\\Local\\Obsidian\\Obsidian.exe",
  "work email": "https://outlook.office.com"
}
```

Names match loosely, so `"launch bonelab"` finds the `bonelab` entry. If a name
isn't in the file, Pilot searches your Start Menu, and only if *that* misses
does it fall back to the Windows search box.

To find a Steam game's ID: right-click it in Steam → Properties → Updates, or
read it off the store URL.

---

## Safety

This thing controls your actual computer, so the guardrails are not optional.

- **F12 stops everything**, instantly, from any window. Configurable via
  `PILOT_KILL_KEY`. In the GUI, Stop and Escape do the same.
- **Mouse failsafe** — slam the pointer into the top-left corner to abort.
- **Confirmation prompts.** Anything that looks like it sends, posts, buys,
  submits, or deletes pauses for a y/n in the terminal. The check reads three
  things: the action, your task wording, and the sentence Claude wrote just
  before acting — so "I'll click Send now" triggers a prompt even though a
  click is normally harmless.
- **Hard blocks.** Card numbers, API keys, SSNs and private keys are never
  typed, and there's no prompt to override it — a y/n question about typing
  your password is already a failure. If a task needs a login, Pilot stops and
  asks you to sign in yourself.
- **A visible pace.** `PILOT_ACTION_DELAY` (default 0.3s) spaces out actions so
  you can watch and react.
- **Everything is logged** to `logs/session_<date>.txt` with timestamps.

Set `PILOT_CONFIRM_EVERY_ACTION=yes` to be asked about every single action while
you're getting a feel for it.

Two things worth knowing: this is a general-purpose agent looking at whatever is
on your screen, so don't leave sensitive windows open behind it, and the
confirmation heuristics are a safety net, not a guarantee — watch what it does.

---

## Configuration

Everything lives in `.env`:

| Setting | Default | What it does |
| --- | --- | --- |
| `PILOT_MODEL` | `claude-sonnet-5` | `claude-opus-5` is smarter and ~2.5x the price |
| `PILOT_EFFORT` | `high` | `low`/`medium`/`high`/`xhigh`/`max` — how hard it thinks per step |
| `PILOT_THINKING` | `adaptive` | `off` to hide reasoning and save a little |
| `PILOT_MAX_STEPS` | `40` | Hard stop, so a confused run can't go forever |
| `PILOT_ACTION_DELAY` | `0.3` | Seconds between actions |
| `PILOT_SCREENSHOTS_IN_CONTEXT` | `3` | Older screenshots are dropped from history |
| `PILOT_MAX_WIDTH` / `HEIGHT` | `1280` / `800` | Screenshot size sent to the model |
| `PILOT_MONITOR` | `1` | `1` = primary, `0` = all monitors as one image, `2` = second |
| `PILOT_KILL_KEY` | `f12` | Global stop key |
| `PILOT_CONFIRM_RISKY` | `yes` | The confirmation gate |
| `PILOT_CONFIRM_EVERY_ACTION` | `no` | Ask before literally everything |

---

## How it works

```
main.py        CLI, REPL, wiring            ui.py        Tkinter window
agent.py       the loop, retries, cost      tools.py     tool schemas + dispatch
screen.py      capture, DPI, scaling        controller.py  mouse/keyboard backends
config.py      .env, apps.json, pricing     safety.py    kill switch, risk gate, logging
```

Each step: screenshot → downscale → send with the task → Claude returns actions →
execute them in order → send back results and a fresh screenshot → repeat until
it says it's finished or hits the step limit.

**The coordinate problem** is the part most likely to go subtly wrong, so it's
worth explaining. Claude sees a downscaled screenshot (1280×800 by default) and
gives coordinates in *that* image's pixel space. Your screen might be 2560×1440.
Windows adds a second layer: at 150% display scaling, an app that hasn't
declared DPI awareness is told the screen is 1707×960 while the real framebuffer
is 2560×1440, so screenshots and clicks disagree and every click lands short.

Pilot calls `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` before
anything touches the display, which puts capture and clicks in the same physical
pixel space. From there, `screen.Frame` maps between the two, sampling the
*centre* of each screenshot pixel rather than its corner — on a 2× downscale
that's the difference between clicking the edge of a small button and clicking
its middle. Multi-monitor origins (a second display left of the primary has
negative coordinates) are handled by the same maths.

**The API.** Pilot uses the `computer_toolset_20260801` client toolset — the
current stable computer-use tool, which needs no beta header and supports
Sonnet 5 and Opus 5. Unlike the older `computer_20250124`, it takes no display
dimensions at all; coordinates are defined purely by the screenshots you send,
which is exactly why the scaling above has to be right. `launch_app` and
`open_url` are custom tools alongside it.

**Cost control.** Tool definitions and the system prompt are cached across
steps, old screenshots are dropped from history, and the running token count and
dollar estimate print after every step. A simple task is typically a cent or
two on Sonnet 5.

---

## Testing

```powershell
python tests\run_all.py     # 39 tests, no display or API key needed
python test_scaling.py      # real screen check, moves your mouse
```

The suite runs the real agent loop against a fake screen, a recording
controller, and scripted API responses, so coordinate scaling, batch
stop-on-first-failure, the safety gate, history trimming and the kill switch are
all exercised without touching your desktop or spending anything.

CI runs this on every change under `pilot/`: the headless suite on Linux, plus a
Windows job that installs the real dependency set, imports every module, and
checks DPI awareness actually applies — the half that cannot be checked on
Linux.

---

## Troubleshooting

**Clicks land off-target, consistently short.** DPI awareness didn't apply.
Run `python test_scaling.py` — if the drift is proportional (about 1.25×, 1.5×
or 2×), check that Python has no per-app DPI compatibility override
(right-click `python.exe` → Properties → Compatibility → Change high DPI
settings) and that you're launching via `main.py`, which sets awareness before
anything else loads.

**Wrong monitor.** Set `PILOT_MONITOR=2` for the second display, or `0` to give
Claude every monitor as one wide image.

**F12 does nothing.** `pynput` may be missing (`pip install pynput`) or blocked
by another app grabbing the key. Ctrl-C and the corner failsafe still work.

**It can't find an app.** Add it to `apps.json` with its full path or URI.

**It clicks the wrong thing in a game.** Fullscreen exclusive games often can't
be captured or clicked by synthetic input. Switch the game to borderless
windowed mode.

**"ANTHROPIC_API_KEY is not set".** `.env` must be next to `main.py` and contain
`ANTHROPIC_API_KEY=sk-ant-...` with no quotes.

**Rate limits or overloaded errors** are retried automatically with backoff, up
to five attempts.
