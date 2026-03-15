#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

mkdir -p "$CLAUDE_DIR"

link() {
  local src="$REPO_DIR/$1"
  local dst="$CLAUDE_DIR/$1"

  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "SKIP $dst (exists and is not a symlink)"
    return
  fi

  ln -sf "$src" "$dst"
  echo "LINK $dst -> $src"
}

link CLAUDE.md
link settings.json
link skills
link commands
link statusline-fancy.sh

echo "Done."
