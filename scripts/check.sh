#!/usr/bin/env bash
# dotclaude の検査をまとめて走らせる。push の前と、スクリプトや Mod を直した後に走らせる。
#
#   scripts/check.sh
#
# - シェルスクリプト（*.sh）を shellcheck にかける
# - Python（*.py）を ruff の lint と書式の検査にかける
# - tests/ のある Mod を claude plugin test にかける
#
# 対象は jj が追跡しているファイルだけ（archive/ を除く）。どれかが落ちたら 1 で終わる。
# WHY 1 本にまとめる: 走らせ忘れた検査の指摘（型、shellcheck）を、後から人に言われて直していた
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root" || exit 1

failed=()

tracked() {
  jj file list 2>/dev/null | grep -E "$1" | grep -v '^archive/'
}

section() {
  printf '\n== %s\n' "$1"
}

section "shellcheck"
mapfile -t shell_files < <(tracked '\.sh$')
if [ "${#shell_files[@]}" -gt 0 ]; then
  # shellcheck は手元に入れていないので、bunx で固定の版を使う
  bunx --silent shellcheck@0.11.0 --severity=warning "${shell_files[@]}" || failed+=(shellcheck)
fi

section "ruff"
mapfile -t python_files < <(tracked '\.py$')
if [ "${#python_files[@]}" -gt 0 ]; then
  ruff check --select E,F,W,B,UP,SIM,I,N "${python_files[@]}" || failed+=("ruff check")
  ruff format --check "${python_files[@]}" || failed+=("ruff format")
fi

section "claude plugin test"
for mod in mods/*/; do
  [ -d "${mod}tests" ] || continue
  echo "-- ${mod%/}"
  claude plugin test "${mod%/}" >/tmp/dotclaude-check-$$.log 2>&1 || {
    cat /tmp/dotclaude-check-$$.log
    failed+=("plugin test ${mod%/}")
  }
  tail -1 /tmp/dotclaude-check-$$.log
done
rm -f /tmp/dotclaude-check-$$.log

echo
if [ "${#failed[@]}" -gt 0 ]; then
  printf '落ちた検査: %s\n' "${failed[*]}"
  exit 1
fi
echo "すべて通った"
