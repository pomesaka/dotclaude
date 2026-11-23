#!/bin/bash
BASE="https://raw.githubusercontent.com/shanraisshan/claude-code-best-practice/main"

echo "### README.md"
curl -s "$BASE/README.md"

echo ""
echo "### claude-skills.md"
curl -s "$BASE/best-practice/claude-skills.md"

echo ""
echo "### claude-subagents.md"
curl -s "$BASE/best-practice/claude-subagents.md"

echo ""
echo "### claude-memory.md"
curl -s "$BASE/best-practice/claude-memory.md"

# Lauren Tan（poteto）の pstack。Cursor 向けのスキル一式で、設計の考えが詰まったファイルだけを読む
PSTACK="https://raw.githubusercontent.com/cursor/plugins/main/pstack"
echo ""
echo "### pstack の最新のコミット（版を報告に書き、次回の差分の起点にする）"
curl -s "https://api.github.com/repos/cursor/plugins/commits?path=pstack&per_page=1" | jq -r '.[0] | "\(.sha[0:7]) \(.commit.committer.date) \(.commit.message | split("\n")[0])"'
for p in \
  skills/poteto-mode/SKILL.md \
  skills/poteto-mode/worker.md \
  skills/poteto-mode/playbooks/bug-fix.md \
  skills/poteto-mode/playbooks/refactoring.md \
  skills/poteto-mode/playbooks/eval.md \
  skills/correct/SKILL.md \
  skills/reflect/SKILL.md \
  skills/interrogate/SKILL.md \
  skills/blast-radius/SKILL.md \
  skills/create-verification-skill/SKILL.md \
  skills/maintain-verification-skill/SKILL.md \
  skills/show-me-your-work/SKILL.md \
  skills/benchmark-checklist/SKILL.md \
  docs/harness/claude-code.md \
  docs/guide/10-recipes-and-pitfalls.md; do
  echo ""
  echo "### pstack/$p"
  curl -s "$PSTACK/$p"
done
