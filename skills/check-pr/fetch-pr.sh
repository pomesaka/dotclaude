#!/usr/bin/env bash
# Usage: fetch-pr.sh <PR番号 または owner/repo#番号>
# PR メタデータ・コメントを取得して XML タグ形式で stdout に出力する
set -euo pipefail

ARG="${1:?Usage: fetch-pr.sh <PR番号 または owner/repo#番号>}"

# owner/repo#番号 形式をパース（例: Accel-Hack/ADeT-AI#546）
if [[ "$ARG" == *#* ]]; then
  REPO="${ARG%#*}"
  PR_ARG="$ARG"
else
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  PR_ARG="$ARG"
fi

# PR メタデータ取得
PR=$(gh pr view "$PR_ARG" --json number,title,body,state,author,baseRefName,headRefName,reviewDecision,url)

NUMBER=$(echo "$PR" | jq -r '.number')
TITLE=$(echo "$PR" | jq -r '.title')
STATE=$(echo "$PR" | jq -r '.state')
AUTHOR=$(echo "$PR" | jq -r '.author.login')
BASE=$(echo "$PR" | jq -r '.baseRefName')
BRANCH=$(echo "$PR" | jq -r '.headRefName')
REVIEW=$(echo "$PR" | jq -r '.reviewDecision')
URL=$(echo "$PR" | jq -r '.url')
BODY=$(echo "$PR" | jq -r '.body')

# owner/repo を PR URL から確定（owner/repo#番号 形式でない場合の補完）
if [[ -z "$REPO" ]]; then
  REPO=$(echo "$URL" | sed 's|https://github.com/||' | sed 's|/pull/.*||')
fi

# インラインレビューコメント
INLINE=$(gh api "repos/$REPO/pulls/$NUMBER/comments")

# 一般コメント
GENERAL=$(gh api "repos/$REPO/issues/$NUMBER/comments")

# 出力
cat <<EOF
<pr_meta>
  <number>$NUMBER</number>
  <title>$TITLE</title>
  <state>$STATE</state>
  <author>$AUTHOR</author>
  <base>$BASE</base>
  <branch>$BRANCH</branch>
  <review>$REVIEW</review>
  <url>$URL</url>
</pr_meta>

<pr_body>
$BODY
</pr_body>

<inline_comments>
$(echo "$INLINE" | jq -r '.[] | "<comment user=\"\(.user.login)\" path=\"\(.path)\" line=\"\(.line // "?")\">\n\(.body)\n</comment>"')
</inline_comments>

<general_comments>
$(echo "$GENERAL" | jq -r '.[] | "<comment user=\"\(.user.login)\">\n\(.body)\n</comment>"')
</general_comments>
EOF
