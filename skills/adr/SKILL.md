---
name: adr
description: Architecture Decision Record（ADR）を作成・記録する。「ADR書こう」「設計決定を記録しよう」「このアーキテクチャの判断を残したい」「なぜこのアプローチにしたか記録して」と言われたときに使用する。
argument-hint: "[テーマ or ADRのタイトル]"
allowed-tools: Read, Write, Glob, Grep, Bash(ls *)
---

# ADR 作成

`$ARGUMENTS` の内容（または会話のコンテキスト）をもとに ADR を作成する。

## Step 1: ADRディレクトリの特定

プロジェクト内の ADR 格納先を探す:

```bash
ls docs/adr/        # 最優先
ls doc/adr/
ls adr/
ls docs/decisions/
```

ディレクトリが見つからなければユーザーに確認する。

## Step 2: 次の番号を決定

```bash
ls docs/adr/ | sort | tail -5
```

既存ファイルの最大連番 + 1 を次の番号とする（4桁ゼロ埋め: `0001`, `0002`, ...）。

## Step 3: コンテキストを収集

会話の内容から以下を把握する。不足していれば `AskUserQuestion` で補完する:

- **何を決定したか** — 採用したアプローチ・技術・パターン
- **何を検討したか** — 却下した代替案とその理由
- **なぜそれを選んだか** — 現在のプロジェクト特性との適合理由
- **どんな制約を受け入れたか** — トレードオフ
- **どんな条件で再評価するか** — 将来の変更トリガー

WHY が書けないなら ADR を書くのが早すぎるサイン。ユーザーに判断の背景を聞く。

## Step 4: ファイル名の決定

`docs/adr/NNNN-<kebab-case-title>.md`

タイトルは日本語でも英語でも可。ファイル名は kebab-case のみ（日本語不可）。

例:
- `docs/adr/0003-use-document-fetch-for-rdb.md`
- `docs/adr/0003-use-tanstack-query-over-swr.md`

## Step 5: ADR を作成

@~/.claude/skills/adr/format.md のテンプレートに従って書く。

**重要**: テンプレートは形式の参考。機械的に穴埋めしないこと。
- Context は「なぜ今この決定が必要だったか」の背景を語る
- Decision は短く断言する（理由は Context に委ねる）
- Consequences の「再評価の条件」は具体的・計測可能な条件にする

---

## Gotchas

- **Consequencesが空**: 制約を受け入れていないなら決定が浅い可能性がある。ユーザーに「このアプローチのデメリットは？」と聞く
- **再評価条件が曖昧**: 「パフォーマンスが問題になったら」は計測できない。「レスポンスタイムが 500ms を超えたら」のように具体化する
- **Decisionが長い**: Decision セクションは 2〜3 文に収める。長くなるなら Context に戻す
- **代替案がない**: 代替案なしで Decision を書くと「なぜこれか」が伝わらない。1つ以上の却下案を Context に含める
- **Statusを書き忘れる**: 必ず `Proposed` か `Accepted` を書く（承認フローがないプロジェクトなら最初から `Accepted` でよい）
