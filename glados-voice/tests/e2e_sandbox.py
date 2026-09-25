"""End-to-end test on a machine without the game or a GPU (how this was developed).

Builds a fake Portal 2 install, points the pipeline at it with --allow-cpu and a
tiny training run, and checks every deliverable. Applio itself runs for real;
only its downloadable model weights are random stand-ins (make_standin_models.py).

usage: e2e_sandbox.py <workdir> <applio_src_dir> <applio_venv_dir> <audio_dir>
  audio_dir: librosa's sample data (LibriSpeech clips + music), e.g. a checkout of
  github.com/librosa/data/audio
"""

import csv
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from fixtures import build_fake_install  # noqa: E402

work, applio_src, applio_venv, audio = (Path(a) for a in sys.argv[1:5])
fresh = "--keep" not in sys.argv
if fresh and work.exists():
    shutil.rmtree(work)
work.mkdir(parents=True, exist_ok=True)
root = work / "GLaDOSVoice"

female, male_a, male_b = (audio / f"{n}.hq.ogg" for n in ("198-209-0000", "3436-172162-0000", "5703-47212-0000"))
music = audio / "Kevin_MacLeod_-_Vibe_Ace.hq.ogg"
if not (work / "install").exists():
    fake = build_fake_install(work / "install", [female, male_a], [male_b], music)
    json.dump({k: str(v) if isinstance(v, Path) else v for k, v in fake.items()},
              open(work / "fake.json", "w"), indent=1)
fake = json.load(open(work / "fake.json"))

# Pre-seed Applio: source (as if downloaded), its venv, stand-in weights.
applio = root / "applio"
if not (applio / "core.py").exists():
    shutil.copytree(applio_src, applio, ignore=shutil.ignore_patterns(".git"))
    (applio / ".venv").symlink_to(applio_venv, target_is_directory=True)
    (applio / ".glados_applio_version").write_text("3.6.5")
    (applio / ".glados_requirements_ok").write_text("sandbox")
    subprocess.run([applio / ".venv" / "bin" / "python", HERE / "make_standin_models.py"], cwd=applio, check=True)

# The "user's recording" for the samples step: a different male speaker.
(root / "samples" / "input").mkdir(parents=True, exist_ok=True)
shutil.copyfile(male_b, root / "samples" / "input" / "my_voice.ogg")

EPOCHS = os.environ.get("E2E_EPOCHS", "4")
env = dict(os.environ, GLADOS_ALLOW_SMALL_MODELS="1")
cmd = [sys.executable, str(HERE.parent / "glados_pipeline.py"), "--root", str(root),
       "--game-dir", fake["game_dir"], "--allow-cpu", "--epochs", EPOCHS, "--save-every", "1",
       "--batch-size", "2", "--min-minutes", "0.3", "--workers", "3",
       "--uv", shutil.which("uv") or str(Path.home() / ".local/bin/uv")] + [a for a in sys.argv[5:] if a != "--keep"]
print("$", " ".join(cmd), flush=True)
rc = subprocess.run(cmd, env=env).returncode
print("pipeline exit code", rc)
if rc != 0:
    sys.exit(rc)

# ----------------------------------------------------------------------------- checks
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


man = list(csv.DictReader(open(root / "raw" / "manifest.csv")))
paths = {r["rel_path"].lower() for r in man}
check(not any("wheatley" in p for p in paths), "Wheatley lines were not extracted")
check(any(p.startswith("sound/vo/potatos/") for p in paths), "PotatOS folder extracted (to be excluded + logged)")
check(any("dlc1_mp_coop" in p for p in paths), "DLC1 lines extracted")
check(any("dlc2_line00" in p for p in paths), "DLC2 (VPK v2) lines extracted")
line02 = next(r for r in man if r["rel_path"].endswith("sp_a3_line02.wav"))
check(line02["source"].startswith("portal2_dlc1") and line02["also_in"] == "portal2",
      f"newer DLC copy wins over the base-game copy ({line02['source']}, also in {line02['also_in']})")
check("portal2_french" not in json.load(open(root / "raw" / "extract_summary.json"))["folders_scanned"],
      "localised folder skipped")

exc = {r["rel_path"].lower(): r["reasons"] for r in csv.DictReader(open(root / "logs" / "excluded.csv"))}
for path, why in fake["expected_bad"].items():
    got = exc.get(path.lower())
    check(got is not None, f"excluded {path.split('/')[-1]} ({why}) -> {got}")

report = json.load(open(root / "clean" / "cleaning_report.json"))
check(report["train_minutes"] > 0.3, f"training minutes reported: {report['train_minutes']}")
check(report["lines_holdout"] > 0, f"held-out lines: {report['lines_holdout']}")
import soundfile as sf  # noqa: E402
infos = [sf.info(str(p)) for p in (root / "dataset").glob("*.wav")]
check(all(i.samplerate == 40000 and i.channels == 1 and i.subtype == "PCM_16" for i in infos),
      f"all {len(infos)} dataset files are mono 40 kHz 16-bit")
check(all(i.duration >= 1.0 for i in infos), "no dataset file under 1 s")

state = json.load(open(root / "logs" / "state.json"))
check(all(s.get("status") == "done" for s in state["steps"].values()), "every step marked done")
sel = json.load(open(root / "eval" / "selection.json"))
check(sel["candidates"] >= 2, f"scored {sel['candidates']} checkpoints, picked epoch {sel['chosen_epoch']}")
z = zipfile.ZipFile(root / "model" / "GLaDOS.zip")
check(sorted(z.namelist()) == ["GLaDOS.index", "GLaDOS.pth"], f"zip holds {z.namelist()}")
for p in (8, 12, 14):
    f = root / "samples" / f"GLaDOS_pitch+{p:02d}.wav"
    check(f.exists() and sf.info(str(f)).duration > 3, f"sample {f.name}")
readme = (root / "README.md").read_text()
check("minutes" in readme and "epoch" in readme and "pitch" in readme.lower(), "README written")
print(f"\n{len(fails)} failures")
sys.exit(1 if fails else 0)
