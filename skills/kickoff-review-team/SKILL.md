---
name: kickoff-review-team
description: プロジェクト固有のレビューチームスキルを生成する。
when_to_use: 「レビューチームを作って」「このプロジェクト用のレビュースキルを作りたい」と言われたとき。既に review-team-xxx スキルがある場合は不要。
allowed-tools: Read, Grep, Glob, Bash(jj git remote list), Bash(ls *), Write
model: sonnet
---

# kickoff-review-team: プロジェクト固有レビュースキルの生成

あなたの目的は、現在のリポジトリを分析し、以下を生成することです:
- `~/.claude/skills/review-team-{project}/SKILL.md`（Coordinator スキル）
- `~/.claude/agents/{agent_name}.md`（各 subagent 定義）

レビュー自体は実行しません。今すぐ Step 0 から開始してください。

---

## Step 0: リポジトリ分析

**プロジェクト名の決定:**
カレントディレクトリ名は使わない（jj workspaceでランダムな名前になるため）。
`jj git remote list` でリポジトリ名を取得し、英小文字・ハイフン形式に変換する。
リモートがない場合は `package.json` の `"name"` や `./CLAUDE.md` を参照する。

**リポジトリ構造の把握:**
トップレベルのディレクトリ一覧・主要言語・サブシステムの分割を調べる。

**プロジェクトドキュメントの確認（存在するものを Read）:**
`./CLAUDE.md` / `./CODING_CONVENTIONS.md` / `./.claude/rules/` / `./backend/CODING_CONVENTIONS.md` / `./frontend/CODING_CONVENTIONS.md`

**ドキュメント体制の確認:**
保守すべきドキュメントが存在するかを確認する。以下のいずれかが当てはまれば docs-reviewer の追加対象とする:
- `docs/` ディレクトリに `.md` ファイルが存在する
- `CLAUDE.md` が存在する
- `README.md` 以外の `.md` ファイルがリポジトリに複数存在する

---

## Step 1: 構成を決定

### 1a. モードとfixer戦略を決定

以下の基準で構成モードを選ぶ:

| 条件 | モード |
|---|---|
| 検出スタックが1種類のみ（Go のみ、TS のみ等） | **lean**: reviewer 1名（全観点統合）+ Coordinator が直接修正 |
| 検出スタックが2種類以上（Go + Next.js 等） | **full**: スタック別分散レビュアー + fixer subagent |

決定した構成（例: `lean / Go単一スタック`）を記録してから次へ進む。

### 1b. スタック固有レビュアーの決定（full モードのみ）

lean モードの場合はスキップ。

### 常に含める（full モードのみ）

| subagent | 担当 |
|---|---|
| design-reviewer-{project} | 凝集度・可読性・設計品質（言語・プロジェクト非依存） |
| fixer-{project} | 修正実装・lint実行 |

### 技術スタック固有レビュアー（fullモード・検出したスタックごとに追加）

policy-reviewer は設けない。各スタックレビュアーが**プロジェクトルールとスタック固有ドキュメントの両方**を担う。

| 検出条件 | agent 名 | スタックドキュメント |
|---|---|---|
| Next.js を使用 | nextjs-reviewer-{project} | `typescript.md`, `react.md`, `nextjs.md` |
| React のみ（Next.js なし） | react-reviewer-{project} | `typescript.md`, `react.md` |
| Go を使用 | go-reviewer-{project} | `go.md` |
| `.tf` ファイルが存在 | terraform-reviewer-{project} | `terraform.md`（存在する場合） |
| 保守すべきドキュメントが存在する | docs-reviewer-{project} | `technical-writing.md` |

---

## Step 2: ファイルの生成

### 2a. Coordinator SKILL.md の生成

**lean モード**:
`~/.claude/skills/kickoff-review-team/tmpl-skill-lean.md` を Read し、
`{project}`・`{stack_summary}`・`{lint_command}` を置換して
`~/.claude/skills/review-team-{project}/SKILL.md` に Write する。

**full モード**:
`~/.claude/skills/kickoff-review-team/tmpl-skill.md` を Read し、
`{project}`・`{reviewers}`・`{reviewer_table}`・`{reviewer_agent_calls}`・`{fixer_agent_name}` を置換して
`~/.claude/skills/review-team-{project}/SKILL.md` に Write する。

### 2b. reviewer agent ファイルの生成

生成先: `~/.claude/agents/`

**lean モード**（reviewer 1名）:
`~/.claude/skills/kickoff-review-team/tmpl-teammate.md` を Read し、
以下のプレースホルダーを埋めて `~/.claude/agents/reviewer-{project}.md` に Write する:

| プレースホルダー | 埋める内容 |
|---|---|
| `{agent_name}` | `reviewer-{project}` |
| `{agent_description}` | `{project} 専任コードレビュアー。{stack_summary}固有ルール適用済み。` |
| `{reviewer_name}` | `reviewer` |
| `{stack_description}` | スタックの説明 |
| `{docs_to_read}` | 読み込むべきファイル一覧（下記参照） |
| `{responsibility}` | 担当する観点 |
| `{diff_command}` | 差分取得コマンド |
| `{empty_diff_message}` | 差分なし時のメッセージ |
| `{report_title}` | レポートのタイトル |

**full モード**（スタック別分散）:
各スタックレビュアーについて同様に `~/.claude/agents/{agent_name}-{project}.md` に Write する。

**`{docs_to_read}` の書き方:**
Step 0 で存在確認したファイルのみ列挙する。プロジェクトルールを先に書き、優先順位を明記する。

**重要: パスの書き方**
- プロジェクト固有ファイルは**必ず相対パス**（例: `./CLAUDE.md`, `./.claude/rules/backend-usecase.md`）
- 絶対パス（`/Users/...` 等）は使わない。jj workspaceのディレクトリ名は毎回変わるため壊れる
- `~/.claude/docs/` 以下のスタックドキュメントのみ `~` を使ってよい

### 2c. docs-reviewer agent の生成（該当する場合のみ）

`~/.claude/skills/kickoff-review-team/tmpl-teammate-docs.md` を Read し、
`{project}` と `{diff_command}` を埋めて `~/.claude/agents/docs-reviewer-{project}.md` に Write する。

### 2d. design-reviewer と fixer の生成（full モードのみ）

lean モードはスキップ。

**design-reviewer-{project}**: `~/.claude/agents/reviewer-airi-design.md` を参考に、
プロジェクト名のみ変えて `~/.claude/agents/design-reviewer-{project}.md` に Write する。

**fixer-{project}**: `~/.claude/agents/fixer-airi.md` を参考に、
プロジェクトの lint コマンドに合わせて `~/.claude/agents/fixer-{project}.md` に Write する。

---

## Step 3: 完了報告

生成したファイル一覧を表示し、`/review-team-{project}` で開始できることを案内する:

```
## 生成完了

### Coordinator スキル
- ~/.claude/skills/review-team-{project}/SKILL.md

### Subagent 定義（~/.claude/agents/）
- reviewer-{project}.md（または各スタック別）
- （docs-reviewer-{project}.md）
- （design-reviewer-{project}.md / fixer-{project}.md）

/review-team-{project} で開始できます。
```
