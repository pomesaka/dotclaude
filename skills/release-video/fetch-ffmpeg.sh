#!/bin/sh
# HyperFrames の描き出しに要る ffmpeg と ffprobe（libx264 付き）を、npm のパッケージから取り出す。
# 使い方: fetch-ffmpeg.sh <置き場所のディレクトリ>
# Homebrew の ffmpeg が PATH にあれば要らない。Playwright の ffmpeg は VP8 だけなので使えない。
# ffmpeg-static は install のスクリプトでダウンロードするので使わない。ここで使う2つは、
# postinstall が chmod だけなので、スクリプトを走らせずに tar から取り出せば同じものになる。
set -eu

dest=${1:?fetch-ffmpeg.sh: 置き場所のディレクトリを渡す}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) arch=darwin-arm64 ;;
  Darwin-x86_64) arch=darwin-x64 ;;
  Linux-x86_64) arch=linux-x64 ;;
  *) echo "fetch-ffmpeg.sh: この OS とアーキテクチャの組は試していない: $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

mkdir -p "$dest"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
# 版は 2026-11 に動いたもの。上げるなら、取り出したバイナリで ffmpeg -encoders | grep libx264 を確かめる
npm pack --silent "@ffmpeg-installer/${arch}@4.1.5" "@ffprobe-installer/${arch}@5.0.1" >/dev/null
for t in *.tgz; do tar -xzf "$t" && mv package "${t%.tgz}"; done
cp ffmpeg-installer-*/ffmpeg "$dest/ffmpeg"
cp ffprobe-installer-*/ffprobe "$dest/ffprobe"
chmod +x "$dest/ffmpeg" "$dest/ffprobe"
"$dest/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q libx264 || { echo "fetch-ffmpeg.sh: libx264 が無い" >&2; exit 1; }
echo "$dest/ffmpeg"
echo "$dest/ffprobe"
