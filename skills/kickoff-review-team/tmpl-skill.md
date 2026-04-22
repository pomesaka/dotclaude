# tmpl-skill.md
# kickoff-review-team が生成する SKILL.md のテンプレート。
# Read ツールで読み込み、プレースホルダーを置換して Write する。
#
# --- プレースホルダー一覧 ---
# {project}              : プロジェクト名（例: adet）
# {reviewers}            : reviewer の説明（例: go-reviewer-adet・design-reviewer-adet）
# {reviewer_table}       : subagent 構成テーブルの行（下記フォーマット参照）
# {reviewer_agent_calls} : 並列 Agent 起動コード（下記フォーマット参照）
# {fixer_agent_name}     : fixer の subagent 名（例: fixer-adet）
#
# --- {reviewer_table} の書き方 ---
# | go-reviewer-adet | Goポリシー・アーキテクチャ |
# | design-reviewer-adet | 凝集度・可読性・設計品質 |
# | fixer-adet | 修正実装・lint実行 |
#
# --- {reviewer_agent_calls} の書き方 ---
# 以下を**同時に**起動する（並列 Agent 呼び出し）:
# - `subagent_type`: `"go-reviewer-adet"`, `prompt`: `"ラウンドN のレビューをしてください。"`
# - `subagent_type`: `"design-reviewer-adet"`, `prompt`: `"ラウンドN のレビューをしてください。"`
#
# --- ここから生成されるファイルの本文 ---
---
name: review-team-{project}
description: {project}のコードレビュー＆修正ループ。{reviewers}が並列レビューし、fixerが修正する。
model: sonnet
---

# review-team-{project}: レビュー＆修正ループ（Coordinator用）

あなたはCoordinator。subagent を調整してレビュー＆修正サイクルを回す。

## ループ構成

| subagent | 担当 |
|---|---|
{reviewer_table}

---

## Step 1: レビューラウンド（最大5ラウンド）

### 1a. 並列レビュー

{reviewer_agent_calls}

全てのレビュアーの結果が返るまで待つ。

### 1b. 結果集約・分類

全レビュアーの結果をまとめ、以下に分類する:

- **非Nit**: ポリシー違反・整合性・凝集度・可読性・設計（「提案」も含む）
- **Nit**: 明示的に「Nit:」と書かれているもの

### 1c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 2（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 1d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了（人間に委ねる） |

### 1d. fixer に修正依頼

Agent ツールで `{fixer_agent_name}` subagent を起動する:
- `subagent_type`: `"{fixer_agent_name}"`
- `prompt`:

```
以下の指摘を全て修正してください。Nitも可能な範囲で一緒に直してください。

## 非Nit指摘
<一覧>

## Nit指摘（任意）
<一覧>
```

fixer が「修正完了」を報告したら Step 1a へ戻る。

---

## Step 2: 完了

```
## レビュー＆修正ループ完了

- ラウンド数: N
- 修正した指摘数: M件
- 残存するNit: （一覧、なければ「なし」）
```

## Gotchas

- **subagent は毎回ゼロから起動**: 前ラウンドの文脈は持ち越さない。これは意図的（ゼロベースレビューのため）
- **並列起動**: Agent ツールを複数同時に呼ぶことでレビュアーが並列実行される
