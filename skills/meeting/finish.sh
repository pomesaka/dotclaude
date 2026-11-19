#!/usr/bin/env bash
# 会議の後の仕上げで、議事録とボードが外に出せる形になっているかを確かめる。直さずに、引っかかった所を出すだけ。
#
#   finish.sh <議事録.md> <ボード.board.json>
#
# 引っかかる所が無ければ「仕上がっている」と出して 0 で終わる。あれば、その行を出して 1 で終わる。
# 議題を消すか、どう言い換えるか、推したことをどう確かめるかは判断が要るので、ここではしない（SKILL.md の「5. 仕上げ」）。
# WHY スクリプトにする: 注記の消し忘れや相対の日付を目で探すと、毎回どこかを見落として、pomesaka に言われてから直していた
set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "使い方: finish.sh <議事録.md> <ボード.board.json>" >&2
  exit 2
fi
minutes=$1
board=$2
xwb=${XWB:-$HOME/github.com/pomesaka/xwhiteboard/bin/xwb}

for f in "$minutes" "$board"; do
  if [ ! -f "$f" ]; then
    echo "ファイルが無い: $f" >&2
    exit 2
  fi
done

problems=0
report() {
  printf '\n== %s\n' "$1"
  problems=$((problems + 1))
}

# 作り方の注記。読む人には要らず、外に出せない
notes='推測|聞き取れず|聞き取り）|と確認）|未確認|文字起こしでは|Claude の(提案|意見)'
if hits=$(rg -n "$notes" "$minutes"); then
  report "議事録に作り方の注記がある。推したことは pomesaka に確かめてから本文を直す"
  echo "$hits"
fi

# 冒頭の表の、手元で確かめるための行
if hits=$(rg -n '^\| (記録|話者) \|' "$minutes"); then
  report "議事録の冒頭の表に「記録」「話者」の行がある。消す"
  echo "$hits"
fi

# 相対の日付。議事録は後で読まれる
relative='今日|明日|昨日|明後日|あさって|来週|先週|今週|再来週'
if hits=$(rg -n "$relative" "$minutes"); then
  report "議事録に相対の日付がある。日付にする"
  echo "$hits"
fi

# japanese-writing.md で言い換える語のうち、議事録に紛れやすいもの
words='温度感|肌感|腹落ち|解像度'
if hits=$(rg -n "$words" "$minutes"); then
  report "議事録に言い換える語がある"
  echo "$hits"
fi

# ボードの崩れと書き方
if ! check=$("$xwb" check "$board" --style); then
  report "xwb check が動かなかった"
  echo "$check"
elif [ "$(printf '%s' "$check" | jq 'length')" -gt 0 ]; then
  report "ボードに xwb check --style の指摘がある"
  printf '%s' "$check" | jq -r '.[] | "\(.kind): \(.message)"'
fi

# ボードの「（聞き取り）」と相対の日付。ボードは次の回も使い続ける
if board_hits=$(jq -r '.elements[] | [.id, (.title // ""), (.text // ""), (.question // ""), (.answer // "")] | join(" ")' "$board" | rg "聞き取り|推測|$relative"); then
  report "ボードに聞き取りの印か相対の日付がある"
  echo "$board_hits"
fi

# 宿題の件数。ボードと議事録で同じ宿題を書いているはず
board_todo=$("$xwb" summary "$board" | jq '.todo | length')
minutes_todo=$(awk '/^## 宿題/{on=1; next} /^## /{on=0} on && /^\| *[0-9]+ *\|/' "$minutes" | wc -l | tr -d ' ')
if [ "$board_todo" != "$minutes_todo" ]; then
  report "宿題の数がボード（${board_todo} 件）と議事録（${minutes_todo} 件）で違う。片方に漏れがないかを見る"
fi

if [ "$problems" -gt 0 ]; then
  printf '\n%s 種類の引っかかりがある\n' "$problems"
  exit 1
fi
echo "仕上がっている"
