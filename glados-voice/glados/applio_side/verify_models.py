"""Runs inside Applio's venv. Checks model files load and fit together.

usage:
  verify_models.py prereq  <applio_dir>                 downloaded prerequisites load
  verify_models.py pretrain <G> <D> <stock_G> <stock_D> custom pretrain matches stock shapes
  verify_models.py weights <pth>                        exported voice model is RVC v2 / 40k
Prints VERIFY_JSON {...}; exit code 1 on any problem.
"""

import json
import os
import sys

import torch


def load(path):
    return torch.load(path, map_location="cpu", weights_only=True)


def shapes(sd):
    return {k: tuple(v.shape) for k, v in sd.items() if hasattr(v, "shape")}


def prereq(applio):
    need = {
        "rvc/models/predictors/rmvpe.pt": 100e6,
        "rvc/models/embedders/contentvec/pytorch_model.bin": 300e6,
        "rvc/models/embedders/contentvec/config.json": 500,
        "rvc/models/pretraineds/hifi-gan/f0G40k.pth": 30e6,
        "rvc/models/pretraineds/hifi-gan/f0D40k.pth": 80e6,
    }
    problems, sizes = [], {}
    for rel, min_size in need.items():
        p = os.path.join(applio, rel)
        if not os.path.isfile(p):
            problems.append(f"missing {rel}")
            continue
        sizes[rel] = os.path.getsize(p)
        if sizes[rel] < min_size and os.environ.get("GLADOS_ALLOW_SMALL_MODELS") != "1":
            problems.append(f"{rel} is only {sizes[rel]} bytes (download was cut short or is an error page)")
            continue
        if rel.endswith((".pt", ".pth", ".bin")):
            try:
                load(p)
            except Exception as exc:
                problems.append(f"{rel} does not load: {exc}")
        else:
            try:
                json.load(open(p, encoding="utf-8"))
            except Exception as exc:
                problems.append(f"{rel} is not valid JSON: {exc}")
    return {"ok": not problems, "problems": problems, "sizes": sizes}


def pretrain(g, d, stock_g, stock_d):
    problems = []
    try:
        gs, ds = load(g)["model"], load(d)["model"]
        rgs, rds = load(stock_g)["model"], load(stock_d)["model"]
        for name, a, b in (("G", gs, rgs), ("D", ds, rds)):
            sa, sb = shapes(a), shapes(b)
            missing = set(sb) - set(sa)
            bad = [k for k in set(sa) & set(sb) if sa[k] != sb[k] and not k.startswith("emb_g")]
            if missing or bad:
                problems.append(f"{name}: {len(missing)} missing tensors, {len(bad)} shape mismatches")
    except Exception as exc:
        problems.append(f"could not load: {exc}")
    return {"ok": not problems, "problems": problems}


def weights(pth):
    problems = []
    info = {}
    try:
        cpt = load(pth)
        info = {"version": cpt.get("version"), "f0": cpt.get("f0"), "sr": cpt.get("sr"),
                "config_sr": cpt.get("config", [None])[-1], "epoch": cpt.get("epoch"),
                "step": cpt.get("step"), "vocoder": cpt.get("vocoder"),
                "embedder_model": cpt.get("embedder_model"),
                "tensors": len(cpt.get("weight", {})),
                "megabytes": round(os.path.getsize(pth) / 1e6, 1)}
        if info["version"] != "v2":
            problems.append(f"version is {info['version']}, expected v2")
        if int(info["config_sr"] or 0) != 40000:
            problems.append(f"sample rate is {info['config_sr']}, expected 40000")
        if not info["f0"]:
            problems.append("model has no pitch guidance (f0)")
        if info["vocoder"] not in (None, "HiFi-GAN"):
            problems.append(f"vocoder {info['vocoder']} is not the standard RVC HiFi-GAN")
        if info["embedder_model"] not in (None, "contentvec"):
            problems.append(f"embedder {info['embedder_model']} is not the standard ContentVec")
        if "emb_g.weight" not in cpt.get("weight", {}):
            problems.append("weights are missing emb_g.weight")
    except Exception as exc:
        problems.append(f"could not load: {exc}")
    return {"ok": not problems, "problems": problems, "info": info}


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "prereq":
        res = prereq(sys.argv[2])
    elif mode == "pretrain":
        res = pretrain(*sys.argv[2:6])
    elif mode == "weights":
        res = weights(sys.argv[2])
    else:
        raise SystemExit(f"unknown mode {mode}")
    print("VERIFY_JSON " + json.dumps(res))
    sys.exit(0 if res["ok"] else 1)
