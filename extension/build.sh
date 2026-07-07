#!/usr/bin/env bash
set -euo pipefail
API_BASE="${API_BASE:-https://sparkle-unlock-guard.lovable.app}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
DIST="$ROOT/dist"
OUT="$ROOT/../public/AI-Infinity-Hardened.zip"

rm -rf "$DIST"
mkdir -p "$DIST"
cp -r "$SRC/." "$DIST/"

# Substitute API base
sed -i "s|__API_BASE__|$API_BASE|g" "$DIST/background.js"

rm -f "$OUT"
cd "$DIST"
nix run nixpkgs#zip -- -qr "$OUT" .
echo "Built: $OUT"
ls -la "$OUT"
