"""Runs the optional TTS stage end to end on a machine without a GPU or internet
access to huggingface.co (how it was developed). Needs a workspace from
e2e_sandbox.py, a TTS venv, and stand-ins from make_tts_standins.py.

usage: tts_sandbox.py <workspace root> <standins dir>   (pipeline venv's python)
Whisper can't download here, so this also covers the no-Whisper fallbacks.
"""

import subprocess
import sys
from pathlib import Path

import soundfile as sf

HERE = Path(__file__).resolve().parent
root, standins = Path(sys.argv[1]), Path(sys.argv[2])
cmd = [sys.executable, str(HERE.parent / "glados_pipeline.py"), "tts", "--root", str(root), "--allow-cpu",
       "--f5-pretrain", str(standins / "model_1250000.safetensors"), "--vocoder-local", str(standins / "vocos"),
       "--updates", "9", "--save-per", "9", "--batch-frames", "500", "--min-lines", "5", "--min-free-gb", "5",
       "--takes", "2", "--nfe-step", "4", "Hello there. This is a test."] + sys.argv[3:]
rc = subprocess.run(cmd).returncode
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


check(rc == 0, "tts exits 0")
check((root / "tts" / "transcripts.csv").exists(), "transcripts.csv written")
check((root / "tts" / "selection.json").exists(), "checkpoint selection written")
out = sorted((root / "tts" / "out").iterdir())[-1]
for f in ("line01_best.wav", "line01_all_takes.wav", "raw/line01_take1.wav", "rvc/line01_take2.wav"):
    check((out / f).exists() and sf.info(str(out / f)).duration > 0.5, f"wrote {f}")
check(sf.info(str(out / "rvc" / "line01_take1.wav")).samplerate == 40000, "takes pass through the 40 kHz RVC model")
check(len((out / "ranking.csv").read_text().splitlines()) == 3, "ranking.csv ranks both takes")
print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
