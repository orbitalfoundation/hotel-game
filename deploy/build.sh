#!/usr/bin/env bash
# Compose the static site into deploy/dist/. The game is plain ES modules —
# "building" is copying the runtime files into the /lita-game + /orbital
# directory shape the importmap and absolute imports expect (the same shape
# server.js serves locally from the workspace). three.js stays on the CDN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # lita-game
WORK="$(cd "$ROOT/.." && pwd)"                     # the workspace (orbital sibling)
DIST="$ROOT/deploy/dist"

rm -rf "$DIST"
mkdir -p "$DIST/lita-game" \
         "$DIST/orbital/orbital-bus/packages" \
         "$DIST/orbital/orbital-spatial" \
         "$DIST/orbital/orbital-volume"

# the game
cp -R "$ROOT/web" "$ROOT/src" "$DIST/lita-game/"
cp "$ROOT/web/index.html" "$DIST/index.html"

# the orbital pieces the importmap references (sources only, no node_modules)
cp -R "$WORK/orbital/orbital-bus/packages/bus"   "$DIST/orbital/orbital-bus/packages/bus"
cp -R "$WORK/orbital/orbital-bus/packages/utils" "$DIST/orbital/orbital-bus/packages/utils"
cp -R "$WORK/orbital/orbital-spatial/src"        "$DIST/orbital/orbital-spatial/src"
cp -R "$WORK/orbital/orbital-volume/volume.js" \
      "$WORK/orbital/orbital-volume/volume_query.js" \
      "$WORK/orbital/orbital-volume/handlers"       "$DIST/orbital/orbital-volume/"
rm -rf "$DIST"/orbital/*/packages/*/test "$DIST"/orbital/*/packages/*/node_modules

echo "✓ built $DIST ($(du -sh "$DIST" | cut -f1))"
