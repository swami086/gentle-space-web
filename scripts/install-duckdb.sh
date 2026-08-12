#!/usr/bin/env bash
# Fetches the official DuckDB CLI into ./.bin so the snapshot exporter needs no
# npm dependency. Idempotent.
set -euo pipefail

VERSION="${DUCKDB_VERSION:-v1.5.2}"
DEST="${DEST:-./.bin}"

case "$(uname -s)-$(uname -m)" in
  Darwin-*)      ASSET="duckdb_cli-osx-universal.zip" ;;
  Linux-x86_64)  ASSET="duckdb_cli-linux-amd64.zip" ;;
  Linux-aarch64) ASSET="duckdb_cli-linux-arm64.zip" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
if [ -x "$DEST/duckdb" ]; then
  echo "duckdb already present: $("$DEST/duckdb" --version)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/duckdb.zip" \
  "https://github.com/duckdb/duckdb/releases/download/${VERSION}/${ASSET}"
unzip -q -o "$TMP/duckdb.zip" -d "$DEST"
chmod +x "$DEST/duckdb"
echo "installed: $("$DEST/duckdb" --version)"
