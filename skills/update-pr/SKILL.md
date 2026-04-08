---
name: update-pr
description: 既存 PR にコードを push してタイトル・ボディを更新する。「PR を更新して」「PRの説明を直して」「変更を push して PR を更新して」と言われたときに使用する。新規 PR 作成は create-pr を使う。
disable-model-invocation: false
argument-hint: "[PR番号]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(bun *), Read, Glob
---

# Update Pull Request

既存のPRを最新の変更で更新する。PR番号は `$ARGUMENTS` で指定、未指定時は現在のブックマークに紐づくPRを自動検出する。

## 手順

### 1. 対象PRの特定

```bash
# 引数指定時
gh pr view <PR番号> --json number,title,headRefName,baseRefName

# 未指定時: 現在のブックマークからPRを探す
jj bookmark list  # 現在のブックマークを確認
gh pr list --head <bookmark名> --json number,title
```

### 2. 変更内容の確認

```bash
# baseブランチとのdiff全体
jj diffu -r '<base branch>..@'

# 前回pushからの差分（何が変わったか把握するため）
jj log -r '<bookmark名>@origin..@'
```

### 3. WHYを会話ヒストリーから収集

**最重要。** diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する:

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **今回の更新で変わった点**: 前回PRからの追加・修正内容

### 4. プッシュ

既存ブックマークの更新なので `--bookmark` で明示的に指定する。

```bash
jj git push --bookmark <bookmark名>
```

### 5. 動作検証

PR更新前に変更の正しさを確認する:

- ビルド・型チェック
- Linter/Formatter
- 必要に応じてテスト

検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はPR更新前に修正すること。

### 6. PR更新

既存のPRタイトル・ボディを最新の変更内容に合わせて更新する。
ボディは create-pr と同じフォーマットで全体を書き直す。

PRボディの「動作検証」セクションには、レビュアーが**手元で再現・確認できる具体的な手順**を書く。

**動作検証の書き方:**

- **前提条件**: 環境変数・外部サービスの設定手順（具体的に）
- **セットアップ**: 準備コマンド
- **静的検証**: 型チェック・lint等のコマンドと期待結果
- **動作確認**: ステップバイステップで「何をしたら何が起きるか」
- **確認ポイント**: 正常系・エラー系で何を確認すべきか

```bash
**`gh pr edit` は更新後のPR URLを stdout に出力する。これをユーザーに提示する。**

```bash
PR_URL=$(gh pr edit <PR番号> --title '更新後のタイトル' --body "$(cat <<'EOF'
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
