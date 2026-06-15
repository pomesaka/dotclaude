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

コメントがあって対応が完了した場合、`update-pr` スキルを呼び出す（Skill ツール使用）。push・PR 更新・`re`（振り返り）がまとめて実行される。コメントがなければスキップ。

## 制約

- jj 管理下のディレクトリで使用する
- ページが正しく開いたかの手動確認は不要

## Gotchas

- **コードレビューだけでなく設計の不備を露出させる**: ユーザーが UI 上でコメントを残す過程で「なぜこの命名か」「なぜこの分割か」という設計判断への疑問が出やすい。実装完了後だけでなく、ドメイン用語や構造に自信がない段階でも積極的に呼ぶと有効。
- **「衝突回避できたか」ではなく「概念ownershipが正しいか」をユーザーが補正する**: 自動レビュアーやサブエージェントは「型衝突した → 名前変えて回避」を是とする。ユーザーは「そもそも共有概念か feature 固有か」というセマンティック ownership を指摘してくる。レビュアーが OK と言った命名・配置でも、ユーザーがコメントしたら「症状回避」ではなく「概念の所属」から考え直すこと。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **ワークスペース構成への質問は大きな設計変更に繋がる**: 例：「この glob は本当に必要か？」という一行のコメントが「実は apps をワークスペースから外すべき」という全体設計の見直しに繋がることがある。短いコメントが設計判断の根底を揺さぶる可能性があるので、前提から再検討する値打ちがある。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->
- **review コメントが構造改善を提案してきたら別 issue に切り出す**: 「この package フラットすぎない？」「ここ分けるべきでは？」のような restructure 提案を同 PR で対応すると、本来の PR スコープ（機能実装）が膨らんで diff が読めなくなる。対応: 提案内容を新規 issue に書き出して open にし、現 PR のレビュー対応では「scope 外なので別 issue 033 化した」と明示する。PR を focused に保ち、restructure は専用 PR で扱う。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **自動レビュー全通過後も「LLM は何を生成しているか」を問う**: policy/quality reviewer はコードの整合性・型安全性・規約遵守をチェックするが、「LLM の実際の contribution が null になっていないか」は問わない。factory で入力を前処理しすぎ + responseRules で「追加禁止」を課すと、LLM は入力をそのまま返すだけの pass-through になる（=AI 不要）。コードが美しく実装されていても設計として破綻しうる。difit でユーザーがこの観点を即座に発見した事例あり（issue 028: テンプレート変数置換 → LLM ノータッチ設計）。対処: 設計段階で「LLM はこの入力から何を生成するか？」を明示できるかチェックする。`docs/design.md`「テンプレート+変数パターンの落とし穴」参照。別パターン（ADeT-AI #603: ファイル読み込み I/O を agent に含める → ファイル内容を連結するだけで LLM 生成ゼロ）も同根。決定的 I/O を agent に押し込むことも同じ罠。
  <!-- importance: high | mentions: 2 | first-seen: 2026-05 -->
- **「なぜ X がないのか」という非存在への問いは aggregator の非対称入力を露出させる**: difit レビューで「screen→http はなんでないの？」「なぜ source Y は対応していない？」という問いが出たとき、それは aggregator が各ソースを別形式で受け取っている設計臭のシグナル。修正は aggregator 側に分岐を追加することではなく、各ソースが共通型（TargetDescriptor / RelationBinding）に変換して渡す境界正規化。この問いが出たら `~/.claude/docs/domain-design-practices.md`「横断モジュールへの入力境界パターン」を参照する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **「ゼロベースで設計しなおしたら？」という問いが段階的改善では見えない設計歪みを露出する**: 段階的リファクタ（型追加・名前変更・wrapper 化）ではアーキテクチャの歪みが隠れやすい。difit で「インターフェース多すぎ・ゼロベースで」というユーザーコメントが来たとき、それは「整理」ではなく「型の存在自体を問い直す」シグナル。対処: 既存の型やパターンをいったん忘れて「この層の責務は何か？それを最も単純に表現すると？」から考え直す。既存実装の影響で複雑化した wrapper・factory・中間型は大抵この問いで消える。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`npx difit` が `npm error Override without name: <key>` で落ちたら `bunx difit` に切り替える**: `npx` は CWD の `package.json` の `overrides` を読んで検証する。bun 系プロジェクトは overrides に説明用コメントキー（例: `"_comment_kysely": "..."`）を入れることがあり、bun はこれを許容するが npm は「名前のない override」として弾く（`npm error Override without name: _comment_kysely`）。これは**ポート衝突ではない** — portless のログで `Using port <P>` が出ていてもこのエラーで `npx` の段階で死ぬので、起動失敗時は最終行のエラーを確認すること。対処: 起動コマンドの `npx difit` を `bunx difit` に置き換える（bun は overrides コメントキーを許容し、stdin パイプ・`--port`/`--host`/`--no-open` もそのまま通る・2026-06 noah で確認）。bun 非採用リポジトリでは `npx` のままでよい。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
