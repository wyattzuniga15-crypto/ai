"""Runs in the TTS venv. Shrinks a finished F5-TTS training checkpoint for evaluation.

usage: slim.py <model_N.pt> <ema_N.pt>
A training checkpoint holds the model, its EMA copy and the optimiser state (3-5 GB);
generation only needs the EMA weights, stored here in fp16 (~0.7 GB). The original is
deleted only after the slim copy loads back.
"""

import os
import sys

import torch

src, dst = sys.argv[1], sys.argv[2]
ck = torch.load(src, map_location="cpu", weights_only=True, mmap=True)  # read from disk, not RAM
ema = {k: (v.half() if torch.is_floating_point(v) else v) for k, v in ck["ema_model_state_dict"].items()}
tmp = dst + ".part"
try:
    torch.save({"ema_model_state_dict": ema, "update": ck.get("update")}, tmp)
    torch.load(tmp, map_location="cpu", weights_only=True)
except Exception:
    if os.path.exists(tmp):
        os.remove(tmp)  # e.g. disk full: keep the original, drop the half-written copy
    raise
os.replace(tmp, dst)
os.remove(src)
print(f"SLIM {os.path.basename(src)} -> {os.path.basename(dst)}")
