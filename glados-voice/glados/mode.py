"""GLaDOS mode: convert recordings with her stepped, robotic intonation.

  glados_mode.bat clip.wav                      steps at the default strength (0.8)
  glados_mode.bat clips\\ --strength 1.0         fully snapped to semitone steps
  glados_mode.bat clip.wav --compare            strengths 0 / 0.4 / 0.7 / 1.0, plus one A/B file
  glados_mode.bat                               everything in samples\\input

Drag files or a folder onto glados_mode.bat to use the defaults. Pitch, index
rate and protect come from tune.bat's best settings when they exist.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

from .common import LOG, Workspace, setup_logging
from . import voice as V

DEFAULT_STRENGTH = 0.8
COMPARE = (0.0, 0.4, 0.7, 1.0)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="glados_mode.bat", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", help="audio files or folders (default: samples\\input)")
    ap.add_argument("--root", default=r"C:\GLaDOSVoice")
    ap.add_argument("--uv", help=argparse.SUPPRESS)
    ap.add_argument("--strength", type=float, help=f"0-1, how hard pitch snaps to semitone steps "
                                                  f"(default: tuned value if > 0, else {DEFAULT_STRENGTH})")
    ap.add_argument("--hold", type=int, help="frames (10 ms) a note must last before the step moves (default 5)")
    ap.add_argument("--compare", action="store_true", help="also write strengths 0, 0.4, 0.7, 1.0 and an A/B file")
    ap.add_argument("--pitch", type=int, help="semitones (default: tuned / recommended)")
    ap.add_argument("--index-rate", type=float)
    ap.add_argument("--protect", type=float)
    ap.add_argument("--out", help="output folder (default <root>\\converted\\glados_mode)")
    a = ap.parse_args(argv)

    ws = Workspace(Path(a.root))
    setup_logging(ws)
    base, source = V.default_settings(ws)
    strength = a.strength if a.strength is not None else (base.autotune_strength or DEFAULT_STRENGTH)
    s = replace(base, autotune_strength=max(0.0, min(1.0, strength)))
    if a.pitch is not None:
        s.pitch = a.pitch
    if a.index_rate is not None:
        s.index_rate = a.index_rate
    if a.protect is not None:
        s.protect = a.protect
    if a.hold is not None:
        s.snap_hold = max(1, a.hold)

    pth, idx = V.model_files(ws)
    inputs = V.collect_inputs(a.inputs or [str(ws.samples_input)])
    if not inputs:
        LOG.error("No audio found. Give files/folders, or put recordings in %s", ws.samples_input)
        return 2
    out_dir = Path(a.out) if a.out else ws.root / "converted" / "glados_mode"
    prepared = V.prepare(inputs, ws.root / "converted" / "_prepared")
    LOG.info("GLaDOS mode on %d file(s) with %s (base settings: %s)", len(inputs), V.describe(s), source)

    strengths = [s.autotune_strength] + ([x for x in COMPARE if x != s.autotune_strength] if a.compare else [])
    jobs, outputs = [], {}
    for st in strengths:
        ss = replace(s, autotune_strength=st)
        pairs = []
        for orig, prep in prepared:
            out = out_dir / f"{orig.stem}_GLaDOS_steps{st:.2f}.wav"
            out.unlink(missing_ok=True)  # settings may differ from last time
            pairs.append((prep, out))
            outputs.setdefault(orig, {})[st] = out
        jobs.append(V.job(pth, idx, ss, pairs))
    V.run_jobs(ws, jobs, ws.root / "converted" / "_glados_mode_jobs.json", "glados_mode.log")

    for orig, prep in prepared:
        for st, out in sorted(outputs[orig].items()):
            LOG.info("  %s", out)
        if a.compare:
            ab = out_dir / f"{orig.stem}_compare_steps.wav"
            V.concat_with_gaps([prep] + [outputs[orig][st] for st in sorted(outputs[orig])], ab)
            LOG.info("  %s  (your clip, then strength %s)", ab, ", ".join(f"{x:g}" for x in sorted(outputs[orig])))
    return 0
