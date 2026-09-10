#!/bin/sh
# Double-click this to play. It starts a small server in this folder and opens the game.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node server.mjs
elif command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "  Voxelcraft is running at http://localhost:8080/"
  echo "  Close this window (or press Ctrl+C) to stop it."
  echo ""
  (sleep 1; open http://localhost:8080/ 2>/dev/null || xdg-open http://localhost:8080/ 2>/dev/null) &
  exec python3 -m http.server 8080 --directory game
else
  echo "This needs Node or Python 3 to serve the files. Install either one and try again."
  read -r _
fi
