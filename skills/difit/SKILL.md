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

portless 経由の名前付き URL で起動する。WHY: ポート被りと、ポート再利用時に origin（`localhost:<port>`）を共有して localStorage コメントが混ざる問題を、レビュー対象ごとの一意な origin で根本回避する（2026-06 実機検証: portless が `PORT` 環境変数で払い出した空きポートに difit がバインドし、stdin パイプも透過、`https://<name>.localhost` で応答することを確認済み）。

```bash
jj diffu -r '<rev>' | mise exec -- portless <name> sh -c 'npx difit - --clean --port "$PORT" --host 127.0.0.1 --no-open'
```

- Bash の `run_in_background` で起動する。ユーザーコメント（difit 終了時に stdout に出る）はタスク出力ファイルを Read で読む
- `<name>` はレビュー対象ごとに一意にする（例: `difit-<ワークスペース名>`、PR なら `difit-pr<番号>`）。URL は `https://<name>.localhost` で確定するのでそれをユーザーに案内する
- difit は `PORT` 環境変数を読まないため `sh -c` 内で `--port "$PORT"` に展開して渡す
- `--no-open` を付ける（difit の自動オープンは portless の名前付き URL を知らない）
- `--background` は使わない（URL が名前で確定するため JSON 出力を読む必要がない。`run_in_background` で足りる）
- `<rev>` のデフォルトは `@`（現在の change）。比較したい場合は jj のリビジョン式を使う（例: `@-..@`、`main..@`）
- `--clean` は localStorage のコメント蓄積を毎回リセットする（同一対象を再レビューするときの蓄積対策）
- `-` は difit に標準入力から diff を読むよう指示する

### フォールバック（portless proxy 未起動時）

起動ログに `Proxy is not running` が出たら、`sudo portless proxy start --https` をユーザーに案内するか、従来の直接起動にフォールバックする:

```bash
jj diffu -r '<rev>' | npx difit - --clean
```

## 起動時コメント（オプション）

ユーザーに伝えたい説明や注意点があれば `--comment` で先にコメントを差し込める。

**注意: `--comment` の JSON はシングルクォートで囲むため `sh -c '...'` の中に置けない。** コメントを注入する場合は `--app-port` の固定ポート方式を使い、`sh -c` なしで起動する（2026-06 実機検証済み: `Using port <P> (fixed)` で route が張られ、`--comment` も argv 直渡しで機能）:

```bash
# 1. 空きポートを取得
python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'

# 2. 取得したポート <P> を portless（--app-port）と difit（--port）の両方に渡す
jj diffu -r '@' | mise exec -- portless <name> --app-port <P> npx difit - --clean --port <P> --host 127.0.0.1 --no-open \
  --comment '{"type":"thread","filePath":"src/foobar.ts","position":{"side":"old","line":102},"body":"line 1\nline 2"}' \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":{"start":36,"end":39}},"body":"L36-L39 の範囲コメント"}'
```

- 起動ログの `difit server started on http://127.0.0.1:<P>` が指定ポートと一致することを確認する（difit の `--port` は preferred 扱いで、占有されていると別ポートに逃げて route が壊れる — `difit --help` 記載の挙動）

- `type: "thread"` を使う
- コメント本文はユーザーが使っている言語で書く
- `position.side`: 追加側=`new` / 削除側=`old`
- 複数行にわたる指摘は range（`{"start": N, "end": M}`）で書く
- 秘密情報（トークン・API キー・認証情報）を `--comment` に含めない

## 対応後の仕上げ

コメントがあって対応が完了した場合、`update-pr` スキルを呼び出す（Skill ツール使用）。push と PR の更新がまとめて実行される。コメントがなければスキップ。

## 制約

- jj 管理下のディレクトリで使用する
- ページが正しく開いたかの手動確認は不要

## Gotchas

- **コメントの読み方は、`~/.claude/docs/working-rules.md`の「利用者のレビューのコメントは、書かれた箇所の直しでなく、前提への問いとして読む」にある**: 命名や構造に自信がない段階で呼んでも、こうした問いをもらえる。
- **「モデルは何を生成しているのか」「なぜXには対応していないのか」と問われたら、`~/.claude/docs/domain-design-practices.md`を読む**: 前の問いは「AI Agentの設計原則」、後の問いは「横断モジュールへの入力境界パターン」に、原因と直し方がある。
- **`npx difit`が`npm error Override without name: <key>`で落ちたら、`bunx difit`に替える**: `npx`は作業ディレクトリの`package.json`の`overrides`を検証し、bunが許す説明用のキー（`"_comment_kysely"`など）を弾く。portlessのログに`Using port <P>`が出ていても、この段階で落ちるので、起動に失敗したらログの最後の行を読む。`bunx`でもstdinのパイプ、`--port`、`--host`、`--no-open`はそのまま通る（2026-06に確認）。bunを使わないリポジトリでは`npx`のままでよい。
- **コメントのブロックは、difitが終了した後に遅れて書き出される**: タスクの出力ファイルを`Client disconnected, shutting down server...`の直後に読むと、`📝 Comments from review session:`のブロックがまだ無く、コメントなしに見える。「指摘なし」とするのは、出力の末尾に`[exited with code 0]`があり、`Total comments:`の行が無いときにする。利用者が「コメントを書いた」と言ったら、同じファイルを読み直す。
- **PRの全体を流す前に、ブランチがbaseの先頭から分岐しているかを確かめる**: baseが古いブランチで差分を流すと、baseに先に入ったコミットが巻き戻しの差分として出て、利用者がその差分の指摘に時間を使う。分岐点の出し方は`~/.claude/docs/jj.md`の「差分の基準点を確かめる」にある。baseの先頭より古ければ、rebaseしてから流す。
