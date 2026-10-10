#!/usr/bin/env bash
# 公開リポジトリへ push する前に、出してはいけない文字列が入っていないかを調べる。
#
#   scripts/check-public.sh [remote] [branch]    既定は origin main
#
# 調べる対象は、<remote>/<branch> にまだ無いコミットの差分・メッセージ・作者のメールアドレス。
# 見つかれば該当行を出して 1 で終わる。
#
# WHY 先端のファイルでなくコミットの差分を見る: 途中のコミットで足して後のコミットで消した文字列も、push すれば履歴に残る。
# WHY 名前の一覧をリポジトリに置かない: 一覧そのものが、公開したくない名前の並びになる。
#   .private-names（.gitignore 済み）に、1 行に 1 つ、正規表現で書く。# で始まる行と空行は読み飛ばす。
# WHY 一覧が無ければ失敗させる: 新しいマシンで一覧を置き忘れたまま、何も調べずに通るのを防ぐ。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
names_file="$repo/.private-names"
remote=${1:-origin}
branch=${2:-main}

if [ ! -f "$names_file" ]; then
  echo "check-public: $names_file がありません。公開しない名前（案件名、顧客名、会社名、メールアドレス）を 1 行に 1 つ書いてください" >&2
  exit 1
fi

names=$(mktemp)
keys=$(mktemp)
log=$(mktemp)
hits=$(mktemp)
trap 'rm -f "$names" "$keys" "$log" "$hits"' EXIT

rg -v '^\s*(#|$)' "$names_file" >"$names" || true
if [ ! -s "$names" ]; then
  echo "check-public: $names_file に名前が 1 つもありません" >&2
  exit 1
fi

# 鍵やトークンの形。大文字と小文字を区別して探す
cat >"$keys" <<'EOF'
sk-ant-[A-Za-z0-9_-]{10,}
sk-[A-Za-z0-9]{32,}
gh[pousr]_[A-Za-z0-9]{30,}
github_pat_[A-Za-z0-9_]{30,}
AKIA[0-9A-Z]{16}
xox[baprs]-[A-Za-z0-9-]{10,}
AIza[0-9A-Za-z_-]{35}
BEGIN [A-Z ]*PRIVATE KEY
eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.
hooks\.slack\.com/services/[A-Za-z0-9/]{10,}
EOF

# リモートにまだ無いコミットだけを見る。リモートに枝が無ければ（最初の push）、すべてのコミットを見る
if git -C "$repo" rev-parse -q --verify "refs/remotes/$remote/$branch" >/dev/null; then
  range="$remote/$branch..$branch"
else
  range="$branch"
fi

git -C "$repo" log -p --no-color --format='commit %H%nauthor %an <%ae>%ncommitter %cn <%ce>%n%B' "$range" >"$log"

# WHY いったんファイルに書く: `rg | head` の形だと、head が先に閉じたときに rg が SIGPIPE で落ち、
# pipefail のせいで「見つからなかった」側に分岐する（2026-10-10 に、検出したのに成功で終わることを確認）
found=0
rg -n -i -f "$names" "$log" >"$hits" || true
if [ -s "$hits" ]; then
  cut -c1-200 "$hits" | head -40 >&2 || true
  echo "check-public: 公開しない名前が $(rg -c '' "$hits") 行で見つかりました（番号は $range の差分の行。40 行まで表示）" >&2
  found=1
fi
rg -n -f "$keys" "$log" >"$hits" || true
if [ -s "$hits" ]; then
  cut -c1-120 "$hits" | head -40 >&2 || true
  echo "check-public: 鍵やトークンの形の文字列が $(rg -c '' "$hits") 行で見つかりました" >&2
  found=1
fi

if [ "$found" -ne 0 ]; then
  exit 1
fi
echo "check-public: $range に問題は見つかりませんでした"
