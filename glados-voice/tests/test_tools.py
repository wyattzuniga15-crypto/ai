"""Checks the user tools against a finished workspace (run tests/e2e_sandbox.py first).

usage: test_tools.py <workspace root>   (run with the pipeline venv's python)
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import soundfile as sf

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent / "glados_pipeline.py"
root = Path(sys.argv[1])
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        fails.append(msg)


def tool(*args) -> int:
    print("$ glados_pipeline.py", " ".join(map(str, args)), flush=True)
    return subprocess.run([sys.executable, str(PIPE), *map(str, args), "--root", str(root)]).returncode


inputs = sorted((root / "samples" / "input").iterdir())
check(len(inputs) >= 1, f"{len(inputs)} recording(s) in samples\\input")

# ---- GLaDOS mode
out = root / "converted" / "glados_mode"
shutil.rmtree(out, ignore_errors=True)
check(tool("glados-mode", inputs[0], "--compare", "--strength", "0.8") == 0, "glados-mode exits 0")
for st in ("0.00", "0.40", "0.70", "0.80", "1.00"):
    f = out / f"{inputs[0].stem}_GLaDOS_steps{st}.wav"
    check(f.exists() and sf.info(str(f)).duration > 3, f"glados-mode wrote {f.name}")
ab = out / f"{inputs[0].stem}_compare_steps.wav"
check(ab.exists() and sf.info(str(ab)).duration > 5 * sf.info(str(out / f"{inputs[0].stem}_GLaDOS_steps0.80.wav")).duration,
      "A/B file holds the input plus all five strengths")

# ---- tune
(root / "best_settings.json").unlink(missing_ok=True)
check(tool("tune", "--quick") == 0, "tune exits 0")
best = json.loads((root / "best_settings.json").read_text())
check(set(best["settings"]) >= {"pitch", "index_rate", "protect", "autotune_strength"}, "best_settings.json has every setting")
check(len(best["tuned_on"]) == len(inputs), "tuned on every recording")
for p in inputs:
    for part in ("A_you", "B_default", "C_best", "ABCD"):
        f = root / "samples" / "compare" / f"{p.stem}_{part}.wav"
        check(f.exists(), f"comparison {f.name}")
check((root / "tuning" / "summary.md").read_text().count("voice.ai") >= 1, "summary gives voice.ai settings")

print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
