"""Mouse and keyboard backends.

`PyAutoGuiController` is the real thing; `RecordingController` records calls
instead of performing them, which is what lets the whole agent loop be tested
on a machine with no display.
"""
from __future__ import annotations

import time

# Claude names keys with X11 keysyms (Return, Page_Down, super). pyautogui uses
# its own vocabulary. Anything not listed falls through unchanged, which covers
# plain letters, digits and the f1-f24 keys.
KEY_ALIASES = {
    "return": "enter", "kp_enter": "enter", "escape": "esc",
    "backspace": "backspace", "bksp": "backspace", "del": "delete",
    "prior": "pageup", "page_up": "pageup", "next": "pagedown", "page_down": "pagedown",
    "super": "win", "super_l": "win", "super_r": "win", "meta": "win",
    "cmd": "win", "command": "win", "windows": "win", "winleft": "winleft",
    "control": "ctrl", "control_l": "ctrl", "control_r": "ctrl",
    "alt_l": "alt", "alt_r": "alt", "altgr": "altright",
    "shift_l": "shift", "shift_r": "shift",
    "caps_lock": "capslock", "num_lock": "numlock", "scroll_lock": "scrolllock",
    "print": "printscreen", "sys_req": "printscreen", "snapshot": "printscreen",
    "linefeed": "enter", "kp_add": "add", "kp_subtract": "subtract",
    "kp_multiply": "multiply", "kp_divide": "divide", "kp_decimal": "decimal",
    "minus": "-", "plus": "+", "equal": "=", "slash": "/", "backslash": "\\",
    "bracketleft": "[", "bracketright": "]", "semicolon": ";", "colon": ":",
    "apostrophe": "'", "quotedbl": '"', "grave": "`", "asciitilde": "~",
    "comma": ",", "period": ".", "question": "?", "exclam": "!",
    "at": "@", "numbersign": "#", "dollar": "$", "percent": "%",
    "asciicircum": "^", "ampersand": "&", "asterisk": "*",
    "parenleft": "(", "parenright": ")", "underscore": "_",
    "less": "<", "greater": ">", "bar": "|", "braceleft": "{", "braceright": "}",
    "space": "space", "tab": "tab", "insert": "insert",
    "up": "up", "down": "down", "left": "left", "right": "right",
    "home": "home", "end": "end",
}

SCROLL_CLICK = 120  # one wheel notch, matching the Windows WHEEL_DELTA


def normalise_key(name: str) -> str:
    key = (name or "").strip()
    return KEY_ALIASES.get(key.lower(), key.lower() if len(key) > 1 else key)


def parse_combo(text: str) -> list[str]:
    """'ctrl+shift+Escape' -> ['ctrl', 'shift', 'esc'].

    A bare '+' (as in ctrl++) survives because we only split on separators that
    sit between two non-empty pieces.
    """
    raw = (text or "").strip()
    if not raw:
        return []
    parts, buffer = [], ""
    for char in raw:
        if char in "+-" and buffer:
            parts.append(buffer)
            buffer = ""
        elif char in "+-" and not buffer and parts:
            buffer = char  # e.g. the second '+' of "ctrl++"
        else:
            buffer += char
    if buffer:
        parts.append(buffer)
    if len(parts) == 1:
        return [normalise_key(parts[0])]
    return [normalise_key(p) for p in parts if p]


class Controller:
    """Interface the tool dispatcher talks to."""

    def move(self, x: int, y: int) -> None: raise NotImplementedError
    def click(self, button: str, clicks: int, x=None, y=None) -> None: raise NotImplementedError
    def mouse_down(self, button: str = "left") -> None: raise NotImplementedError
    def mouse_up(self, button: str = "left") -> None: raise NotImplementedError
    def drag(self, x0: int, y0: int, x1: int, y1: int) -> None: raise NotImplementedError
    def scroll(self, clicks: int, horizontal: bool = False) -> None: raise NotImplementedError
    def type_text(self, text: str) -> None: raise NotImplementedError
    def press(self, keys: list[str], repeat: int = 1) -> None: raise NotImplementedError
    def hold(self, keys: list[str], duration: float) -> None: raise NotImplementedError
    def key_down(self, key: str) -> None: raise NotImplementedError
    def key_up(self, key: str) -> None: raise NotImplementedError
    def position(self) -> tuple[int, int]: raise NotImplementedError


class PyAutoGuiController(Controller):
    def __init__(self, failsafe: bool = True, type_interval: float = 0.012):
        import pyautogui

        self._pg = pyautogui
        pyautogui.FAILSAFE = failsafe   # slam the mouse into a corner to abort
        pyautogui.PAUSE = 0             # we do our own pacing in the agent loop
        self._type_interval = type_interval

    def move(self, x, y): self._pg.moveTo(x, y)

    def click(self, button="left", clicks=1, x=None, y=None):
        if x is not None and y is not None:
            self._pg.moveTo(x, y)
        # Some apps ignore a synthetic double-click that arrives with zero gap.
        self._pg.click(button=button, clicks=clicks, interval=0.06 if clicks > 1 else 0.0)

    def mouse_down(self, button="left"): self._pg.mouseDown(button=button)
    def mouse_up(self, button="left"): self._pg.mouseUp(button=button)

    def drag(self, x0, y0, x1, y1):
        self._pg.moveTo(x0, y0)
        self._pg.mouseDown()
        # Windows drag-and-drop needs intermediate motion or the drop is dropped.
        self._pg.moveTo((x0 + x1) // 2, (y0 + y1) // 2, duration=0.12)
        self._pg.moveTo(x1, y1, duration=0.12)
        self._pg.mouseUp()

    def scroll(self, clicks, horizontal=False):
        if horizontal:
            self._pg.hscroll(clicks * SCROLL_CLICK)
        else:
            self._pg.scroll(clicks * SCROLL_CLICK)

    def type_text(self, text):
        # typewrite() drops characters outside the US layout; send those directly.
        ascii_run = ""
        for char in text:
            if char.isprintable() and ord(char) < 128:
                ascii_run += char
                continue
            if ascii_run:
                self._pg.typewrite(ascii_run, interval=self._type_interval)
                ascii_run = ""
            if char == "\n":
                self._pg.press("enter")
            elif char == "\t":
                self._pg.press("tab")
            else:
                self._pg.write(char)
        if ascii_run:
            self._pg.typewrite(ascii_run, interval=self._type_interval)

    def press(self, keys, repeat=1):
        for _ in range(max(1, repeat)):
            if len(keys) == 1:
                self._pg.press(keys[0])
            else:
                self._pg.hotkey(*keys)

    def hold(self, keys, duration):
        for key in keys:
            self._pg.keyDown(key)
        try:
            time.sleep(duration)
        finally:
            for key in reversed(keys):
                self._pg.keyUp(key)

    def key_down(self, key): self._pg.keyDown(key)
    def key_up(self, key): self._pg.keyUp(key)
    def position(self): return tuple(self._pg.position())


class RecordingController(Controller):
    """Records what would have happened. Used by the test suite and --dry-run."""

    def __init__(self, cursor=(0, 0)):
        self.calls: list[tuple] = []
        self._cursor = cursor

    def _record(self, *call): self.calls.append(call)

    def move(self, x, y): self._cursor = (x, y); self._record("move", x, y)
    def click(self, button="left", clicks=1, x=None, y=None):
        if x is not None: self._cursor = (x, y)
        self._record("click", button, clicks, *self._cursor)
    def mouse_down(self, button="left"): self._record("mouse_down", button)
    def mouse_up(self, button="left"): self._record("mouse_up", button)
    def drag(self, x0, y0, x1, y1): self._cursor = (x1, y1); self._record("drag", x0, y0, x1, y1)
    def scroll(self, clicks, horizontal=False): self._record("scroll", clicks, horizontal)
    def type_text(self, text): self._record("type", text)
    def press(self, keys, repeat=1): self._record("press", "+".join(keys), repeat)
    def hold(self, keys, duration): self._record("hold", "+".join(keys), duration)
    def key_down(self, key): self._record("key_down", key)
    def key_up(self, key): self._record("key_up", key)
    def position(self): return self._cursor
