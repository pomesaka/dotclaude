---
name: impl-issue-noah
description: GitHub IssueをNoah実装フローで実装してPRを作成する。
when_to_use: 「issueを実装して」「#123を実装して」「このissueをやって」と言われたとき。
argument-hint: "<issue-number>"
allowed-tools: Bash(gh *), Bash(jj *), Bash(mise *), Read, Edit, Write, Grep, Glob
model: sonnet
---

# impl-issue-noah: Issue実装フロー

あなたはCoordinator。GitHub Issueの内容を元に実装→レビュー→PR作成のフローを自動化する。

引数 `$ARGUMENTS` に issue 番号（3桁、例: `001`）を受け取る。なければ AskUserQuestion でユーザーに確認する。

## Step 0: Issue 取得

```bash
ls issues/$ARGUMENTS-*.md
```

該当ファイルを Read して内容を把握する。特に以下を確認:
- `status` が `open` または `in-progress` であること（`done` / `wontfix` なら中断してユーザーに確認）
- `depends` に記載された issue が全て `done` であること
- 実装すべき機能・修正内容の詳細
- どの app / package に変更が入るか（`apps/ms-holdings`、`packages/features`、`packages/ai` 等）
- UIへの変更が含まれるか

issue ファイルの `status` を `in-progress` に更新する。

## Step 1: 実装（サブエージェント）

Agent ツールで `general-purpose` sub-agentを起動し、実装を委譲する。

プロンプトには以下を含める:
- noahモノレポ（Bun + Next.js App Router）のissueを実装するタスクであること
- `issues/$ARGUMENTS-*.md` の内容（全文）
- 「まず `CLAUDE.md`, `docs/apps/architecture.md`, `docs/apps/conventions.md` を読んでアーキテクチャ・規約を確認してください」
- 「実装後は `mise exec -- bun run lint` でlintを、`mise exec -- bun run typecheck` で型チェックを通してください。エラーが残っていれば修正してください」
- 「jjコマンドは使わず、ファイル編集のみ行ってください」

sub-agentの返答を確認し、lint・typecheckが通ったことを確認してから次のステップへ進む。
エラーが残っていればCoordinatorが自分で追加修正する。

## Step 2: ドメインレビュー

`review-domain` スキルを呼び出す（Skill ツール使用）。

結果を確認し:
- **重大な設計問題**（責務の誤配置・レイヤー境界の侵犯・型設計の欠陥）→ Coordinatorが自分で修正し lint/typecheck を通す
- **提案レベルの指摘**→ 判断してスキップ or 反映（issue のスコープを超える変更は避ける）

## Step 3: PR作成

`create-pr` スキルを呼び出す（Skill ツール使用）。

PRのタイトル・本文に `closes #<issue番号>` を含めるよう指示する。

## Step 4: コードレビュー＆修正ループ

`review-team-noah` スキルを呼び出す（Skill ツール使用）。

内部でreviewer subagentによるレビュー→Coordinatorによる修正→update-prのサイクルが実行される。

## Step 5: issue を done にする

issue ファイルの `status` を `done` に更新する。Devlog は Step 6 の `re` が書く。

## Step 6: 振り返り（Devlog 込み）

`re` スキルを呼び出す（Skill ツール使用）。

**このプロジェクトでは `re` が Devlog も書く**。`re` 実行時に以下を伝える:
- 対象 issue ファイルのパス（`issues/NNN-*.md`）
- Devlog の各セクションを会話ヒストリーから埋めること

`re` が Devlog を書く際の各セクション:

| セクション | 書く内容 |
|---|---|
| `### 実装内容` | 何を実装したか（変更ファイル・追加した型・関数の概要） |
| `### 設計判断` | なぜそのアプローチを選んだか。却下した代替案があれば理由も |
| `### レビューで指摘・修正した点` | レビューループで修正した非 Nit 指摘の一覧 |
| `### 困ったこと・ハマったこと` | 詰まった箇所と解決のきっかけ |

空欄のまま残すセクションがあれば `（なし）` と書く。

知見の書き先（`re` がドキュメントへ反映する際の判断基準）:

| 知見の性質 | 反映先 |
|---|---|
| noah 固有の規約・禁止事項 | `CLAUDE.md` または `docs/apps/conventions.md` |
| reviewer が複数 issue で同じ観点を指摘 | `docs/apps/conventions.md` に規約として明文化 |
| TypeScript / React / Next.js の一般的なプラクティス | `~/.claude/docs/typescript.md` 等の言語ドキュメント |
| reviewer スキルが見落としている観点 | `dotclaude/skills/review-team-noah/teammate-reviewer.md` |

## Gotchas

- **Issue番号なしで起動**: `$ARGUMENTS` が空なら AskUserQuestion でユーザーに確認する
- **実装サブエージェントがjjを使う**: jjコマンドを使わないよう明示すること（ファイル編集のみ）
- **create-prの前にreview-team-noahを呼ぶ**: review-team-noahはupdate-prを呼ぶためPRが存在しないと失敗する。Step 3（create-pr）→ Step 4（review-team-noah）の順を守ること
- **lint/typecheckコマンド**: `mise exec -- bun run lint` と `mise exec -- bun run typecheck`。直接 `bun` はPATHに入っていない場合があるため必ず `mise exec --` を前置する
- **変更フィルタ**: `bun run lint` / `bun run typecheck` はモノレポルートで実行すれば全パッケージをチェックする。変更したパッケージのみ絞る場合は `mise exec -- bun --filter='@noah/xxx' lint` を使う
- **bun install 未実施**: 実装前に `bun install` 済みかを確認する。`node_modules` がなければ lint/typecheck が依存解決エラーで全滅する。`ls node_modules 2>/dev/null | head -1` で確認し、空なら `mise exec -- bun install` を先に実行すること
