#!/usr/bin/env bash
# install.sh - put the pack where Iris will find it.
#
# Iris loads shaderpacks from plain folders, so by default this symlinks the
# working tree into .minecraft/shaderpacks/Custom. Edit a file here, hit the
# reload key in-game (default R on the shader selection screen, or F3+R), done.
# No rezipping.
#
# Usage:
#   ./install.sh                  # symlink into ~/.minecraft/shaderpacks
#   ./install.sh --copy           # copy instead of symlink
#   ./install.sh /path/to/.minecraft
#   ./install.sh --copy /path/to/instance/.minecraft

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/Custom"

MODE="link"
MC_DIR=""
for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --link) MODE="link" ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) MC_DIR="$arg" ;;
  esac
done

if [[ -z "$MC_DIR" ]]; then
  for cand in "$HOME/.minecraft" \
              "$HOME/Library/Application Support/minecraft" \
              "$APPDATA/.minecraft"; do
    if [[ -d "$cand" ]]; then MC_DIR="$cand"; break; fi
  done
fi

if [[ -z "$MC_DIR" || ! -d "$MC_DIR" ]]; then
  echo "Could not find a .minecraft directory." >&2
  echo "Pass it explicitly:  ./install.sh /path/to/.minecraft" >&2
  echo "(For MultiMC/Prism, that's the instance's .minecraft folder.)" >&2
  exit 1
fi

DEST_DIR="$MC_DIR/shaderpacks"
DEST="$DEST_DIR/Custom"
mkdir -p "$DEST_DIR"

if [[ -e "$DEST" || -L "$DEST" ]]; then
  echo ">> $DEST already exists; replacing it."
  rm -rf "$DEST"
fi

if [[ "$MODE" == "copy" ]]; then
  cp -R "$SRC" "$DEST"
  echo ">> copied  $SRC -> $DEST"
  echo "   (re-run this after every edit, or use the default symlink mode instead)"
else
  ln -s "$SRC" "$DEST"
  echo ">> linked  $DEST -> $SRC"
  echo "   Edits here are live; just reload the shader in-game."
fi

echo
echo "Now: Options -> Video Settings -> Shader Packs -> Custom"
echo
echo "Check your mod versions first:"
ls -1 "$MC_DIR/mods/" 2>/dev/null | grep -iE 'iris|sodium' || \
  echo "  (no iris/sodium jars found in $MC_DIR/mods/)"
echo
echo "Iris must be 1.10.x and Sodium must be 0.8.x but NOT 0.8.13"
echo "(Sodium 0.8.13 hard-breaks Iris <= 1.10.7 and the game won't start)."
