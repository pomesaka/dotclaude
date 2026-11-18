#!/usr/bin/env bash
# dotclaude の検査をまとめて走らせる。push の前と、スクリプトや Mod を直した後に走らせる。
#
#   scripts/check.sh
#
# - シェルスクリプト（*.sh）を shellcheck にかけ、macOS の bash 3.2 に無い書き方が無いかを見る
# - スキルと scripts/ の TypeScript を型検査し、bun test を走らせる。Python のファイルが無いかを見る
# - tests/ のある Mod を claude plugin test にかける
# スクリプトの書き方の決まりは docs/agent-environment.md の「スクリプトの書き方」にある
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
# WHY mapfile を使わない: macOS の /bin/bash は 3.2 で mapfile が無く、検査が走らないまま先へ進んでいた
shell_files=()
while IFS= read -r file; do shell_files+=("$file"); done < <(tracked '\.sh$')
if [ "${#shell_files[@]}" -gt 0 ]; then
  # 手元に入れていないので、mise で固定の版を使う。
  # WHY NOT bunx: npm の shellcheck は別の版の付け方の包みで、0.11.0 の指定が見つからずに落ちていた
  mise exec shellcheck@0.11.0 -- shellcheck --severity=warning "${shell_files[@]}" || failed+=(shellcheck)
  # WHY 自分で探す: shellcheck は bash の版の違いを見ない。macOS の /bin/bash は 3.2 で、
  #   mapfile などが command not found になっても、set -e が無いと検査を飛ばしたまま先へ進む
  if rg -n '^\s*(mapfile|readarray|declare -A)\b|\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)\}' "${shell_files[@]}"; then
    echo "bash 3.2 に無い書き方があります（mapfile、readarray、連想配列、大文字小文字の変換）"
    failed+=("bash 3.2")
  fi
fi

section "TypeScript のスクリプト"
# WHY TypeScript に揃える: Mod と型や関数を共有でき、テストの書き方も Mod と同じになる（2026-11-18 に pomesaka が決めた）
python_files=()
while IFS= read -r file; do python_files+=("$file"); done < <(tracked '\.py$')
if [ "${#python_files[@]}" -gt 0 ]; then
  printf 'Python のファイルがあります。スクリプトは TypeScript で書く: %s\n' "${python_files[*]}"
  failed+=(python)
fi
bun install --frozen-lockfile --silent || failed+=("bun install")
bunx tsc -p tsconfig.json || failed+=(tsc)
bun test skills scripts || failed+=("bun test")

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
