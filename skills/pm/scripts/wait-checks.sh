#!/usr/bin/env bash
# Waits until every check of a PR has finished, then prints them.
# Usage: wait-checks.sh <owner/repo> <pr-number>
# Exits 0 when all passed or were skipped, 1 otherwise.
set -u
repo="$1"
pr="$2"
# WHY sleep first: right after push, gh pr checks prints nothing until the runs are queued.
sleep 30
while true; do
  out="$(gh pr checks "$pr" --repo "$repo" 2>&1)"
  if [ -z "$out" ] || printf '%s\n' "$out" | rg -q '\t(pending|queued|in_progress)\t'; then
    sleep 30
    continue
  fi
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | rg -q '\t(fail|cancel)'; then
    exit 1
  fi
  exit 0
done
