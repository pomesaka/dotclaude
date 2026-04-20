---
name: check-pr
description: PR の内容をキャッチアップする。
when_to_use: 「PR #123 を確認して」「このPRをレビューしたい」「別セッションの作業を引き継ぎたい」と言われたとき。
argument-hint: "[PR番号 または owner/repo#PR番号]"
allowed-tools: Bash(jj *), Bash(gh *)
model: haiku
---

# Check PR — キャッチアップ

引数 `$ARGUMENTS` にはPR番号（例: `123`）または `owner/repo#123` 形式を指定する。
リポジトリ未指定時は `gh pr view` がカレントリポジトリを自動判定する。

## 手順

### 1. PR基本情報の取得

```bash
gh pr view $ARGUMENTS --json number,title,body,state,author,baseRefName,headRefName,reviewDecision,reviews,labels,assignees,url
```

`headRefName`（= PRのブランチ名）を控える。以降 `<branch>` と呼ぶ。

### 2. ローカルにブランチを展開

```bash
jj git fetch
jj bookmark track <branch> --remote=origin
jj new <branch>
```

`bookmark track` がすでにトラッキング済みのエラーを出す場合は無視してよい。

### 3. レビューコメントの取得

PR番号とリポジトリを特定したうえで:

```bash
# インラインレビューコメント（ファイルパス・行番号付き）
gh api repos/<owner>/<repo>/pulls/<PR番号>/comments \
  | jq -r '.[] | "[\(.user.login)] \(.path):\(.line // "?")\n\(.body)\n---"'

# 一般コメント（会話スレッド）
gh api repos/<owner>/<repo>/issues/<PR番号>/comments \
  | jq -r '.[] | "[\(.user.login)] \(.body)\n---"'
```

### 4. 差分の確認

```bash
jj diffu
```

ファイル一覧を把握し、変更規模・影響範囲を確認する。

### 5. キャッチアップサマリーの出力

以下の形式でまとめて出力する:

---

## PR #<番号>: <タイトル>

**URL**: <url>
**Author**: <author>  **State**: <state>  **Review**: <reviewDecision>

### 概要
<PRボディの要点を要約>

### 注目ファイル（任意）
変更の中で特に重要・複雑なファイルがあれば列挙する。単純な追記や設定変更のみなら省略。

### レビューコメント
<インライン・一般コメントを時系列でまとめる。未解決の指摘があれば強調>

### 現在の状態
- レビュー承認状況
- 未解決のコメント・議論
- 次にやるべきこと（レビュー継続 / 修正対応 / マージ待ち など）

---

サマリー出力後、「レビューを続けますか？修正を対応しますか？」などユーザーへ次のアクションを確認する。
