"""TEST ONLY. Writes random-weight stand-ins for Applio's downloaded models.

The sandbox this pipeline was developed in cannot reach huggingface.co, so the
real RMVPE / ContentVec / pretrained G+D files cannot be fetched there. These
stand-ins have the right architectures and file names, which is enough to run
every Applio step for real (preprocess, extract, train, index, infer) and check
the pipeline's plumbing. They produce meaningless audio. Never used on a real run.

Run inside Applio's venv with cwd = the Applio folder.
"""

import json
import os
import sys

import torch

sys.path.insert(0, os.getcwd())
torch.manual_seed(0)

from rvc.lib.predictors.RMVPE import E2E  # noqa: E402

os.makedirs("rvc/models/predictors", exist_ok=True)
torch.save(E2E(4, 1, (2, 2)).state_dict(), "rvc/models/predictors/rmvpe.pt")

from transformers import HubertConfig  # noqa: E402

from rvc.lib.utils import HubertModelWithFinalProj  # noqa: E402

cfg = HubertConfig(hidden_size=768, num_hidden_layers=2, num_attention_heads=12,
                   intermediate_size=1024, classifier_proj_size=256)
emb_dir = "rvc/models/embedders/contentvec"
os.makedirs(emb_dir, exist_ok=True)
cfg.save_pretrained(emb_dir)
# Applio looks for pytorch_model.bin (the file it downloads); write that format explicitly.
torch.save(HubertModelWithFinalProj(cfg).state_dict(), os.path.join(emb_dir, "pytorch_model.bin"))

from rvc.lib.algorithm.discriminators import MultiPeriodDiscriminator  # noqa: E402
from rvc.lib.algorithm.synthesizers import Synthesizer  # noqa: E402

hps = json.load(open("rvc/configs/40000.json"))
g = Synthesizer(hps["data"]["filter_length"] // 2 + 1, hps["train"]["segment_size"] // hps["data"]["hop_length"],
                **hps["model"], use_f0=True, sr=40000, vocoder="HiFi-GAN", checkpointing=False, randomized=True)
d = MultiPeriodDiscriminator(hps["model"]["use_spectral_norm"], checkpointing=False, version="v2")
os.makedirs("rvc/models/pretraineds/hifi-gan", exist_ok=True)
torch.save({"model": g.state_dict()}, "rvc/models/pretraineds/hifi-gan/f0G40k.pth")
torch.save({"model": d.state_dict()}, "rvc/models/pretraineds/hifi-gan/f0D40k.pth")
print("stand-in models written")
