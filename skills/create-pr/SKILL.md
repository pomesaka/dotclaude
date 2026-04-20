---
name: create-pr
description: jj + gh を使って新しい PR を作成する。
when_to_use: 「PRを作って」「プルリクを出して」「push して PR を作成して」と言われたとき。既存 PR の更新は update-pr を使う。
disable-model-invocation: false
argument-hint: "[base-branch]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(task *), Bash(bun *), Read, Glob
model: haiku
---

# Create Pull Request

baseブランチに向けてPRを作成する。baseブランチは `$ARGUMENTS` で指定、未指定時は `main`。
`jj diffu` は git diff形式でdiffを表示するカスタムコマンド（`jj diff` と同じオプション）。

## 手順

### 1. ログ確認・description設定

```bash
jj log --limit 5
```

現在のリビジョン（`@`）の description が空（`(no description set)`）の場合、PR作成前に設定する:

1. `jj diffu` で変更内容を確認
2. 会話ヒストリーからWHY（動機・設計判断の理由）を収集
3. `jj desc -m '...'` で description を設定（`/jjdesc` スキルと同じフォーマット）

description が既に設定されている場合はスキップ。

### 2. base branchとのdiffを確認

```bash
jj diffu -r '<base branch>..@'
```

### 3. WHYを会話ヒストリーから収集

**最重要。** diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する:

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **背景情報**: バグの根本原因、制約、要件

### 4. ブックマーク作成・プッシュ

`--named <name>=@` を使う。bookmark create + track + push を1コマンドで行い、新規ブックマークの tracking エラーを回避できる。

```bash
jj git push --named <name>=@
```

### 5. 動作検証

PR作成前に変更の正しさを確認する:

- ビルド・型チェック
- Linter/Formatter
- 必要に応じてテスト

検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はPR作成前に修正すること。

### 6. PR作成

PRボディの「動作検証」セクションには、レビュアーが**手元で再現・確認できる具体的な手順**を書く。

**動作検証の書き方:**

- **前提条件**: 環境変数・外部サービスの設定手順（具体的に）
- **セットアップ**: 準備コマンド
- **静的検証**: 型チェック・lint等のコマンドと期待結果
- **動作確認**: ステップバイステップで「何をしたら何が起きるか」
- **確認ポイント**: 正常系・エラー系で何を確認すべきか

抽象的な記述（「動作確認する」）ではなく、コピペで再現できるレベルの具体性。

**`gh pr create` が stdout に出力するURLが正しいPRのURL。**
`jj git push` が出力する `pull/new/...` URLは使わないこと。

```bash
PR_URL=$(gh pr create --base <base branch> --head <name> --title '適切なタイトル' --body "$(cat <<'EOF'
## 背景・動機（WHY）
なぜこの変更が必要だったか。課題や問題の説明。

## 概要
変更内容の概要（アプローチの選択理由を含む）

## 変更点
- 主要な変更点

## 動作検証

### 前提条件
必要な環境変数・外部サービスの設定手順

### 静的検証
```bash
コマンド   # 期待結果
```

### 動作確認手順
1. 具体的なステップ → 期待される結果

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)")
echo "$PR_URL"
```
