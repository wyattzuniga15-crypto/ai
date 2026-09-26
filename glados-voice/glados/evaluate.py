"""Male test clip, checkpoint selection, export, pitch samples.

Choosing a checkpoint: every saved snapshot converts the held-out GLaDOS lines
(never trained on) back into GLaDOS at pitch 0 with no index, and a male test
clip at +12 with the index. Two measurements per snapshot:

  * held-out error: mel-cepstral distance between each held-out line and its
    re-synthesis. This rises again when the model starts memorising the
    training set, so it is the overtraining signal.
  * timbre distance: Frechet distance between MFCC statistics of the converted
    male clip and of the GLaDOS training set, i.e. how much the output of a
    *different* speaker sounds like her.

Both are smoothed over neighbouring snapshots and combined; the lowest wins.
"""

from __future__ import annotations

import csv
import math
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np

from . import applio as AP
from . import audio as A
from .common import LOG, MODEL_NAME, Blocked, StepFailed, Workspace, read_json, run, write_json

AUDIO_IN = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus")
TEST_TEXT = ("Hello, and welcome to the test. Today we will find out how well you follow very "
             "simple instructions. Please stand on the marked square and remain perfectly calm. "
             "Your results will be recorded, and then, most likely, ignored.")
PITCHES = (8, 12, 14)


# ----------------------------------------------------------------------------- test clip

def _normalise_speech(x: np.ndarray, sr: int) -> np.ndarray:
    y = A.resample(x, sr)
    y = A.highpass(y, A.TARGET_SR, 60.0)
    s, e = A.trim_bounds(y, A.TARGET_SR)
    y = A.fade(y[s:e], A.TARGET_SR)
    loud = A.lufs(y, A.TARGET_SR)
    g = -20.0 - loud if np.isfinite(loud) else 0.0
    g = min(g, -1.0 - 20 * np.log10(np.max(np.abs(y)) + 1e-9))
    return (y * 10 ** (g / 20)).astype(np.float32)


def _tts_edge(ws: Workspace, mp3: Path) -> bool:
    rc, tail, _ = run([ws.applio_python, "-m", "edge_tts", "--voice", "en-US-GuyNeural", "--text",
                       TEST_TEXT, "--write-media", mp3], cwd=ws.applio, check=False, quiet=True,
                      log_name="samples.log", logs_dir=ws.logs, timeout=120)
    return rc == 0 and mp3.exists() and mp3.stat().st_size > 5000


def _tts_sapi(wav: Path) -> bool:
    ps = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object {{ $_.Enabled -and $_.VoiceInfo.Gender -eq 'Male' -and $_.VoiceInfo.Culture.Name -like 'en*' }} | Select-Object -First 1
if ($v) {{ $s.SelectVoice($v.VoiceInfo.Name) }}
$s.Rate = -1
$s.SetOutputToWaveFile('{str(wav).replace("'", "''")}')
$s.Speak('{TEST_TEXT.replace("'", "''")}')
$s.Dispose()
"""
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=120)
        return r.returncode == 0 and wav.exists() and wav.stat().st_size > 5000
    except Exception:
        return False


def user_inputs(ws: Workspace) -> list[Path]:
    ws.samples_input.mkdir(parents=True, exist_ok=True)
    return sorted(p for p in ws.samples_input.iterdir() if p.suffix.lower() in AUDIO_IN)


def make_test_clip(ws: Workspace) -> dict:
    """samples/male_test_original.wav: the user's recording if given, else a male TTS voice."""
    work = ws.samples / "_work"
    work.mkdir(parents=True, exist_ok=True)
    mine = user_inputs(ws)
    if mine:
        src, kind = mine[0], f"your recording {mine[0].name}"
    else:
        src, kind = work / "male_tts.mp3", "male text-to-speech voice (Microsoft Guy, neural)"
        if not _tts_edge(ws, src):
            src, kind = work / "male_tts.wav", "male text-to-speech voice (Windows SAPI)"
            if not _tts_sapi(src):
                raise Blocked("Could not create a male test clip (no internet TTS and no Windows voice). "
                              f"Put a short recording of a man talking (WAV/MP3) into {ws.samples_input} "
                              "and re-run.")
    x, sr, _ = A.load_audio(src)
    y = _normalise_speech(x, sr)
    out = ws.samples / "male_test_original.wav"
    A.write_wav16(out, y)
    male_dir = ws.eval / "male_input"
    shutil.rmtree(male_dir, ignore_errors=True)
    A.write_wav16(male_dir / "male_test.wav", y)
    f0 = A.yin_f0(y, A.TARGET_SR)
    v = f0[f0 > 0]
    info = {"source": kind, "seconds": round(len(y) / A.TARGET_SR, 1),
            "f0_median_hz": round(float(np.median(v)), 1) if v.size else None}
    LOG.info("Male test clip: %s, %.1f s, median pitch %s Hz -> %s", kind, info["seconds"],
             info["f0_median_hz"], out)
    return info


# ----------------------------------------------------------------------------- metrics

def _frame_level_db(m: np.ndarray, n_mels: int = 80) -> np.ndarray:
    """Mean log-mel level in dB from c0 of an orthonormal-DCT MFCC."""
    return m[:, 0] * 10.0 / np.sqrt(n_mels)


def _active_mfcc(x: np.ndarray, sr: int, range_db: float = 35.0) -> np.ndarray:
    m = A.mfcc(x, sr, n=25)
    lvl = _frame_level_db(m)
    return m[lvl > lvl.max() - range_db, 1:]


def glados_reference(ws: Workspace, max_files: int = 400) -> dict:
    cache = ws.eval / "glados_reference.npz"
    if cache.exists() and cache.stat().st_mtime > max((f.stat().st_mtime for f in ws.dataset.glob("*.wav")), default=0):
        d = np.load(cache)
        return {"mu": d["mu"], "cov": d["cov"]}
    files = sorted(ws.dataset.glob("*.wav"))
    rng = np.random.default_rng(0)
    if len(files) > max_files:
        files = list(rng.choice(files, max_files, replace=False))
    frames = [_active_mfcc(*A.read_wav(f)) for f in files]
    allf = np.concatenate(frames, axis=0)
    mu, cov = allf.mean(axis=0), np.cov(allf, rowvar=False)
    np.savez(cache, mu=mu, cov=cov)
    return {"mu": mu, "cov": cov}


def frechet(mu1, cov1, mu2, cov2) -> float:
    diff = mu1 - mu2
    # tr(sqrtm(C1 C2)) = sum of sqrt(eigenvalues of C1 C2); those are real and >= 0
    # for covariance matrices (tiny negatives/imaginary parts are round-off).
    eig = np.real(np.linalg.eigvals(cov1 @ cov2))
    tr_covmean = float(np.sum(np.sqrt(np.clip(eig, 0, None))))
    return float(diff @ diff + np.trace(cov1) + np.trace(cov2) - 2 * tr_covmean)


def timbre_distance(wav: Path, ref: dict) -> float:
    x, sr = A.read_wav(wav)
    f = _active_mfcc(x, sr)
    if len(f) < 30:
        return float("nan")
    return frechet(f.mean(axis=0), np.cov(f, rowvar=False), ref["mu"], ref["cov"])


def _align(ref: np.ndarray, out: np.ndarray, sr: int, max_shift_s: float = 0.2):
    """Shift `out` so its energy envelope lines up with `ref` (RVC keeps timing)."""
    hop = int(sr * 0.005)
    a = A.frame_db(ref, sr, 0.02, 0.005)
    b = A.frame_db(out, sr, 0.02, 0.005)
    # Floor at 60 dB under the peak: digital silence (-100 dB) would otherwise
    # dominate the correlation and pull the alignment off.
    a, b = np.maximum(a, a.max() - 60), np.maximum(b, b.max() - 60)
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    max_lag = int(max_shift_s / 0.005)
    best, best_lag = -np.inf, 0
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            c = np.dot(a[lag:], b[: n - lag])
        else:
            c = np.dot(a[: n + lag], b[-lag:])
        if c > best:
            best, best_lag = c, lag
    shift = best_lag * hop
    if shift > 0:
        out = np.concatenate([np.zeros(shift, dtype=out.dtype), out])
    elif shift < 0:
        out = out[-shift:]
    m = min(len(ref), len(out))
    return ref[:m], out[:m]


def mel_cepstral_distance(ref_wav: Path, out_wav: Path) -> float:
    r, sr = A.read_wav(ref_wav)
    o, sr2 = A.read_wav(out_wav)
    if sr2 != sr:
        o = A.resample(o, sr2, sr)
    r, o = _align(r, o, sr)
    mr, mo = A.mfcc(r, sr, n=25), A.mfcc(o, sr, n=25)
    n = min(len(mr), len(mo))
    mr, mo = mr[:n], mo[:n]
    lvl = _frame_level_db(mr)
    active = lvl > lvl.max() - 35.0
    d = mr[active, 1:] - mo[active, 1:]
    # MFCCs here are log10-based; 10/ln10*sqrt(2*sum) is the usual MCD scaling in dB
    return float(np.mean(10.0 / math.log(10) * np.sqrt(2 * np.sum(d ** 2, axis=1))))


def _smooth(v: np.ndarray) -> np.ndarray:
    if len(v) < 3:
        return v
    p = np.pad(v, 1, mode="edge")
    return (p[:-2] + p[1:-1] + p[2:]) / 3


# ----------------------------------------------------------------------------- selection

def select_checkpoint(ws: Workspace, gpu: dict, index_path: str, epochs: int,
                      min_epoch_frac: float = 0.3, male_pitch: int = 12) -> dict:
    weights = AP.weight_files(ws.experiment)
    if not weights:
        raise StepFailed("No weight snapshots found; training did not save any")
    min_epoch = max(1, int(epochs * min_epoch_frac))
    cands = [w for w in weights if w[0] >= min_epoch] or weights
    holdout = sorted(ws.holdout.glob("*.wav"))
    male = sorted((ws.eval / "male_input").glob("*.wav"))
    if not holdout:
        raise StepFailed("No held-out lines in eval/holdout; re-run the clean step")
    LOG.info("Scoring %d snapshots (epochs %d-%d) on %d held-out lines + the male test clip",
             len(cands), cands[0][0], cands[-1][0], len(holdout))
    jobs = []
    for ep, step, pth in cands:
        base = ws.eval / f"epoch_{ep:04d}"
        jobs.append({"model": str(pth), "index": "", "pitch": 0, "index_rate": 0.0, "protect": 0.5,
                     "pairs": [[str(h), str(base / "holdout" / h.name)] for h in holdout]})
        if male:
            jobs.append({"model": str(pth), "index": index_path, "pitch": male_pitch, "index_rate": 0.5,
                         "protect": 0.33, "pairs": [[str(m), str(base / "male" / m.name)] for m in male]})
    AP.convert(ws, gpu, jobs, ws.eval / "select_jobs.json", log_name="applio_eval.log")

    ref = glados_reference(ws)
    rows = []
    for ep, step, pth in cands:
        base = ws.eval / f"epoch_{ep:04d}"
        # Scores are cheap to recompute (only the conversions are cached), so they
        # always reflect the current metric code.
        mcds = [mel_cepstral_distance(h, base / "holdout" / h.name) for h in holdout
                if (base / "holdout" / h.name).exists()]
        tds = [timbre_distance(base / "male" / m.name, ref) for m in male if (base / "male" / m.name).exists()]
        sc = {"heldout_mcd_db": float(np.mean(mcds)) if mcds else float("nan"),
              "timbre_distance": float(np.nanmean(tds)) if tds else float("nan")}
        write_json(base / "scores.json", sc)
        rows.append({"epoch": ep, "step": step, "file": pth.name, **sc})

    mcd = np.array([r["heldout_mcd_db"] for r in rows])
    td = np.array([r["timbre_distance"] for r in rows])

    def z(v):
        v = np.where(np.isfinite(v), v, np.nanmax(v) if np.isfinite(v).any() else 0)
        s = v.std()
        return (v - v.mean()) / s if s > 0 else np.zeros_like(v)

    mcd_s, td_s = _smooth(mcd), _smooth(td)
    has_td = np.isfinite(td).any()
    combined = 0.65 * z(mcd_s) + 0.35 * z(td_s) if has_td else z(mcd_s)
    for r, a, b, c in zip(rows, mcd_s, td_s, combined):
        r.update(heldout_mcd_smoothed=round(float(a), 4), timbre_smoothed=round(float(b), 4),
                 combined_score=round(float(c), 4))
    best = int(np.argmin(combined))
    chosen = rows[best]

    with open(ws.eval / "checkpoint_scores.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    best_mcd_i = int(np.nanargmin(mcd_s))
    overtrain = {
        "best_heldout_epoch": rows[best_mcd_i]["epoch"],
        "heldout_mcd_best": round(float(mcd_s[best_mcd_i]), 3),
        "heldout_mcd_final": round(float(mcd_s[-1]), 3),
        "final_vs_best_pct": round(100 * (mcd_s[-1] - mcd_s[best_mcd_i]) / mcd_s[best_mcd_i], 2),
    }
    overtrain["verdict"] = (
        "held-out error rose after its best point: the last epochs were overtraining"
        if overtrain["final_vs_best_pct"] > 1.5 and overtrain["best_heldout_epoch"] < rows[-1]["epoch"]
        else "no clear overtraining: held-out error was still flat or falling at the end")

    tb_csv = AP.tensorboard_scalars(ws, ws.eval / "tensorboard_scalars.csv")
    result = {"chosen_epoch": chosen["epoch"], "chosen_step": chosen["step"],
              "chosen_file": str(ws.experiment / chosen["file"]),
              "chosen_scores": {k: chosen[k] for k in ("heldout_mcd_db", "timbre_distance", "combined_score")},
              "last_epoch": rows[-1]["epoch"], "candidates": len(rows), "overtraining": overtrain,
              "table": [{k: r[k] for k in ("epoch", "heldout_mcd_db", "timbre_distance", "combined_score")}
                        for r in rows],
              "tensorboard_csv": str(tb_csv) if tb_csv else None}
    write_json(ws.eval / "selection.json", result)
    LOG.info("Best snapshot: epoch %d (held-out MCD %.3f dB, timbre distance %.3f). %s.",
             chosen["epoch"], chosen["heldout_mcd_db"], chosen["timbre_distance"], overtrain["verdict"])
    return result


# ----------------------------------------------------------------------------- export

def export(ws: Workspace, chosen_file: str, index_info: dict) -> dict:
    ws.model.mkdir(parents=True, exist_ok=True)
    pth = ws.model / f"{MODEL_NAME}.pth"
    idx = ws.model / f"{MODEL_NAME}.index"
    shutil.copyfile(chosen_file, pth)
    shutil.copyfile(index_info["index"], idx)
    res = AP._verify(ws, "weights", pth)
    if not res["ok"]:
        raise StepFailed("The exported model failed its checks: " + "; ".join(res["problems"]))
    zpath = ws.model / f"{MODEL_NAME}.zip"
    _zip(zpath, [pth, idx])
    out = {"pth": str(pth), "index": str(idx), "zip": str(zpath),
           "zip_megabytes": round(zpath.stat().st_size / 1e6, 1), "model_info": res["info"]}
    if index_info.get("compact_index"):
        cidx = ws.model / f"{MODEL_NAME}_compact.index"
        shutil.copyfile(index_info["compact_index"], cidx)
        czip = ws.model / f"{MODEL_NAME}_compact.zip"
        with zipfile.ZipFile(czip, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(pth, pth.name)
            z.write(cidx, f"{MODEL_NAME}.index")
        out["compact_zip"] = str(czip)
        out["compact_zip_megabytes"] = round(czip.stat().st_size / 1e6, 1)
    LOG.info("Model exported: %s + %s -> %s (%.0f MB)", pth.name, idx.name, zpath, out["zip_megabytes"])
    return out


def _zip(zpath: Path, files: list[Path]):
    tmp = zpath.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.name)
    with zipfile.ZipFile(tmp) as z:
        bad = z.testzip()
        if bad:
            raise StepFailed(f"Zip check failed on {bad}")
    tmp.replace(zpath)


# ----------------------------------------------------------------------------- samples

def recommend_pitch(male_f0: float | None, glados_f0: float | None) -> dict:
    if not male_f0 or not glados_f0:
        return {"exact": None, "recommended": 12}
    exact = 12 * math.log2(glados_f0 / male_f0)
    rec = min(PITCHES, key=lambda p: abs(p - exact))
    return {"exact": round(exact, 1), "recommended": rec}


def make_samples(ws: Workspace, gpu: dict, index_rate: float = 0.6) -> dict:
    pth, idx = ws.model / f"{MODEL_NAME}.pth", ws.model / f"{MODEL_NAME}.index"
    inputs = [ws.samples / "male_test_original.wav"]
    extra = [p for p in user_inputs(ws)]
    work = ws.samples / "_work"
    prepared = []
    for p in extra:  # user recordings: normalise first so all samples are comparable
        x, sr, _ = A.load_audio(p)
        q = work / f"{p.stem}_prepared.wav"
        A.write_wav16(q, _normalise_speech(x, sr))
        prepared.append((q, p.stem))
    jobs, outputs = [], []
    for pitch in PITCHES:
        pairs = [[str(inputs[0]), str(ws.samples / f"GLaDOS_pitch+{pitch:02d}.wav")]]
        for q, stem in prepared:
            pairs.append([str(q), str(ws.samples / f"{stem}_GLaDOS_pitch+{pitch:02d}.wav")])
        for _, out in pairs:
            Path(out).unlink(missing_ok=True)
        outputs += [o for _, o in pairs]
        jobs.append({"model": str(pth), "index": str(idx), "pitch": pitch, "index_rate": index_rate,
                     "protect": 0.33, "pairs": pairs})
    AP.convert(ws, gpu, jobs, work / "sample_jobs.json", log_name="samples.log")
    missing = [o for o in outputs if not Path(o).exists()]
    if missing:
        raise StepFailed(f"Sample conversion did not write: {missing}")
    report = read_json(ws.clean / "cleaning_report.json", {})
    male_f0 = read_json(ws.logs / "state.json", {}).get("steps", {}).get("test_clip", {}).get("info", {}).get("f0_median_hz")
    rec = recommend_pitch(male_f0, report.get("glados_f0_median_hz"))
    measured = {}
    for pitch in PITCHES:
        x, sr = A.read_wav(ws.samples / f"GLaDOS_pitch+{pitch:02d}.wav")
        f0 = A.yin_f0(x, sr)
        v = f0[f0 > 0]
        measured[f"+{pitch}"] = round(float(np.median(v)), 1) if v.size else None
    LOG.info("Samples written to %s. GLaDOS's median pitch is %s Hz, the male clip's %s Hz, so the "
             "ideal shift is %s semitones; closest tested: +%d.", ws.samples,
             report.get("glados_f0_median_hz"), male_f0, rec["exact"], rec["recommended"])
    return {"files": [Path(o).name for o in outputs], "index_rate": index_rate,
            "output_f0_median_hz": measured, "pitch": rec}
