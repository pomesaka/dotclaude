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

- **複数のレビューコメントを反映する前にコメント間の依存性を整理する**: コメント A の変更がコメント B の内容に波及することがある（例: テーブル命名変更 → カラム名変更が連動）。サマリー出力時点でインラインコメントを全部読み切り、依存関係のあるコメントをグループ化してから修正に着手すると整合性を保ちやすい。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`--from <base> --to <branch>` の diff が PR の説明と全く噛み合わないほど巨大なら、branch が stale（base からリベースされずに放置）な可能性を疑う**: `gh pr view <番号> --json mergeable` で `CONFLICTING` なら確定的にstale。この場合 `<base>`（例: main）を直接比較すると、branch 派生後に base 側へマージされた無関係なコミット群が全部ノイズとして混ざる。`jj log -r 'fork_point(<base> | <branch>)'` で真の分岐点コミットを特定し、そこから `jj diffu --from <fork_point> --to <branch>` を取ると PR の実スコープに一致したクリーンな diff が得られる。現在の状態セクションには `mergeable: CONFLICTING` を必ず明示し、「マージ前に rebase が必要」と伝える。実例: ある案件の PR で `--from main` が無関係な差分込みで170KB超だったのに対し、fork point (`a453bb13`) からの diff は説明どおりの82ファイルに一致した。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
