---
name: kickoff-review-team
description: リポジトリを分析して最適なAgent Team構成を決定し、プロジェクト固有のreview-teamスキルを生成する。生成されたスキルをユーザーが呼び出すことでレビュー＆修正ループが始まる。
allowed-tools: Read, Grep, Glob, Bash(jj git remote list), Bash(ls *), Write
---

# kickoff-review-team: プロジェクト固有レビュースキルの生成

あなたの目的は、現在のリポジトリを分析し、コードレビュー＆修正チームのスキルファイル群を `~/.claude/skills/review-team-{project}/` に生成することです。レビュー自体は実行しません。今すぐ Step 0 から開始してください。

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

## Step 1: チーム構成を決定

### 常に含める

| teammate | 担当 |
|---|---|
| design-reviewer | 凝集度・可読性・設計品質（言語・プロジェクト非依存） |
| fixer | 修正実装・lint実行 |

### 技術スタック固有レビュアー（検出したスタックごとに追加）

policy-reviewer は設けない。各スタックレビュアーが**プロジェクトルールとスタック固有ドキュメントの両方**を担う。

**各スタックレビュアーの初期化メッセージに含めるもの:**
1. プロジェクト固有ルール（`CLAUDE.md` / `rules/` / `CODING_CONVENTIONS.md` など、存在するもの）
2. 対応する `~/.claude/docs/` のスタックドキュメント

**優先順位:** プロジェクトルールが `~/.claude/docs/` の内容より優先される。矛盾がある場合はプロジェクトルールに従う。

| 検出条件 | reviewer 名 | スタックドキュメント | diff の絞り込み |
|---|---|---|---|
| Next.js を使用 | nextjs-reviewer | `typescript.md`, `react.md`, `nextjs.md` | frontend/ など |
| React のみ（Next.js なし） | react-reviewer | `typescript.md`, `react.md` | 該当ディレクトリ |
| Go を使用 | go-reviewer | `go.md` | backend/ など |
| `.tf` ファイルが存在 | terraform-reviewer | `terraform.md`（存在する場合） | `*.tf` |
| 保守すべきドキュメントが存在する（`docs/*.md`、`CLAUDE.md`、複数の `.md` ファイルなど） | docs-reviewer | `~/.claude/docs/technical-writing.md` + Docs Map があれば対象ファイル | `jj diffu -r 'main..@'`（全差分） |

**スタックが検出されないがプロジェクトルールがある場合:**
`policy-reviewer` を追加し、プロジェクトルールのみを担当させる。

**判断のポイント:**
- Go + Next.js のモノレポ → go-reviewer + nextjs-reviewer の両方追加
- 差分が特定ディレクトリに限定されるなら diff コマンドにパスを絞る
- `~/.claude/docs/` に対応ファイルがなくてもレビュアーは追加してよい（プロジェクトルールだけで動く）

---

## Step 2: スキルファイルの生成

### 2a. Coordinator（SKILL.md）の生成

`~/.claude/skills/kickoff-review-team/tmpl-skill.md` を Read してフォーマットを把握し、
プロジェクトに合わせてカスタマイズして `~/.claude/skills/review-team-{project}/SKILL.md` に Write する。

### 2b. 各 reviewer ファイルの生成

Step 1 で決定した各スタックレビュアーについて、`~/.claude/skills/kickoff-review-team/tmpl-teammate.md` を Read し、
以下のプレースホルダーを埋めて `~/.claude/skills/review-team-{project}/teammate-{name}.md` に Write する:

| プレースホルダー | 埋める内容 |
|---|---|
| `{reviewer_name}` | reviewer の名前（例: go-reviewer） |
| `{stack_description}` | 担当スタックの説明（例: Goスタック） |
| `{docs_to_read}` | **読み込むべきファイルの一覧**（下記参照） |
| `{responsibility}` | 担当する観点（例: GoポリシーとDDDアーキテクチャのチェック） |
| `{diff_command}` | 差分取得コマンド（例: `jj diffu -r 'main..@' backend/`） |
| `{empty_diff_message}` | 差分なし時のメッセージ（例: backendの変更なし） |
| `{report_title}` | レポートのタイトル（例: Go Review Result） |

**`{docs_to_read}` の書き方:**
Step 0 で存在確認したファイルのみ列挙する。プロジェクトルールを先に書き、優先順位を明記する。

**重要: パスの書き方**
- プロジェクト固有ファイル（CLAUDE.md, rules/, CODING_CONVENTIONS.md 等）は**必ず相対パス**で書く（例: `./CLAUDE.md`, `./.claude/rules/backend-usecase.md`）
- 絶対パス（`/Users/...` 等）は絶対に使わない。jj workspaceのディレクトリ名は毎回変わるため、絶対パスは壊れる
- `~/.claude/docs/` 以下のスタックドキュメントのみ `~` を使ってよい

```
プロジェクト固有ルール（優先）:
- ./CLAUDE.md
- ./.claude/rules/*.md
- ./backend/CODING_CONVENTIONS.md   ← 存在する場合のみ

スタック固有の観点（プロジェクトルールと矛盾する場合はプロジェクトルール優先）:
- ~/.claude/docs/go.md
```

### 2c. docs-reviewer の生成（docs-reviewer が必要な場合）

`~/.claude/skills/kickoff-review-team/tmpl-teammate-docs.md` を Read し、
以下のプレースホルダーを埋めて `~/.claude/skills/review-team-{project}/teammate-docs.md` に Write する:

| プレースホルダー | 埋める内容 |
|---|---|
| `{diff_command}` | `jj diffu -r 'main..@'`（絞り込みなし・全差分） |

### 2d. design-reviewer と fixer のコピー

以下はそのままコピー（内容変更不要）。teammate ファイルは以下を参考に（スキルロード時に自動展開される）:

!`cat ~/.claude/skills/kickoff-review-team/teammate-design.md 2>/dev/null`

---

!`cat ~/.claude/skills/kickoff-review-team/teammate-policy.md 2>/dev/null`

---

!`cat ~/.claude/skills/kickoff-review-team/teammate-fix.md 2>/dev/null`

---

## Step 3: 完了報告

生成したファイル一覧を表示し、`/review-team-{project}` で開始できることを案内する。
