"""Runs in the TTS venv. Writes an F5-TTS fine-tuning dataset.

usage: prepare.py <items.json>     items.json: {"items": [{"audio": abs path, "text": str}, ...]}
Same files F5-TTS's prepare_csv_wavs.py writes (raw.arrow, duration.json, vocab.txt), but
the vocab comes from the copy shipped inside the package; the path that script expects
does not exist in a pip install.
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compat import f5_paths  # noqa: E402

import soundfile as sf  # noqa: E402
from datasets.arrow_writer import ArrowWriter  # noqa: E402

from f5_tts.model.utils import convert_char_to_pinyin  # noqa: E402

items = json.load(open(sys.argv[1], encoding="utf-8"))["items"]
paths = f5_paths()
os.makedirs(paths["data"], exist_ok=True)
rows, durations, skipped = [], [], 0
texts = convert_char_to_pinyin([it["text"] for it in items], polyphone=True)
for it, text in zip(items, texts):
    d = sf.info(it["audio"]).duration
    if not 0.3 <= d <= 30 or not it["text"].strip():
        skipped += 1
        continue
    rows.append({"audio_path": it["audio"], "text": text, "duration": d})
    durations.append(d)
with ArrowWriter(path=os.path.join(paths["data"], "raw.arrow")) as w:
    for r in rows:
        w.write(r)
    w.finalize()
json.dump({"duration": durations}, open(os.path.join(paths["data"], "duration.json"), "w", encoding="utf-8"))
shutil.copyfile(paths["vocab"], os.path.join(paths["data"], "vocab.txt"))
print("PREPARE_JSON " + json.dumps({"dir": paths["data"], "lines": len(rows), "skipped": skipped,
                                    "minutes": round(sum(durations) / 60, 2), "ckpts": paths["ckpts"],
                                    "vocab": paths["vocab"]}))
