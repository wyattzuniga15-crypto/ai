"""Builds a fake Steam library + Portal 2 install for testing the pipeline.

The VPKs are written in the real format (v1 multi-archive like Portal 2's own
pak01_dir.vpk + pak01_000.vpk, v1 single-file, and v2), and the voice lines are
real speech clips cut up and, for some, deliberately damaged so every cleaning
rule has something to catch. The test lines are named like Portal 2's
(sp_a1_..., dlc1_mp_coop_...) but the audio is public LibriSpeech speech.
"""

from __future__ import annotations

import io
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glados import audio as A  # noqa: E402


# ----------------------------------------------------------------------------- VPK writer

def _tree(entries: dict[str, tuple]) -> bytes:
    """entries: path -> (crc, archive_index, offset, length, preload_bytes)"""
    by_ext: dict = {}
    for path, meta in entries.items():
        d, _, fname = path.rpartition("/")
        name, _, ext = fname.rpartition(".")
        by_ext.setdefault(ext, {}).setdefault(d or " ", []).append((name, meta))
    out = io.BytesIO()
    for ext, dirs in by_ext.items():
        out.write(ext.encode() + b"\0")
        for d, files in dirs.items():
            out.write(d.encode() + b"\0")
            for name, (crc, arch, off, length, preload) in files:
                out.write(name.encode() + b"\0")
                out.write(struct.pack("<IHHIIH", crc, len(preload), arch, off, length, 0xFFFF))
                out.write(preload)
            out.write(b"\0")
        out.write(b"\0")
    out.write(b"\0")
    return out.getvalue()


def write_vpk(dir_path: Path, files: dict[str, bytes], mode: str = "multi", preload: int = 0):
    """mode: 'multi' (v1, data in pak01_000.vpk), 'embedded' (v1, data after the tree), 'v2'."""
    dir_path.parent.mkdir(parents=True, exist_ok=True)
    entries, blob = {}, io.BytesIO()
    for path, data in files.items():
        pre, rest = data[:preload], data[preload:]
        off = blob.tell()
        blob.write(rest)
        arch = 0 if mode in ("multi", "v2") else 0x7FFF
        entries[path] = (zlib.crc32(data) & 0xFFFFFFFF, arch, off, len(rest), pre)
    tree = _tree(entries)
    with open(dir_path, "wb") as f:
        if mode == "v2":
            f.write(struct.pack("<7I", 0x55AA1234, 2, len(tree), 0, 0, 48, 0))
            f.write(tree)
            f.write(b"\0" * 48)
        else:
            f.write(struct.pack("<3I", 0x55AA1234, 1, len(tree)))
            f.write(tree)
            if mode == "embedded":
                f.write(blob.getvalue())
    if mode in ("multi", "v2"):
        (dir_path.with_name(dir_path.name.replace("_dir.vpk", "_000.vpk"))).write_bytes(blob.getvalue())


# ----------------------------------------------------------------------------- audio helpers

def wav_bytes(x: np.ndarray, sr: int, subtype="PCM_16", channels=1, source_chunks=False) -> bytes:
    buf = io.BytesIO()
    data = np.stack([x] * channels, axis=1) if channels > 1 else x
    sf.write(buf, data, sr, subtype=subtype, format="WAV")
    b = buf.getvalue()
    if source_chunks:  # Source-engine style extra chunks (cue points + LIST) after the data
        cue = b"cue " + struct.pack("<II", 28, 1) + struct.pack("<II4sIII", 1, 0, b"data", 0, 0, 0)
        lst = b"LIST" + struct.pack("<I", 12) + b"adtl" + b"note" + struct.pack("<I", 0)
        body = b[12:] + cue + lst
        b = b"RIFF" + struct.pack("<I", len(body) + 4) + b"WAVE" + body
    return b


def ffmpeg_encode(x: np.ndarray, sr: int, fmt: str, codec: str) -> bytes:
    src = io.BytesIO()
    sf.write(src, x, sr, subtype="PCM_16", format="WAV")
    r = subprocess.run([A.ffmpeg_exe(), "-v", "error", "-i", "-", "-c:a", codec, "-f", fmt, "-"],
                       input=src.getvalue(), capture_output=True, check=True)
    return r.stdout


def speech_chunks(clips: list[Path], sr: int = 44100, length=(2.2, 3.8), hop=1.1) -> list[np.ndarray]:
    out = []
    rng = np.random.default_rng(1)
    for c in clips:
        x, s, _ = A.load_audio(c)
        x = A.resample(x, s, sr)
        x = x / (np.abs(x).max() + 1e-9) * 0.7
        t = 0.0
        while t + length[1] < len(x) / sr:
            L = rng.uniform(*length)
            seg = x[int(t * sr): int((t + L) * sr)]
            out.append(np.concatenate([np.zeros(int(0.15 * sr)), seg, np.zeros(int(0.2 * sr))]).astype(np.float32))
            t += hop
    return out


def sung_notes(sr: int, notes_hz=(262, 294, 330, 349, 392), dur=0.7) -> np.ndarray:
    t = np.arange(int(sr * dur)) / sr
    out = []
    for f in notes_hz:
        tone = sum((0.5 / k) * np.sin(2 * np.pi * f * k * t) for k in range(1, 8))
        env = np.minimum(1, np.minimum(t / 0.05, (dur - t) / 0.05))
        out.append(tone * env)
    y = np.concatenate([np.zeros(int(0.2 * sr))] + out + [np.zeros(int(0.2 * sr))])
    return (0.4 * y / np.abs(y).max()).astype(np.float32)


def scream(sr: int, dur=1.6) -> np.ndarray:
    t = np.arange(int(sr * dur)) / sr
    f = 750 + 150 * np.sin(2 * np.pi * 1.5 * t)
    ph = 2 * np.pi * np.cumsum(f) / sr
    y = sum((0.6 / k) * np.sin(k * ph) for k in range(1, 6)) * np.minimum(1, t / 0.05)
    y = y + 0.03 * np.random.default_rng(0).standard_normal(len(t))
    return np.concatenate([np.zeros(int(0.1 * sr)), 0.8 * y / np.abs(y).max(), np.zeros(int(0.1 * sr))]).astype(np.float32)


# ----------------------------------------------------------------------------- install

def build_fake_install(base: Path, glados_clips: list[Path], other_clips: list[Path], music: Path) -> dict:
    """Returns {"steam_root", "library", "game_dir", "expected": {...}}."""
    sr = 44100
    steam = base / "Steam"
    lib = base / "OtherDrive" / "SteamLibrary"
    game = lib / "steamapps" / "common" / "Portal 2"
    (steam / "steamapps").mkdir(parents=True, exist_ok=True)
    (lib / "steamapps").mkdir(parents=True, exist_ok=True)
    lib_escaped = str(lib).replace("\\", "\\\\")
    steam_escaped = str(steam).replace("\\", "\\\\")
    (steam / "steamapps" / "libraryfolders.vdf").write_text(f'''"libraryfolders"
{{
\t"0"
\t{{
\t\t"path"\t\t"{steam_escaped}"
\t\t"apps"\t\t{{ "440"\t\t"123" }}
\t}}
\t"1"
\t{{
\t\t"path"\t\t"{lib_escaped}"
\t\t"apps"\t\t{{ "620"\t\t"456" }}
\t}}
}}
''')
    (lib / "steamapps" / "appmanifest_620.acf").write_text('"AppState"\n{\n\t"appid"\t\t"620"\n\t"installdir"\t\t"Portal 2"\n}\n')

    chunks = speech_chunks(glados_clips, sr)
    rng = np.random.default_rng(7)
    base_files: dict[str, bytes] = {}
    expected_bad: dict[str, str] = {}
    # clean lines in assorted Source formats
    fmts = ["pcm44", "pcm44", "pcm22", "adpcm", "mp3", "stereo", "source_chunks"]
    for i, x in enumerate(chunks):
        kind = fmts[i % len(fmts)]
        name = f"sound/vo/glados/sp_a{1 + i % 4}_line{i:02d}.wav"
        if kind == "pcm44":
            base_files[name] = wav_bytes(x, sr)
        elif kind == "pcm22":
            base_files[name] = wav_bytes(A.resample(x, sr, 22050), 22050)
        elif kind == "adpcm":
            base_files[name] = ffmpeg_encode(x, sr, "wav", "adpcm_ms")
        elif kind == "mp3":
            base_files[name.replace(".wav", ".mp3")] = ffmpeg_encode(x, sr, "mp3", "libmp3lame")
        elif kind == "stereo":
            base_files[name] = wav_bytes(x, sr, channels=2)
        else:
            base_files[name] = wav_bytes(x, sr, source_chunks=True)

    donor = chunks[0]
    m, msr, _ = A.load_audio(music)
    m = A.resample(m, msr, sr)[: len(donor) + sr]
    bad = {
        "sound/vo/glados/sp_a2_bts_b01.wav": (np.concatenate([donor, np.zeros(sr // 2, np.float32)])
                                               + 0.35 * m[: len(donor) + sr // 2], "music bed"),
        "sound/vo/glados/sp_a2_bts_b02.wav": (donor + 0.06 * rng.standard_normal(len(donor)).astype(np.float32), "static"),
        "sound/vo/glados/sp_a2_bts_b03.wav": (np.clip(donor * 6, -1, 1), "clipped"),
        "sound/vo/glados/sp_a3_b04.wav": (sung_notes(sr), "singing"),
        "sound/vo/glados/sp_a3_b05.wav": (scream(sr), "scream"),
        "sound/vo/glados/sp_a3_b06.wav": (donor[: int(0.75 * sr)], "too short"),
        "sound/vo/glados/sp_a3_b07.wav": (np.zeros(sr, np.float32), "silent"),
        "sound/vo/glados/sp_a3_b08.wav": (A.resample(A.resample(chunks[6][::-1].copy(), sr, 8000), 8000, sr), "radio / low bandwidth"),
        "sound/vo/glados/glados_laugh01.wav": (chunks[2], "name: laugh"),
        "sound/vo/glados/sp_a4_glitch02.wav": (chunks[3], "name: glitch"),
        "sound/vo/glados/sp_a4_finale_caroline01.wav": (chunks[4], "name: caroline"),
        "sound/vo/potatos/potatos_sp_a3_intro01.wav": (chunks[5], "name: potato"),
        "sound/vo/glados/sp_a1_line00_again.wav": (chunks[0], "identical duplicate"),
    }
    for path, (x, why) in bad.items():
        base_files[path] = wav_bytes(np.asarray(x, np.float32), sr)
        expected_bad[path] = why
    # re-encoded copy = near duplicate
    base_files["sound/vo/glados/sp_a1_line01_alt.mp3"] = ffmpeg_encode(chunks[1] * 0.8, sr, "mp3", "libmp3lame")
    expected_bad["sound/vo/glados/sp_a1_line01_alt.mp3"] = "near duplicate"
    # other characters must not be extracted
    for i, x in enumerate(speech_chunks(other_clips, sr)[:6]):
        base_files[f"sound/vo/wheatley/sp_a1_wakeup{i:02d}.wav"] = wav_bytes(x, sr)
    base_files["scripts/game_sounds_vo_glados.txt"] = b'"GLaDOS.sp_a1_line00" { "wave" "*vo/glados/sp_a1_line00.wav" }'
    base_files["materials/dummy.vmt"] = b"LightmappedGeneric {}"
    write_vpk(game / "portal2" / "pak01_dir.vpk", base_files, mode="multi", preload=32)

    # DLC1 (v1 embedded): coop lines + a newer copy of one base line (must win)
    dlc = {}
    for i, x in enumerate(chunks[-4:]):
        dlc[f"sound/vo/glados/dlc1_mp_coop_art_death_turret{i:02d}.wav"] = wav_bytes(x, sr)
    # same path as a base-game line (sp_a3_line02.wav): the DLC copy must win
    dlc["sound/vo/glados/sp_a3_line02.wav"] = wav_bytes(chunks[2][: int(len(chunks[2]) * 0.95)], sr)
    write_vpk(game / "portal2_dlc1" / "pak01_dir.vpk", dlc, mode="embedded")
    # DLC2 (v2 format)
    write_vpk(game / "portal2_dlc2" / "pak01_dir.vpk",
              {"sound/vo/glados/dlc2_line00.wav": wav_bytes(chunks[-5], sr)}, mode="v2")
    # A localised folder: must be skipped entirely
    write_vpk(game / "portal2_french" / "pak01_dir.vpk",
              {"sound/vo/glados/sp_a1_line00.wav": wav_bytes(chunks[0] * 0.5, sr)}, mode="embedded")
    return {"steam_root": steam, "library": lib, "game_dir": game, "expected_bad": expected_bad,
            "n_clean_base": len(chunks)}
