"""Runs in the TTS venv. Whisper transcripts for a list of WAVs.

usage: transcribe.py <in.json> <out.json>
in.json: {"files": [...], "model": "openai/whisper-large-v3-turbo"}
Exit code 3 (and ASR_UNAVAILABLE) if the model cannot be loaded, e.g. offline.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compat  # noqa: E402,F401

import soundfile as sf  # noqa: E402
import torch  # noqa: E402

job = json.load(open(sys.argv[1], encoding="utf-8"))
out_path = sys.argv[2]
done = json.load(open(out_path, encoding="utf-8")) if os.path.exists(out_path) else {}
todo = [f for f in job["files"] if f not in done]
if todo:
    try:
        from transformers import pipeline

        device = 0 if torch.cuda.is_available() else -1
        asr = pipeline("automatic-speech-recognition", model=job.get("model", "openai/whisper-large-v3-turbo"),
                       dtype=torch.float16 if device == 0 else torch.float32, device=device)
    except Exception as exc:
        print(f"ASR_UNAVAILABLE {type(exc).__name__}: {exc}", flush=True)
        sys.exit(3)
    import numpy as np
    import soxr

    for i, f in enumerate(todo, 1):
        x, sr = sf.read(f, dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if sr != 16000:
            x = soxr.resample(x, sr, 16000)
        res = asr({"raw": np.ascontiguousarray(x), "sampling_rate": 16000},
                  generate_kwargs={"language": "english", "task": "transcribe"})
        done[f] = res["text"].strip()
        if i % 50 == 0 or i == len(todo):
            json.dump(done, open(out_path, "w", encoding="utf-8"), indent=1)
            print(f"transcribed {i}/{len(todo)}", flush=True)
json.dump(done, open(out_path, "w", encoding="utf-8"), indent=1)
print(f"ASR_DONE {len(done)}")
