---
name: upload-screenshots
description: ローカルのスクリーンショット（PNG/JPEG/GIF/WebP/SVG）や動画（MP4/MOV/WebM）をGitHubのIssueまたはPRコメントに添付する。
when_to_use: 「スクショをPRにあげて」「動画をコメントに投稿して」と言われたとき。
argument-hint: "[pr-number or issue-number]"
allowed-tools: Bash(jj bookmark *), Bash(gh *)
model: haiku
---

# upload-screenshots: スクリーンショットをGitHub Issue/PRに投稿する

## 概要

`gh` CLI 2.99.0 以降の `--attach` フラグで、ローカルの画像・動画をそのまま Issue/PR コメントに添付する。
アップロードは GitHub 側でホストされ、動画も変換なしでプレーヤーとして埋め込み表示される。

- 対応形式: PNG / JPEG / GIF / WebP / SVG（画像）、MP4 / MOV / WebM（動画）
- サイズ上限: 画像・GIF 10MB、動画 10MB（Free）/ 100MB（有料プラン）
- 1コマンドあたり最大50ファイル
- 要 `gh` 2.99.0+（`gh --version` で確認。満たさなければ先にアップデートする）

## 手順

### Step 1: 対象の特定

ARGUMENTSからIssue/PR番号を取得する。未指定の場合は現在のブックマークからPRを探す:

```bash
jj bookmark list
gh pr list --head <bookmark名> --json number,title
```

### Step 2: 添付コメントを投稿

`--attach '<ファイルパス>#<画像の説明>'` で1ファイルずつ指定する（`#` 以降は alt text。動画には付けられない）。

```bash
gh pr comment <NUMBER> --attach './screenshot1.png#ログイン後の画面' --attach './demo.mp4#操作の様子'
# Issueの場合は gh issue comment
```

- `--body`（`-b`）を省略すると、添付ファイルだけの新規コメントになる（各添付はファイル名 or alt text 付きで末尾に並ぶ）
- 配置や説明文をコントロールしたい場合は、本文に `![説明](./screenshot1.png)` のようにローカルパスを直接書いて `--body` に渡す。`--attach` で同じパスを渡すと、その参照がアップロード後の URL に書き換わる（alt text は本文側の記述が優先される）

### Step 3: 既存コメントへの追記（必要な場合）

`--edit-last --attach ...` で自分の最後のコメントに追記できる（`gh pr comment --help` に両フラグの記載あり。組み合わせの実地動作はこのスキルでは未検証 — 失敗したら新規コメント投稿にフォールバックする）。

## Gotchas

- **`--attach` は `gh issue/pr create/edit/comment` にのみ存在する**: `gh api` 経由の生 REST 呼び出しにはない。添付を伴わずコメント本文だけ書き換えたい場合は従来通り `gh api --method PATCH repos/{repo}/issues/comments/{id}` を使う
- **動画はそのままプレーヤーとして埋め込まれ、alt text は付けられない**（`gh pr comment --help` に明記）
- 詳細: https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
