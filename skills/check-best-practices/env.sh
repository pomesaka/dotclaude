#!/bin/bash

DOTCLAUDE=~/github.com/pomesaka/dotclaude

echo "### CLAUDE.md"
cat ~/.claude/CLAUDE.md 2>/dev/null

echo ""
echo "### スキル一覧（フロントマター）"
for skill_file in ~/.claude/skills/*/SKILL.md; do
  skill_dir=$(dirname "$skill_file")
  echo ""
  echo "#### $(basename "$skill_dir")"
  awk '/^---/{count++} count==1{print} count==2{exit}' "$skill_file"
done

echo ""
echo "### commands/ 一覧"
ls "$DOTCLAUDE/commands/" 2>/dev/null

echo ""
echo "### docs/ 一覧"
ls "$DOTCLAUDE/docs/" 2>/dev/null
