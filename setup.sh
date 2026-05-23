#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd -P)"
TARGET_HOME="${DOTCLAUDE_HOME:-$HOME}"
CLAUDE_DIR="$TARGET_HOME/.claude"
CODEX_DIR="$TARGET_HOME/.codex"
SKILLS_DIR="$TARGET_HOME/.agents/skills"

# DOTCLAUDE_HOME isolates setup verification from the real user configuration.
mkdir -p "$CLAUDE_DIR" "$CODEX_DIR/tmp" "$SKILLS_DIR"

link() {
  local src="$1" dst="$2"
  if [[ ! -e "$src" ]]; then
    echo "SKIP $src (source missing)"
    return
  fi
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "SKIP $dst (existing user file or directory)"
    return
  fi
  # -n prevents a directory symlink from receiving another link inside its target.
  ln -sfn "$src" "$dst"
  echo "LINK $dst -> $src"
}

for name in CLAUDE.md settings.json skills commands agents rules docs; do
  link "$REPO_DIR/$name" "$CLAUDE_DIR/$name"
done
link "$REPO_DIR/AGENTS.md" "$CODEX_DIR/AGENTS.md"
link "$REPO_DIR/agents" "$CODEX_DIR/agents"
link "$REPO_DIR/docs" "$CODEX_DIR/docs"

for skill_dir in "$REPO_DIR"/skills/*; do
  [[ -f "$skill_dir/SKILL.md" ]] || continue
  link "$skill_dir" "$SKILLS_DIR/$(basename "$skill_dir")"
done

# Remove only this repository's obsolete links; preserve other skills and .system.
for skill_link in "$SKILLS_DIR"/*; do
  [[ -L "$skill_link" ]] || continue
  target="$(readlink "$skill_link")"
  case "$target" in
    "$REPO_DIR"/skills/*)
      if [[ ! -f "$target/SKILL.md" ]]; then
        rm "$skill_link"
        echo "REMOVE $skill_link (managed skill no longer exists)"
      fi
      ;;
  esac
done
for stale in "$CLAUDE_DIR/statusline-fancy.sh" "$CODEX_DIR/statusline-fancy.sh"; do
  if [[ -L "$stale" && "$(readlink "$stale")" == "$REPO_DIR/statusline-fancy.sh" && ! -e "$stale" ]]; then
    rm "$stale"
    echo "REMOVE $stale (managed source no longer exists)"
  fi
done
echo "Done."
