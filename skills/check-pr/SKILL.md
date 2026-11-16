---
name: check-pr
description: PR の内容をキャッチアップする。
when_to_use: 「PR #123 を確認して」「このPRをレビューしたい」「別セッションの作業を引き継ぎたい」と言われたとき。
argument-hint: "[PR番号 または owner/repo#PR番号]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(bash ~/.claude/skills/check-pr/fetch-pr.sh *), Bash(bash ~/.claude/skills/check-pr/checkout.sh *)
model: haiku
---

# Check PR — キャッチアップ

## 手順

### 0. PR メタデータの取得

```bash
bash ~/.claude/skills/check-pr/fetch-pr.sh $ARGUMENTS
```

出力された `<pr_meta>` から `<branch>` と `<base>` を読み取る。以降それぞれ `<branch>` `<base>` と呼ぶ。

### 1. ローカルにブランチを展開

```bash
bash ~/.claude/skills/check-pr/checkout.sh <branch>
```

### 3. 差分の確認

```bash
jj diffu --from <base> --to <branch>
```

差分が大きい場合は `--stat` 付きでファイル一覧を先に確認し、重要なファイルを絞って `jj diffu --from <base> --to <branch> <path>` で個別に見る。

### 4. キャッチアップサマリーの出力

以下の形式でまとめて出力する。

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

## Gotchas

- **レビューコメントを反映する前に、インラインのコメントを全部読み、互いに関わるものをまとめる**: あるコメントへの対応が、別のコメントの内容を変えることがある（テーブルの名前を変えると、カラムの名前も変わる、など）。1件ずつ直すと、後の修正が前の修正と食い違う。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **`--from <base> --to <branch>`の差分がPRの説明と合わないほど大きいときは、branchが古いbaseのままになっている**: branchが分かれた後に`<base>`へ入った無関係なコミットが、すべて差分に混ざる。`gh pr view <番号> --json mergeable`が`CONFLICTING`なら、古いと分かる。`jj log -r 'fork_point(<base> | <branch>)'`で分岐点を出し、`jj diffu --from <分岐点> --to <branch>`で取ると、PRの範囲どおりの差分になる。「現在の状態」には`mergeable: CONFLICTING`と、マージの前にrebaseが要ることを書く。
  <!-- mentions: 1 | first-seen: 2026-07 -->
