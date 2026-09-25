"""Writes C:\\GLaDOSVoice\\README.md from what the steps recorded."""

from __future__ import annotations

from pathlib import Path

from .common import MODEL_NAME, Workspace, now, read_json


def _table(rows: list[list], header: list[str]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def write_readme(ws: Workspace, state: dict) -> Path:
    st = state["steps"]
    info = lambda name: st.get(name, {}).get("info", {})  # noqa: E731
    ext, conv, cl = info("extract"), info("convert"), read_json(ws.clean / "cleaning_report.json", {})
    setup, gpu, tr = info("setup_applio"), info("gpu_check"), info("train")
    idx, sel, exp, smp, clip = info("index"), read_json(ws.eval / "selection.json", {}), info("export"), info("samples"), info("test_clip")
    pitch = smp.get("pitch", {})
    rec = pitch.get("recommended", 12)

    lines = [f"# {MODEL_NAME} voice model (personal use only)", "",
             f"Built {now()} by the GLaDOSVoice pipeline from the voice files in your own Portal 2 "
             "install. Keep the audio and the model to yourself: nothing here was uploaded anywhere.", ""]

    lines += ["## Summary", "", _table([
        ["Clean speech used for training", f"**{cl.get('train_minutes', '?')} minutes** ({cl.get('lines_train', '?')} lines)"],
        ["Held out to pick the best checkpoint", f"{cl.get('holdout_minutes', '?')} minutes ({cl.get('lines_holdout', '?')} lines)"],
        ["Lines excluded", f"{cl.get('lines_excluded', '?')} of {cl.get('lines_found', '?')} (reasons below)"],
        ["Epochs trained", f"{tr.get('epochs', '?')} (batch size {tr.get('batch_size', '?')}, snapshot every "
                           f"{state.get('settings', {}).get('save_every', '?')} epochs)"],
        ["Pretrained base", tr.get("pretrain") or setup.get("pretrain", {}).get("name", "?")],
        ["Checkpoint picked", f"**epoch {sel.get('chosen_epoch', '?')}** ({Path(sel.get('chosen_file', '?')).name})"],
        ["Recommended voice.ai pitch", f"**+{rec}** semitones (exact estimate {pitch.get('exact', '?')})"],
        ["GPU", f"{gpu.get('name', '?')} ({gpu.get('vram_gb', '?')} GB), CUDA {gpu.get('cuda_build', '?')}"
                if gpu.get("device") != "cpu" else "none: CPU test mode"],
    ], ["", ""]), ""]

    lines += ["## Files", "",
              f"- `model\\{MODEL_NAME}.pth` - the voice model (RVC v2, 40 kHz, RMVPE, HiFi-GAN)",
              f"- `model\\{MODEL_NAME}.index` - feature index ({idx.get('megabytes', '?')} MB)",
              f"- `model\\{MODEL_NAME}.zip` - both of the above ({exp.get('zip_megabytes', '?')} MB). "
              "**This is the file for voice.ai.**"]
    if exp.get("compact_zip"):
        lines.append(f"- `model\\{MODEL_NAME}_compact.zip` ({exp.get('compact_zip_megabytes')} MB) - same "
                     "model with a smaller k-means index, in case voice.ai rejects the big one")
    lines += [f"- `samples\\male_test_original.wav` - the input: {clip.get('source', '?')}"]
    for p in (8, 12, 14):
        lines.append(f"- `samples\\GLaDOS_pitch+{p:02d}.wav` - converted at +{p}"
                     + ("  <- recommended" if p == rec else ""))
    lines += ["- `logs\\pipeline.log` - everything the pipeline did; `logs\\excluded.csv` - every "
              "excluded line and why; `clean\\features.csv` - the measurements behind each decision",
              "- `eval\\checkpoint_scores.csv` - the score of every saved checkpoint", ""]

    lines += ["## Uploading to voice.ai", "",
              "1. Open voice.ai, go to **Upload Custom Model**, give it a name (e.g. GLaDOS).",
              f"2. Choose `C:\\GLaDOSVoice\\model\\{MODEL_NAME}.zip` and save.",
              f"3. Set the pitch to **+{rec}** and adjust by ear: go up (+14) if she sounds too low or "
              "male, down (+8) if she sounds strained or squeaky. Listen to the three files in "
              "`samples\\` first to hear the difference.", ""]

    lines += ["## How the pitch was chosen", "",
              f"GLaDOS's lines have a median pitch of {cl.get('glados_f0_median_hz', '?')} Hz. The male test "
              f"clip's median is {clip.get('f0_median_hz', '?')} Hz, so matching her needs "
              f"12 x log2({cl.get('glados_f0_median_hz', '?')}/{clip.get('f0_median_hz', '?')}) = "
              f"{pitch.get('exact', '?')} semitones; the closest tested value is +{rec}. "
              "If your own voice is deeper than the test clip, use a slightly higher setting. "
              f"Put a recording of yourself in `samples\\input\\` and run `run.bat --redo test_clip` to "
              "re-measure against your own voice.", ""]
    if smp.get("output_f0_median_hz"):
        lines += ["Measured median pitch of the converted samples: " + ", ".join(
            f"{k}: {v} Hz" for k, v in smp["output_f0_median_hz"].items()), ""]

    lines += ["## Dataset", "",
              f"{ext.get('files', '?')} files were extracted from the GLaDOS voice folders "
              f"({', '.join(f'{k}: {v}' for k, v in ext.get('by_folder', {}).items())}), "
              f"{conv.get('raw_minutes', '?')} minutes in all. Each was converted to mono 40 kHz 16-bit, "
              "measured, and dropped if it was not normal GLaDOS speech. Kept lines were trimmed "
              f"of silence and loudness-normalised to {cl.get('target_lufs', -20)} LUFS.", ""]
    ex = cl.get("excluded_by_reason", {})
    if ex:
        lines += [_table([[k, v["lines"], v["minutes"]] for k, v in ex.items()],
                         ["Excluded because", "Lines", "Minutes"]), ""]

    lines += ["## Training and checkpoint choice", "",
              f"Applio {setup.get('applio_version', '?')} trained for {tr.get('epochs', '?')} epochs and "
              f"saved {tr.get('weights_saved', '?')} snapshots. Every snapshot from epoch "
              f"{(sel.get('table') or [{}])[0].get('epoch', '?')} on converted the held-out GLaDOS lines "
              "(which it never trained on) and the male test clip. The pick minimises a mix of "
              "held-out error (mel-cepstral distance, which rises when a model overtrains) and "
              "timbre distance of the converted male clip from her training lines.", ""]
    ot = sel.get("overtraining", {})
    if ot:
        lines += [f"Overtraining check: held-out error was lowest at epoch {ot.get('best_heldout_epoch')} "
                  f"({ot.get('heldout_mcd_best')} dB) and {ot.get('heldout_mcd_final')} dB at the end "
                  f"({ot.get('final_vs_best_pct'):+}%): {ot.get('verdict')}.", ""]
    table = sel.get("table", [])
    if table:
        lines += [_table([[r["epoch"], f"{r['heldout_mcd_db']:.3f}", f"{r['timbre_distance']:.3f}",
                           f"{r['combined_score']:+.2f}" + ("  <- picked" if r["epoch"] == sel.get("chosen_epoch") else "")]
                          for r in table],
                         ["Epoch", "Held-out MCD (dB, lower = better)", "Timbre distance (lower = better)",
                          "Combined (lower = better)"]), ""]

    lines += ["## Re-running", "",
              "Run `run.bat` again at any time: finished steps are skipped and an interrupted step "
              "resumes (training continues from its last snapshot). To redo a step and everything "
              "after it: `run.bat --redo <step>`, e.g. `--redo select` to re-pick the checkpoint. "
              "Steps: locate, extract, convert, clean, setup_applio, gpu_check, preprocess, features, "
              "train, index, test_clip, select, export, samples, report.", ""]
    path = ws.root / "README.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
