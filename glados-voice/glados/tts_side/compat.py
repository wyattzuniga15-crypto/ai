"""Imported first by every script in the TTS venv (and so by every data-loader worker,
which on Windows re-imports the main script).

* torchaudio >= 2.9 routes torchaudio.load through torchcodec, which needs FFmpeg DLLs
  that a pip install on Windows does not have. F5-TTS only loads WAVs we wrote, so
  soundfile does the job with no extra install.
* F5-TTS's trainer starts 16 data-loader processes; on Windows each is a full Python
  with torch loaded, so cap it at 4.
"""

import os
import sys

import soundfile as sf
import torch
import torchaudio


def _sf_load(path, *args, **kwargs):
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return torch.from_numpy(x.T.copy()), sr


torchaudio.load = _sf_load

try:
    from f5_tts.model import trainer as _trainer

    _orig_train = _trainer.Trainer.train

    def _train(self, train_dataset, num_workers=None, resumable_with_seed=None):
        # at least 1: F5-TTS builds its DataLoader with persistent_workers=True
        n = max(1, int(os.environ.get("GLADOS_TTS_WORKERS", "4")))
        return _orig_train(self, train_dataset, num_workers=n, resumable_with_seed=resumable_with_seed)

    _trainer.Trainer.train = _train
except Exception as exc:  # pragma: no cover - only matters if F5-TTS changes shape
    print(f"compat: could not patch the F5-TTS trainer: {exc}", file=sys.stderr)


def f5_paths(dataset_name: str = "GLaDOS", tokenizer: str = "pinyin") -> dict:
    """Where F5-TTS looks for datasets and writes checkpoints (relative to its package)."""
    from importlib.resources import files

    base = files("f5_tts")
    return {
        "data": os.path.abspath(str(base.joinpath(f"../../data/{dataset_name}_{tokenizer}"))),
        "ckpts": os.path.abspath(str(base.joinpath(f"../../ckpts/{dataset_name}"))),
        "vocab": os.path.abspath(str(base.joinpath("infer/examples/vocab.txt"))),
    }
