"""Checks the user tools against a finished workspace (run tests/e2e_sandbox.py first).

usage: test_tools.py <workspace root> [section ...]   (run with the pipeline venv's python)
sections: glados-mode tune convert-folder (default: all)
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import soundfile as sf

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent / "glados_pipeline.py"
root = Path(sys.argv[1])
sections = sys.argv[2:] or ["glados-mode", "tune", "convert-folder"]
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        fails.append(msg)


def tool(*args, capture=False):
    print("$ glados_pipeline.py", " ".join(map(str, args)), flush=True)
    r = subprocess.run([sys.executable, str(PIPE), *map(str, args), "--root", str(root)],
                       capture_output=capture, text=True)
    if capture:
        print(r.stdout[-2000:], r.stderr[-2000:])
    return r


inputs = sorted((root / "samples" / "input").iterdir())
check(len(inputs) >= 1, f"{len(inputs)} recording(s) in samples\\input")


def test_glados_mode():
    out = root / "converted" / "glados_mode"
    shutil.rmtree(out, ignore_errors=True)
    check(tool("glados-mode", inputs[0], "--compare", "--strength", "0.8").returncode == 0, "glados-mode exits 0")
    for st in ("0.00", "0.40", "0.70", "0.80", "1.00"):
        f = out / f"{inputs[0].stem}_GLaDOS_steps{st}.wav"
        check(f.exists() and sf.info(str(f)).duration > 3, f"glados-mode wrote {f.name}")
    ab = out / f"{inputs[0].stem}_compare_steps.wav"
    one = out / f"{inputs[0].stem}_GLaDOS_steps0.80.wav"
    check(ab.exists() and one.exists() and sf.info(str(ab)).duration > 5 * sf.info(str(one)).duration,
          "A/B file holds the input plus all five strengths")


def test_tune():
    (root / "best_settings.json").unlink(missing_ok=True)
    check(tool("tune", "--quick").returncode == 0, "tune exits 0")
    best = json.loads((root / "best_settings.json").read_text())
    check(set(best["settings"]) >= {"pitch", "index_rate", "protect", "autotune_strength"},
          "best_settings.json has every setting")
    check(len(best["tuned_on"]) == len(inputs), "tuned on every recording")
    for p in inputs:
        for part in ("A_you", "B_default", "C_best", "ABCD"):
            f = root / "samples" / "compare" / f"{p.stem}_{part}.wav"
            check(f.exists(), f"comparison {f.name}")
    check("voice.ai" in (root / "tuning" / "summary.md").read_text(), "summary gives voice.ai settings")


def test_convert_folder():
    drop = root / "test_dropbox"
    shutil.rmtree(drop, ignore_errors=True)
    drop.mkdir()
    for i, src in enumerate(inputs[:2]):
        x, sr = sf.read(str(src))
        sf.write(str(drop / f"clip{i}.wav"), x, sr)
    shutil.copyfile(inputs[0], drop / "not_a_wav.ogg")
    out = drop / "GLaDOS"
    check(tool("convert-folder", drop).returncode == 0, "convert-folder exits 0")
    wavs = sorted(p.name for p in out.glob("*.wav"))
    check(wavs == [f"clip{i}_GLaDOS.wav" for i in range(min(2, len(inputs)))], f"converted the WAVs only: {wavs}")
    stamp = {p.name: p.stat().st_mtime_ns for p in out.glob("*.wav")}
    r = tool("convert-folder", drop, capture=True)
    check(r.returncode == 0 and "0 to convert" in (r.stdout + r.stderr), "second run skips converted files")
    check({p.name: p.stat().st_mtime_ns for p in out.glob("*.wav")} == stamp, "outputs untouched on the re-run")
    time.sleep(1.1)
    os.utime(drop / "clip0.wav")  # "edited" clip
    r = tool("convert-folder", drop, capture=True)
    check("1 to convert" in (r.stdout + r.stderr), "a changed clip is reconverted")
    check(tool("convert-folder", drop, "--all-audio").returncode == 0 and (out / "not_a_wav_GLaDOS.wav").exists(),
          "--all-audio also converts other formats")
    shutil.rmtree(drop, ignore_errors=True)


for name, fn in (("glados-mode", test_glados_mode), ("tune", test_tune), ("convert-folder", test_convert_folder)):
    if name in sections:
        fn()
print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
