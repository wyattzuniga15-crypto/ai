# GLaDOSVoice

Builds a GLaDOS RVC v2 voice model from the voice files in **your own Portal 2
install**, on your own PC, for personal use. Nothing is uploaded or shared; the
game folder is only read, never changed.

## Run it

1. Copy this `glados-voice` folder anywhere on the Windows PC with the RTX 3060 Ti.
2. Double-click **`run.bat`**.

That's all. It runs unattended for several hours (most of it training), keeps the
PC awake while it works, and writes everything to `C:\GLaDOSVoice\`. If it stops
for any reason (crash, reboot, closed window), double-click `run.bat` again: done
steps are skipped and training resumes from its last snapshot.

It stops and asks for you only when it cannot continue on its own, printing a
**BLOCKED** message that says what to do. For example: Portal 2 isn't installed,
the NVIDIA driver is missing, or the disk is full.

**When it finishes**, upload `C:\GLaDOSVoice\model\GLaDOS.zip` to voice.ai
(**Upload Custom Model**) and set the pitch given in `C:\GLaDOSVoice\README.md`.

## What it does

| Step | What happens |
| --- | --- |
| locate | Finds Portal 2: the default Steam path, then every Steam library listed in `libraryfolders.vdf` |
| extract | Lists every VPK archive (base game, DLC and update folders; localised folders are skipped), writes the full `sound/vo/` listing to `logs\`, and copies out only the GLaDOS voice folders, CRC-checking each file. Where a file exists in several archives, the newest copy wins |
| convert | Converts every line to mono 40 kHz 16-bit WAV (`clean\converted\`) |
| clean | Measures every line and excludes non-speech: PotatOS and Caroline lines, singing, screams, laughs, glitches, lines with music or sound effects under them, noisy, clipped or radio-filtered lines, lines under 1 s, silent files, and exact or near duplicates. Every exclusion and its reason goes to `logs\excluded.csv`. Kept lines are trimmed and loudness-normalised to -20 LUFS. About 3% are held back as a test set. Every line that passes is kept, even past 70 minutes, and the log says how much longer that makes training |
| setup_applio | Installs Applio 3.6.5 (RVC v2) in its own Python 3.12 venv with CUDA PyTorch, its models, and the TITAN pretrained base (falls back to Applio's stock base) |
| gpu_check | Confirms PyTorch sees the RTX 3060 Ti and runs a test on it. From then on, every Applio process sees only that card, so neither the CPU nor the AMD integrated graphics can be used |
| preprocess, features | Applio slicing, then RMVPE pitch and ContentVec features on the GPU |
| train | RVC v2, 40 kHz, 300 epochs, batch size 8, a snapshot every 10 epochs. Out of GPU memory lowers the batch size (then turns on gradient checkpointing); a crash resumes from the last snapshot |
| index | Builds the `.index` file |
| select | Converts the held-out lines and a male test clip with every snapshot, and picks the one with the lowest held-out error and timbre distance (not simply the last one). Overtraining shows up as held-out error rising again |
| export | `model\GLaDOS.pth`, `model\GLaDOS.index`, `model\GLaDOS.zip` (checked to be a standard RVC v2 40k model) |
| samples | Male test clip converted at +8, +12 and +14 in `samples\` |
| report | `C:\GLaDOSVoice\README.md`: dataset minutes, epochs, the chosen checkpoint and why, and the recommended pitch |

## Options

Pass them to `run.bat`, e.g. `run.bat --epochs 350`:

- `--game-dir "D:\SteamLibrary\steamapps\common\Portal 2"`: set the game folder yourself if it isn't found
- `--root D:\GLaDOSVoice`: a different workspace folder
- `--epochs 300`, `--save-every 10`, `--batch-size 8`: training settings
- `--max-minutes 70`: cap the dataset (the least typical lines are dropped first).
  The default is no cap. Epoch time grows in proportion to the audio, so the
  pipeline reports how much longer a set over 70 minutes takes: as a percentage
  after cleaning, and in hours once the first epochs are measured (also in
  `C:\GLaDOSVoice\README.md`).
- `--gpu-name "3060 Ti"`: which CUDA card to require
- `--pretrain stock`: skip the TITAN base
- `--redo <step>`: redo a step and everything after it (e.g. `--redo select`)
- `--until <step>`: stop after a step (e.g. `--until clean` to review the dataset first)

Settings are remembered. Changing one later redoes only the steps it affects:
for example, more epochs continues training from the last snapshot.

## GLaDOS mode (stepped, robotic intonation)

Her delivery moves in flat pitch steps rather than gliding. `glados_mode.bat`
converts your recordings and snaps the pitch toward semitone steps:

- **Drag** audio files or a folder onto `glados_mode.bat`, or run
  `glados_mode.bat` with no arguments to convert everything in `samples\input\`.
- `--strength 0..1` sets how hard it snaps (default 0.8; 1.0 is fully stepped,
  0 is your natural intonation). `--compare` also writes 0 / 0.4 / 0.7 / 1.0 plus
  one file that plays them back to back.
- Results go to `C:\GLaDOSVoice\converted\glados_mode\`.

This does not use Applio's own autotune switch. In Applio 3.6.5 that switch
skips the pitch shift entirely (a +12 conversion comes out at your own pitch)
and gives silent frames a 49 Hz buzz (`tests/test_glados_mode.py` shows both).
Here the snapping runs after the pitch shift, only on voiced frames, and holds
each note for 50 ms so it steps cleanly instead of warbling between two notes.
voice.ai cannot do this live; it applies to recorded clips.

## Settings tuned to your voice

Put a few recordings of yourself in `C:\GLaDOSVoice\samples\input\` (WAV/MP3,
10–60 s each, talking normally), then run **`tune.bat`**. It converts them over a
staged search: pitch, then index rate, protect, GLaDOS-mode step strength, and a
final pitch fine-tune. About 20 settings in all. Each result is scored against
her held-out lines (never used in training) with measures that don't depend on
the words:

| Measure | What it compares |
| --- | --- |
| timbre | MFCC statistics of the output vs hers, relative to how far your raw voice is from hers |
| pitch | median pitch, in semitones |
| range | pitch spread (flat vs lively delivery) |
| steps | share of pitch held on flat plateaus: her stepped intonation |
| artifacts | noise/buzz above her level |

Results:

- `C:\GLaDOSVoice\best_settings.json`, used automatically by `glados_mode.bat`
  and `convert_folder.bat`
- `samples\compare\<clip>_ABCD.wav`, which plays your clip (A), default settings (B),
  the best settings (C) and the best with the other pitch style (D), plus each
  one as a separate file
- `tuning\summary.md` (including the best settings for voice.ai, which can't do
  steps) and `tuning\scores.csv` with every setting tried

## Drop-folder converter

**`convert_folder.bat`** converts every WAV in a folder with your best settings
from `tune.bat` (or the recommended pitch if you haven't tuned yet):

- `convert_folder.bat` with no argument uses `C:\GLaDOSVoice\dropbox\` → `dropbox\GLaDOS\`
- `convert_folder.bat "D:\my clips"` → `D:\my clips\GLaDOS\<name>_GLaDOS.wav`
- Run it again whenever you add clips: files already converted with the same
  settings and model are skipped, and edited ones are redone.
- `--all-audio` includes MP3/FLAC/OGG/M4A too; `--steps 0.8` adds GLaDOS-mode
  steps; `--pitch N` overrides the pitch; `--force` reconverts everything.

## Optional: text-to-speech (`tts.bat`)

Type a line and get several GLaDOS takes to pick from. It works on typed or
recorded lines only; it does not run live inside voice.ai.

- `tts.bat` on its own builds the TTS model once (several hours; resumable like `run.bat`)
- `tts.bat "Oh. It's you."` makes 5 takes; `--takes 8` for more, `--file lines.txt` for one line per row
- `--steps 0.6` adds GLaDOS-mode steps on the RVC pass

How it's built:

1. **Transcripts.** Portal 2's own captions are matched to each clean line through the
   game's soundscripts, then checked against Whisper (`large-v3-turbo`). Where they
   agree, the caption is used (proper punctuation). Where they differ or there's no
   caption, Whisper's text is used. Every decision is in `tts\transcripts.csv`.
2. **Fine-tuning.** F5-TTS (`F5TTS_v1_Base`, pinned to 1.1.22) is fine-tuned on the clean
   training lines, sized for 8 GB: bf16, 8-bit Adam, about 1,500 mel frames per batch,
   and smaller batches if it runs out of memory. Finished snapshots are shrunk to fp16
   weights as training goes (a full one is 3–5 GB). Needs about 15 GB of free disk.
3. **Checkpoint choice.** Every snapshot and the untuned base model synthesise the
   held-out lines' text. The pick has the fewest word errors (Whisper) and the closest
   timbre to her real held-out lines, so fine-tuning can't leave you worse off than the
   base model.
4. **Speaking.** Each take is generated by F5-TTS, polished by the RVC model (pitch 0,
   since it's already her voice), then ranked by word errors and timbre. All takes are kept in
   `tts\out\<time>_<text>\`: `line01_best.wav`, `line01_all_takes.wav` (in rank order)
   and `ranking.csv` with what Whisper heard in each.

The F5-TTS base weights are licensed CC-BY-NC (non-commercial), which fits personal use.
The first run downloads F5-TTS, Vocos and Whisper (about 4 GB) into
`C:\GLaDOSVoice\tools\hf-cache`.

## Your own voice for the samples

Put a recording of yourself (WAV/MP3, 10–30 s of normal talking) in
`C:\GLaDOSVoice\samples\input\` and run `run.bat --redo test_clip`. The samples
and the pitch recommendation are then based on your voice instead of the built-in
male test voice.

## Testing

Everything here was developed on a Linux machine without the game, a GPU or
access to huggingface.co, so the tests build their own stand-ins:

| Test | What it covers |
| --- | --- |
| `tests/test_units.py` | Steam library parsing, name rules, caption formats (`.txt` and compiled `.dat`), WER, metrics, settings migration |
| `tests/e2e_sandbox.py` | The whole pipeline on a fake Portal 2 install: real VPK formats (v1 multi-archive, v1 embedded, v2), real speech, planted bad lines for every exclusion rule, Applio run for real on the CPU with random stand-in weights, and resume after a failure |
| `tests/test_glados_mode.py` | Applio's real pitch code with a known contour: the upstream autotune bug, and GLaDOS mode's +12 / steps / unvoiced handling |
| `tests/test_tools.py` | `glados_mode`, `tune` and `convert_folder` against the finished test workspace |
| `tests/tts_sandbox.py` | The TTS stage with random stand-in F5-TTS/Vocos weights: transcripts (without Whisper), fine-tuning, resume, checkpoint shrinking and choice, takes through RVC, ranking |

What the sandbox cannot show is output quality, since the stand-in weights make noise.
The real model's quality depends on the real run: the held-out scores in
`C:\GLaDOSVoice\README.md` are the objective measure.
