"""Drop-folder converter (convert_folder.bat).

  convert_folder.bat                    every WAV in <root>\\dropbox -> <root>\\dropbox\\GLaDOS
  convert_folder.bat "D:\\my clips"      every WAV in that folder -> "D:\\my clips\\GLaDOS"
  convert_folder.bat clips --all-audio  also MP3/FLAC/OGG/M4A

Uses the best settings from tune.bat (best_settings.json); without them, the
recommended pitch and standard settings. Files already converted with the same
settings are skipped, so running it again only converts what is new or changed.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from . import voice as V
from .common import LOG, Workspace, read_json, setup_logging, write_json

LEDGER = ".glados_converted.json"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="convert_folder.bat", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", help="folder of clips (default <root>\\dropbox)")
    ap.add_argument("--root", default=r"C:\GLaDOSVoice")
    ap.add_argument("--uv", help=argparse.SUPPRESS)
    ap.add_argument("--out", help="output folder (default <folder>\\GLaDOS)")
    ap.add_argument("--all-audio", action="store_true", help="not just .wav: also mp3/flac/ogg/m4a/...")
    ap.add_argument("--steps", type=float, help="override the GLaDOS-mode step strength (0-1)")
    ap.add_argument("--pitch", type=int, help="override the pitch")
    ap.add_argument("--force", action="store_true", help="reconvert everything")
    a = ap.parse_args(argv)

    ws = Workspace(Path(a.root))
    setup_logging(ws)
    folder = Path(a.folder) if a.folder else ws.root / "dropbox"
    folder.mkdir(parents=True, exist_ok=True)
    out_dir = Path(a.out) if a.out else folder / "GLaDOS"
    s, source = V.default_settings(ws)
    if a.steps is not None:
        s.autotune_strength = max(0.0, min(1.0, a.steps))
    if a.pitch is not None:
        s.pitch = a.pitch
    pth, idx = V.model_files(ws)

    inputs = [p for p in V.collect_inputs([str(folder)], wav_only=not a.all_audio)]
    if not inputs:
        LOG.info("No %s files in %s. Drop some in and run this again.",
                 "audio" if a.all_audio else "WAV", folder)
        return 0
    ledger_path = out_dir / LEDGER
    ledger = {} if a.force else (read_json(ledger_path, {}) or {})
    tag = f"{s.tag()}@{V.model_key(ws)}"  # reconvert if the settings or the model change
    todo = []
    for p in inputs:
        out = out_dir / f"{p.stem}_GLaDOS.wav"
        st = p.stat()
        key = f"{st.st_size}:{int(st.st_mtime)}:{tag}"
        if out.exists() and ledger.get(p.name) == key:
            continue
        out.unlink(missing_ok=True)
        todo.append((p, out, key))
    LOG.info("%d %s file(s) in %s, %d to convert, with %s (%s)", len(inputs), "audio" if a.all_audio else "WAV",
             folder, len(todo), V.describe(s), source)
    if not todo:
        return 0
    prepared = dict(V.prepare([p for p, _, _ in todo], ws.root / "converted" / "_prepared"))
    job = V.job(pth, idx, s, [(prepared[p], out) for p, out, _ in todo])
    V.run_jobs(ws, [job], ws.root / "converted" / "_folder_jobs.json", "convert_folder.log")
    for p, out, key in todo:
        if out.exists():
            ledger[p.name] = key
            LOG.info("  %s -> %s", p.name, out)
        else:
            LOG.error("  %s was not converted; see logs\\convert_folder.log", p.name)
    write_json(ledger_path, ledger)
    return 0
