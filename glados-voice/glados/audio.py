"""Audio I/O and the small DSP toolkit the cleaner and the checkpoint scorer share.

Everything here is numpy/scipy so the pipeline venv stays light (no torch).
"""

from __future__ import annotations

import re
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
from numpy.lib.stride_tricks import sliding_window_view
from scipy import signal
from scipy.fft import dct

TARGET_SR = 40000
EPS = 1e-10


# ----------------------------------------------------------------------------- I/O

@lru_cache(maxsize=1)
def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _ffmpeg_decode(path: Path):
    exe = ffmpeg_exe()
    probe = subprocess.run([exe, "-hide_banner", "-i", str(path)], capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
    m = re.search(r"Audio: ([^,]+), (\d+) Hz, ([^,]+)", probe.stderr)
    if not m:
        raise ValueError(f"ffmpeg cannot find an audio stream: {probe.stderr.strip()[-300:]}")
    sr = int(m.group(2))
    out = subprocess.run([exe, "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1",
                          "-f", "f32le", "-acodec", "pcm_f32le", "-"], capture_output=True)
    if out.returncode != 0 or not out.stdout:
        raise ValueError(f"ffmpeg failed to decode: {out.stderr.decode(errors='replace')[-300:]}")
    x = np.frombuffer(out.stdout, dtype="<f4").astype(np.float32)
    return x, sr, {"codec": m.group(1).strip(), "channels": m.group(3).strip(), "decoder": "ffmpeg"}


def load_audio(path: Path):
    """Decode any audio file to mono float32. Returns (samples, sample_rate, info)."""
    path = Path(path)
    try:
        x, sr = sf.read(str(path), dtype="float32", always_2d=True)
        info = sf.info(str(path))
        meta = {"codec": info.subtype, "channels": x.shape[1], "decoder": "libsndfile"}
        x = x.mean(axis=1).astype(np.float32)
        if x.size == 0:
            raise ValueError("empty")
        return x, int(sr), meta
    except Exception:
        return _ffmpeg_decode(path)


def resample(x: np.ndarray, sr: int, target: int = TARGET_SR) -> np.ndarray:
    if sr == target:
        return x.astype(np.float32)
    return soxr.resample(x.astype(np.float32), sr, target, quality="VHQ").astype(np.float32)


def write_wav16(path: Path, x: np.ndarray, sr: int = TARGET_SR):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".part.wav")
    sf.write(str(tmp), np.clip(x, -1.0, 32767 / 32768), sr, subtype="PCM_16")
    tmp.replace(path)


def read_wav(path: Path):
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x.mean(axis=1), sr


# ----------------------------------------------------------------------------- framing

def frames(x: np.ndarray, n: int, hop: int) -> np.ndarray:
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    return sliding_window_view(x, n)[::hop]


def frame_db(x: np.ndarray, sr: int, win: float = 0.02, hop: float = 0.01) -> np.ndarray:
    f = frames(x, int(sr * win), int(sr * hop))
    return 10 * np.log10(np.mean(f.astype(np.float64) ** 2, axis=1) + EPS)


def highpass(x: np.ndarray, sr: int, hz: float = 50.0) -> np.ndarray:
    sos = signal.butter(4, hz, btype="highpass", fs=sr, output="sos")
    if len(x) < 64:
        return x
    return signal.sosfiltfilt(sos, x).astype(np.float32)


def trim_bounds(x: np.ndarray, sr: int, rel_db: float = 40.0, abs_floor_db: float = -60.0,
                pad_s: float = 0.12):
    """Sample range that keeps speech plus a little breathing room at each end."""
    hop = int(sr * 0.005)
    db = frame_db(x, sr, 0.02, 0.005)
    if db.size == 0:
        return 0, 0
    thr = max(db.max() - rel_db, abs_floor_db)
    on = np.flatnonzero(db > thr)
    if on.size == 0:
        return 0, 0
    pad = int(pad_s * sr)
    start = max(0, on[0] * hop - pad)
    end = min(len(x), on[-1] * hop + int(0.02 * sr) + pad)
    return int(start), int(end)


def fade(x: np.ndarray, sr: int, ms: float = 8.0) -> np.ndarray:
    n = min(int(sr * ms / 1000), len(x) // 2)
    if n <= 1:
        return x
    y = x.copy()
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    y[:n] *= ramp
    y[-n:] *= ramp[::-1]
    return y


def lufs(x: np.ndarray, sr: int) -> float:
    import pyloudnorm as pyln

    if len(x) < int(0.45 * sr):
        x = np.pad(x, (0, int(0.45 * sr) - len(x)))
    try:
        v = pyln.Meter(sr).integrated_loudness(x.astype(np.float64))
    except Exception:
        return float("-inf")
    return float(v)


# ----------------------------------------------------------------------------- spectra

@lru_cache(maxsize=8)
def _hann(n: int) -> np.ndarray:
    return signal.get_window("hann", n).astype(np.float32)


def power_spec(x: np.ndarray, sr: int, n_fft: int = 2048, hop: int = 400):
    f = frames(x, n_fft, hop) * _hann(n_fft)
    S = np.abs(np.fft.rfft(f, axis=1)) ** 2  # (T, F)
    return S.astype(np.float64), np.fft.rfftfreq(n_fft, 1.0 / sr)


@lru_cache(maxsize=8)
def mel_fb(sr: int, n_fft: int, n_mels: int, fmin: float = 40.0, fmax: float | None = None) -> np.ndarray:
    fmax = fmax or sr / 2
    def hz2mel(h):
        return 2595.0 * np.log10(1.0 + np.asarray(h) / 700.0)
    def mel2hz(m):
        return 700.0 * (10 ** (np.asarray(m) / 2595.0) - 1.0)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    pts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    fb = np.zeros((n_mels, freqs.size))
    for i in range(n_mels):
        lo, c, hi = pts[i], pts[i + 1], pts[i + 2]
        up = (freqs - lo) / max(c - lo, EPS)
        down = (hi - freqs) / max(hi - c, EPS)
        fb[i] = np.maximum(0, np.minimum(up, down))
    fb /= np.maximum(fb.sum(axis=1, keepdims=True), EPS)
    return fb


def log_mel(x: np.ndarray, sr: int, n_mels: int = 80, n_fft: int = 2048, hop: int = 400,
            range_db: float = 80.0) -> np.ndarray:
    """log10 mel power, (T, n_mels), floored `range_db` under the loudest bin so that
    near-empty bands and digital silence cannot dominate distances."""
    S, _ = power_spec(x, sr, n_fft, hop)
    lm = np.log10(S @ mel_fb(sr, n_fft, n_mels).T + 1e-12)
    return np.maximum(lm, lm.max() - range_db / 10.0)


def mfcc(x: np.ndarray, sr: int, n: int = 25, n_mels: int = 80, hop: int = 400) -> np.ndarray:
    lm = log_mel(x, sr, n_mels=n_mels, hop=hop)
    return dct(lm, type=2, norm="ortho", axis=1)[:, :n]  # (T, n); c0 is loudness


# ----------------------------------------------------------------------------- pitch (YIN)

def yin_f0(x: np.ndarray, sr: int, fmin: float = 60.0, fmax: float = 1000.0,
           threshold: float = 0.15, hop_s: float = 0.01) -> np.ndarray:
    """Frame-wise f0 in Hz (0 = unvoiced). Vectorised YIN at 16 kHz."""
    if sr != 16000:
        x = resample(x, sr, 16000)
    sr = 16000
    W = int(0.04 * sr)
    tau_min, tau_max = int(sr / fmax), int(sr / fmin)
    Wp = W - tau_max
    F = frames(x.astype(np.float64), W, int(hop_s * sr))
    if F.shape[0] == 0:
        return np.zeros(0)
    x0 = F[:, :Wp]
    e0 = np.sum(x0 ** 2, axis=1)
    cs = np.concatenate([np.zeros((F.shape[0], 1)), np.cumsum(F ** 2, axis=1)], axis=1)
    taus = np.arange(tau_max + 1)
    e_tau = cs[:, taus + Wp] - cs[:, taus]
    N = 1 << int(np.ceil(np.log2(W + Wp)))
    A = np.fft.rfft(x0, N, axis=1)
    B = np.fft.rfft(F, N, axis=1)
    corr = np.fft.irfft(np.conj(A) * B, N, axis=1)[:, : tau_max + 1]
    d = np.maximum(e0[:, None] + e_tau - 2 * corr, 0)
    cm = np.cumsum(d[:, 1:], axis=1)
    cmnd = np.ones_like(d)
    cmnd[:, 1:] = d[:, 1:] * taus[1:] / np.maximum(cm, EPS)
    seg = cmnd[:, tau_min:]
    below = seg < threshold
    has = below.any(axis=1)
    idx = np.argmax(below, axis=1)
    # walk down to the local minimum after the first threshold crossing
    for _ in range(40):
        nxt = np.minimum(idx + 1, seg.shape[1] - 1)
        better = seg[np.arange(len(idx)), nxt] < seg[np.arange(len(idx)), idx]
        if not better.any():
            break
        idx = np.where(better, nxt, idx)
    tau = idx + tau_min
    # parabolic interpolation
    rows = np.arange(len(tau))
    t0 = np.clip(tau - 1, 1, tau_max)
    t2 = np.clip(tau + 1, 1, tau_max)
    a, b, c = cmnd[rows, t0], cmnd[rows, tau], cmnd[rows, t2]
    den = a - 2 * b + c
    shift = np.where(np.abs(den) > EPS, 0.5 * (a - c) / np.where(np.abs(den) > EPS, den, 1), 0)
    f0 = sr / np.maximum(tau + np.clip(shift, -1, 1), 1)
    # silence is not voiced
    energy_db = 10 * np.log10(e0 / Wp + EPS)
    active = energy_db > (energy_db.max() - 40 if energy_db.size else 0)
    return np.where(has & active, f0, 0.0)


def sustained_ratio(f0: np.ndarray, min_frames: int = 35, cents_tol: float = 50.0) -> float:
    """Share of voiced frames that sit on one held note for >= min_frames (singing)."""
    voiced = f0 > 0
    if voiced.sum() < min_frames:
        return 0.0
    cents = np.where(voiced, 1200 * np.log2(np.maximum(f0, 1) / 55.0), np.nan)
    held = 0
    run_start, anchor = None, None
    for i, c in enumerate(np.append(cents, np.nan)):
        if not np.isnan(c) and anchor is not None and abs(c - anchor) <= cents_tol:
            continue
        if run_start is not None and i - run_start >= min_frames:
            held += i - run_start
        if np.isnan(c):
            run_start, anchor = None, None
        else:
            run_start, anchor = i, c
    return float(held / voiced.sum())


# ----------------------------------------------------------------------------- analysis

def analyze(x: np.ndarray, sr: int) -> dict:
    """Quality features for one converted line (float mono at `sr`, untrimmed)."""
    feats: dict = {}
    feats["duration_s"] = len(x) / sr
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    feats["peak_dbfs"] = 20 * np.log10(peak + EPS)
    # clipping: flat tops at (near) full scale
    hot = np.abs(x) >= 0.985
    feats["clip_frac"] = float(np.mean(hot[1:] & hot[:-1])) if len(x) > 1 else 0.0

    db = frame_db(x, sr)
    p95 = float(np.percentile(db, 95)) if db.size else -100.0
    feats["rel_floor_edges_db"] = float(np.percentile(db, 5)) - p95 if db.size else 0.0

    s, e = trim_bounds(x, sr)
    y = x[s:e]
    feats["trim_start_s"] = s / sr
    feats["trim_end_s"] = e / sr
    feats["trimmed_s"] = len(y) / sr
    if len(y) < int(0.25 * sr):
        feats["silent"] = True
        return feats
    feats["silent"] = False

    dby = frame_db(y, sr)
    feats["rel_floor_inner_db"] = float(np.percentile(dby, 10) - np.percentile(dby, 95))

    S, freqs = power_spec(y, sr)
    fr_db = 10 * np.log10(S.sum(axis=1) + EPS)
    act = fr_db > fr_db.max() - 35
    Sa = S[act] if act.sum() >= 3 else S
    # Speech band only, so narrow-band sources are not scored as "tonal".
    band = (freqs >= 150) & (freqs <= 6000)
    Sb = Sa[:, band]
    Sb = Sb + 1e-9 * Sb.max(axis=1, keepdims=True) + EPS
    flat = np.exp(np.mean(np.log(Sb), axis=1)) / np.mean(Sb, axis=1)
    feats["flatness"] = float(np.median(flat))
    tot = Sa.sum() + EPS
    feats["hf_ratio_db"] = float(10 * np.log10(Sa[:, freqs > 8000].sum() / tot + EPS))
    feats["lf_ratio_db"] = float(10 * np.log10(Sa[:, freqs < 120].sum() / tot + EPS))
    # Radio / telephone / heavily filtered lines have almost nothing above 4.5 kHz,
    # whatever the spectral tilt; normal speech keeps sibilance up there.
    feats["presence_db"] = float(10 * np.log10(Sa[:, freqs > 4500].sum() / tot + EPS))
    # Informational: where the long-term spectrum falls 60 dB under its peak.
    ltas = 10 * np.log10(np.convolve(Sa.mean(axis=0), np.ones(9) / 9, mode="same") + EPS)
    above = np.flatnonzero(ltas > ltas.max() - 60)
    feats["bandwidth_hz"] = float(freqs[above[-1]]) if above.size else 0.0

    f0 = yin_f0(y, sr)
    v = f0[f0 > 0]
    feats["voiced_ratio"] = float(len(v) / max(1, len(f0)))
    feats["f0_median"] = float(np.median(v)) if v.size else 0.0
    feats["f0_p90"] = float(np.percentile(v, 90)) if v.size else 0.0
    feats["high_pitch_frac"] = float(np.mean(v > 500)) if v.size else 0.0
    feats["sustained_ratio"] = sustained_ratio(f0)
    feats["lufs"] = lufs(y, sr)
    return feats


def fingerprint(y: np.ndarray, sr: int, n_mels: int = 40, length: int = 128) -> np.ndarray:
    """Fixed-size log-mel image of a trimmed line, for near-duplicate detection."""
    lm = log_mel(y, sr, n_mels=n_mels, hop=800)  # 20 ms
    if lm.shape[0] < 2:
        lm = np.repeat(lm, 2, axis=0)
    t_old = np.linspace(0, 1, lm.shape[0])
    t_new = np.linspace(0, 1, length)
    img = np.stack([np.interp(t_new, t_old, lm[:, k]) for k in range(n_mels)], axis=1)
    img = img - img.mean(axis=0, keepdims=True)
    v = img.ravel()
    return (v / (np.linalg.norm(v) + EPS)).astype(np.float32)
