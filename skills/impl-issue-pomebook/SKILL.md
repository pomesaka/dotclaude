---
name: impl-issue-pomebook
description: pomebook の issue を実装フローで実装して jjcommit + deploy まで行う。
when_to_use: 「issueを実装して」「#123を実装して」「このissueをやって」と言われたとき。
argument-hint: "<issue-number>"
model: sonnet
---

# impl-issue-pomebook: Issue 実装フロー

あなたは Coordinator。`issues/` ディレクトリの issue を読み、実装 → レビュー → jjcommit + deploy のフローを自動化する。

引数 `$ARGUMENTS` に issue 番号を受け取る。なければ AskUserQuestion でユーザーに確認する。

## Step 0: Issue 確認

```bash
cat issues/<番号>.md
```

内容を把握する。特に以下を確認:
- 実装すべき機能・修正内容の詳細
- UI への変更が含まれるか
- 依存する issue（`depends:` フィールド）が未完了でないか

## Step 1: 実装計画

issue の内容を元に実装方針を決める。不明点があれば AskUserQuestion でユーザーに確認してから進む。

## Step 2: 実装（サブエージェント）

Agent ツールで `worker-pomebook` サブエージェントを起動し、実装を委譲する。

プロンプトには以下を含める:
- pomebook の issue を実装するタスクであること
- issue のタイトルと本文（全文）
- Step 1 で決めた実装方針の詳細
- 「jj コマンドは使わず、ファイル編集のみ行ってください」

サブエージェントの返答を確認し、lint が通ったことを確認してから次のステップへ進む。
lint エラーが報告されていれば、Coordinator が自分で追加修正する。

## Step 3: ドメインレビュー

`review-domain` スキルを呼び出す（Skill ツール使用）。

結果を確認し:
- **重大な設計問題**（責務の誤配置、型設計の欠陥、境界の侵犯）→ Coordinator が自分で修正し lint で確認
- **提案レベルの指摘** → 判断してスキップ or 反映（issue のスコープを超える変更は避ける）

lint 確認:
```bash
bun run lint
```

## Step 4: コードレビュー＆修正ループ

`review-team-pomebook` スキルを呼び出す（Skill ツール使用）。

内部で reviewer subagent によるレビュー → Coordinator による修正のサイクルが実行される。重要な指摘がなくなるまで繰り返す。

## Step 5: Issue ステータス更新

`issues/<番号>-*.md` の `status: open` を `status: done` に書き換える。

```bash
# 対象ファイルを特定して更新
ls issues/<番号>-*.md
```

Edit ツールで frontmatter の `status: open` → `status: done` に変更する。

## Step 6: コミット

### 6a. 変更内容を確認

```bash
jj diffu
```

### 6b. WHY をこの会話から収集する

**最重要。** diff からは WHAT しか読み取れない。WHY はこの会話ヒストリーにしかない。以下を特定する:

- **課題・動機**: issue が解決しようとしていた問題（issue 本文の Context / Scope）
- **設計判断の理由**: ドメインレビュー・コードレビューで修正した内容とその理由
- **却下した代替案**: レビューで「こうしなかった理由」として出てきたもの

### 6c. コミットメッセージを作成・実行

WHY（6b）と WHAT（6a）からメッセージを作成し、`jj commit` で実行する:

```bash
jj commit -m "$(cat <<'EOF'
feat(<scope>): <タイトル 50文字以内>

<WHY — なぜこの変更が必要だったか、選んだアプローチの理由>

<WHAT — 主要な変更内容（diff から自明でない点のみ）>

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 6d. 確認

```bash
jj log --limit 2
```

## Step 7: Deploy

```bash
bun run deploy
```

デプロイ完了を確認して終了。

## Gotchas

- **issue 番号なしで起動**: `$ARGUMENTS` が空なら AskUserQuestion でユーザーに確認する
- **depends が未完了**: 依存 issue が open/in-progress なら実装前にユーザーに確認する
- **worker-pomebook が jj を使う**: jj コマンドを使わないよう明示すること（ファイル編集のみ）
- **lint が通らない実装**: サブエージェントが lint を確認せずに終了することがある。返答に lint 結果が明示されていない場合は Coordinator が自分で lint を実行して確認する
