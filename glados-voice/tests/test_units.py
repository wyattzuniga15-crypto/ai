"""Fast checks that need neither the game nor Applio (run with the pipeline venv's python).

usage: python tests/test_units.py
"""

import json
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import glados_pipeline as G  # noqa: E402
from glados import audio as A  # noqa: E402
from glados.captions import clean_caption, parse_caption_dat, parse_caption_txt, parse_soundscript  # noqa: E402
from glados.clean import name_reasons  # noqa: E402
from glados.common import State, training_time_note  # noqa: E402
from glados.evaluate import frechet, recommend_pitch  # noqa: E402
from glados.extract import is_language_folder, line_id  # noqa: E402
from glados.locate import parse_library_folders  # noqa: E402
from glados.tts import similarity, wer  # noqa: E402

fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


# Steam library list, new and old formats
vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n' \
      '\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n'
libs = [str(p).replace("/", "\\") for p in parse_library_folders(vdf)]
check(libs == ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"], f"libraryfolders.vdf (new format): {libs}")
old = '"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t"1"\n\t"1"\t\t"E:\\\\Games\\\\Steam"\n}\n'
check([str(p).replace("/", "\\") for p in parse_library_folders(old)] == ["E:\\Games\\Steam"], "libraryfolders.vdf (old format)")

# Folders and ids
check(is_language_folder("portal2_french") and not is_language_folder("portal2_dlc2"), "language folders skipped, DLC kept")
check(line_id("sound/vo/glados/botcoop/Sp_A1_X01.wav") == "glados__botcoop__sp_a1_x01", "line ids")

# Name rules: catch the non-speech kinds, never topical words
for name, want in [("sound/vo/potatos/potatos_sp_a3_01.wav", "PotatOS"), ("sound/vo/glados/glados_laugh01.wav", "laugh"),
                   ("sound/vo/glados/want_you_gone_01.wav", "singing"), ("sound/vo/glados/sp_a4_caroline02.wav", "Caroline")]:
    check(any(want.lower() in r.lower() for r in name_reasons(name)), f"name rule: {name.split('/')[-1]}")
for name in ["sound/vo/glados/dlc1_mp_coop_art_death_turret01.wav", "sound/vo/glados/sp_a2_human01.wav",
             "sound/vo/glados/mp_coop_paint_bridge03.wav"]:
    check(not name_reasons(name), f"no false name hit: {name.split('/')[-1]}")

# Captions
ss = '"GLaDOS.a" { "wave" "*vo\\\\glados\\\\a.wav" }\n"GLaDOS.b" { "rndwave" { "wave" ")vo/glados/b1.wav" "wave" "vo/glados/b2.wav" } }'
m = parse_soundscript(ss)
check(m == {"sound/vo/glados/a.wav": ["glados.a"], "sound/vo/glados/b1.wav": ["glados.b"],
            "sound/vo/glados/b2.wav": ["glados.b"]}, "soundscript wave -> entry, incl. rndwave")
caps = parse_caption_txt('"lang"{"Tokens"{\n"GLaDOS.a"\t"<clr:1,2,3>Hello <I>there</I>."\n}}'.encode("utf-16"))
check(clean_caption(caps["glados.a"]) == "Hello there.", "UTF-16 caption file, tags removed")
entries, data = b"", b""
for tok, txt in (("glados.a", "From dat."),):
    b = (txt + "\x00").encode("utf-16-le")
    entries += struct.pack("<IiHH", zlib.crc32(tok.encode()) & 0xFFFFFFFF, 0, len(data), len(b))
    data += b
dat = struct.pack("<4siiiii", b"VCCD", 1, 1, 8192, 1, 24 + len(entries)) + entries + data
check(parse_caption_dat(dat).get(zlib.crc32(b"glados.a") & 0xFFFFFFFF) == "From dat.", "compiled .dat captions")

# Transcript agreement
check(wer("Hello and welcome", "hello, and welcome!") == 0.0, "WER ignores case/punctuation")
check(abs(wer("a b c d", "a x c") - 0.5) < 1e-9, "WER counts a substitution and a deletion")
check(similarity("The cake is a lie.", "the cake is a lie") == 1.0 and similarity("yes", "no") == 0.0, "caption/Whisper similarity")

# Metrics
rng = np.random.default_rng(0)
x = rng.standard_normal((400, 8))
check(abs(frechet(x.mean(0), np.cov(x, rowvar=False), x.mean(0), np.cov(x, rowvar=False))) < 1e-9, "Frechet distance of a set to itself is 0")
check(recommend_pitch(110, 220)["recommended"] == 12 and recommend_pitch(130, 220)["recommended"] == 8, "pitch recommendation")
t = np.arange(40000) / 40000
f0 = A.yin_f0((0.5 * np.sin(2 * np.pi * 180 * t)).astype(np.float32), 40000)
check(abs(np.median(f0[f0 > 0]) - 180) < 1, "YIN pitch on a 180 Hz tone")

# Training time note
check(training_time_note(60) == "" and "20% longer" in training_time_note(84), "over-70-minute note")
check("+51m" in training_time_note(84, 62.0, 300), "note converts to hours with a measured epoch time")

# Settings migration (old default cap of 70 minutes)
d = Path(tempfile.mkdtemp())
for stored, argv, want_mm, want_redo in [({"max_minutes": 70.0}, [], 0.0, ["clean"]),
                                         ({"max_minutes": 70.0, "max_minutes__explicit": True}, [], 70.0, []),
                                         ({"max_minutes": 0.0}, ["--max-minutes", "60"], 60.0, ["clean"])]:
    (d / "s.json").write_text(json.dumps({"steps": {"clean": {"status": "done"}}, "settings": stored}))
    st = State(d / "s.json")
    a = G.parse_args(["--root", str(d)] + argv)
    redo = G.resolve_settings(a, st)
    check(a.max_minutes == want_mm and redo == want_redo, f"settings {stored} {argv} -> {a.max_minutes}, redo {redo}")

print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
