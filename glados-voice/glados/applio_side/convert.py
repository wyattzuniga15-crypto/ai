"""Runs inside Applio's venv (cwd = Applio folder). Batch voice conversion.

usage: convert.py <jobs.json>

jobs.json: {"jobs": [{"model": pth, "index": path, "pitch": int, "index_rate": f,
                     "protect": f, "autotune_strength": f, "snap_hold": int,
                     "pairs": [[input, output], ...]}]}
Loads ContentVec/RMVPE once and swaps only the voice model between jobs, which
is far quicker than one CLI call per checkpoint. Existing outputs are skipped,
so an interrupted run resumes.

GLaDOS mode ("autotune_strength" > 0) snaps the pitch contour toward semitone
steps. It does NOT use Applio's own f0_autotune switch, which in 3.6.5 (a) skips
the pitch shift entirely when on, so +12 would come out at the speaker's own
pitch, and (b) snaps silent/unvoiced frames to 49 Hz, adding a low buzz. Here
the snapping runs after Applio's pitch shift, touches voiced frames only, and
holds each note for a few frames so it steps instead of warbling.
"""

import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.getcwd())

from rvc.infer import pipeline as P  # noqa: E402
from rvc.infer.infer import VoiceConverter  # noqa: E402

SNAP = {"strength": 0.0, "hold": 5}


def _run_median(notes: np.ndarray, voiced: np.ndarray, width: int) -> np.ndarray:
    """Median of note numbers within each voiced run, so a step must persist to count."""
    if width <= 1:
        return notes
    out = notes.copy()
    half = width // 2
    idx = np.flatnonzero(voiced)
    if idx.size == 0:
        return out
    breaks = np.flatnonzero(np.diff(idx) > 1)
    for run in np.split(idx, breaks + 1):
        seg = notes[run]
        padded = np.pad(seg, half, mode="edge")
        win = np.lib.stride_tricks.sliding_window_view(padded, width)
        out[run] = np.median(win, axis=1)
    return out


def snap_f0(f0: np.ndarray, strength: float, hold: int) -> np.ndarray:
    f0 = np.asarray(f0, dtype=np.float64)
    voiced = f0 > 0
    if strength <= 0 or not voiced.any():
        return f0
    semis = np.zeros_like(f0)
    semis[voiced] = 12 * np.log2(f0[voiced] / 440.0)
    notes = _run_median(np.round(semis), voiced, hold)
    out = f0.copy()
    target = semis + (notes - semis) * min(1.0, strength)
    out[voiced] = 440.0 * 2 ** (target[voiced] / 12)
    return out


_orig_get_f0 = P.Pipeline.get_f0


def _get_f0(self, x, p_len, f0_method="rmvpe", pitch=0, f0_autotune=False, f0_autotune_strength=1.0,
            proposed_pitch=False, proposed_pitch_threshold=155.0):
    coarse, f0 = _orig_get_f0(self, x, p_len, f0_method, pitch, False, f0_autotune_strength,
                              proposed_pitch, proposed_pitch_threshold)
    before = f0
    if SNAP["strength"] > 0:
        f0 = snap_f0(f0, SNAP["strength"], SNAP["hold"])
        f0_mel = 1127 * np.log(1 + f0 / 700)
        f0_mel[f0_mel > 0] = (f0_mel[f0_mel > 0] - self.f0_mel_min) * 254 / (self.f0_mel_max - self.f0_mel_min) + 1
        f0_mel[f0_mel <= 1] = 1
        f0_mel[f0_mel > 255] = 255
        coarse = np.rint(f0_mel).astype(int)
    if os.environ.get("GLADOS_F0_DUMP"):  # testing aid: the contour the model actually receives
        np.savez(f"{os.environ['GLADOS_F0_DUMP']}_{SNAP['strength']:.2f}_{time.time_ns()}.npz",
                 shifted=np.asarray(before), final=np.asarray(f0), pitch=pitch)
    return coarse, f0


P.Pipeline.get_f0 = _get_f0

if __name__ == "__main__":
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))["jobs"]
    vc = VoiceConverter()
    failures = 0
    for job in jobs:
        t = time.time()
        done = 0
        SNAP["strength"] = float(job.get("autotune_strength", 0.0))
        SNAP["hold"] = int(job.get("snap_hold", 5))
        for inp, out in job["pairs"]:
            if os.path.exists(out) and os.path.getsize(out) > 1000:
                continue
            os.makedirs(os.path.dirname(out), exist_ok=True)
            try:
                vc.convert_audio(
                    audio_input_path=inp,
                    audio_output_path=out,
                    model_path=job["model"],
                    index_path=job.get("index") or "",
                    pitch=int(job.get("pitch", 0)),
                    f0_method="rmvpe",
                    index_rate=float(job.get("index_rate", 0.0)),
                    volume_envelope=float(job.get("volume_envelope", 1.0)),
                    protect=float(job.get("protect", 0.33)),
                    split_audio=False,
                    f0_autotune=False,
                    embedder_model="contentvec",
                    clean_audio=False,
                    export_format="WAV",
                    post_process=False,
                    sid=0,
                )
                if not os.path.exists(out):
                    raise RuntimeError("no output written")
                done += 1
            except Exception as exc:
                failures += 1
                print(f"CONVERT_FAILED {inp} -> {out}: {exc}", flush=True)
        print(f"CONVERT_JOB_DONE {os.path.basename(job['model'])} pitch={job.get('pitch', 0)} "
              f"steps={SNAP['strength']} files={done} seconds={time.time() - t:.1f}", flush=True)
    sys.exit(1 if failures else 0)
