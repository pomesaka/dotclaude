#!/usr/bin/env bash
# Usage: checkout.sh <branch>
# jj でブランチをフェッチしてローカルに展開する
set -euo pipefail

BRANCH="${1:?Usage: checkout.sh <branch>}"

jj git fetch
jj bookmark track "$BRANCH" --remote=origin 2>/dev/null || true
jj new "$BRANCH"
