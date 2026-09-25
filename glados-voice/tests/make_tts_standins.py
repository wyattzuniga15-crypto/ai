"""TEST ONLY. Random-weight stand-ins for F5-TTS's downloads (base model + Vocos vocoder).

Same architectures and file formats as the real ones, so fine-tuning, checkpoint
loading and generation all run for real; the audio is meaningless. Run in the TTS venv:
    python make_tts_standins.py <out_dir>
"""

import os
import sys

import torch
import yaml
from ema_pytorch import EMA
from safetensors.torch import save_file

from f5_tts.model import CFM, DiT
from f5_tts.model.utils import get_tokenizer
from importlib.resources import files

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
torch.manual_seed(0)
vocab = str(files("f5_tts").joinpath("infer/examples/vocab.txt"))
vocab_map, n = get_tokenizer(vocab, "custom")
model = CFM(transformer=DiT(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4,
                            text_num_embeds=n, mel_dim=100),
            mel_spec_kwargs=dict(n_fft=1024, hop_length=256, win_length=1024, n_mel_channels=100,
                                 target_sample_rate=24000, mel_spec_type="vocos"),
            vocab_char_map=vocab_map)
ema = EMA(model, include_online_model=False)
save_file({k: v.detach().contiguous().clone() for k, v in ema.state_dict().items()},
          os.path.join(out, "model_1250000.safetensors"))

voc = os.path.join(out, "vocos")
os.makedirs(voc, exist_ok=True)
cfg = {
    "feature_extractor": {"class_path": "vocos.feature_extractors.MelSpectrogramFeatures",
                          "init_args": {"sample_rate": 24000, "n_fft": 1024, "hop_length": 256, "n_mels": 100,
                                        "padding": "center"}},
    "backbone": {"class_path": "vocos.models.VocosBackbone",
                 "init_args": {"input_channels": 100, "dim": 512, "intermediate_dim": 1536, "num_layers": 8}},
    "head": {"class_path": "vocos.heads.ISTFTHead",
             "init_args": {"dim": 512, "n_fft": 1024, "hop_length": 256, "padding": "center"}},
}
yaml.safe_dump(cfg, open(os.path.join(voc, "config.yaml"), "w"))
from vocos import Vocos  # noqa: E402

torch.save(Vocos.from_hparams(os.path.join(voc, "config.yaml")).state_dict(), os.path.join(voc, "pytorch_model.bin"))
print("TTS stand-ins written to", out)
