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
