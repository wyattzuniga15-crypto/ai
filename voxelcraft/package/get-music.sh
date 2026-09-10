#!/bin/sh
# Double-click this once to add Minecraft's music and records (a few hundred megabytes).
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  node get-music.mjs
  echo "Press return to close."
  read -r _
else
  echo "This needs Node.js. Install it from https://nodejs.org and try again."
  read -r _
fi
