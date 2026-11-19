#!/usr/bin/env bash
set -Eeuo pipefail

# Generate the static gzip companions expected by docker/nginx/web.conf after a
# Godot Web export. Keep the original filenames: browsers request them while
# Nginx selects the .gz version for clients that support gzip.

BUILD_DIR="${1:-apps/web/public/godot}"

for file in index.js index.pck index.wasm; do
  path="$BUILD_DIR/$file"
  if [[ ! -f "$path" ]]; then
    echo "Missing Godot Web build file: $path" >&2
    exit 1
  fi

  gzip -9 -k -f "$path"
done
