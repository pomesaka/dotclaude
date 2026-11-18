#!/bin/sh
# PR の状態を、報告に貼れる決まった形で出す。URL、ブランチ、ベース、状態、CI の結果。
# 使い方: pr-summary.sh <PR 番号かブランチ名> [-R owner/repo]
# 「何を変えたか」は書かない。それはモデルが会話から書く
set -u

target=${1:?pr-summary.sh: PR 番号かブランチ名を渡す}
shift
gh pr view "$target" "$@" --json url,number,title,headRefName,baseRefName,state,isDraft,statusCheckRollup --jq '
  "PR #\(.number)「\(.title)」: \(.url)",
  "ブランチ: \(.headRefName) → \(.baseRefName)（\(.state | ascii_downcase)\(if .isDraft then "、draft" else "" end)）",
  ( if (.statusCheckRollup | length) == 0 then "CI: チェック無し"
    else "CI:", (.statusCheckRollup[] | "- \(.name // .context): \((.conclusion // .state // .status) | ascii_downcase)")
    end )
'
