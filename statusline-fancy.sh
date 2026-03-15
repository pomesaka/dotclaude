#!/usr/bin/env bash
# statusline-fancy.sh
# Reads JSON from stdin (provided by Claude Code) and outputs a status line.

input=$(cat)

cwd=$(echo "$input" | jq -r '.cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // 100 | floor')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0 | . * 100 | round | . / 100 | tostring')

# Shorten home directory to ~
cwd="${cwd/#$HOME/~}"

# Build gauge (10 chars wide)
filled=$(( remaining / 10 ))
empty=$(( 10 - filled ))
gauge=""
for ((i=0; i<filled; i++)); do gauge+="█"; done
for ((i=0; i<empty; i++));  do gauge+="░"; done

echo "[${model}]  ${gauge} ${remaining}%  \$${cost}  📁 ${cwd}"
