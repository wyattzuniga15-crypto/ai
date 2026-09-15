"""Screen capture, DPI awareness, and coordinate scaling.

The model only ever sees a downscaled screenshot, and every coordinate it
returns is in that screenshot's pixel space. Everything in this module exists to
translate between three coordinate systems:

  screenshot space  what Claude sees and talks about  (e.g. 1280x800)
  capture space     the raw pixels we grabbed         (e.g. 2560x1440)
  desktop space     what pyautogui clicks, which on a multi-monitor setup can
                    start at a negative origin        (capture space + origin)

The pure functions at the top are deliberately free of any Windows or display
dependency so they can be unit-tested anywhere.
"""
from __future__ import annotations

import base64
import ctypes
import io
import sys
from dataclasses import dataclass


# GetProcessDpiAwareness values.
_AWARENESS = {
    0: "unaware - clicks WILL be offset on scaled displays",
    1: "system-dpi (set before Pilot started)",
    2: "per-monitor (set before Pilot started)",
}


def enable_dpi_awareness() -> str:
    """Opt into true physical pixels on Windows. Must run before pyautogui/mss.

    Without this, a 150%-scaled display reports 1707x960 to our process while
    the real framebuffer is 2560x1440. Screenshots come back at one size,
    SetCursorPos interprets another, and every click lands short of its target.
    Returns a short description of the resulting mode, for logging.
    """
    if sys.platform != "win32":
        return "not windows; no DPI call needed"
    user32 = ctypes.windll.user32
    # -4 is DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (Windows 10 1703+).
    try:
        if user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return "per-monitor-v2"
    except (AttributeError, OSError):
        pass
    try:  # Windows 8.1+: 2 == PROCESS_PER_MONITOR_DPI_AWARE
        if ctypes.windll.shcore.SetProcessDpiAwareness(2) == 0:
            return "per-monitor"
    except (AttributeError, OSError):
        pass
    try:
        if user32.SetProcessDPIAware():
            return "system-dpi"
    except (AttributeError, OSError):
        pass
    # Every setter failed, which does not mean we are unaware: awareness can
    # only be set once per process, so a manifest (Python's own, or an embedding
    # host's) that already declared it makes these calls fail. Ask Windows what
    # the process actually is rather than reporting a false negative.
    return current_dpi_awareness()


def current_dpi_awareness() -> str:
    """Describe the process's actual DPI awareness, whoever set it."""
    if sys.platform != "win32":
        return "not windows; no DPI call needed"
    try:
        awareness = ctypes.c_int()
        if ctypes.windll.shcore.GetProcessDpiAwareness(None, ctypes.byref(awareness)) == 0:
            return _AWARENESS.get(awareness.value, f"awareness code {awareness.value}")
    except (AttributeError, OSError):
        pass
    try:  # Vista-era fallback: a boolean, not a level.
        return ("system-dpi (already set)" if ctypes.windll.user32.IsProcessDPIAware()
                else "unaware - clicks WILL be offset on scaled displays")
    except (AttributeError, OSError):
        pass
    return "unknown - run test_scaling.py before trusting coordinates"


def dpi_awareness_is_usable(mode: str) -> bool:
    """False only for modes that mean coordinates cannot be trusted."""
    return not (mode.startswith("unaware") or mode.startswith("unknown"))


@dataclass(frozen=True)
class Frame:
    """Geometry of one captured frame, and the maths to map between spaces."""

    capture_width: int
    capture_height: int
    shot_width: int
    shot_height: int
    origin_x: int = 0
    origin_y: int = 0

    @property
    def scale_x(self) -> float:
        return self.capture_width / self.shot_width

    @property
    def scale_y(self) -> float:
        return self.capture_height / self.shot_height

    def to_desktop(self, x: float, y: float) -> tuple[int, int]:
        """Screenshot pixel -> absolute desktop pixel for pyautogui.

        The +0.5 samples the centre of the screenshot pixel rather than its top
        left corner. On a 2x downscale that is the difference between clicking
        the edge of a 4px-wide UI element and clicking its middle.
        """
        dx = self.origin_x + int((x + 0.5) * self.scale_x)
        dy = self.origin_y + int((y + 0.5) * self.scale_y)
        return (
            _clamp(dx, self.origin_x, self.origin_x + self.capture_width - 1),
            _clamp(dy, self.origin_y, self.origin_y + self.capture_height - 1),
        )

    def to_shot(self, x: float, y: float) -> tuple[int, int]:
        """Absolute desktop pixel -> screenshot pixel (for cursor_position)."""
        sx = int((x - self.origin_x) / self.scale_x)
        sy = int((y - self.origin_y) / self.scale_y)
        return (
            _clamp(sx, 0, self.shot_width - 1),
            _clamp(sy, 0, self.shot_height - 1),
        )

    def region_to_desktop(self, region: list[int] | tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        """Screenshot [x0,y0,x1,y1] -> capture-space box for cropping."""
        x0, y0, x1, y1 = region
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        left = _clamp(int(x0 * self.scale_x), 0, self.capture_width - 1)
        top = _clamp(int(y0 * self.scale_y), 0, self.capture_height - 1)
        right = _clamp(int(round(x1 * self.scale_x)), left + 1, self.capture_width)
        bottom = _clamp(int(round(y1 * self.scale_y)), top + 1, self.capture_height)
        return left, top, right, bottom


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def fit_within(width: int, height: int, max_width: int, max_height: int) -> tuple[int, int]:
    """Largest size <= the caps that preserves aspect ratio. Never upscales."""
    if width <= 0 or height <= 0:
        raise ValueError(f"bad capture size {width}x{height}")
    scale = min(1.0, max_width / width, max_height / height)
    return max(1, int(round(width * scale))), max(1, int(round(height * scale)))


class ScreenSource:
    """Interface implemented by the real grabber and by test doubles."""

    def capture(self) -> tuple[bytes, Frame]:
        raise NotImplementedError

    def zoom(self, region, max_width: int, max_height: int) -> tuple[bytes, Frame]:
        raise NotImplementedError



class MssScreen(ScreenSource):
    """Real capture via mss, downscaled with Pillow."""

    def __init__(self, max_width: int = 1280, max_height: int = 800, monitor: int = 1):
        import mss  # imported lazily so the module stays importable headless
        from PIL import Image

        self._Image = Image
        self._sct = mss.mss()
        monitors = self._sct.monitors
        # monitors[0] is the union of all displays, monitors[1] the primary.
        self._monitor = monitors[monitor] if 0 <= monitor < len(monitors) else monitors[1]
        self.max_width = max_width
        self.max_height = max_height

    @property
    def geometry(self) -> dict:
        return dict(self._monitor)

    def _grab(self):
        raw = self._sct.grab(self._monitor)
        return self._Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

    def capture(self) -> tuple[bytes, Frame]:
        image = self._grab()
        shot_w, shot_h = fit_within(image.width, image.height, self.max_width, self.max_height)
        frame = Frame(
            capture_width=image.width,
            capture_height=image.height,
            shot_width=shot_w,
            shot_height=shot_h,
            origin_x=self._monitor.get("left", 0),
            origin_y=self._monitor.get("top", 0),
        )
        if (shot_w, shot_h) != (image.width, image.height):
            image = image.resize((shot_w, shot_h), self._Image.LANCZOS)
        return encode_png(image), frame

    def zoom(self, region, max_width: int, max_height: int) -> tuple[bytes, Frame]:
        """Crop a screenshot-space region out of a fresh full-resolution grab."""
        image = self._grab()
        shot_w, shot_h = fit_within(image.width, image.height, self.max_width, self.max_height)
        frame = Frame(image.width, image.height, shot_w, shot_h,
                      self._monitor.get("left", 0), self._monitor.get("top", 0))
        box = frame.region_to_desktop(region)
        crop = image.crop(box)
        out_w, out_h = fit_within(crop.width, crop.height, max_width, max_height)
        if (out_w, out_h) != (crop.width, crop.height):
            crop = crop.resize((out_w, out_h), self._Image.LANCZOS)
        return encode_png(crop), frame


def encode_png(image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def to_base64(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode("ascii")


def image_block(png_bytes: bytes) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": to_base64(png_bytes)},
    }
