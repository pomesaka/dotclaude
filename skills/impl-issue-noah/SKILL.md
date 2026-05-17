---
name: impl-issue-noah
description: GitHub IssueをNoah実装フローで実装してPRを作成する。
when_to_use: 「issueを実装して」「#123を実装して」「このissueをやって」と言われたとき。
argument-hint: "<issue-number>"
allowed-tools: Bash(gh *), Read, Grep, Glob
model: sonnet
---

# impl-issue-noah: Issue実装フロー

あなたはCoordinator。GitHub Issueの内容を元に実装→レビュー→PR作成のフローを自動化する。

引数 `$ARGUMENTS` にIssue番号を受け取る。なければ AskUserQuestion でユーザーに確認する。

## Step 0: Issue取得

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,assignees
```

内容を把握する。特に以下を確認:
- 実装すべき機能・修正内容の詳細
- どの app / package に変更が入るか（`apps/ms-holdings`、`packages/features`、`packages/ai` 等）
- UIへの変更が含まれるか

## Step 1: 実装（サブエージェント）

Agent ツールで `general-purpose` sub-agentを起動し、実装を委譲する。

プロンプトには以下を含める:
- noahモノレポ（Bun + Next.js App Router）のissueを実装するタスクであること
- Issue #$ARGUMENTS のタイトルと本文（全文）
- 「まず `CLAUDE.md`, `docs/apps/architecture.md`, `docs/apps/conventions.md` を読んでアーキテクチャ・規約を確認してください」
- 「実装後は `mise exec -- bun run lint` でlintを、`mise exec -- bun run typecheck` で型チェックを通してください。エラーが残っていれば修正してください」
- 「jjコマンドは使わず、ファイル編集のみ行ってください」

sub-agentの返答を確認し、lint・typecheckが通ったことを確認してから次のステップへ進む。
エラーが残っていればCoordinatorが自分で追加修正する。

## Step 2: PR作成

`create-pr` スキルを呼び出す（Skill ツール使用）。

PRのタイトル・本文に `closes #<issue番号>` を含めるよう指示する。

## Step 3: コードレビュー＆修正ループ

`review-team-noah` スキルを呼び出す（Skill ツール使用）。

内部でreviewer subagentによるレビュー→Coordinatorによる修正→update-prのサイクルが実行される。

## Gotchas

- **Issue番号なしで起動**: `$ARGUMENTS` が空なら AskUserQuestion でユーザーに確認する
- **実装サブエージェントがjjを使う**: jjコマンドを使わないよう明示すること（ファイル編集のみ）
- **create-prの前にreview-team-noahを呼ぶ**: review-team-noahはupdate-prを呼ぶためPRが存在しないと失敗する。Step 2（create-pr）→ Step 3（review-team-noah）の順を守ること
- **lint/typecheckコマンド**: `mise exec -- bun run lint` と `mise exec -- bun run typecheck`。直接 `bun` はPATHに入っていない場合があるため必ず `mise exec --` を前置する
- **変更フィルタ**: `bun run lint` / `bun run typecheck` はモノレポルートで実行すれば全パッケージをチェックする。変更したパッケージのみ絞る場合は `mise exec -- bun --filter='@noah/xxx' lint` を使う
