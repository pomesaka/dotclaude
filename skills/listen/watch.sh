#!/bin/sh
# Monitor の中身。60 秒ごとに、前に出した後に書かれた行を 1 行ずつ短くして出す。
# 使い方: watch.sh <出力のフォルダ> [last]
# last は、前に読んだ最後のファイル名（.jsonl を除く）。Monitor が 30 分で切れたら、
# 最後に届いた行の後のファイル名を渡して立て直す。0 なら最初から読む
set -u

here=$(cd "$(dirname "$0")" && pwd)

dir=${1:?watch.sh: 出力のフォルダを渡す}
last=${2:-0}
cd "$dir/events" || exit 1

# WHY sleep 60: 1 分ぶんの行を 1 回の知らせにまとめる。pomesaka はリアルタイム性を求めていない
while :; do
  sleep 60
  for f in [0-9]*.jsonl; do
    [ -e "$f" ] || continue
    n=${f%.jsonl}
    [ "$n" -gt "$last" ] || continue
    [ -s "$f" ] || break
    jq -r -f "$here/line.jq" "$f"
    last=$n
  done
  echo "last=$last"
done
