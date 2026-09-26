"""List Portal 2's VPK archives and copy out only GLaDOS voice files.

The game install is opened read-only. Every file is CRC-checked against the
VPK index as it is copied.
"""

from __future__ import annotations

import csv
import re
import zlib
from collections import Counter, defaultdict
from pathlib import Path

from .common import LOG, Blocked, StepFailed, Workspace, write_json

AUDIO_EXT = (".wav", ".mp3", ".ogg")

# Localised content folders (portal2_french, ...). Their VO is not English.
LANGUAGES = {
    "arabic", "brazilian", "bulgarian", "czech", "danish", "dutch", "finnish", "french",
    "german", "greek", "hungarian", "italian", "japanese", "korean", "koreana", "latam",
    "norwegian", "polish", "portuguese", "romanian", "russian", "schinese", "spanish",
    "swedish", "tchinese", "thai", "turkish", "ukrainian", "vietnamese",
}

# Speaker folders under sound/vo/ worth extracting. PotatOS and Caroline folders
# are extracted too, so that their exclusion is visible in the cleaning log.
DEFAULT_VO_FOLDER_PATTERN = r"glados|aperture_ai|potato|caroline"


def is_language_folder(name: str) -> bool:
    parts = name.lower().split("_")
    return len(parts) > 1 and parts[-1] in LANGUAGES


def folder_priority(name: str) -> int:
    """Higher wins when the same file exists in several places (Source mount order)."""
    n = name.lower()
    if n == "update":
        return 100
    m = re.match(r"portal2_dlc(\d+)$", n)
    if m:
        return 50 + int(m.group(1))
    if n == "portal2":
        return 10
    return 20


def content_folders(game_dir: Path) -> list[dict]:
    out = []
    for sub in sorted(p for p in game_dir.iterdir() if p.is_dir()):
        if is_language_folder(sub.name):
            LOG.info("Skipping localised folder %s", sub.name)
            continue
        vpks = sorted(sub.glob("*_dir.vpk"))
        loose = sub / "sound" / "vo"
        if vpks or loose.is_dir():
            out.append({"name": sub.name, "priority": folder_priority(sub.name),
                        "vpks": vpks, "loose": loose if loose.is_dir() else None})
    return out


def _archive_path(dir_vpk: Path, archive_index: int) -> Path:
    # pak01_dir.vpk -> pak01_003.vpk (done on the file name only; the vpk
    # package's own version rewrites the whole path, which breaks on some folders).
    stem = dir_vpk.name[: -len("_dir.vpk")]
    return dir_vpk.with_name(f"{stem}_{archive_index:03d}.vpk")


def read_vpk_entry(dir_vpk: Path, meta: tuple) -> bytes:
    preload, crc32, preload_length, archive_index, archive_offset, file_length = meta
    data = bytes(preload)
    if file_length:
        src = dir_vpk if archive_index == 0x7FFF else _archive_path(dir_vpk, archive_index)
        with open(src, "rb") as f:
            f.seek(archive_offset)
            body = f.read(file_length)
        if len(body) != file_length:
            raise StepFailed(f"Short read from {src}: wanted {file_length}, got {len(body)}")
        data += body
    if zlib.crc32(data) & 0xFFFFFFFF != crc32:
        raise StepFailed(f"CRC mismatch for an entry in {dir_vpk.name}; the game files may be "
                         "damaged (Steam > Portal 2 > Properties > Verify integrity).")
    return data


def iter_vpk(dir_vpk: Path):
    import vpk  # the "vpk" PyPI package

    pak = vpk.open(str(dir_vpk))
    for path, meta in pak.read_index_iter():
        yield path.replace("\\", "/"), meta


def line_id(rel_vo_path: str) -> str:
    """sound/vo/glados/sp_a1_intro1_01.wav -> glados__sp_a1_intro1_01"""
    rel = rel_vo_path.lower()
    if rel.startswith("sound/vo/"):
        rel = rel[len("sound/vo/"):]
    rel = rel.rsplit(".", 1)[0]
    return rel.replace("/", "__")


def run_extract(ws: Workspace, game_dir: Path, vo_pattern: str = DEFAULT_VO_FOLDER_PATTERN) -> dict:
    speaker_re = re.compile(vo_pattern, re.IGNORECASE)
    folders = content_folders(game_dir)
    if not folders:
        raise Blocked(f"No VPK archives found under {game_dir}.")

    all_vo_counts: Counter = Counter()
    sub_counts: Counter = Counter()
    candidates: dict[str, list[dict]] = defaultdict(list)
    listing_path = ws.logs / "vpk_vo_listing.txt"
    with open(listing_path, "w", encoding="utf-8") as listing:
        for folder in folders:
            for dir_vpk in folder["vpks"]:
                n_files = 0
                for path, meta in iter_vpk(dir_vpk):
                    n_files += 1
                    low = path.lower()
                    if not low.startswith("sound/vo/"):
                        continue
                    listing.write(f"{folder['name']}/{dir_vpk.name}\t{path}\t{meta[5] + meta[2]}\n")
                    parts = low.split("/")
                    speaker = parts[2] if len(parts) > 3 else "(root)"
                    all_vo_counts[speaker] += 1
                    sub_counts["/".join(parts[:-1])] += 1
                    if speaker_re.search(speaker) and low.endswith(AUDIO_EXT):
                        candidates[low].append({"folder": folder["name"], "priority": folder["priority"],
                                                "vpk": dir_vpk, "path": path, "meta": meta,
                                                "size": meta[2] + meta[5]})
                LOG.info("Indexed %s/%s: %d files", folder["name"], dir_vpk.name, n_files)
            if folder["loose"]:
                for f in folder["loose"].rglob("*"):
                    if not f.is_file():
                        continue
                    rel = "sound/vo/" + f.relative_to(folder["loose"]).as_posix()
                    low = rel.lower()
                    parts = low.split("/")
                    speaker = parts[2] if len(parts) > 3 else "(root)"
                    listing.write(f"{folder['name']}/(loose)\t{rel}\t{f.stat().st_size}\n")
                    all_vo_counts[speaker] += 1
                    sub_counts["/".join(parts[:-1])] += 1
                    if speaker_re.search(speaker) and low.endswith(AUDIO_EXT):
                        candidates[low].append({"folder": folder["name"],
                                                "priority": folder["priority"] + 1,
                                                "loose": f, "path": rel, "size": f.stat().st_size})

    summary_path = ws.logs / "vpk_vo_folders.txt"
    with open(summary_path, "w", encoding="utf-8") as fh:
        fh.write("Voice folders found in the game archives (files per folder):\n\n")
        for sub, n in sorted(sub_counts.items()):
            mark = "  <- extracted" if speaker_re.search(sub.split("/")[2] if sub.count("/") >= 2 else "") else ""
            fh.write(f"{n:6d}  {sub}{mark}\n")
    LOG.info("Voice folders in the archives: %s", ", ".join(f"{k} ({v})" for k, v in all_vo_counts.most_common(12)))
    LOG.info("Full listing: %s ; folder summary: %s", listing_path, summary_path)

    if not candidates:
        raise Blocked("No files matching a GLaDOS voice folder were found under sound/vo/ in the "
                      f"game archives. See {summary_path} for what is there, then re-run with "
                      "--vo-folders \"<regex>\" naming the right folder.")

    manifest_rows = []
    extracted = skipped = overridden = 0
    raw_bytes = 0
    for low, versions in sorted(candidates.items()):
        versions.sort(key=lambda v: v["priority"], reverse=True)
        best = versions[0]
        overridden += len(versions) - 1
        rel_under_vo = best["path"][len("sound/vo/"):]
        dest = ws.raw / Path(rel_under_vo.lower())
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.stat().st_size == best["size"]:
            skipped += 1
        else:
            if "loose" in best:
                data = best["loose"].read_bytes()
            else:
                data = read_vpk_entry(best["vpk"], best["meta"])
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            extracted += 1
        raw_bytes += best["size"]
        manifest_rows.append({
            "id": line_id(best["path"]),
            "rel_path": best["path"],
            "raw_file": str(dest.relative_to(ws.root)),
            "source": f"{best['folder']}/" + (best["vpk"].name if "vpk" in best else "(loose)"),
            "also_in": ";".join(f"{v['folder']}" for v in versions[1:]),
            "bytes": best["size"],
        })
        if (extracted + skipped) % 250 == 0:
            LOG.info("  %d/%d files", extracted + skipped, len(candidates))

    ids = Counter(r["id"] for r in manifest_rows)
    dupes = [i for i, n in ids.items() if n > 1]
    if dupes:  # e.g. foo.wav and foo.mp3 side by side
        for r in manifest_rows:
            if r["id"] in dupes:
                r["id"] = r["id"] + "_" + r["rel_path"].rsplit(".", 1)[1].lower()

    with open(ws.raw / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(manifest_rows[0].keys()))
        w.writeheader()
        w.writerows(manifest_rows)

    by_speaker = Counter(r["rel_path"].lower().split("/")[2] for r in manifest_rows)
    info = {
        "game_dir": str(game_dir),
        "folders_scanned": [f["name"] for f in folders],
        "files": len(manifest_rows),
        "newly_extracted": extracted,
        "already_present": skipped,
        "older_copies_ignored": overridden,
        "megabytes": round(raw_bytes / 1e6, 1),
        "by_folder": dict(by_speaker),
    }
    write_json(ws.raw / "extract_summary.json", info)
    LOG.info("Extracted %d GLaDOS-folder files (%d new, %d already present; %d older duplicate "
             "copies from other archives ignored) -> %s", len(manifest_rows), extracted, skipped,
             overridden, ws.raw)
    return info
