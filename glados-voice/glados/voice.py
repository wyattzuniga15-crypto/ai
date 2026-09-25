"""Converting your own recordings with the finished model.

Shared by GLaDOS mode (glados_mode.bat), the settings search (tune.bat) and
the drop-folder converter (convert_folder.bat).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path

import numpy as np

from . import applio as AP
from . import audio as A
from .common import LOG, MODEL_NAME, Blocked, State, Workspace, read_json, write_json

AUDIO_IN = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus")
BEST_SETTINGS = "best_settings.json"


@dataclass
class Settings:
    pitch: int = 12
    index_rate: float = 0.6
    protect: float = 0.33
    autotune_strength: float = 0.0  # 0 = natural pitch; 1 = fully snapped to semitone steps
    snap_hold: int = 5              # frames (10 ms each) a new note must hold before the step moves
    volume_envelope: float = 1.0

    def tag(self) -> str:
        t = f"p{self.pitch:+d}_ir{self.index_rate:.2f}_pr{self.protect:.2f}"
        if self.autotune_strength > 0:
            t += f"_at{self.autotune_strength:.2f}"
        return t

    @classmethod
    def from_dict(cls, d: dict) -> "Settings":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


def model_files(ws: Workspace) -> tuple[Path, Path]:
    pth, idx = ws.model / f"{MODEL_NAME}.pth", ws.model / f"{MODEL_NAME}.index"
    if not pth.exists() or not idx.exists():
        raise Blocked(f"No finished model in {ws.model}. Run run.bat first (it builds the model).")
    return pth, idx


def model_key(ws: Workspace) -> str:
    """Changes whenever the exported model changes, so cached conversions go stale with it."""
    pth, _ = model_files(ws)
    st = pth.stat()
    return hashlib.sha1(f"{st.st_size}:{st.st_mtime_ns}".encode()).hexdigest()[:8]


def gpu_for_tools(ws: Workspace) -> dict:
    state = State(ws.state_file)
    gpu = state.info("gpu_check")
    if not gpu:
        raise Blocked("The GPU has not been checked yet. Run run.bat first.")
    return gpu


def recommended_pitch(ws: Workspace) -> int:
    rec = State(ws.state_file).info("samples").get("pitch", {}).get("recommended")
    return int(rec) if rec is not None else 12


def default_settings(ws: Workspace) -> tuple[Settings, str]:
    best = read_json(ws.root / BEST_SETTINGS)
    if best and "settings" in best:
        return Settings.from_dict(best["settings"]), f"best settings from {ws.root / BEST_SETTINGS}"
    return Settings(pitch=recommended_pitch(ws)), "defaults (run tune.bat to tune them to your voice)"


def save_best(ws: Workspace, settings: Settings, extra: dict):
    write_json(ws.root / BEST_SETTINGS, {"settings": asdict(settings), **extra})


def normalise_speech(x: np.ndarray, sr: int, trim: bool = True) -> np.ndarray:
    """Mono 40 kHz, 60 Hz high-pass, edges trimmed, -20 LUFS, peak <= -1 dBFS."""
    y = A.highpass(A.resample(x, sr), A.TARGET_SR, 60.0)
    if trim:
        s, e = A.trim_bounds(y, A.TARGET_SR)
        if e - s > A.TARGET_SR // 4:
            y = y[s:e]
    y = A.fade(y, A.TARGET_SR)
    loud = A.lufs(y, A.TARGET_SR)
    g = -20.0 - loud if np.isfinite(loud) else 0.0
    g = min(g, -1.0 - 20 * np.log10(np.max(np.abs(y)) + 1e-9))
    return (y * 10 ** (g / 20)).astype(np.float32)


def collect_inputs(items: list[str], wav_only: bool = False) -> list[Path]:
    exts = (".wav",) if wav_only else AUDIO_IN
    out: list[Path] = []
    for it in items:
        p = Path(it)
        if p.is_dir():
            out += sorted(q for q in p.iterdir() if q.is_file() and q.suffix.lower() in exts)
        elif p.is_file() and p.suffix.lower() in exts:
            out.append(p)
        else:
            LOG.warning("Skipping %s (not a %s file or folder)", it, "/".join(exts))
    seen, uniq = set(), []
    for p in out:
        if p.resolve() not in seen:
            seen.add(p.resolve())
            uniq.append(p)
    return uniq


def prepare(inputs: list[Path], work: Path) -> list[tuple[Path, Path]]:
    """Decode + normalise each input once (cached by content). Returns (original, prepared)."""
    work.mkdir(parents=True, exist_ok=True)
    out = []
    for p in inputs:
        h = hashlib.sha1(p.read_bytes()).hexdigest()[:10]
        q = work / f"{p.stem}_{h}.wav"
        if not q.exists():
            x, sr, _ = A.load_audio(p)
            A.write_wav16(q, normalise_speech(x, sr))
        out.append((p, q))
    return out


def job(pth: Path, idx: Path, s: Settings, pairs: list[tuple[Path, Path]]) -> dict:
    return {"model": str(pth), "index": str(idx), "pitch": int(s.pitch), "index_rate": float(s.index_rate),
            "protect": float(s.protect), "volume_envelope": float(s.volume_envelope),
            "autotune_strength": float(s.autotune_strength), "snap_hold": int(s.snap_hold),
            "pairs": [[str(a), str(b)] for a, b in pairs]}


def run_jobs(ws: Workspace, jobs: list[dict], jobs_file: Path, log_name: str):
    AP.convert(ws, gpu_for_tools(ws), jobs, jobs_file, log_name=log_name)


def concat_with_gaps(parts: list[Path], out: Path, gap_s: float = 0.6):
    """One file that plays several versions back to back, for quick A/B listening."""
    chunks = []
    for p in parts:
        x, sr = A.read_wav(p)
        if sr != A.TARGET_SR:
            x = A.resample(x, sr)
        chunks += [x, np.zeros(int(gap_s * A.TARGET_SR), np.float32)]
    A.write_wav16(out, np.concatenate(chunks[:-1]))


def describe(s: Settings) -> str:
    at = f", GLaDOS-mode steps {s.autotune_strength:.2f}" if s.autotune_strength > 0 else ", natural pitch"
    return f"pitch {s.pitch:+d}, index rate {s.index_rate:.2f}, protect {s.protect:.2f}{at}"


def dump(obj) -> str:
    return json.dumps(obj, indent=2, default=str)
