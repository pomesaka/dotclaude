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
# 名前の一覧は任意。未設定・空の場合も、鍵やトークンと、敬称の付いた語の検査は行う。
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
names_file="$repo/.private-names"
remote=${1:-origin}
branch=${2:-main}

names=$(mktemp)
keys=$(mktemp)
log=$(mktemp)
hits=$(mktemp)
trap 'rm -f "$names" "$keys" "$log" "$hits"' EXIT

if [ -f "$names_file" ]; then
  rg -v '^\s*(#|$)' "$names_file" >"$names" || true
fi
if [ ! -s "$names" ]; then
  echo "check-public: 名前の一覧が未設定のため、鍵やトークンのみ検査します" >&2
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

# 調べるのは、コミットメッセージと作者と、差分で足した行だけ。
# WHY 消した行と前後の行を見ない: どちらもすでに公開されている。名前を消すコミットが、消した名前で止まらないようにする
git -C "$repo" log --no-color --format='commit %H%nauthor %an <%ae>%ncommitter %cn <%ce>%n%B' "$range" >"$log"
git -C "$repo" log -p --no-color --format= "$range" | rg '^\+' >>"$log" || true

# WHY いったんファイルに書く: `rg | head` の形だと、head が先に閉じたときに rg が SIGPIPE で落ち、
# pipefail のせいで「見つからなかった」側に分岐する（2026-10-10 に、検出したのに成功で終わることを確認）
found=0
rg -n -i -f "$names" "$log" >"$hits" || true
if [ -s "$hits" ]; then
  cut -c1-200 "$hits" | head -40 >&2 || true
  echo "check-public: 公開しない名前が $(rg -c '' "$hits") 行で見つかりました（40 行まで表示）" >&2
  found=1
fi
rg -n -f "$keys" "$log" >"$hits" || true
if [ -s "$hits" ]; then
  cut -c1-120 "$hits" | head -40 >&2 || true
  echo "check-public: 鍵やトークンの形の文字列が $(rg -c '' "$hits") 行で見つかりました" >&2
  found=1
fi

# 敬称（様、さん）の付いた語。
# WHY 一覧に無い名前も探す: 名前の一覧は、知っている名前しか止められない。
#   一覧に無い相手先の人名に「様」を付けた例が、この検査が無かったときにすり抜けて push された（2026-11-17）。
# 名前でない「〜様」の語（仕様、同様など）と、伏せ字（〇〇さん）は外す。誤検知が出たら、下の除外に足す
rg -o '[\p{Han}\p{Katakana}ー]{1,8}(様|さん)' "$log" | rg -v '(仕|同|多|模|一|異|態|有|皆|客|各|神)様$|^皆さん$|^[〇○]+(様|さん)$' >"$hits" || true
if [ -s "$hits" ]; then
  sort -u "$hits" | head -40 >&2 || true
  echo "check-public: 敬称の付いた語が見つかりました。人名なら消すか「ある〜」に書き換える。名前でなければ、このスクリプトの除外に足す" >&2
  found=1
fi

if [ "$found" -ne 0 ]; then
  exit 1
fi
echo "check-public: $range に問題は見つかりませんでした"
