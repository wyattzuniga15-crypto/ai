"""Dataset building: convert -> analyse -> exclude -> dedupe -> trim/normalise -> split.

Exclusions come from two places, and every one is logged with its reason:
  * the file name / folder (PotatOS, Caroline, singing, screams, glitches), and
  * the audio itself, judged against the rest of the corpus: a line is dropped
    when a feature (background floor, noise, clipping, held notes, very high
    pitch, ...) is a strong outlier from typical GLaDOS lines AND past an
    absolute bound, so her normal processed voice never counts as "noisy".
"""

from __future__ import annotations

import csv
import hashlib
import math
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from . import audio as A
from .common import LOG, StepFailed, Workspace, fmt_minutes, write_json

TARGET_LUFS = -20.0
PEAK_CEILING_DBFS = -1.0

# (rule, tokens, reason). Tokens are matched against the words of the folder
# and file name (split on _ / - . and digits), including 2-3 word joins so
# "want_you_gone" matches "wantyougone".
NAME_RULES = [
    ("potato", {"potato", "potatos", "potatoes", "potatoe"},
     "PotatOS / potato-battery line (name)"),
    ("caroline", {"caroline"}, "Caroline line (name)"),
    ("singing", {"sing", "sings", "singing", "song", "songs", "lullaby", "wantyougone",
                 "stillalive", "caramia", "opera", "music", "choir", "melody", "karaoke"},
     "singing / music (name)"),
    ("vocalization", {"scream", "screams", "screaming", "yell", "yells", "shout", "shouts",
                      "pain", "grunt", "grunts", "laugh", "laughs", "laughing", "laughter",
                      "cough", "coughs", "gasp", "gasps", "sigh", "sighs", "cry", "crying",
                      "sob", "sobs", "hum", "humming", "breath", "breathing", "breathe"},
     "scream / laugh / non-speech sound (name)"),
    ("glitch", {"glitch", "glitches", "glitchy", "malfunction", "static", "distort",
                "distorted", "distortion", "corrupt", "corrupted", "garble", "garbled",
                "stutter", "stuttering"},
     "glitch / distortion (name)"),
]

# (feature, direction, absolute bound, reason)
AUDIO_RULES = [
    ("rel_floor_inner_db", "high", -28.0, "background music / sound effects under the voice"),
    ("rel_floor_edges_db", "high", -30.0, "background music / sound effects before or after the line"),
    ("flatness", "high", 0.08, "noise or distortion heavy"),
    ("hf_ratio_db", "high", -18.0, "static / hiss / glitch (excess high-frequency energy)"),
    ("lf_ratio_db", "high", -10.0, "rumble / impact / music bass"),
    ("clip_frac", "high", 0.001, "clipped"),
    ("high_pitch_frac", "high", 0.25, "scream / shriek (sustained very high pitch)"),
    ("sustained_ratio", "high", 0.35, "singing (long held notes)"),
    ("presence_db", "low", -45.0, "muffled / radio / telephone-band (almost nothing above 4.5 kHz)"),
]
PITCH_RULE_REASON = "pitch far from her normal range (pitched, slowed or glitch effect)"


def reason_key(reason: str) -> str:
    """Group a per-line reason into its category for the summary table."""
    for prefix, key in (("near-duplicate", "near-duplicate of another line"),
                        ("duplicate of", "identical duplicate of another line"),
                        ("over the", "over the minutes budget (least typical lines)"),
                        ("too short", "too short"),
                        ("could not", "unreadable")):
        if reason.startswith(prefix):
            return key
    return re.sub(r"\s*\[.*$", "", reason).strip()


def name_tokens(rel_path: str) -> set[str]:
    words = [w for w in re.split(r"[/_\-.\s]+|\d+", rel_path.lower()) if w]
    toks = set(words)
    for n in (2, 3):
        for i in range(len(words) - n + 1):
            toks.add("".join(words[i:i + n]))
    return toks


def name_reasons(rel_path: str) -> list[str]:
    toks = name_tokens(rel_path.rsplit(".", 1)[0])
    return [reason for _, words, reason in NAME_RULES if toks & words]


# ----------------------------------------------------------------------------- convert

def _convert_one(args):
    src, dst = args
    try:
        x, sr, meta = A.load_audio(Path(src))
        y = A.resample(x, sr)
        A.write_wav16(Path(dst), y)
        return {"ok": True, "native_sr": sr, "codec": meta.get("codec"),
                "channels": meta.get("channels"), "decoder": meta.get("decoder"),
                "seconds": round(len(x) / sr, 3)}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]}


def run_convert(ws: Workspace, workers: int) -> dict:
    """Step 1 of cleaning: every extracted line -> mono 40 kHz 16-bit WAV."""
    manifest = list(csv.DictReader(open(ws.raw / "manifest.csv", encoding="utf-8")))
    meta_path = ws.clean / "converted_manifest.csv"
    known = {}
    if meta_path.exists():
        known = {r["id"]: r for r in csv.DictReader(open(meta_path, encoding="utf-8"))}
    jobs, rows = [], []
    for r in manifest:
        dst = ws.converted / f"{r['id']}.wav"
        if dst.exists() and r["id"] in known and known[r["id"]].get("ok") == "True":
            rows.append(known[r["id"]])
            continue
        jobs.append((r, str(ws.root / r["raw_file"]), str(dst)))
    LOG.info("Converting %d lines to mono 40 kHz 16-bit WAV (%d already done)", len(jobs), len(rows))
    if jobs:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for i, (r, res) in enumerate(zip([j[0] for j in jobs],
                                             ex.map(_convert_one, [(j[1], j[2]) for j in jobs],
                                                    chunksize=8)), 1):
                row = {"id": r["id"], "rel_path": r["rel_path"], **res}
                row.setdefault("error", "")
                rows.append(row)
                if not res["ok"]:
                    LOG.warning("Could not decode %s: %s", r["rel_path"], res["error"])
                if i % 200 == 0:
                    LOG.info("  converted %d/%d", i, len(jobs))
    fields = ["id", "rel_path", "ok", "native_sr", "codec", "channels", "decoder", "seconds", "error"]
    with open(meta_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    ok = [r for r in rows if str(r.get("ok")) == "True"]
    total_s = sum(float(r["seconds"]) for r in ok)
    rates = {}
    for r in ok:
        rates[str(r["native_sr"])] = rates.get(str(r["native_sr"]), 0) + 1
    LOG.info("Converted %d lines (%s of raw audio). Source sample rates: %s. Failed: %d",
             len(ok), fmt_minutes(total_s), rates, len(rows) - len(ok))
    return {"converted": len(ok), "failed": len(rows) - len(ok), "raw_minutes": round(total_s / 60, 1),
            "source_sample_rates": rates}


# ----------------------------------------------------------------------------- analyse

def _analyze_one(path_str):
    path = Path(path_str)
    try:
        x, sr = A.read_wav(path)
        feats = A.analyze(x, sr)
        fp = None
        if not feats.get("silent"):
            s, e = int(feats["trim_start_s"] * sr), int(feats["trim_end_s"] * sr)
            fp = A.fingerprint(x[s:e], sr)
        pcm_hash = hashlib.sha1(np.round(x * 32767).astype(np.int16).tobytes()).hexdigest()
        return path.stem, feats, fp, pcm_hash, None
    except Exception as exc:
        return path.stem, None, None, None, f"{type(exc).__name__}: {exc}"


def _robust(values: np.ndarray):
    values = values[np.isfinite(values)]
    if values.size == 0:
        return 0.0, 0.0
    med = float(np.median(values))
    mad = float(np.median(np.abs(values - med))) * 1.4826
    return med, mad


def _thresholds(rows: list[dict], k: float) -> dict:
    th = {}
    for feat, direction, bound, _ in AUDIO_RULES:
        vals = np.array([r["f"].get(feat, np.nan) for r in rows], dtype=float)
        med, mad = _robust(vals)
        if direction == "high":
            th[feat] = max(bound, med + k * mad) if mad > 0 else bound
        else:
            th[feat] = min(bound, med - k * mad) if mad > 0 else bound
        th[feat + "__median"] = med
        th[feat + "__spread"] = mad
    f0 = np.array([r["f"].get("f0_median", 0) for r in rows], dtype=float)
    f0 = f0[f0 > 0]
    if f0.size:
        st = 12 * np.log2(f0 / np.median(f0))
        _, mad = _robust(st)
        th["f0_median__median"] = float(np.median(f0))
        th["pitch_semitones_limit"] = max(7.0, k * mad)
    return th


def _audio_reasons(f: dict, th: dict) -> list[str]:
    out = []
    for feat, direction, _, reason in AUDIO_RULES:
        v = f.get(feat)
        if v is None or not np.isfinite(v):
            continue
        if (direction == "high" and v > th[feat]) or (direction == "low" and v < th[feat]):
            out.append(f"{reason} [{feat}={v:.3g}, limit {th[feat]:.3g}]")
    f0 = f.get("f0_median", 0)
    if f0 and "f0_median__median" in th:
        st = 12 * math.log2(f0 / th["f0_median__median"])
        if abs(st) > th["pitch_semitones_limit"]:
            out.append(f"{PITCH_RULE_REASON} [{st:+.1f} semitones from typical]")
    return out


def _badness(f: dict, th: dict) -> float:
    """How far a line leans toward every soft-rule failure (0 = typical)."""
    score = 0.0
    for feat, direction, _, _ in AUDIO_RULES:
        v = f.get(feat)
        med, spread = th.get(feat + "__median", 0), th.get(feat + "__spread", 0)
        if v is None or not np.isfinite(v) or spread <= 0:
            continue
        z = (v - med) / spread if direction == "high" else (med - v) / spread
        score += max(0.0, z)
    return score


def _process_for_training(x: np.ndarray, sr: int) -> np.ndarray:
    y = A.highpass(x, sr, 50.0)
    s, e = A.trim_bounds(y, sr)
    y = A.fade(y[s:e], sr)
    loud = A.lufs(y, sr)
    gain_db = TARGET_LUFS - loud if np.isfinite(loud) else 0.0
    peak_db = 20 * np.log10(np.max(np.abs(y)) + 1e-12)
    gain_db = min(gain_db, PEAK_CEILING_DBFS - peak_db)  # never clip; never limit
    return (y * (10 ** (gain_db / 20))).astype(np.float32)


def _write_processed(args):
    src, dst = args
    x, sr = A.read_wav(Path(src))
    y = _process_for_training(x, sr)
    A.write_wav16(Path(dst), y, sr)
    return len(y) / sr, A.lufs(y, sr)


def run_clean(ws: Workspace, workers: int, min_seconds: float = 1.0, min_minutes: float = 40.0,
              max_minutes: float = 70.0, near_dup_similarity: float = 0.92) -> dict:
    conv = [r for r in csv.DictReader(open(ws.clean / "converted_manifest.csv", encoding="utf-8"))]
    rel_of = {r["id"]: r["rel_path"] for r in conv}
    failed = [r for r in conv if r.get("ok") != "True"]
    ids = [r["id"] for r in conv if r.get("ok") == "True"]
    LOG.info("Analysing %d converted lines (loudness, background floor, noise, pitch, ...)", len(ids))

    rows: dict[str, dict] = {}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        paths = [str(ws.converted / f"{i}.wav") for i in ids]
        for n, (lid, feats, fp, h, err) in enumerate(ex.map(_analyze_one, paths, chunksize=8), 1):
            rows[lid] = {"id": lid, "rel_path": rel_of[lid], "f": feats or {}, "fp": fp,
                         "hash": h, "hard": [], "soft": [], "err": err}
            if n % 250 == 0:
                LOG.info("  analysed %d/%d", n, len(ids))

    # ---- hard rules: names, unreadable, silent, too short
    for r in rows.values():
        if r["err"]:
            r["hard"].append(f"could not analyse ({r['err']})")
            continue
        r["hard"] += name_reasons(r["rel_path"])
        f = r["f"]
        if f.get("silent") or f.get("peak_dbfs", -100) < -45:
            r["hard"].append("silent / nearly silent")
        elif f.get("trimmed_s", 0) < min_seconds:
            r["hard"].append(f"too short ({f.get('trimmed_s', 0):.2f} s after trimming silence, "
                             f"minimum {min_seconds:g} s)")
    for r in failed:
        rows[r["id"]] = {"id": r["id"], "rel_path": r["rel_path"], "f": {}, "fp": None, "hash": None,
                         "hard": [f"could not decode ({r.get('error', '')})"], "soft": [], "err": "decode"}

    pool = [r for r in rows.values() if not r["hard"]]
    if not pool:
        raise StepFailed("Every line was excluded by the name/length rules; see logs/excluded.csv")

    # ---- soft (audio) rules, relaxed only if the dataset would fall under min_minutes
    for k in (4.0, 5.0, 6.0, 8.0):
        th = _thresholds(pool, k)
        for r in pool:
            r["soft"] = _audio_reasons(r["f"], th)
        kept_s = sum(r["f"]["trimmed_s"] for r in pool if not r["soft"])
        LOG.info("Audio rules at %.0f x typical spread: %d of %d lines pass (%s)", k,
                 sum(1 for r in pool if not r["soft"]), len(pool), fmt_minutes(kept_s))
        if kept_s / 60 >= min_minutes:
            break
        LOG.warning("Under %.0f minutes, so relaxing the audio rules", min_minutes)
    used_k = k
    for r in pool:
        r["bad"] = _badness(r["f"], th)

    kept = [r for r in pool if not r["soft"]]

    # ---- duplicates: identical audio, then near-identical (same line re-encoded / re-used)
    seen: dict[str, dict] = {}
    for r in sorted(kept, key=lambda r: r["bad"]):
        if r["hash"] in seen:
            r["soft"].append(f"duplicate of {seen[r['hash']]['id']} (identical audio)")
        else:
            seen[r["hash"]] = r
    kept = [r for r in kept if not r["soft"]]
    kept.sort(key=lambda r: r["f"]["trimmed_s"])
    durs = np.array([r["f"]["trimmed_s"] for r in kept])
    fps = [r["fp"] for r in kept]
    near_pairs = []
    for i, r in enumerate(kept):
        if r["soft"]:
            continue
        j_hi = np.searchsorted(durs, durs[i] * 1.06, side="right")
        for j in range(i + 1, j_hi):
            o = kept[j]
            if o["soft"]:
                continue
            sim = float(np.dot(fps[i], fps[j]))
            if sim >= 0.85:
                near_pairs.append((r["id"], o["id"], round(sim, 4)))
            if sim >= near_dup_similarity:
                loser, winner = (o, r) if o["bad"] > r["bad"] else (r, o)
                loser["soft"].append(f"near-duplicate of {winner['id']} (similarity {sim:.3f})")
                if loser is r:
                    break
    kept = [r for r in kept if not r["soft"]]

    # ---- budget: above max_minutes, drop the least typical lines first
    total = sum(r["f"]["trimmed_s"] for r in kept)
    if total / 60 > max_minutes:
        for r in sorted(kept, key=lambda r: r["bad"], reverse=True):
            if total / 60 <= max_minutes:
                break
            r["soft"].append(f"over the {max_minutes:g}-minute budget (least typical of the rest, "
                             f"score {r['bad']:.1f})")
            total -= r["f"]["trimmed_s"]
        kept = [r for r in kept if not r["soft"]]

    # ---- held-out lines for checkpoint selection (never trained on)
    eligible = sorted((r for r in kept if 2.0 <= r["f"]["trimmed_s"] <= 8.0),
                      key=lambda r: hashlib.sha1(r["id"].encode()).hexdigest())
    n_hold = int(min(30, max(10, round(0.03 * len(kept)))))
    n_hold = min(n_hold, max(0, len(eligible) - 5), len(kept) // 5)
    holdout = {r["id"] for r in eligible[:n_hold]}

    # ---- write dataset/ and eval/holdout/ (processed), clearing stale files first
    for d in (ws.dataset, ws.holdout):
        d.mkdir(parents=True, exist_ok=True)
        for f in d.glob("*.wav"):
            f.unlink()
    jobs = [(str(ws.converted / f"{r['id']}.wav"),
             str((ws.holdout if r["id"] in holdout else ws.dataset) / f"{r['id']}.wav")) for r in kept]
    LOG.info("Trimming, loudness-normalising to %.0f LUFS and writing %d lines", TARGET_LUFS, len(jobs))
    out_secs = {}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for (src, dst), (secs, loud) in zip(jobs, ex.map(_write_processed, jobs, chunksize=8)):
            out_secs[Path(dst).stem] = secs
    train_s = sum(s for i, s in out_secs.items() if i not in holdout)
    hold_s = sum(s for i, s in out_secs.items() if i in holdout)

    # ---- logs
    feat_names = sorted({k for r in rows.values() for k in r["f"].keys()})
    with open(ws.clean / "features.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "rel_path", "decision", "reasons", "badness"] + feat_names)
        for r in sorted(rows.values(), key=lambda r: r["id"]):
            reasons = r["hard"] + r["soft"]
            decision = "excluded" if reasons else ("holdout" if r["id"] in holdout else "train")
            w.writerow([r["id"], r["rel_path"], decision, " | ".join(reasons), round(r.get("bad", 0), 2)]
                       + [r["f"].get(k, "") for k in feat_names])
    reason_stats: dict[str, list] = {}
    with open(ws.logs / "excluded.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "rel_path", "seconds", "reasons"])
        for r in sorted(rows.values(), key=lambda r: r["id"]):
            reasons = r["hard"] + r["soft"]
            if not reasons:
                continue
            secs = r["f"].get("trimmed_s", r["f"].get("duration_s", 0)) or 0
            w.writerow([r["id"], r["rel_path"], round(secs, 2), " | ".join(reasons)])
            st = reason_stats.setdefault(reason_key(reasons[0]), [0, 0.0])
            st[0] += 1
            st[1] += secs
    with open(ws.logs / "near_duplicate_pairs.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["line_a", "line_b", "similarity"])
        w.writerows(sorted(near_pairs, key=lambda p: -p[2]))

    kept_f0 = [rows[i]["f"]["f0_median"] for i in out_secs if rows[i]["f"].get("f0_median", 0) > 0]
    report = {
        "lines_found": len(rows),
        "lines_train": len(out_secs) - len(holdout),
        "lines_holdout": len(holdout),
        "lines_excluded": sum(1 for r in rows.values() if r["hard"] or r["soft"]),
        "train_minutes": round(train_s / 60, 2),
        "holdout_minutes": round(hold_s / 60, 2),
        "clean_minutes_total": round((train_s + hold_s) / 60, 2),
        "excluded_by_reason": {k: {"lines": v[0], "minutes": round(v[1] / 60, 2)}
                               for k, v in sorted(reason_stats.items(), key=lambda kv: -kv[1][0])},
        "audio_rule_strictness_k": used_k,
        "thresholds": {k: round(v, 4) for k, v in th.items()},
        "glados_f0_median_hz": round(float(np.median(kept_f0)), 1) if kept_f0 else None,
        "target_lufs": TARGET_LUFS,
        "min_seconds": min_seconds,
        "holdout_ids": sorted(holdout),
    }
    write_json(ws.clean / "cleaning_report.json", report)
    LOG.info("Clean dataset: %d lines, %s for training + %d held-out lines (%s) for picking the best "
             "checkpoint. Excluded %d lines; reasons in %s",
             report["lines_train"], fmt_minutes(train_s), len(holdout), fmt_minutes(hold_s),
             report["lines_excluded"], ws.logs / "excluded.csv")
    for k, v in report["excluded_by_reason"].items():
        LOG.info("   excluded %4d lines (%5.1f min): %s", v["lines"], v["minutes"], k)
    if train_s / 60 < min_minutes:
        LOG.warning("Only %s of clean speech (target %g-%g). Training will still work, but "
                    "check logs/excluded.csv for lines that could be kept.",
                    fmt_minutes(train_s), min_minutes, max_minutes)
    return {k: v for k, v in report.items() if k not in ("thresholds", "holdout_ids")}
