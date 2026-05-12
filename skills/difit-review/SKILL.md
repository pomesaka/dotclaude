---
name: difit-review
description: 指定された diff をエージェント自身がレビューし、指摘コメントを difit に投入して開く。
when_to_use: 「セルフレビューして」「気になる点をコメントで残して」「自分で diff を読んでから見せて」と言われたとき。PR や特定リビジョンの解説をコメント付きで見せたいとき。
---

# Difit Review

## 概要

エージェントが diff をレビュー・分析し、その結果を `--comment` で difit に注入して起動する。ユーザーは指摘コメントが乗った状態の diff をブラウザで確認できる。

## 手順

### Step 1: 対象 diff の確認

ユーザーが指定した対象（ローカルリビジョン・GitHub PR URL・パッチファイル等）の diff を確認し、必要なら周辺コードも読んで内容を理解する。

PR レビューの場合もコメントは difit 内に留め、GitHub へのコメント投稿は行わない。

### Step 2: difit 起動

指摘・説明を `--comment` 引数に整理して difit を起動する。

**ローカルリビジョンの場合（ファイル経由 + `--background`）:**

```bash
jj diffu -r '<rev>' > ~/.claude/tmp/difit-review.patch
npx difit - --clean --background \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":42},"body":"ここの分岐は null チェックが必要"}' \
  --comment '{"type":"thread","filePath":"src/bar.ts","position":{"side":"new","line":{"start":10,"end":15}},"body":"このループは O(n²) になる"}' \
  < ~/.claude/tmp/difit-review.patch
```

- stdout に出る JSON から URL を取り出しユーザーに共有する（例: `{"port":4966,"url":"http://localhost:4966","pid":...}`）
- パイプ直接渡しは `--background` と相性が悪いため、ファイル経由にする

**GitHub PR の場合（`--pr` フラグ）:**

```bash
npx difit --pr https://github.com/owner/repo/pull/123 --clean --background \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":42},"body":"..."}'
```

## コメント記法

- `type: "thread"` を使う
- 本文はユーザーが使っている言語で書く
- `position.side`: 追加側=`new` / 削除側=`old`
- 範囲指摘は `{"start": N, "end": M}`
- 秘密情報（トークン・API キー・認証情報）をコメントに含めない

## 完了基準

- difit の URL をユーザーに共有
- コメントを付けなかった場合はその旨を明示
- ページの手動確認は不要

## Troubleshooting

- **`jj diffu` が見つからない**: `jj diff --git` で代替（git 形式の unified diff を出力）
- **difit が何も表示しない**: `-` 引数が正しくパイプを受け取れているか確認。`jj diffu -r '@' | cat` で diff が空でないことを確認してから difit に渡す
- **コメントが表示されない**: `--comment` の JSON が壊れている可能性。`echo '{"type":"thread",...}' | jq .` で検証する
- **`--clean` のみで Files changed が増え続ける**: `--clean` は起動時にクリアするが、同一ポートで再利用された場合は蓄積する。ポートが変わっていることを確認する
