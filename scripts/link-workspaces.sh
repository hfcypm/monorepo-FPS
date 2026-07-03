#!/usr/bin/env bash
# Ensure workspace packages are symlinked into node_modules

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for dir in "$ROOT"/packages/*/; do
  pkg_json="$dir/package.json"
  [ -f "$pkg_json" ] || continue

  # Extract "name" field from package.json using grep (no dependency on bun/node)
  name=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$pkg_json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

  if [[ "$name" == @*/* ]]; then
    scope="${name%/*}"
    mkdir -p "$ROOT/node_modules/$scope"
    ln -sfn "$(realpath "$dir")" "$ROOT/node_modules/$name"
  fi
done
