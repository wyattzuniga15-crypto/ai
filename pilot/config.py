"""Configuration for Pilot: environment, models, pricing, apps registry, logging."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent

# The stable computer-use client toolset. Verified against the Anthropic docs:
# no beta header is required, and the entry rejects display_width_px /
# display_height_px / display_number -- coordinates always live in the pixel
# space of the screenshots we return.
COMPUTER_TOOLSET = "computer_toolset_20260801"
TOOLSET_NAME = "computer"

# USD per million tokens. Cache read is 0.1x input, 5-minute cache write 1.25x.
PRICING = {
    "claude-sonnet-5": {"input": 2.00, "output": 10.00},
    "claude-opus-5": {"input": 5.00, "output": 25.00},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
}
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


def _env_str(key: str, default: str) -> str:
    value = os.getenv(key)
    return default if value is None or value.strip() == "" else value.strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env_str(key, str(default)))
    except ValueError:
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(_env_str(key, str(default)))
    except ValueError:
        return default


def _env_bool(key: str, default: bool) -> bool:
    return _env_str(key, "yes" if default else "no").lower() in {"1", "true", "yes", "y", "on"}


@dataclass
class Settings:
    api_key: str = ""
    model: str = "claude-sonnet-5"
    max_tokens: int = 8192
    effort: str = "high"          # low | medium | high | xhigh | max
    thinking: str = "adaptive"    # adaptive | off

    max_steps: int = 40
    action_delay: float = 0.3     # seconds between actions, so you can watch
    screenshots_in_context: int = 3

    # Screenshot downscale target. 1280x800 keeps text legible while staying
    # well inside the API's image limits; the docs recommend not exceeding
    # 1920x1080 for computer use.
    max_width: int = 1280
    max_height: int = 800
    monitor: int = 1              # 1 = primary; 0 = the whole virtual desktop

    kill_key: str = "f12"
    failsafe: bool = True
    confirm_risky: bool = True
    confirm_every_action: bool = False

    log_dir: Path = field(default_factory=lambda: ROOT / "logs")
    apps_file: Path = field(default_factory=lambda: ROOT / "apps.json")

    @property
    def prices(self) -> dict[str, float]:
        return PRICING.get(self.model, PRICING["claude-sonnet-5"])


def load_settings(overrides: dict | None = None) -> Settings:
    load_dotenv(ROOT / ".env")
    load_dotenv()  # also honour a .env in the working directory
    s = Settings(
        api_key=_env_str("ANTHROPIC_API_KEY", ""),
        model=_env_str("PILOT_MODEL", "claude-sonnet-5"),
        max_tokens=_env_int("PILOT_MAX_TOKENS", 8192),
        effort=_env_str("PILOT_EFFORT", "high").lower(),
        thinking=_env_str("PILOT_THINKING", "adaptive").lower(),
        max_steps=_env_int("PILOT_MAX_STEPS", 40),
        action_delay=_env_float("PILOT_ACTION_DELAY", 0.3),
        screenshots_in_context=_env_int("PILOT_SCREENSHOTS_IN_CONTEXT", 3),
        max_width=_env_int("PILOT_MAX_WIDTH", 1280),
        max_height=_env_int("PILOT_MAX_HEIGHT", 800),
        monitor=_env_int("PILOT_MONITOR", 1),
        kill_key=_env_str("PILOT_KILL_KEY", "f12").lower(),
        failsafe=_env_bool("PILOT_FAILSAFE", True),
        confirm_risky=_env_bool("PILOT_CONFIRM_RISKY", True),
        confirm_every_action=_env_bool("PILOT_CONFIRM_EVERY_ACTION", False),
    )
    for key, value in (overrides or {}).items():
        if value is not None and hasattr(s, key):
            setattr(s, key, value)
    if s.effort not in {"low", "medium", "high", "xhigh", "max"}:
        s.effort = "high"
    s.screenshots_in_context = max(1, s.screenshots_in_context)
    s.max_steps = max(1, s.max_steps)
    return s


def load_apps(path: Path) -> dict[str, str]:
    """Read apps.json into a lowercase name -> target map."""
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[pilot] could not read {path.name}: {exc}", file=sys.stderr)
        return {}
    apps: dict[str, str] = {}
    for name, target in raw.items():
        if name.startswith("_") or not isinstance(target, str):
            continue  # "_comment" keys and non-string values are ignored
        apps[name.strip().lower()] = target
    return apps


def session_log_path(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"session_{datetime.now():%Y-%m-%d}.txt"
