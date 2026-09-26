"""Settings tuned to your voice (tune.bat).

Takes your recordings in samples\\input, converts them over a staged search of
pitch -> index rate -> protect -> GLaDOS-mode step strength -> pitch fine-tune,
and scores every result against her held-out lines (eval\\holdout, never used in
training). Your words differ from hers, so every measure is content-independent:

  timbre      Frechet distance of MFCC statistics, relative to your unconverted voice
              (1.0 = as far from her as you are, 0 = indistinguishable)
  pitch       |median pitch - her median| in semitones
  range       |pitch spread - her spread| in semitones (flat vs lively delivery)
  steps       |share of pitch held on flat plateaus - hers| (her stepped intonation)
  artifacts   excess noise/buzz: spectral flatness and >8 kHz energy above hers

Writes <root>\\best_settings.json (used by glados_mode.bat and
convert_folder.bat), tuning\\scores.csv with every setting tried, and A/B
comparison files in samples\\compare\\.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import replace
from pathlib import Path

import numpy as np

from . import audio as A
from . import evaluate as EV
from . import voice as V
from .common import LOG, Blocked, Workspace, now, setup_logging

WEIGHTS = {"timbre": 1.0, "pitch": 0.6, "range": 0.3, "steps": 0.4, "artifacts": 0.4}
STAGES = [
    ("index_rate", (0.3, 0.45, 0.6, 0.75, 0.9)),
    ("protect", (0.15, 0.25, 0.33, 0.42, 0.5)),
    ("autotune_strength", (0.0, 0.3, 0.5, 0.7, 0.9)),
]


# ----------------------------------------------------------------------------- measures

def _pitch_stats(x: np.ndarray, sr: int) -> dict:
    f0 = A.yin_f0(x, sr)
    v = f0 > 0
    if v.sum() < 10:
        return {"median_st": float("nan"), "spread_st": float("nan"), "plateau": float("nan")}
    st = 12 * np.log2(f0[v] / 440.0)
    # plateau: consecutive voiced frames that move < 0.15 semitone
    full = np.where(v, 12 * np.log2(np.maximum(f0, 1) / 440.0), np.nan)
    d = np.abs(np.diff(full))
    both = ~np.isnan(d)
    plateau = float(np.mean(d[both] < 0.15)) if both.any() else float("nan")
    return {"median_st": float(np.median(st)), "spread_st": float(np.std(st)), "plateau": plateau}


def _texture(x: np.ndarray, sr: int) -> dict:
    S, freqs = A.power_spec(x, sr)
    lvl = 10 * np.log10(S.sum(axis=1) + 1e-10)
    act = lvl > lvl.max() - 35
    Sa = S[act] if act.sum() >= 3 else S
    band = (freqs >= 150) & (freqs <= 6000)
    Sb = Sa[:, band] + 1e-9 * Sa[:, band].max(axis=1, keepdims=True) + 1e-10
    flat = float(np.median(np.exp(np.mean(np.log(Sb), axis=1)) / np.mean(Sb, axis=1)))
    hf = float(10 * np.log10(Sa[:, freqs > 8000].sum() / (Sa.sum() + 1e-10) + 1e-10))
    return {"flatness": flat, "hf_db": hf}


def measure(path: Path) -> dict:
    x, sr = A.read_wav(path)
    m = EV._active_mfcc(x, sr)
    out = {"mu": m.mean(axis=0), "cov": np.cov(m, rowvar=False), "frames": len(m)}
    out.update(_pitch_stats(x, sr))
    out.update(_texture(x, sr))
    return out


def reference(ws: Workspace) -> dict:
    files = sorted(ws.holdout.glob("*.wav"))
    if len(files) < 3:
        files += sorted(ws.dataset.glob("*.wav"))[:40]
    if not files:
        raise Blocked("No held-out GLaDOS lines found (eval\\holdout). Run run.bat first.")
    mfcc, pitch, spread, plat, flat, hf = [], [], [], [], [], []
    for f in files:
        x, sr = A.read_wav(f)
        mfcc.append(EV._active_mfcc(x, sr))
        p = _pitch_stats(x, sr)
        t = _texture(x, sr)
        if np.isfinite(p["median_st"]):
            pitch.append(p["median_st"])
            spread.append(p["spread_st"])
            plat.append(p["plateau"])
        flat.append(t["flatness"])
        hf.append(t["hf_db"])
    allm = np.concatenate(mfcc)
    return {"mu": allm.mean(axis=0), "cov": np.cov(allm, rowvar=False), "median_st": float(np.median(pitch)),
            "spread_st": float(np.median(spread)), "plateau": float(np.median(plat)),
            "flatness": float(np.median(flat)), "hf_db": float(np.median(hf)), "lines": len(files),
            "median_hz": round(440 * 2 ** (float(np.median(pitch)) / 12), 1)}


def score(m: dict, ref: dict, baseline_timbre: float) -> dict:
    fd = EV.frechet(m["mu"], m["cov"], ref["mu"], ref["cov"]) if m["frames"] > 30 else float("nan")
    parts = {
        "timbre": fd / baseline_timbre if baseline_timbre > 0 else fd,
        "pitch": abs(m["median_st"] - ref["median_st"]),
        "range": abs(m["spread_st"] - ref["spread_st"]),
        "steps": abs(m["plateau"] - ref["plateau"]) / 0.1,
        "artifacts": max(0.0, m["flatness"] - ref["flatness"]) / 0.02 + max(0.0, m["hf_db"] - ref["hf_db"]) / 3.0,
    }
    parts = {k: (v if np.isfinite(v) else 10.0) for k, v in parts.items()}
    parts["total"] = sum(WEIGHTS[k] * parts[k] for k in WEIGHTS)
    return parts


# ----------------------------------------------------------------------------- search

class Search:
    def __init__(self, ws: Workspace, prepared, ref, baselines):
        self.ws, self.prepared, self.ref, self.baselines = ws, prepared, ref, baselines
        self.pth, self.idx = V.model_files(ws)
        self.results: dict[str, dict] = {}
        self.runs = ws.root / "tuning" / "runs" / V.model_key(ws)  # new model -> fresh conversions

    def out_path(self, s: V.Settings, orig: Path) -> Path:
        return self.runs / s.tag() / f"{orig.stem}.wav"

    def evaluate(self, candidates: list[V.Settings], label: str) -> list[tuple[V.Settings, dict]]:
        todo = [s for s in candidates if s.tag() not in self.results]
        if todo:
            jobs = [V.job(self.pth, self.idx, s, [(prep, self.out_path(s, orig)) for orig, prep in self.prepared])
                    for s in todo]
            V.run_jobs(self.ws, jobs, self.ws.root / "tuning" / f"jobs_{label}.json", "tune.log")
            for s in todo:
                per_clip = []
                for orig, prep in self.prepared:
                    per_clip.append(score(measure(self.out_path(s, orig)), self.ref, self.baselines[orig]))
                agg = {k: float(np.mean([p[k] for p in per_clip])) for k in per_clip[0]}
                self.results[s.tag()] = {"settings": s, **agg}
        ranked = sorted(((self.results[s.tag()]["settings"], self.results[s.tag()]) for s in candidates),
                        key=lambda r: r[1]["total"])
        for s, r in ranked[:3]:
            LOG.info("   %-44s score %.3f (timbre %.2f, pitch %.2f st, range %.2f, steps %.2f, artifacts %.2f)",
                     V.describe(s), r["total"], r["timbre"], r["pitch"], r["range"], r["steps"], r["artifacts"])
        return ranked


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="tune.bat", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", help="your recordings (default: everything in samples\\input)")
    ap.add_argument("--root", default=r"C:\GLaDOSVoice")
    ap.add_argument("--uv", help=argparse.SUPPRESS)
    ap.add_argument("--quick", action="store_true", help=argparse.SUPPRESS)  # tests: 2 values per stage
    a = ap.parse_args(argv)
    ws = Workspace(Path(a.root))
    setup_logging(ws)

    inputs = V.collect_inputs(a.inputs or [str(ws.samples_input)])
    if not inputs:
        raise Blocked(f"Put one or more recordings of your voice (WAV/MP3, 10-60 s each, normal talking) "
                      f"into {ws.samples_input}, then run tune.bat again.")
    prepared = V.prepare(inputs, ws.root / "tuning" / "_prepared")
    LOG.info("Tuning on %d recording(s): %s", len(inputs), ", ".join(p.name for p in inputs))
    ref = reference(ws)
    LOG.info("Reference: %d held-out GLaDOS lines, median pitch %.1f Hz, pitch spread %.2f st, "
             "plateau share %.2f", ref["lines"], ref["median_hz"], ref["spread_st"], ref["plateau"])

    baselines, your_st = {}, []
    for orig, prep in prepared:
        m = measure(prep)
        baselines[orig] = EV.frechet(m["mu"], m["cov"], ref["mu"], ref["cov"])
        if np.isfinite(m["median_st"]):
            your_st.append(m["median_st"])
    if not your_st:
        raise Blocked("No voiced speech found in your recordings; record 10-60 s of normal talking.")
    exact = ref["median_st"] - float(np.median(your_st))
    your_hz = 440 * 2 ** (float(np.median(your_st)) / 12)
    LOG.info("Your median pitch: %.1f Hz -> matching hers needs %+.1f semitones", your_hz, exact)

    search = Search(ws, prepared, ref, baselines)
    pitches = sorted({p for p in (8, 10, 12, 14, 16, int(round(exact))) if 0 <= p <= 24})
    stages = STAGES
    if a.quick:
        pitches = pitches[:2]
        stages = [(f, v[::4]) for f, v in STAGES]
    LOG.info("Stage 1/5: pitch %s", pitches)
    best = search.evaluate([V.Settings(pitch=p) for p in pitches], "pitch")[0][0]
    for n, (field, values) in enumerate(stages, 2):
        LOG.info("Stage %d/5: %s %s", n, field.replace("_", " "), list(values))
        best = search.evaluate([replace(best, **{field: v}) for v in values], field)[0][0]
    LOG.info("Stage 5/5: pitch fine-tune around %+d", best.pitch)
    ranked = search.evaluate([replace(best, pitch=p) for p in (best.pitch - 1, best.pitch, best.pitch + 1)
                              if 0 <= p <= 24], "pitch_fine")
    best, best_r = ranked[0]

    # ---- save
    tdir = ws.root / "tuning"
    rows = sorted(search.results.values(), key=lambda r: r["total"])
    with open(tdir / "scores.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["rank", "pitch", "index_rate", "protect", "steps", "total", "timbre", "pitch_err_st",
                    "range_err_st", "steps_err", "artifacts"])
        for i, r in enumerate(rows, 1):
            s = r["settings"]
            w.writerow([i, s.pitch, s.index_rate, s.protect, s.autotune_strength, round(r["total"], 4),
                        round(r["timbre"], 4), round(r["pitch"], 3), round(r["range"], 3),
                        round(r["steps"], 3), round(r["artifacts"], 3)])
    V.save_best(ws, best, {"score": {k: round(v, 4) for k, v in best_r.items() if k != "settings"},
                           "tuned_on": [p.name for p in inputs], "your_median_hz": round(your_hz, 1),
                           "exact_pitch_shift": round(exact, 1), "reference_lines": ref["lines"],
                           "settings_tried": len(rows), "date": now()})

    # ---- side-by-side comparisons
    default = V.Settings(pitch=V.recommended_pitch(ws))
    alt = replace(best, autotune_strength=0.0 if best.autotune_strength > 0 else 0.8)
    extra = search.evaluate([default, alt], "compare")
    by_tag = {s.tag(): r for s, r in extra}
    cmp_dir = ws.samples / "compare"
    cmp_dir.mkdir(parents=True, exist_ok=True)
    for orig, prep in search.prepared:
        parts = [("A_you", prep), ("B_default", search.out_path(default, orig)),
                 ("C_best", search.out_path(best, orig)),
                 ("D_best_" + ("natural_pitch" if best.autotune_strength > 0 else "glados_mode"),
                  search.out_path(alt, orig))]
        for name, src in parts:
            x, sr = A.read_wav(src)
            A.write_wav16(cmp_dir / f"{orig.stem}_{name}.wav", A.resample(x, sr))
        V.concat_with_gaps([p for _, p in parts], cmp_dir / f"{orig.stem}_ABCD.wav")
    summary = [
        "# Settings tuned to your voice", "",
        f"Tuned {now()} on: {', '.join(p.name for p in inputs)}. Scored against {ref['lines']} held-out "
        "GLaDOS lines.", "",
        f"**Best: {V.describe(best)}** (score {best_r['total']:.3f}; lower is better).", "",
        f"- Default for comparison ({V.describe(default)}): score {by_tag[default.tag()]['total']:.3f}",
        f"- Best with the opposite pitch style ({V.describe(alt)}): score {by_tag[alt.tag()]['total']:.3f}",
        f"- Your median pitch {your_hz:.0f} Hz; hers {ref['median_hz']:.0f} Hz; exact shift {exact:+.1f} semitones",
        "", "Listen: `samples\\compare\\<clip>_ABCD.wav` plays A = you, B = default settings, "
        "C = best, D = best with the other pitch style, with short gaps in between.", "",
    ]
    natural = best if best.autotune_strength == 0 else alt
    summary.append(f"For voice.ai, which has no step/autotune option: pitch **{natural.pitch:+d}**, index rate "
                   f"{natural.index_rate:.2f} (the best setting with natural pitch).")
    (tdir / "summary.md").write_text("\n".join(summary), encoding="utf-8")
    LOG.info("Best settings: %s. Saved to %s", V.describe(best), ws.root / V.BEST_SETTINGS)
    LOG.info("A/B files in %s; every score in %s", cmp_dir, tdir / "scores.csv")
    return 0
