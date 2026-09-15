"""Stage 1 check: prove screenshots and coordinates line up with the real screen.

Run this on the Windows box before trusting the agent with anything:

    python test_scaling.py

It moves the mouse to the centre of the screen, then round-trips a grid of
points through the same maths the agent uses. If the cursor does not land dead
centre, DPI awareness or the monitor selection is wrong and every click the
agent makes will be off by the same proportion.
"""
from __future__ import annotations

import sys
import time

from screen import enable_dpi_awareness

DPI_MODE = enable_dpi_awareness()

from config import load_settings  # noqa: E402
from screen import MssScreen, dpi_awareness_is_usable  # noqa: E402


def main() -> int:
    settings = load_settings()
    print(f"dpi awareness : {DPI_MODE}")
    if not dpi_awareness_is_usable(DPI_MODE):
        print("  WARNING: this process is not DPI aware, so captures and clicks will")
        print("  disagree on any display scaled above 100%. Fix this before going further.")

    try:
        source = MssScreen(settings.max_width, settings.max_height, settings.monitor)
    except Exception as exc:
        print(f"could not open the screen: {type(exc).__name__}: {exc}")
        return 1

    png, frame = source.capture()
    print(f"monitor       : {source.geometry}")
    print(f"captured      : {frame.capture_width}x{frame.capture_height} "
          f"at origin ({frame.origin_x}, {frame.origin_y})")
    print(f"sent to claude: {frame.shot_width}x{frame.shot_height}  ({len(png) / 1024:.0f} KB png)")
    print(f"scale factor  : {frame.scale_x:.4f}x horizontally, {frame.scale_y:.4f}x vertically")

    try:
        import pyautogui
        pyautogui.FAILSAFE = settings.failsafe
    except Exception as exc:
        print(f"\npyautogui unavailable ({exc}); running the maths-only checks.")
        pyautogui = None

    # Round-trip a grid: screenshot point -> desktop -> back again.
    print("\nround-tripping a grid of points through the scaling maths:")
    worst = 0
    for fx in (0.0, 0.25, 0.5, 0.75, 0.999):
        for fy in (0.0, 0.25, 0.5, 0.75, 0.999):
            sx, sy = int(fx * (frame.shot_width - 1)), int(fy * (frame.shot_height - 1))
            dx, dy = frame.to_desktop(sx, sy)
            bx, by = frame.to_shot(dx, dy)
            worst = max(worst, abs(bx - sx), abs(by - sy))
    tolerance = max(1, int(max(frame.scale_x, frame.scale_y)))
    ok = worst <= tolerance
    print(f"  worst round-trip error: {worst} screenshot px (tolerance {tolerance}) "
          f"{'OK' if ok else 'FAIL'}")

    if pyautogui is None:
        return 0 if ok else 1

    centre_shot = (frame.shot_width // 2, frame.shot_height // 2)
    centre_desktop = frame.to_desktop(*centre_shot)
    expected = (frame.origin_x + frame.capture_width // 2,
                frame.origin_y + frame.capture_height // 2)

    print(f"\nmoving the mouse to the centre of the screenshot {centre_shot} ...")
    pyautogui.moveTo(*centre_desktop)
    time.sleep(0.4)
    actual = tuple(pyautogui.position())

    drift = max(abs(actual[0] - expected[0]), abs(actual[1] - expected[1]))
    print(f"  mapped to      : {centre_desktop}")
    print(f"  true centre    : {expected}")
    print(f"  cursor landed  : {actual}")
    print(f"  drift          : {drift} px")

    slack = tolerance + 2
    if drift <= slack:
        print("\nPASS - the cursor is where the screenshot says it should be.")
        return 0

    print("\nFAIL - the cursor did not land where expected.")
    print("  If drift is large and proportional (roughly 1.25x, 1.5x or 2x), DPI awareness")
    print("  did not take effect: check that nothing imports pyautogui before screen.py runs,")
    print("  and that Python is not running with a per-app compatibility DPI override.")
    print("  If you have several monitors, try PILOT_MONITOR=0 (all) or 2 (second display).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
