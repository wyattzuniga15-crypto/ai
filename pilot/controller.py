"""Mouse and keyboard backends.

`PyAutoGuiController` is the real thing; `RecordingController` records calls
instead of performing them, which is what lets the whole agent loop be tested
on a machine with no display.
"""
from __future__ import annotations

import ctypes
import struct
import sys
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

TYPE_CHUNK = 20            # characters per typewrite call, so F12 can land between
WHEEL_DELTA = 120          # Windows measures wheel movement in these units
MOUSEEVENTF_HWHEEL = 0x01000
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

# SendInput's INPUT struct. Two things matter here and both are easy to get
# wrong. The union has to carry MOUSEINPUT even though we only fill in the
# keyboard member, because MOUSEINPUT is the largest member and SendInput
# rejects any cbSize that isn't exactly sizeof(INPUT). And the fields use
# fixed-width types rather than c_ulong/c_long: Windows DWORD is always 32
# bits, but ctypes.c_ulong is 64 bits on Linux, which would silently inflate
# the struct to 56 bytes and make the call fail. Spelling the widths out keeps
# the layout identical everywhere, so INPUT_SIZE_X64 can be asserted in a test
# that runs on any platform.
_ULONG_PTR = ctypes.c_uint64 if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_uint32
INPUT_SIZE_X64 = 40


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = (("dx", ctypes.c_int32), ("dy", ctypes.c_int32),
                ("mouseData", ctypes.c_uint32), ("dwFlags", ctypes.c_uint32),
                ("time", ctypes.c_uint32), ("dwExtraInfo", _ULONG_PTR))


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = (("wVk", ctypes.c_uint16), ("wScan", ctypes.c_uint16),
                ("dwFlags", ctypes.c_uint32), ("time", ctypes.c_uint32),
                ("dwExtraInfo", _ULONG_PTR))


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = (("uMsg", ctypes.c_uint32), ("wParamL", ctypes.c_uint16),
                ("wParamH", ctypes.c_uint16))


class _INPUTUNION(ctypes.Union):
    _fields_ = (("mi", _MOUSEINPUT), ("ki", _KEYBDINPUT), ("hi", _HARDWAREINPUT))


class _INPUT(ctypes.Structure):
    _fields_ = (("type", ctypes.c_uint32), ("union", _INPUTUNION))


def utf16_units(char: str) -> list[int]:
    """UTF-16 code units for one character, as surrogate pairs where needed.

    Unicode key events carry 16-bit scan codes, so anything above the BMP
    (emoji, mostly) has to go out as two events.
    """
    encoded = char.encode("utf-16-le")
    return list(struct.unpack(f"<{len(encoded) // 2}H", encoded))


def unicode_key_events(text: str) -> list:
    """Build press+release INPUT records that type `text` regardless of layout."""
    events = []
    for char in text:
        for unit in utf16_units(char):
            for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
                record = _INPUT(type=INPUT_KEYBOARD)
                record.union.ki = _KEYBDINPUT(wVk=0, wScan=unit, dwFlags=flags,
                                              time=0, dwExtraInfo=0)
                events.append(record)
    return events


def send_hwheel(amount: int) -> None:
    """Send a real horizontal wheel event on Windows.

    Separate from the controller so it can be stubbed in tests, and because
    pyautogui has no working equivalent: its Windows _hscroll just calls
    _scroll, which sends MOUSEEVENTF_WHEEL, so "scroll right" scrolls down.
    """
    if sys.platform != "win32":
        raise OSError("horizontal wheel events are Windows-only here")
    ctypes.windll.user32.mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, int(amount), 0)


def send_unicode(text: str) -> int:
    """Type `text` on Windows via SendInput. Returns the events injected.

    This exists because pyautogui cannot type these characters at all:
    write() presses one named key per character, and anything outside its
    194-entry KEYBOARD_KEYS table is dropped without an error -- so "cafe"
    with an accent arrives as "caf". Unicode scan codes bypass the keyboard
    layout entirely and cover em dashes, curly quotes, accents and CJK alike.
    """
    if sys.platform != "win32":
        raise OSError("unicode key injection is Windows-only")
    events = unicode_key_events(text)
    if not events:
        return 0
    user32 = ctypes.windll.user32
    user32.SendInput.argtypes = (ctypes.c_uint, ctypes.POINTER(_INPUT), ctypes.c_int)
    user32.SendInput.restype = ctypes.c_uint
    array = (_INPUT * len(events))(*events)
    sent = user32.SendInput(len(events), array, ctypes.sizeof(_INPUT))
    if sent != len(events):
        raise OSError(f"SendInput sent {sent} of {len(events)} events "
                      f"(error {ctypes.get_last_error()})")
    return sent


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
    """Interface the tool dispatcher talks to.

    `sleep` is replaced by the agent with the kill switch's interruptible
    wait. Without that, a long hold or a long line of typing is a single
    blocking call, and F12 does nothing until it finishes -- hold_key alone
    can be asked for 300 seconds.
    """

    sleep = staticmethod(time.sleep)

    def move(self, x: int, y: int) -> None: raise NotImplementedError
    def click(self, button: str, clicks: int, x=None, y=None) -> None: raise NotImplementedError
    def mouse_down(self, button: str = "left") -> None: raise NotImplementedError
    def mouse_up(self, button: str = "left") -> None: raise NotImplementedError
    def drag(self, x0: int, y0: int, x1: int, y1: int) -> None: raise NotImplementedError
    def scroll(self, notches: int, horizontal: bool = False) -> None: raise NotImplementedError
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
        self._windows = sys.platform == "win32"
        self._keys = set(getattr(pyautogui, "KEYBOARD_KEYS", ()))

    # -- coordinates --------------------------------------------------------

    def _safe_point(self, x: int, y: int) -> tuple[int, int]:
        """Nudge off a failsafe corner so a real click there isn't an abort.

        FAILSAFE_POINTS is every corner of the screen, not just the origin, so
        without this a legitimate click on a corner pixel -- the Show Desktop
        sliver, a maximised window's close button, the Start button on some
        layouts -- raises FailSafeException and kills the run. One pixel inward
        hits the same control; nothing on a desktop is one pixel wide.
        """
        if not self._pg.FAILSAFE:
            return x, y
        for corner_x, corner_y in getattr(self._pg, "FAILSAFE_POINTS", ()):
            if x == corner_x and y == corner_y:
                width, height = self._pg.size()
                return (x + 1 if x <= 0 else min(x - 1, width - 2),
                        y + 1 if y <= 0 else min(y - 1, height - 2))
        return x, y

    def move(self, x, y):
        self._pg.moveTo(*self._safe_point(x, y))

    def click(self, button="left", clicks=1, x=None, y=None):
        if x is not None and y is not None:
            self._pg.moveTo(*self._safe_point(x, y))
        # Some apps ignore a synthetic double-click that arrives with zero gap.
        self._pg.click(button=button, clicks=clicks, interval=0.06 if clicks > 1 else 0.0)

    def mouse_down(self, button="left"): self._pg.mouseDown(button=button)
    def mouse_up(self, button="left"): self._pg.mouseUp(button=button)

    def drag(self, x0, y0, x1, y1):
        x0, y0 = self._safe_point(x0, y0)
        x1, y1 = self._safe_point(x1, y1)
        self._pg.moveTo(x0, y0)
        self._pg.mouseDown()
        # Windows drag-and-drop needs intermediate motion or the drop is dropped.
        self._pg.moveTo((x0 + x1) // 2, (y0 + y1) // 2, duration=0.12)
        self._pg.moveTo(x1, y1, duration=0.12)
        self._pg.mouseUp()

    # -- wheel -------------------------------------------------------------

    def scroll(self, notches, horizontal=False):
        """Scroll by whole wheel notches; positive is up, or right.

        Two pyautogui quirks are handled here. Its Windows _scroll passes the
        argument straight through as mouse_event's dwData, which Windows counts
        in WHEEL_DELTA units, so one notch is 120 and pyautogui.scroll(1) moves
        1/120th of a notch. And its Windows _hscroll just calls _scroll, which
        sends MOUSEEVENTF_WHEEL -- asking it to scroll right scrolls *down*
        instead -- so the horizontal wheel event is sent directly.
        """
        if not self._windows:
            # X11 and macOS count notches directly, one wheel event each.
            (self._pg.hscroll if horizontal else self._pg.scroll)(notches)
            return
        amount = int(notches) * WHEEL_DELTA
        if horizontal:
            send_hwheel(amount)
        else:
            self._pg.scroll(amount)

    # -- keyboard -----------------------------------------------------------

    def type_text(self, text):
        """Type text, including characters pyautogui would silently drop.

        pyautogui presses one named key per character, so anything outside its
        KEYBOARD_KEYS table -- em dashes, curly quotes, accents, CJK, emoji --
        vanishes with no error. Those runs go through unicode key injection
        instead. ASCII stays on pyautogui, which sends real scan codes and so
        keeps working in apps and games that ignore injected characters.
        """
        pending_ascii = ""
        pending_unicode = ""

        def flush_ascii():
            nonlocal pending_ascii
            if not pending_ascii:
                return
            # One typewrite call for a long string would ignore the kill
            # switch until the whole string was typed, so send it in chunks
            # and let the stop check run between them.
            for start in range(0, len(pending_ascii), TYPE_CHUNK):
                self.sleep(0)
                self._pg.typewrite(pending_ascii[start:start + TYPE_CHUNK],
                                   interval=self._type_interval)
            pending_ascii = ""

        def flush_unicode():
            nonlocal pending_unicode
            if not pending_unicode:
                return
            if self._windows:
                send_unicode(pending_unicode)
            else:
                self._pg.write(pending_unicode)
            pending_unicode = ""

        for char in text:
            if char in "\n\t":
                flush_ascii()
                flush_unicode()
                self._pg.press("enter" if char == "\n" else "tab")
            elif char.isprintable() and ord(char) < 128:
                flush_unicode()
                pending_ascii += char
            else:
                flush_ascii()
                pending_unicode += char
        flush_ascii()
        flush_unicode()

    def _check_keys(self, keys):
        """Reject key names pyautogui would ignore, instead of doing nothing.

        _keyDown returns silently for a name it doesn't recognise, so an
        unsupported key looks like a successful press that changed nothing --
        which sends the agent into a retry loop against a screen that never
        moves. Failing loudly puts the reason in the tool result instead.
        """
        unknown = [k for k in keys if self._keys and k not in self._keys]
        if unknown:
            raise ValueError(f"pyautogui has no key named {', '.join(repr(k) for k in unknown)}")

    def press(self, keys, repeat=1):
        self._check_keys(keys)
        for _ in range(max(1, repeat)):
            if len(keys) == 1:
                self._pg.press(keys[0])
            else:
                self._pg.hotkey(*keys)

    def hold(self, keys, duration):
        self._check_keys(keys)
        for key in keys:
            self._pg.keyDown(key)
        try:
            # Interruptible: stopping mid-hold still releases the keys, because
            # the release runs in the finally block.
            self.sleep(duration)
        finally:
            for key in reversed(keys):
                self._pg.keyUp(key)

    def key_down(self, key):
        self._check_keys([key])
        self._pg.keyDown(key)

    def key_up(self, key):
        self._check_keys([key])
        self._pg.keyUp(key)

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
    def scroll(self, notches, horizontal=False): self._record("scroll", notches, horizontal)
    def type_text(self, text): self._record("type", text)
    def press(self, keys, repeat=1): self._record("press", "+".join(keys), repeat)
    def hold(self, keys, duration): self._record("hold", "+".join(keys), duration)
    def key_down(self, key): self._record("key_down", key)
    def key_up(self, key): self._record("key_up", key)
    def position(self): return self._cursor
