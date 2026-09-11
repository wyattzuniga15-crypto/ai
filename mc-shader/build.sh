#!/usr/bin/env bash
# build.sh - package the pack as dist/Custom.zip for dropping straight into
# .minecraft/shaderpacks/.
#
# Iris loads both folders and zips. A zip is the right form for just playing;
# a folder is the right form for tuning, because it hot-reloads in game. Use
# install.sh for the folder route.
#
# shaders/ must sit at the ZIP ROOT, which is how every distributed pack is
# laid out and what Iris expects. Zipping the containing folder instead would
# bury shaders/ one level too deep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$SCRIPT_DIR/Custom"
DIST="$SCRIPT_DIR/dist"
OUT="$DIST/Custom.zip"

if [[ ! -d "$PACK/shaders" ]]; then
  echo "FATAL: no shaders/ directory at $PACK/shaders" >&2
  exit 2
fi

# Never ship a pack that does not compile.
if [[ "${SKIP_CHECK:-0}" != "1" ]]; then
  echo ">> validating..."
  if ! "$SCRIPT_DIR/check.sh" "$PACK" >/dev/null; then
    echo "FATAL: check.sh failed - refusing to build a broken pack." >&2
    echo "       Run ./check.sh to see the errors, or SKIP_CHECK=1 to override." >&2
    exit 1
  fi
fi

command -v zip >/dev/null 2>&1 || { echo "FATAL: 'zip' is not installed." >&2; exit 2; }

rm -rf "$DIST"
mkdir -p "$DIST"
( cd "$PACK" && zip -rq "$OUT" shaders -x '*.DS_Store' -x '__MACOSX/*' )

echo ">> built $OUT"
unzip -l "$OUT" | tail -1 | sed 's/^/   /'
echo
echo "Drop it in .minecraft/shaderpacks/ as-is - do not unzip."
echo "To tune shaders live instead, use ./install.sh (folder, hot-reloadable)."
