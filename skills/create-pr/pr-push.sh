#!/bin/sh
# @ を push し、PR を作るか本文を直す。create-pr と update-pr から呼ぶ。
# 使い方: pr-push.sh <ブランチ名> <タイトル> <本文のファイル> [ベースのブランチ（既定 main）]
#
# - ブランチが origin に無ければ jj git push --named <ブランチ>=@、あれば移して push する
# - そのブランチの PR が無ければ gh pr create、あれば gh pr edit
# - 最後に pr-summary.sh で PR の状態を出す
# 本文とタイトルを書くのはモデル。このスクリプトは、どちらの手順を踏むかを決めて実行するだけ
set -eu

here=$(cd "$(dirname "$0")" && pwd)
branch=${1:?pr-push.sh: ブランチ名を渡す}
title=${2:?pr-push.sh: タイトルを渡す}
body=${3:?pr-push.sh: 本文のファイルを渡す}
base=${4:-main}

case $branch in
  release/*) echo "pr-push.sh: release/ は trunk 用の名前。feat/、fix/、docs/、chore/、hotfix/ から選ぶ" >&2; exit 2 ;;
esac
# WHY 先に確かめる: --body-file はファイルが無いと gh がエラーにするが、空のファイルは空の本文で通る
if [ ! -s "$body" ]; then
  echo "pr-push.sh: 本文のファイルが無いか空: $body" >&2
  exit 2
fi
if [ -z "$(jj log -r @ --no-graph -T description)" ]; then
  echo "pr-push.sh: @ に説明が無い。jj desc -m で書いてから呼ぶ" >&2
  exit 2
fi

jj git fetch

# push されるファイルを見せる。PR に属さないファイルが混ざっていないかは、呼んだ側が見る
if jj log -r "$branch@origin" --no-graph -T 'commit_id' >/dev/null 2>&1; then
  echo "== $branch@origin からの差分"
  jj diff --from "$branch@origin" --to @ --stat
  if [ -z "$(jj diff --from "$branch@origin" --to @ --summary)" ]; then
    echo "pr-push.sh: origin と中身が同じなので push しない（CI を走り直させないため）"
  else
    jj bookmark set "$branch" -r @ --allow-backwards
    jj git push --bookmark "$branch"
  fi
else
  echo "== $base@origin からの差分"
  jj diff --from "$base@origin" --to @ --stat
  jj git push --named "$branch=@"
fi

# PR の有無で、作るか直すかを分ける
number=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -n "$number" ]; then
  gh pr edit "$number" --title "$title" --body-file "$body" >/dev/null
  # 本文が空で上書きされていないかを確かめる
  if [ -z "$(gh pr view "$number" --json body --jq .body)" ]; then
    echo "pr-push.sh: PR #$number の本文が空になった。$body を確かめて gh pr edit し直す" >&2
    exit 1
  fi
else
  gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body" >/dev/null
fi

"$here/pr-summary.sh" "$branch"
