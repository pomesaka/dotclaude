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
