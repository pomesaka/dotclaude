#!/bin/sh
# xlisten を止め、止まるまで待つ。last を渡すと、その後に書かれた残りの行を出す。
# 使い方: stop.sh <出力のフォルダ> [last]
set -u

here=$(cd "$(dirname "$0")" && pwd)

dir=${1:?stop.sh: 出力のフォルダを渡す}
last=${2:-}
pid_file=$dir/xlisten.pid

if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file")
  # 名前の一致で止めない。PID ファイルの PID が xlisten listen であることを確かめる
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "PID ${pid} はもう終わっている"
  elif ps -p "$pid" -o command= 2>/dev/null | grep -q "xlisten listen"; then
    kill "$pid"
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
      sleep 0.5
      i=$((i + 1))
    done
    echo "止めた（PID ${pid}）"
  else
    echo "PID $pid は xlisten listen ではない。止めていない" >&2
    exit 1
  fi
else
  echo "xlisten.pid が無い。もう止まっている"
fi

# WHY: Monitor は 60 秒ごとにまとめて渡すので、止めた時点で最後の 1 分ぶんが届いていない
if [ -n "$last" ]; then
  cd "$dir/events" || exit 1
  for f in [0-9]*.jsonl; do
    [ -e "$f" ] || continue
    n=${f%.jsonl}
    [ "$n" -gt "$last" ] || continue
    jq -r -f "$here/line.jq" "$f"
  done
fi
