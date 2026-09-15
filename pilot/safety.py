"""Kill switch, action logging, and the confirmation gate.

Three independent layers, because any one of them can be wrong:

  1. BLOCK   - things Pilot must never do at all (type a password, a card
               number). Refused outright; no prompt, because a y/n question
               about typing your password is already a failure.
  2. CONFIRM - things that commit: sending, buying, deleting, submitting.
               Paused for an explicit y/n.
  3. ALLOW   - ordinary navigation.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from controller import parse_combo

ALLOW, CONFIRM, BLOCK = "allow", "confirm", "block"


class Stopped(Exception):
    """Raised when the kill switch fires or the user declines an action."""


class KillSwitch:
    """A global hotkey (F12 by default) plus a programmatic stop flag."""

    def __init__(self, key: str = "f12"):
        self.key = (key or "f12").lower()
        self._event = threading.Event()
        self._listener = None
        self.reason = ""

    def start(self) -> bool:
        """Begin listening globally. Returns False if pynput is unavailable."""
        try:
            from pynput import keyboard
        except Exception:
            return False

        target = getattr(keyboard.Key, self.key, None)

        def on_press(pressed):
            if target is not None and pressed == target:
                self.trip(f"{self.key.upper()} pressed")

        try:
            self._listener = keyboard.Listener(on_press=on_press)
            self._listener.daemon = True
            self._listener.start()
            return True
        except Exception:
            return False

    def stop(self) -> None:
        if self._listener is not None:
            self._listener.stop()
            self._listener = None

    def trip(self, reason: str = "stop requested") -> None:
        if not self._event.is_set():
            self.reason = reason
            self._event.set()

    def clear(self) -> None:
        self.reason = ""
        self._event.clear()

    @property
    def tripped(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        if self._event.is_set():
            raise Stopped(self.reason or "stopped")

    def sleep(self, seconds: float) -> None:
        """Interruptible delay, so F12 takes effect inside the pacing gap."""
        if self._event.wait(timeout=max(0.0, seconds)):
            raise Stopped(self.reason or "stopped")


# --- Risk classification ----------------------------------------------------

# Never typed, whatever the task says.
SECRET_PATTERNS = [
    (re.compile(r"\b(?:\d[ -]*?){13,19}\b"), "looks like a payment card number"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "looks like a social security number"),
    (re.compile(r"\b(?:cvv|cvc|security code)\b[:\s]*\d{3,4}\b", re.I), "looks like a card security code"),
    (re.compile(r"\b(?:sk-ant-|sk-|ghp_|gho_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{8,}"), "looks like an API key or token"),
    (re.compile(r"\b(?:my |the )?password is\b", re.I), "looks like a password"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "is a private key"),
]

# Typed text that commits something irreversible in a shell.
DESTRUCTIVE_TEXT = [
    (re.compile(r"\brm\s+-[a-z]*[rf]", re.I), "a recursive delete"),
    (re.compile(r"\b(?:del|erase)\s+/[sq]", re.I), "a recursive delete"),
    (re.compile(r"\bRemove-Item\b.*-Recurse", re.I), "a recursive delete"),
    (re.compile(r"\bformat\s+[a-z]:", re.I), "formatting a drive"),
    (re.compile(r"\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b", re.I), "a destructive database statement"),
    (re.compile(r"\bgit\s+push\s+.*--force", re.I), "a force push"),
    (re.compile(r"\bshutdown\b|\bdiskpart\b", re.I), "a system-level command"),
]

# Words that mean the next commit-style action is worth pausing on. Matched
# against the task text and against whatever Claude just said it was doing.
COMMIT_INTENT = re.compile(
    r"\b(send|sending|sends|post|posting|publish|publishing|tweet|submit|submitting|"
    r"buy|buying|purchase|purchasing|order|ordering|checkout|check out|pay|paying|payment|"
    r"confirm order|place the order|subscribe|delete|deleting|remove|removing|uninstall|"
    r"format|wipe|erase|reply|replying|email|e-mail|dm|message them|transfer|withdraw|"
    r"sign the|accept the|agree to)\b",
    re.I,
)

# Keys that commit whatever is currently focused.
# Stored as sorted, normalised combos so lookup is order-independent.
COMMIT_KEYS = {"enter", "ctrl+enter", "enter+shift", "alt+s"}

DESTRUCTIVE_KEYS = {"delete+shift", "ctrl+delete+shift"}

LOGIN_HINT = re.compile(r"\b(log ?in|sign ?in|password|passcode|2fa|two.factor|otp|verification code)\b", re.I)


@dataclass
class Verdict:
    level: str
    reason: str = ""

    @property
    def allowed(self) -> bool:
        return self.level == ALLOW


class RiskEngine:
    """Decides allow / confirm / block for one pending action.

    It gets three signals: the action itself, the task the user typed, and the
    sentence Claude wrote just before acting. The last one matters more than it
    looks -- "I'll click Send now" is the clearest statement of intent we get,
    and it costs nothing to read.
    """

    def __init__(self, confirm_risky: bool = True, confirm_every_action: bool = False):
        self.confirm_risky = confirm_risky
        self.confirm_every_action = confirm_every_action
        self.task = ""
        self.narration = ""

    def set_task(self, task: str) -> None:
        self.task = task or ""

    def set_narration(self, text: str) -> None:
        self.narration = text or ""

    def _intent_is_committal(self) -> bool:
        return bool(COMMIT_INTENT.search(self.narration) or COMMIT_INTENT.search(self.task))

    def assess(self, name: str, payload: dict) -> Verdict:
        text = str(payload.get("text") or "")

        if name == "type":
            for pattern, why in SECRET_PATTERNS:
                if pattern.search(text):
                    return Verdict(BLOCK, f"refusing to type text that {why}")
            if LOGIN_HINT.search(text) and len(text) < 64 and "@" not in text:
                return Verdict(CONFIRM, "this may be credential entry")
            for pattern, why in DESTRUCTIVE_TEXT:
                if pattern.search(text):
                    return Verdict(CONFIRM, f"typing {why}")
            if self._intent_is_committal() and len(text) > 120:
                return Verdict(CONFIRM, "composing a long message while the task looks like it sends something")

        if name == "key":
            # Normalise through the same parser the controller uses, so that
            # "Return", "enter" and "KP_Enter" are all recognised as the same key.
            keys = parse_combo(text)
            combo = "+".join(sorted(keys))
            if combo in DESTRUCTIVE_KEYS:
                return Verdict(CONFIRM, f"{text} deletes without using the recycle bin")
            if combo in COMMIT_KEYS and self._intent_is_committal():
                return Verdict(CONFIRM, "pressing this key looks like it commits the action")

        if name in {"left_click", "double_click", "middle_click"} and self._intent_is_committal():
            return Verdict(CONFIRM, "this click looks like it commits the action")

        if self.confirm_every_action and name not in {"screenshot", "zoom", "wait", "cursor_position"}:
            return Verdict(CONFIRM, "confirm-every-action is on")

        return Verdict(ALLOW)

    def gate(self, name: str, payload: dict) -> Verdict:
        verdict = self.assess(name, payload)
        if verdict.level == CONFIRM and not self.confirm_risky and not self.confirm_every_action:
            return Verdict(ALLOW)
        return verdict


class TerminalApprover:
    """Asks y/n on stdin. The GUI swaps in its own implementation."""

    def __init__(self, kill_switch: KillSwitch | None = None):
        self.kill_switch = kill_switch

    def ask(self, summary: str, reason: str) -> bool:
        print(f"\n  \033[33m! confirm\033[0m {summary}")
        print(f"    why: {reason}")
        try:
            answer = input("    proceed? [y/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return False
        return answer in {"y", "yes"}


class AutoApprover:
    """Used by --yolo and the test suite."""

    def __init__(self, answer: bool = True):
        self.answer = answer
        self.asked: list[tuple[str, str]] = []

    def ask(self, summary: str, reason: str) -> bool:
        self.asked.append((summary, reason))
        return self.answer


class SessionLog:
    """Timestamped append-only log of everything Pilot does."""

    def __init__(self, path: Path, echo: bool = False):
        self.path = path
        self.echo = echo
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, kind: str, message: str) -> None:
        line = f"{datetime.now():%Y-%m-%d %H:%M:%S} [{kind:<8}] {message}"
        with self._lock:
            try:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError:
                pass
        if self.echo:
            print(line)

    def banner(self, task: str, model: str) -> None:
        self.write("session", "-" * 60)
        self.write("task", f"{task!r} (model={model})")
