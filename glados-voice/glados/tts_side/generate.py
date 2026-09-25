"""Runs in the TTS venv. Speech from text with F5-TTS, several takes per line.

usage: generate.py <job.json>
job.json: {"ckpt": path or "" (downloads the base model), "vocab": path, "vocoder_local": dir or null,
           "ref_audio": wav, "ref_text": str, "nfe_step": 32,
           "items": [{"text": str, "out": wav, "seed": int}, ...]}
Existing outputs are skipped, so an interrupted run resumes.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compat  # noqa: E402,F401

from f5_tts.api import F5TTS  # noqa: E402

job = json.load(open(sys.argv[1], encoding="utf-8"))
todo = [it for it in job["items"] if not (os.path.exists(it["out"]) and os.path.getsize(it["out"]) > 1000)]
if todo:
    tts = F5TTS(model="F5TTS_v1_Base", ckpt_file=job.get("ckpt") or "", vocab_file=job.get("vocab") or "",
                vocoder_local_path=job.get("vocoder_local"))
    for i, it in enumerate(todo, 1):
        os.makedirs(os.path.dirname(it["out"]), exist_ok=True)
        tts.infer(ref_file=job["ref_audio"], ref_text=job["ref_text"], gen_text=it["text"],
                  nfe_step=int(job.get("nfe_step", 32)), seed=int(it["seed"]), file_wave=it["out"],
                  show_info=lambda *a, **k: None)
        print(f"GENERATED {i}/{len(todo)} {os.path.basename(it['out'])}", flush=True)
print("GENERATE_DONE", flush=True)
