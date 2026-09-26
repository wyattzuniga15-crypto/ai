"""Portal 2's own subtitles for each voice line.

Source games tie a caption to a *soundscript entry* ("GLaDOS.sp_a1_intro1_01"),
and the entry to a wave file (vo/glados/sp_a1_intro1_01.wav). So: read every
soundscript (scripts/*.txt) to map wave -> entry names, read the English caption
files (resource/closecaption_english.txt, or the compiled .dat, keyed by CRC32
of the lower-cased entry name), and join the two. Everything is read from the
game's VPKs/loose files without changing them.
"""

from __future__ import annotations

import re
import struct
import zlib
from pathlib import Path

from .common import LOG
from .extract import content_folders, iter_vpk, read_vpk_entry

CAPTION_FILES = ("resource/closecaption_english.txt", "resource/closecaption_english.dat",
                 "resource/subtitles_english.txt", "resource/subtitles_english.dat")
TAG_RE = re.compile(r"<[^>]*>")


def normalise_wave(path: str) -> str:
    p = re.sub(r"/+", "/", path.strip().replace("\\", "/")).lstrip("*#@><^)}$!?&~ ").lower()
    return p if p.startswith("sound/") else "sound/" + p


def _tokens(text: str):
    text = re.sub(r"//[^\n]*", "", text)
    for m in re.finditer(r'"([^"]*)"|([{}])|([^\s{}"]+)', text):
        yield m.group(1) if m.group(1) is not None else (m.group(2) or m.group(3))


def parse_soundscript(text: str) -> dict[str, list[str]]:
    """wave path -> [entry names] for every entry in one soundscript file."""
    out: dict[str, list[str]] = {}
    toks = list(_tokens(text))
    i, depth, entry, prev = 0, 0, None, None
    while i < len(toks):
        t = toks[i]
        if t == "{":
            if depth == 0:
                entry = prev
            depth += 1
        elif t == "}":
            depth = max(0, depth - 1)
            if depth == 0:
                entry = None
        elif depth >= 1 and entry and t.lower() == "wave" and i + 1 < len(toks) and toks[i + 1] not in "{}":
            out.setdefault(normalise_wave(toks[i + 1]), []).append(entry.lower())
            i += 1
        prev = t
        i += 1
    return out  # rndwave { "wave" ... "wave" ... } blocks are caught by the same rule


def _decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    if len(raw) > 3 and raw[1] == 0 and raw[3] == 0:
        return raw.decode("utf-16-le")
    return raw.decode("utf-8", errors="replace")


def parse_caption_txt(raw: bytes) -> dict[str, str]:
    text = _decode(raw)
    out = {}
    for m in re.finditer(r'^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"', text, re.MULTILINE):
        key, val = m.group(1).lower(), m.group(2)
        if key in ("language", "tokens", "lang"):
            continue
        out[key] = val
    return out


def parse_caption_dat(raw: bytes) -> dict[int, str]:
    """Compiled captions: {crc32(lowercase token): text}."""
    magic, version, numblocks, blocksize, dirsize, dataoffset = struct.unpack_from("<4siiiii", raw, 0)
    if magic != b"VCCD" or dirsize <= 0:
        return {}
    entry = (dataoffset - 24) // dirsize if dataoffset > 24 else 12
    entry = 16 if entry >= 16 else 12
    out = {}
    for k in range(dirsize):
        base = 24 + k * entry
        if entry == 12:
            h, block, off, length = struct.unpack_from("<IiHH", raw, base)
        else:
            h, _, block, off, length = struct.unpack_from("<IIiHH", raw, base)
        start = dataoffset + block * blocksize + off
        txt = raw[start:start + length].decode("utf-16-le", errors="replace").rstrip("\x00")
        out[h] = txt
    return out


def clean_caption(text: str) -> str:
    t = TAG_RE.sub("", text.replace("\\n", " "))
    t = re.sub(r"^\s*\[?[A-Za-z .'-]{2,20}\]?\s*:\s*", "", t)  # "GLaDOS: ..." speaker prefix
    t = re.sub(r"\s+", " ", t).strip()
    return t


def read_game_captions(game_dir: Path) -> dict[str, str]:
    """rel wave path ("sound/vo/glados/x.wav") -> caption text (cleaned)."""
    folders = sorted(content_folders(game_dir), key=lambda f: f["priority"])  # low first; later overrides
    wave_to_entries: dict[str, list[str]] = {}
    captions_txt: dict[str, str] = {}
    captions_dat: dict[int, str] = {}
    found = []
    for folder in folders:
        items = []  # (rel_path, reader)
        for dir_vpk in folder["vpks"]:
            for path, meta in iter_vpk(dir_vpk):
                low = path.lower()
                if (low.startswith("scripts/") and low.endswith(".txt")) or low in CAPTION_FILES:
                    items.append((low, lambda d=dir_vpk, m=meta: read_vpk_entry(d, m)))
        root = game_dir / folder["name"]
        for rel in CAPTION_FILES:
            if (root / rel).is_file():
                items.append((rel, lambda p=root / rel: p.read_bytes()))
        if (root / "scripts").is_dir():
            for p in (root / "scripts").glob("*.txt"):
                items.append((f"scripts/{p.name.lower()}", lambda p=p: p.read_bytes()))
        for rel, read in items:
            try:
                raw = read()
            except Exception as exc:
                LOG.debug("could not read %s: %s", rel, exc)
                continue
            if rel.startswith("scripts/"):
                if b"vo/glados" not in raw.lower().replace(b"\\", b"/") and b"vo/potatos" not in raw.lower():
                    continue
                for wave, names in parse_soundscript(_decode(raw)).items():
                    wave_to_entries.setdefault(wave, [])
                    wave_to_entries[wave] += [n for n in names if n not in wave_to_entries[wave]]
            elif rel.endswith(".txt"):
                captions_txt.update(parse_caption_txt(raw))
                found.append(f"{folder['name']}/{rel}")
            else:
                captions_dat.update(parse_caption_dat(raw))
                found.append(f"{folder['name']}/{rel}")
    LOG.info("Captions: %d soundscript entries point at voice files; caption files: %s",
             len(wave_to_entries), ", ".join(found) or "none found")
    out = {}
    for wave, names in wave_to_entries.items():
        for n in names:
            txt = captions_txt.get(n)
            if txt is None:
                txt = captions_dat.get(zlib.crc32(n.encode("utf-8")) & 0xFFFFFFFF)
            if txt:
                out[wave] = clean_caption(txt)
                break
    return out
