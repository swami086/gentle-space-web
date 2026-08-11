#!/usr/bin/env bash
# Copies every skill under docs/superpowers/hermes-skills/<category>/<name>/SKILL.md into
# ~/.hermes/skills/<name>/SKILL.md (flat — matches the existing ads-agent-campaign-strategy
# convention), overwriting existing files. Idempotent — safe to re-run after editing a skill.
# Works unmodified once Hermes moves to the GCP VM (~/.hermes is a fixed path regardless of host).
# See docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="$REPO_ROOT/docs/superpowers/hermes-skills"
DEST_ROOT="${HERMES_SKILLS_DIR:-$HOME/.hermes/skills}"

if [ ! -d "$SRC_ROOT" ]; then
  echo "sync-hermes-skills: no source dir at $SRC_ROOT" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"
count=0
for category_dir in "$SRC_ROOT"/*/; do
  [ -d "$category_dir" ] || continue
  category="$(basename "$category_dir")"
  for skill_dir in "$category_dir"*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    dest="$DEST_ROOT/$name"
    mkdir -p "$dest"
    cp -f "${skill_dir}SKILL.md" "$dest/SKILL.md"
    echo "synced $category/$name -> $dest/SKILL.md"
    count=$((count + 1))
  done
done

echo "sync-hermes-skills: $count skill(s) synced into $DEST_ROOT"
echo "Note: restart 'hermes gateway' (docker compose restart gateway) to pick up changes — Hermes caches its skill index per-session."
