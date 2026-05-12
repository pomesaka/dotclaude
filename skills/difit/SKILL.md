---
name: difit
description: 実装した変更を difit のローカル diff ビューアでユーザーにレビューしてもらう。
when_to_use: コード変更後にユーザーへレビューを依頼したいとき。エージェントが「レビューします」「変更を確認させてください」と言って差分を見せたい場面で発火する。
---

# Difit

## 概要

jj の差分を unified diff としてパイプし、difit（GitHub 風ローカル diff ビューア）でユーザーにレビューしてもらう。
ユーザーがレビューコメントを残した場合は difit 終了時に stdout に出力されるので、それを読んで対応を続ける。
コメントなしで閉じられたら「指摘なし」として扱う。

## 起動コマンド

```bash
jj diffu -r '<rev>' | npx difit - --clean
```

- `<rev>` のデフォルトは `@`（現在の change）。比較したい場合は jj のリビジョン式を使う（例: `@-..@`、`main..@`）
- `--clean` は localStorage のコメント蓄積を毎回リセットする（パイプ運用での Files changed 膨張対策）
- `-` は difit に標準入力から diff を読むよう指示する

## 起動時コメント（オプション）

ユーザーに伝えたい説明や注意点があれば `--comment` で先にコメントを差し込める。

```bash
jj diffu -r '@' | npx difit - --clean \
  --comment '{"type":"thread","filePath":"src/foobar.ts","position":{"side":"old","line":102},"body":"line 1\nline 2"}' \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":{"start":36,"end":39}},"body":"L36-L39 の範囲コメント"}'
```

- `type: "thread"` を使う
- コメント本文はユーザーが使っている言語で書く
- `position.side`: 追加側=`new` / 削除側=`old`
- 複数行にわたる指摘は range（`{"start": N, "end": M}`）で書く
- 秘密情報（トークン・API キー・認証情報）を `--comment` に含めない

## 制約

- jj 管理下のディレクトリで使用する
- ページが正しく開いたかの手動確認は不要
