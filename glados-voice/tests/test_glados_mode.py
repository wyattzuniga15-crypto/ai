"""GLaDOS-mode pitch handling, tested against Applio's real Pipeline.get_f0.

Run inside Applio's venv with cwd = the Applio folder:
    python <this file>

A fake pitch tracker stands in for RMVPE and returns a known contour (a male
voice around 110 Hz with natural wobble and some unvoiced frames), so the test
shows exactly what the voice model is fed:
  * Applio's own f0_autotune: the +12 shift is lost and unvoiced frames get 49 Hz
  * our GLaDOS mode: +12 applied, stepped onto semitones, unvoiced untouched
"""

import importlib.util
import os
import sys

import numpy as np

sys.path.insert(0, os.getcwd())
from rvc.infer import pipeline as P  # noqa: E402

rng = np.random.default_rng(0)
n = 400
t = np.arange(n) / 100.0
KNOWN = 110.0 * 2 ** ((1.5 * np.sin(2 * np.pi * 0.7 * t) + 0.2 * rng.standard_normal(n)) / 12)
KNOWN[:20] = 0
KNOWN[150:170] = 0
KNOWN[-15:] = 0


class FakeRMVPE:
    def __init__(self, **kw):
        pass

    def get_f0(self, x, filter_radius=0.03):
        return KNOWN.copy()


P.RMVPE = FakeRMVPE


class Cfg:
    x_pad, x_query, x_center, x_max, device = 1, 6, 38, 41, "cpu"


pipe = P.Pipeline(40000, Cfg())
x = np.zeros(16000 * 4, dtype=np.float32)
voiced = KNOWN > 0
want = KNOWN[voiced] * 2  # +12 semitones

# Applio's built-in autotune (for the record)
_, f_applio = pipe.get_f0(x, n, "rmvpe", pitch=12, f0_autotune=True, f0_autotune_strength=1.0)
applio_ratio = np.median(f_applio[voiced] / KNOWN[voiced])
applio_unvoiced = float(np.max(f_applio[~voiced]))

# Ours
spec = importlib.util.spec_from_file_location(
    "conv", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "glados", "applio_side", "convert.py"))
conv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conv)
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


print(f"Applio f0_autotune at pitch +12: output/input pitch ratio {applio_ratio:.2f} "
      f"(2.00 expected), unvoiced frames set to {applio_unvoiced:.0f} Hz")
check(abs(applio_ratio - 1.0) < 0.05, "confirms Applio 3.6.5 bug: autotune drops the pitch shift")

for strength in (0.0, 0.5, 1.0):
    conv.SNAP.update(strength=strength, hold=5)
    coarse, f = pipe.get_f0(x, n, "rmvpe", pitch=12)
    st_out = 12 * np.log2(f[voiced] / 440)
    on_grid = np.mean(np.abs(st_out - np.round(st_out)) < 0.02)
    ratio = np.median(f[voiced] / KNOWN[voiced])
    dev = np.abs(12 * np.log2(f[voiced] / want))
    print(f"steps {strength:.1f}: ratio {ratio:.3f}, {100 * on_grid:.0f}% frames on a semitone, "
          f"max deviation from +12 {dev.max():.2f} st, unvoiced max {f[~voiced].max():.1f} Hz")
    check(abs(ratio - 2.0) < 0.05, f"steps {strength}: +12 semitones applied")
    check(f[~voiced].max() == 0, f"steps {strength}: unvoiced frames stay unvoiced")
    # Nearest-note snapping moves a frame <= 0.5 st (0.25 on average). The hold can
    # keep the previous note a few frames into a change: one more semitone at most.
    check(dev.max() <= 1.5 * strength + 1e-6 and dev.mean() <= 0.35 * strength + 1e-6,
          f"steps {strength}: follows the natural +12 contour (max {dev.max():.2f}, mean {dev.mean():.2f} st)")
    if strength == 1.0:
        check(on_grid > 0.99, "steps 1.0: every voiced frame sits exactly on a semitone")
        changes = np.count_nonzero(np.diff(np.round(st_out)))
        check(changes < 0.2 * voiced.sum(), f"steps 1.0: stepped contour ({changes} note changes "
                                            f"over {voiced.sum()} voiced frames)")
    c_expected = np.rint(np.clip((1127 * np.log(1 + f / 700) - pipe.f0_mel_min) * 254
                                 / (pipe.f0_mel_max - pipe.f0_mel_min) + 1, 1, 255)).astype(int)
    c_expected[f == 0] = 1
    check(np.array_equal(coarse, c_expected), f"steps {strength}: coarse pitch matches the final contour")
print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
