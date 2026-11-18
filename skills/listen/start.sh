#!/bin/sh
# listen スキルの読み込み時に走る。引数で分ける。
#   mic | web: xlisten を切り離して起動し、聞き始めるまで待って、Monitor に渡すコマンドを出す
#   stop: 動いている xlisten を止める
#   なし: どちらで聞くかを利用者に聞くよう出す
# WHY 失敗しても exit 0: 読み込み時のコマンドが 0 以外で終わると、スキルの呼び出しごと止まり、
# 何が起きたかがモデルに届かない。失敗は「起動に失敗」で始まる行で知らせる
set -u

here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-}
case $mode in
  mic) flags=--no-system ;;
  web) flags= ;;
  stop)
    found=
    for pid_file in "$HOME"/.claude/tmp/xlisten/*/xlisten.pid; do
      [ -f "$pid_file" ] || continue
      found=1
      dir=$(dirname "$pid_file")
      "$here/stop.sh" "$dir" 2>&1
      echo "フォルダ: $dir"
    done
    [ -n "$found" ] || echo "動いている xlisten は無い"
    exit 0 ;;
  "") echo "引数が無い。mic か web かを AskUserQuestion で聞き、$here/start.sh <mic|web> を実行する"; exit 0 ;;
  *) echo "起動に失敗: mic、web、stop のどれかを渡す（渡されたのは「${mode}」）"; exit 0 ;;
esac

# WHY ~/.claude/tmp: 文字起こしは使い終えたら消す。~/xlisten/<時刻> のようにホームから
# 2 階層目のフォルダは、hook の danger-guard が rm -r を止める
base=$HOME/.claude/tmp/xlisten
stamp=$(date +%Y%m%d-%H%M)
out=$base/$stamp-$mode
log=$base/$stamp.log
mkdir -p "$base"

# 前の会議の xlisten が動いていたら、起動しない。止めるかは利用者が決める
for pid_file in "$base"/*/xlisten.pid; do
  [ -f "$pid_file" ] || continue
  old=$(cat "$pid_file")
  if ps -p "$old" -o command= 2>/dev/null | grep -q "xlisten listen"; then
    echo "起動に失敗: 別の xlisten が動いている（PID ${old}、$(dirname "$pid_file")）。止めてよいかを利用者に聞き、$here/stop.sh $(dirname "$pid_file") で止めてから $here/start.sh $mode を実行する"
    exit 0
  fi
done

# shellcheck disable=SC2086 # flags は空か 1 語
nohup xlisten listen --out "$out" $flags > "$log" 2>&1 < /dev/null &
pid=$!

# 起動には whisper、RE-USE、話者分離のモデルを読む数秒がかかる。60 秒で諦める
i=0
until grep -q "take part" "$log" 2>/dev/null; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "起動に失敗: xlisten が起動の途中で終わった。ログ: $log"
    tail -20 "$log"
    exit 0
  fi
  i=$((i + 1))
  if [ "$i" -ge 120 ]; then
    echo "起動に失敗: 60 秒たっても聞き始めない（PID $pid は動いたまま）。ログ: $log"
    exit 0
  fi
  sleep 0.5
done

echo "聞き始めた（${mode}、PID ${pid}）"
echo "フォルダ: $out"
echo "ログ: $log"
echo "Monitor のコマンド（timeout_ms は 1800000）: $here/watch.sh $out 0"
echo "止めるとき: $here/stop.sh $out"
