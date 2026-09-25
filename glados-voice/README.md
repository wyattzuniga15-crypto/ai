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
| clean | Measures every line and excludes non-speech: PotatOS and Caroline lines, singing, screams, laughs, glitches, lines with music or sound effects under them, noisy, clipped or radio-filtered lines, lines under 1 s, silent files, and exact or near duplicates. Every exclusion and its reason goes to `logs\excluded.csv`. Kept lines are trimmed and loudness-normalised to -20 LUFS. About 3% are held back as a test set |
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
- `--gpu-name "3060 Ti"`: which CUDA card to require
- `--pretrain stock`: skip the TITAN base
- `--redo <step>`: redo a step and everything after it (e.g. `--redo select`)
- `--until <step>`: stop after a step (e.g. `--until clean` to review the dataset first)

Settings are remembered. Changing one later redoes only the steps it affects:
for example, more epochs continues training from the last snapshot.

## Your own voice for the samples

Put a recording of yourself (WAV/MP3, 10–30 s of normal talking) in
`C:\GLaDOSVoice\samples\input\` and run `run.bat --redo test_clip`. The samples
and the pitch recommendation are then based on your voice instead of the built-in
male test voice.

## Testing

`tests/e2e_sandbox.py` runs the whole pipeline on a machine without the game or a
GPU. It builds a fake Portal 2 install (real VPK formats, real speech, and
planted bad lines for every exclusion rule), then runs Applio for real on the CPU
with random stand-in weights for its downloadable models.
