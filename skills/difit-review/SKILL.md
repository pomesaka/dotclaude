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

指摘・説明を `--comment` 引数に整理し、portless 経由の名前付き URL で起動する。WHY: ポート被りと、ポート再利用時に origin（`localhost:<port>`）を共有して localStorage コメントが混ざる問題を、レビュー対象ごとの一意な origin で根本回避する。

`--comment` の JSON はシングルクォートで囲むため `sh -c '...'` の中に置けない。`--app-port` の固定ポート方式で portless と difit に同じポートを渡す（2026-06 実機検証済み: `--pr` モード / stdin モードとも portless 経由で動作、`--comment` も argv 直渡しで機能）:

```bash
# 1. 空きポートを取得
python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'
```

**ローカルリビジョンの場合（ファイル経由）:**

```bash
jj diffu -r '<rev>' > ~/.claude/tmp/difit-review.patch
mise exec -- portless <name> --app-port <P> npx difit - --clean --port <P> --host 127.0.0.1 --no-open \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":42},"body":"ここの分岐は null チェックが必要"}' \
  --comment '{"type":"thread","filePath":"src/bar.ts","position":{"side":"new","line":{"start":10,"end":15}},"body":"このループは O(n²) になる"}' \
  < ~/.claude/tmp/difit-review.patch
```

**GitHub PR の場合（`--pr` フラグ）:**

```bash
mise exec -- portless difit-pr<番号> --app-port <P> npx difit --pr https://github.com/owner/repo/pull/123 --clean --port <P> --host 127.0.0.1 --no-open \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":42},"body":"..."}'
```

- Bash の `run_in_background` で起動する（difit の `--background` は使わない。URL が `https://<name>.localhost` で確定するため JSON 出力を読む必要がない）
- `<name>` はレビュー対象ごとに一意にする（例: PR なら `difit-pr563`、ローカルなら `difit-<ワークスペース名>`）
- 起動ログの `difit server started on http://127.0.0.1:<P>` が指定ポートと一致することを確認する（difit の `--port` は preferred 扱いで、占有されていると別ポートに逃げて route が壊れる — `difit --help` 記載の挙動）
- ユーザーには `https://<name>.localhost` を共有する

**フォールバック（portless proxy 未起動時）:** 起動ログに `Proxy is not running` が出たら、従来の `--background` 方式で直接起動し、stdout の JSON（例: `{"port":4966,"url":"http://localhost:4966","pid":...}`）から URL を共有する:

```bash
npx difit --pr https://github.com/owner/repo/pull/123 --clean --background --comment '...'
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
- **`--clean` のみで Files changed が増え続ける**: `--clean` は起動時にクリアするが、同一ポートで再利用された場合は蓄積する。portless の名前付き起動（Step 2）ならレビュー対象ごとに origin が分かれるためこの問題自体が起きない。フォールバックの直接起動時のみ、ポートが変わっていることを確認する
