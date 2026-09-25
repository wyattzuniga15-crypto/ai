"""Find the Portal 2 install: default path, then every Steam library folder."""

from __future__ import annotations

import os
import re
import string
from pathlib import Path

from .common import LOG, Blocked

PORTAL2_APPID = "620"
DEFAULT_GAME_DIR = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Portal 2")


def is_portal2_dir(p: Path) -> bool:
    return (p / "portal2" / "pak01_dir.vpk").is_file()


def _registry_steam_roots() -> list[Path]:
    roots = []
    if os.name != "nt":
        return roots
    try:
        import winreg
    except ImportError:
        return roots
    keys = [
        (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
    ]
    for hive, sub, value in keys:
        try:
            with winreg.OpenKey(hive, sub) as k:
                v, _ = winreg.QueryValueEx(k, value)
                if v:
                    roots.append(Path(v))
        except OSError:
            pass
    return roots


def parse_library_folders(vdf_text: str) -> list[Path]:
    """Library paths from libraryfolders.vdf (current and pre-2021 formats)."""
    paths = []
    for m in re.finditer(r'"path"\s+"([^"]+)"', vdf_text):
        paths.append(m.group(1))
    # Old format: "1"  "D:\\SteamLibrary"
    for m in re.finditer(r'^\s*"\d+"\s+"([^"]+)"\s*$', vdf_text, re.MULTILINE):
        paths.append(m.group(1))
    out = []
    for p in paths:
        p = p.replace("\\\\", "\\")
        out.append(Path(p))
    return out


def _installdir_from_manifest(library: Path) -> str | None:
    acf = library / "steamapps" / f"appmanifest_{PORTAL2_APPID}.acf"
    if not acf.is_file():
        return None
    m = re.search(r'"installdir"\s+"([^"]+)"', acf.read_text(encoding="utf-8", errors="replace"))
    return m.group(1) if m else None


def steam_libraries(extra_roots: list[Path] | None = None) -> list[Path]:
    roots = list(extra_roots or [])
    roots += _registry_steam_roots()
    roots += [Path(r"C:\Program Files (x86)\Steam"), Path(r"C:\Program Files\Steam")]
    libs: list[Path] = []
    for root in roots:
        if root not in libs:
            libs.append(root)
        for vdf in (root / "steamapps" / "libraryfolders.vdf", root / "config" / "libraryfolders.vdf"):
            if vdf.is_file():
                LOG.info("Reading Steam library list %s", vdf)
                for lib in parse_library_folders(vdf.read_text(encoding="utf-8", errors="replace")):
                    if lib not in libs:
                        libs.append(lib)
    return libs


def find_portal2(explicit: str | None = None, steam_roots: list[Path] | None = None) -> Path:
    tried: list[Path] = []

    def check(p: Path) -> bool:
        tried.append(p)
        return is_portal2_dir(p)

    if explicit:
        p = Path(explicit)
        if check(p):
            return p
        raise Blocked(f"--game-dir {p} does not contain portal2\\pak01_dir.vpk. "
                      "Point it at the folder that holds the 'portal2' subfolder.")

    if check(DEFAULT_GAME_DIR):
        return DEFAULT_GAME_DIR

    for lib in steam_libraries(steam_roots):
        installdir = _installdir_from_manifest(lib) or "Portal 2"
        if check(lib / "steamapps" / "common" / installdir):
            return lib / "steamapps" / "common" / installdir

    # Last resort: common library locations on every drive.
    if os.name == "nt":
        for letter in string.ascii_uppercase[2:]:
            drive = Path(f"{letter}:\\")
            if not drive.exists():
                continue
            for base in ("SteamLibrary", "Steam", "Games\\Steam", "Games\\SteamLibrary",
                         "Program Files (x86)\\Steam", "Program Files\\Steam"):
                if check(drive / base / "steamapps" / "common" / "Portal 2"):
                    return drive / base / "steamapps" / "common" / "Portal 2"

    listing = "\n  ".join(str(p) for p in tried[:30])
    raise Blocked("Portal 2 was not found. Looked in:\n  " + listing +
                  "\nInstall it in Steam, or re-run with -GameDir \"<folder containing portal2>\".")
