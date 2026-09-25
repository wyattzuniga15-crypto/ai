"""Runs in the TTS venv. F5-TTS fine-tuning with the compat patches applied.

usage: finetune.py <f5-tts_finetune-cli arguments...>
Resumes by itself: F5-TTS picks up model_last.pt from its checkpoint folder.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compat  # noqa: E402,F401  (must come before F5-TTS touches torchaudio)

if __name__ == "__main__":
    from f5_tts.train import finetune_cli

    sys.argv = ["f5-tts_finetune-cli"] + sys.argv[1:]
    finetune_cli.main()
    print("FINETUNE_DONE", flush=True)
