"""GLaDOS RVC v2 voice model, end to end, from your own Portal 2 install.

Normally started by run.bat / run.ps1, which set up Python first. Every step
records its result in <root>\\logs\\state.json; running again skips finished
steps and resumes an interrupted one (training resumes from its last snapshot).

  python glados_pipeline.py --root C:\\GLaDOSVoice            run / resume everything
  python glados_pipeline.py --redo clean                     redo a step and all later ones
  python glados_pipeline.py --until clean                    stop after a step
"""

from __future__ import annotations

import argparse
import multiprocessing
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from glados import applio as AP  # noqa: E402
from glados import clean as CL  # noqa: E402
from glados import evaluate as EV  # noqa: E402
from glados.common import (LOG, Blocked, State, StepFailed, Workspace, fmt_duration,  # noqa: E402
                           keep_awake, setup_logging)
from glados.extract import DEFAULT_VO_FOLDER_PATTERN, run_extract  # noqa: E402
from glados.locate import find_portal2  # noqa: E402
from glados.report import write_readme  # noqa: E402

STEPS = [
    ("locate", "Find Portal 2"),
    ("extract", "Extract GLaDOS voice files from the game archives"),
    ("convert", "Convert every line to mono 40 kHz 16-bit WAV"),
    ("clean", "Exclude non-speech lines, dedupe, trim, normalise, hold out a test set"),
    ("setup_applio", "Install Applio (RVC v2) in its own venv, with CUDA PyTorch and models"),
    ("gpu_check", "Verify training will run on the RTX 3060 Ti"),
    ("preprocess", "Slice the dataset (Applio)"),
    ("features", "Extract RMVPE pitch and ContentVec features on the GPU"),
    ("train", "Train the RVC v2 40k model"),
    ("index", "Build the .index file"),
    ("test_clip", "Prepare a male test clip"),
    ("select", "Score every checkpoint on held-out lines and pick the best"),
    ("export", "Copy the model to model\\ and build GLaDOS.zip"),
    ("samples", "Convert the test clip at +8, +12 and +14"),
    ("report", "Write README.md"),
]
NAMES = [s[0] for s in STEPS]
GPU_STEPS = {"preprocess", "features", "train", "index", "select", "samples"}

# Settings that shape the model; stored on first use so a plain re-run reuses them.
DEFAULTS = {"epochs": 300, "save_every": 10, "batch_size": 8, "gpu_name": "3060 Ti", "pretrain": "titan",
            "min_seconds": 1.0, "min_minutes": 40.0, "max_minutes": 70.0, "vo_folders": DEFAULT_VO_FOLDER_PATTERN}
# If one of these changes, these steps (and all after them) must be redone.
INVALIDATES = {"min_seconds": "clean", "min_minutes": "clean", "max_minutes": "clean",
               "vo_folders": "extract", "pretrain": "preprocess", "epochs": "train", "save_every": "train"}


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=r"C:\GLaDOSVoice", help="workspace folder")
    ap.add_argument("--game-dir", help="Portal 2 folder (the one containing 'portal2'); found automatically")
    ap.add_argument("--uv", default=None, help="path to uv (run.ps1 passes it)")
    ap.add_argument("--redo", nargs="+", choices=NAMES, metavar="STEP", help="redo these steps and all later ones")
    ap.add_argument("--until", choices=NAMES, metavar="STEP", help="stop after this step")
    ap.add_argument("--epochs", type=int)
    ap.add_argument("--save-every", type=int, help="save a snapshot every N epochs (default 10)")
    ap.add_argument("--batch-size", type=int, help="starting batch size (default 8; lowered automatically on out-of-memory)")
    ap.add_argument("--gpu-name", help="part of the CUDA device name to train on (default '3060 Ti')")
    ap.add_argument("--pretrain", help="pretrained base: 'titan' (default, falls back to stock) or 'stock'")
    ap.add_argument("--min-seconds", type=float, help="shortest line kept after trimming (default 1.0)")
    ap.add_argument("--min-minutes", type=float, help="relax the audio rules below this many minutes (default 40)")
    ap.add_argument("--max-minutes", type=float, help="drop the least typical lines above this (default 70)")
    ap.add_argument("--vo-folders", help="regex for the sound/vo/ folders to extract")
    ap.add_argument("--workers", type=int, default=max(1, min((os.cpu_count() or 4) - 1, 12)))
    ap.add_argument("--allow-cpu", action="store_true", help=argparse.SUPPRESS)  # test mode only
    ap.add_argument("--verbose", action="store_true")
    return ap.parse_args(argv)


def resolve_settings(args, state: State) -> list[str]:
    """explicit flag > value stored from an earlier run > default. Returns steps to redo."""
    stored = state.data["settings"]
    redo = []
    for key, default in DEFAULTS.items():
        given = getattr(args, key)
        value = given if given is not None else stored.get(key, default)
        if key in stored and stored[key] != value and key in INVALIDATES:
            LOG.info("Setting %s changed %s -> %s: redoing from step '%s'", key, stored[key], value, INVALIDATES[key])
            redo.append(INVALIDATES[key])
        setattr(args, key, value)
        stored[key] = value
    state.save()
    return redo


def find_uv(args, ws: Workspace) -> str:
    for cand in (args.uv, ws.tools / "uv" / ("uv.exe" if os.name == "nt" else "uv"), shutil.which("uv")):
        if cand and Path(cand).exists():
            return str(cand)
    raise Blocked("uv (the Python installer) was not found. Start the pipeline with run.bat, which installs it.")


def main(argv=None) -> int:
    args = parse_args(argv)
    ws = Workspace(Path(args.root))
    ws.make()
    setup_logging(ws, args.verbose)
    state = State(ws.state_file)
    LOG.info("GLaDOSVoice pipeline. Workspace: %s. Personal use: nothing is uploaded anywhere.", ws.root)

    redo = resolve_settings(args, state) + (args.redo or [])
    if redo:
        first = min(NAMES.index(r) for r in redo)
        for name in NAMES[first:]:
            state.reset(name)
        LOG.info("Will redo from step '%s'", NAMES[first])

    keep_awake()
    ctx = {"args": args, "ws": ws, "state": state}
    t_run = time.time()
    last = NAMES.index(args.until) if args.until else len(NAMES) - 1
    pending_gpu = any(not state.is_done(n) for n in GPU_STEPS)

    for i, (name, title) in enumerate(STEPS[: last + 1], 1):
        rerun_gpu_check = name == "gpu_check" and pending_gpu
        if state.is_done(name) and not rerun_gpu_check:
            LOG.info("[%2d/%d] %s: already done", i, len(STEPS), title)
            continue
        LOG.info("=" * 78)
        LOG.info("[%2d/%d] %s", i, len(STEPS), title)
        state.mark(name, "running")
        t0 = time.time()
        try:
            info = RUNNERS[name](ctx) or {}
        except Blocked as exc:
            state.mark(name, "blocked", {"error": str(exc)})
            LOG.error("")
            LOG.error("BLOCKED at step '%s' - this needs you:", name)
            for line in str(exc).splitlines():
                LOG.error("    %s", line)
            LOG.error("Fix that, then run run.bat again; it picks up from here.")
            return 2
        except KeyboardInterrupt:
            state.mark(name, "interrupted")
            LOG.warning("Interrupted. Run run.bat again to resume from step '%s'.", name)
            return 130
        except Exception as exc:
            state.mark(name, "failed", {"error": f"{type(exc).__name__}: {exc}"[:2000]})
            LOG.error("Step '%s' failed: %s", name, exc)
            LOG.debug(traceback.format_exc())
            (ws.logs / "last_error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            LOG.error("Details: %s. Running run.bat again retries this step "
                      "(finished work is kept).", ws.logs / "last_error.txt")
            return 1
        state.mark(name, "done", {**info, "seconds": round(time.time() - t0)})
        LOG.info("[%2d/%d] done in %s", i, len(STEPS), fmt_duration(time.time() - t0))

    if args.until:
        LOG.info("Stopped after step '%s' as asked.", args.until)
        return 0
    s = state.data["steps"]
    cl = s.get("clean", {}).get("info", {})
    sel = s.get("select", {}).get("info", {})
    ex = s.get("export", {}).get("info", {})
    smp = s.get("samples", {}).get("info", {})
    LOG.info("=" * 78)
    LOG.info("ALL DONE in %s.", fmt_duration(time.time() - t_run))
    LOG.info("  Clean training audio: %s min (%s lines)", cl.get("train_minutes"), cl.get("lines_train"))
    LOG.info("  Epochs trained: %s; checkpoint picked: epoch %s", s.get("train", {}).get("info", {}).get("epochs"),
             sel.get("chosen_epoch"))
    LOG.info("  Upload this to voice.ai: %s (%s MB)", ex.get("zip"), ex.get("zip_megabytes"))
    LOG.info("  Recommended pitch: +%s. Listen to %s first.", smp.get("pitch", {}).get("recommended"), ws.samples)
    LOG.info("  Full write-up: %s", ws.root / "README.md")
    return 0


# ----------------------------------------------------------------------------- step runners

def _gpu(ctx):
    return ctx["state"].info("gpu_check")


def _locate(ctx):
    game = find_portal2(ctx["args"].game_dir)
    LOG.info("Portal 2 found at %s (read-only; nothing in it is changed)", game)
    return {"game_dir": str(game)}


def _extract(ctx):
    return run_extract(ctx["ws"], Path(ctx["state"].info("locate")["game_dir"]), ctx["args"].vo_folders)


def _convert(ctx):
    return CL.run_convert(ctx["ws"], ctx["args"].workers)


def _clean(ctx):
    a = ctx["args"]
    return CL.run_clean(ctx["ws"], a.workers, a.min_seconds, a.min_minutes, a.max_minutes)


def _setup(ctx):
    a = ctx["args"]
    a.uv = find_uv(a, ctx["ws"])
    return AP.setup_applio(ctx["ws"], a)


def _gpu_check(ctx):
    return AP.gpu_check(ctx["ws"], ctx["args"])


def _preprocess(ctx):
    return AP.preprocess(ctx["ws"], _gpu(ctx))


def _features(ctx):
    return AP.extract_features(ctx["ws"], _gpu(ctx))


def _train(ctx):
    st = ctx["state"]
    live = st.step("train").setdefault("info", {})
    return AP.train(ctx["ws"], ctx["args"], _gpu(ctx), st.info("setup_applio")["pretrain"], live, st.save)


def _index(ctx):
    return AP.build_index(ctx["ws"], _gpu(ctx))


def _test_clip(ctx):
    return EV.make_test_clip(ctx["ws"])


def _select(ctx):
    st = ctx["state"]
    return EV.select_checkpoint(ctx["ws"], _gpu(ctx), st.info("index")["index"], st.info("train")["epochs"])


def _export(ctx):
    st = ctx["state"]
    return EV.export(ctx["ws"], st.info("select")["chosen_file"], st.info("index"))


def _samples(ctx):
    return EV.make_samples(ctx["ws"], _gpu(ctx))


def _report(ctx):
    path = write_readme(ctx["ws"], ctx["state"].data)
    LOG.info("Wrote %s", path)
    return {"readme": str(path)}


RUNNERS = {"locate": _locate, "extract": _extract, "convert": _convert, "clean": _clean,
           "setup_applio": _setup, "gpu_check": _gpu_check, "preprocess": _preprocess,
           "features": _features, "train": _train, "index": _index, "test_clip": _test_clip,
           "select": _select, "export": _export, "samples": _samples, "report": _report}


if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
