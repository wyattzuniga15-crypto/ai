"""Tool definitions and the dispatcher that executes them.

Two families of tool are declared to the API:

  * the Anthropic computer-use toolset (`computer_toolset_20260801`), a client
    toolset whose 17 member tools we execute here. Its results must echo
    `toolset_name: "computer"`.
  * two custom tools, `launch_app` and `open_url`, which exist so that Claude
    can skip the whole look-at-the-desktop-and-hunt-for-an-icon dance for the
    single most common request: open something.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import webbrowser
from difflib import SequenceMatcher
from pathlib import Path

import screen as screen_mod
from config import COMPUTER_TOOLSET
from controller import parse_combo

MOUSE_BUTTONS = {
    "left_click": ("left", 1), "right_click": ("right", 1), "middle_click": ("middle", 1),
    "double_click": ("left", 2), "triple_click": ("left", 3),
}
IMAGE_MEMBERS = {"screenshot", "zoom"}

LAUNCH_APP_TOOL = {
    "name": "launch_app",
    "description": (
        "Launch a Windows application by name. Checks the user's apps.json registry first "
        "(which maps names to executable paths or protocol URIs such as steam://rungameid/...), "
        "then the Start Menu, then falls back to the Windows search box. "
        "Prefer this over clicking around the desktop or taskbar to open something. "
        "Returns text describing what was launched; take a screenshot afterwards to confirm "
        "the window actually appeared, since some apps take several seconds to show up."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "App name as a person would say it, e.g. 'spotify', 'bonelab', 'chrome', 'notepad'.",
            }
        },
        "required": ["name"],
        "additionalProperties": False,
    },
}

OPEN_URL_TOOL = {
    "name": "open_url",
    "description": (
        "Open an http:// or https:// URL in the default browser. Prefer this over typing "
        "into the address bar. Take a screenshot afterwards to see what loaded."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"url": {"type": "string", "description": "Full URL including the scheme."}},
        "required": ["url"],
        "additionalProperties": False,
    },
}


def tool_definitions() -> list[dict]:
    return [{"type": COMPUTER_TOOLSET}, LAUNCH_APP_TOOL, OPEN_URL_TOOL]


class SystemOpener:
    """Starts apps and URLs. Isolated so tests can substitute a recorder."""

    def start(self, target: str) -> None:
        if sys.platform == "win32":
            os.startfile(target)  # noqa: S606 - the point of this class
            return
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        if shutil.which(opener) is None:
            raise OSError(f"no handler available to open {target!r} on {sys.platform}")
        subprocess.Popen([opener, target], start_new_session=True)

    def browse(self, url: str) -> None:
        webbrowser.open(url)


class RecordingOpener:
    """Used by --dry-run and the tests: records instead of launching."""

    def __init__(self):
        self.started: list[str] = []
        self.browsed: list[str] = []

    def start(self, target): self.started.append(target)
    def browse(self, url): self.browsed.append(url)


def start_menu_entries() -> dict[str, Path]:
    """Every .lnk under the user and machine Start Menus, keyed by lowercase name."""
    entries: dict[str, Path] = {}
    roots = [
        Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
        Path(os.environ.get("PROGRAMDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
    ]
    for root in roots:
        try:
            if not root.is_dir():
                continue
            for link in root.rglob("*.lnk"):
                entries.setdefault(link.stem.lower(), link)
        except OSError:
            continue
    return entries


def best_match(name: str, candidates: dict[str, Path], threshold: float = 0.72):
    """Fuzzy-match an app name against Start Menu entries.

    Exact, then whole-word, then substring, then similarity -- and within each
    tier the shortest entry wins. That ordering is what makes 'chrome' resolve
    to 'Google Chrome' rather than 'Chrome Remote Desktop': both contain the
    word, and the shorter name is the one a person means.
    """
    target = name.strip().lower()
    if not target or not candidates:
        return None
    if target in candidates:
        return candidates[target]
    word = re.compile(rf"\b{re.escape(target)}\b")
    for keys in ([k for k in candidates if word.search(k)],
                 [k for k in candidates if target in k]):
        if keys:
            return candidates[min(keys, key=lambda k: (len(k), k))]
    score, key = max((SequenceMatcher(None, target, k).ratio(), k) for k in candidates)
    return candidates[key] if score >= threshold else None


def looks_like_uri(target: str) -> bool:
    """True for 'steam://rungameid/1592190' and bare 'spotify:' style handlers."""
    head = target.split(":", 1)[0]
    return ":" in target and head.isalnum() and len(head) > 1 and not target[1:2] == ":"


class ToolRunner:
    def __init__(self, settings, screen_source, controller, risk, approver, log,
                 opener=None, apps=None):
        self.settings = settings
        self.screen = screen_source
        self.controller = controller
        self.risk = risk
        self.approver = approver
        self.log = log
        self.opener = opener or SystemOpener()
        self.apps = apps if apps is not None else {}
        self.frame: screen_mod.Frame | None = None
        self.on_event = None  # optional callback(kind, message) for the UI
        # Replaced by the agent with the kill switch's interruptible sleep, so
        # that F12 lands during a 30-second `wait` instead of after it.
        self.sleep = time.sleep

    # -- helpers ------------------------------------------------------------

    def _emit(self, kind: str, message: str) -> None:
        self.log.write(kind, message)
        if self.on_event:
            self.on_event(kind, message)

    def _require_frame(self) -> screen_mod.Frame:
        if self.frame is None:
            self.capture()  # establishes the coordinate space
        return self.frame

    def _point(self, coordinate) -> tuple[int, int]:
        frame = self._require_frame()
        if not coordinate or len(coordinate) != 2:
            return self.controller.position()
        return frame.to_desktop(float(coordinate[0]), float(coordinate[1]))

    def capture(self) -> bytes:
        png, frame = self.screen.capture()
        self.frame = frame
        return png

    def describe_screen(self) -> str:
        frame = self._require_frame()
        return (f"{frame.capture_width}x{frame.capture_height} captured, "
                f"sent as {frame.shot_width}x{frame.shot_height} "
                f"(scale {frame.scale_x:.2f}x)")

    # -- custom tools -------------------------------------------------------

    def launch_app(self, name: str) -> str:
        wanted = (name or "").strip()
        if not wanted:
            return "No app name given."
        key = wanted.lower()

        target = self.apps.get(key)
        if target is None:  # allow 'google chrome' to hit a 'chrome' entry
            for alias, value in self.apps.items():
                if alias in key or key in alias:
                    target = value
                    break

        if target:
            try:
                self.opener.start(target)
            except OSError as exc:
                return f"apps.json maps {wanted!r} to {target!r} but launching it failed: {exc}"
            self._emit("launch", f"{wanted} -> {target} (apps.json)")
            kind = "protocol handler" if looks_like_uri(target) else "path"
            return (f"Launched {wanted!r} via the apps.json {kind} {target}. "
                    "Take a screenshot to confirm it opened; games and large apps can take 10-30s, "
                    "so use wait before concluding it failed.")

        if sys.platform == "win32":
            match = best_match(wanted, start_menu_entries())
            if match is not None:
                try:
                    self.opener.start(str(match))
                except OSError as exc:
                    return f"Found Start Menu entry {match.stem!r} but launching it failed: {exc}"
                self._emit("launch", f"{wanted} -> {match} (start menu)")
                return (f"Launched {match.stem!r} from the Start Menu. "
                        "Take a screenshot to confirm it opened.")

            # Last resort: drive the Windows search box. Slower and less certain
            # than the paths above, which is exactly why it is last.
            self.controller.press(["win"])
            self.sleep(0.6)  # the search box needs a moment before it takes input
            self.controller.type_text(wanted)
            self._emit("launch", f"{wanted} -> Windows search fallback")
            return (f"No apps.json or Start Menu entry for {wanted!r}. Opened Windows search and typed "
                    f"{wanted!r}. Take a screenshot to see the results, then press Return if the top "
                    "hit is correct, or click the right one.")

        return (f"No apps.json entry for {wanted!r}, and Start Menu lookup only works on Windows "
                f"(running on {sys.platform}). Add it to apps.json to launch it directly.")

    def open_url(self, url: str) -> str:
        target = (url or "").strip()
        if not target:
            return "No URL given."
        if "://" not in target:
            target = "https://" + target
        scheme = target.split("://", 1)[0].lower()
        if scheme not in {"http", "https"}:
            return f"Refusing to open a {scheme!r} URL; open_url only handles http and https."
        self.opener.browse(target)
        self._emit("open_url", target)
        return f"Opened {target} in the default browser. Take a screenshot to see what loaded."

    # -- computer toolset ---------------------------------------------------

    def _summarise(self, name: str, payload: dict) -> str:
        if name == "type":
            text = str(payload.get("text", ""))
            shown = text if len(text) <= 60 else text[:57] + "..."
            return f"type {shown!r}"
        if name == "key":
            return f"press {payload.get('text')}"
        if name in MOUSE_BUTTONS:
            coordinate = payload.get("coordinate")
            where = f" at {tuple(coordinate)}" if coordinate else " at the cursor"
            return f"{name.replace('_', ' ')}{where}"
        if name == "scroll":
            return f"scroll {payload.get('scroll_direction')} x{payload.get('scroll_amount')}"
        if name == "left_click_drag":
            return f"drag {payload.get('start_coordinate')} -> {payload.get('coordinate')}"
        if name == "wait":
            return f"wait {payload.get('duration')}s"
        if name == "zoom":
            return f"zoom into {payload.get('region')}"
        return name.replace("_", " ")

    def execute_member(self, name: str, payload: dict):
        """Run one computer-toolset member. Returns API `content` for the result."""
        controller = self.controller

        if name == "screenshot":
            return [screen_mod.image_block(self.capture())]

        if name == "zoom":
            region = payload.get("region")
            if not region or len(region) != 4:
                raise ValueError("zoom needs region [x0, y0, x1, y1]")
            self._require_frame()
            png, frame = self.screen.zoom(region, self.settings.max_width, self.settings.max_height)
            self.frame = frame  # full-frame geometry is unchanged by a zoom
            return [screen_mod.image_block(png)]

        if name in MOUSE_BUTTONS:
            button, clicks = MOUSE_BUTTONS[name]
            x, y = self._point(payload.get("coordinate"))
            modifiers = parse_combo(payload.get("text", "")) if payload.get("text") else []
            for key in modifiers:
                controller.key_down(key)
            try:
                controller.click(button=button, clicks=clicks, x=x, y=y)
            finally:
                for key in reversed(modifiers):
                    controller.key_up(key)
            return f"{name} at ({x}, {y})" + (f" with {'+'.join(modifiers)}" if modifiers else "")

        if name == "mouse_move":
            x, y = self._point(payload.get("coordinate"))
            controller.move(x, y)
            return f"moved to ({x}, {y})"

        if name == "left_mouse_down":
            controller.mouse_down("left")
            return "left button down"

        if name == "left_mouse_up":
            controller.mouse_up("left")
            return "left button up"

        if name == "left_click_drag":
            start = payload.get("start_coordinate")
            end = payload.get("coordinate")
            if not start or not end:
                raise ValueError("left_click_drag needs start_coordinate and coordinate")
            x0, y0 = self._point(start)
            x1, y1 = self._point(end)
            modifiers = parse_combo(payload.get("text", "")) if payload.get("text") else []
            for key in modifiers:
                controller.key_down(key)
            try:
                controller.drag(x0, y0, x1, y1)
            finally:
                for key in reversed(modifiers):
                    controller.key_up(key)
            return f"dragged ({x0}, {y0}) -> ({x1}, {y1})"

        if name == "cursor_position":
            frame = self._require_frame()
            x, y = frame.to_shot(*controller.position())
            return f"X={x},Y={y}"

        if name == "scroll":
            direction = str(payload.get("scroll_direction", "down")).lower()
            amount = int(payload.get("scroll_amount", 3))
            coordinate = payload.get("coordinate")
            if coordinate:
                controller.move(*self._point(coordinate))
            modifiers = parse_combo(payload.get("text", "")) if payload.get("text") else []
            for key in modifiers:
                controller.key_down(key)
            try:
                if direction in {"up", "down"}:
                    controller.scroll(amount if direction == "up" else -amount)
                elif direction in {"left", "right"}:
                    controller.scroll(-amount if direction == "left" else amount, horizontal=True)
                else:
                    raise ValueError(f"unknown scroll direction {direction!r}")
            finally:
                for key in reversed(modifiers):
                    controller.key_up(key)
            return f"scrolled {direction} by {amount}"

        if name == "type":
            controller.type_text(str(payload.get("text", "")))
            return "typed"

        if name == "key":
            keys = parse_combo(str(payload.get("text", "")))
            if not keys:
                raise ValueError("key needs text")
            repeat = int(payload.get("repeat", 1) or 1)
            controller.press(keys, repeat=max(1, min(100, repeat)))
            return f"pressed {'+'.join(keys)}" + (f" x{repeat}" if repeat > 1 else "")

        if name == "hold_key":
            keys = parse_combo(str(payload.get("text", "")))
            duration = min(float(payload.get("duration", 1)), 300.0)
            controller.hold(keys, duration)
            return f"held {'+'.join(keys)} for {duration}s"

        if name == "wait":
            duration = min(float(payload.get("duration", 1)), 300.0)
            self.sleep(duration)
            return f"waited {duration}s"

        raise ValueError(f"unsupported computer tool {name!r}")
