---
name: upload-screenshots
description: ローカルのスクリーンショット（PNG/JPEG/GIF）や動画（WebM/MP4→GIF自動変換）をGitHubのIssueまたはPRコメントに投稿する。「スクショをPRにあげて」「動画をコメントに投稿して」と言われたときに使用する。
argument-hint: "[pr-number or issue-number]"
model: haiku
---

# upload-screenshots: スクリーンショットをGitHub Issue/PRに投稿する

## 概要

GitHub APIは直接バイナリをコメントに添付できない。
**ドラフトリリースのアセット**としてアップロードし、`browser_download_url` をmarkdownに埋め込む方式を使う。

- リポジトリのGitツリー（`git log`/`git blame`）には一切含まれない
- S3ベースのGitHub管理ストレージに保存される
- プライベートリポジトリでも `![]()` でインライン表示される（PNG/JPEG/GIF）

## 手順

### Step 1: 対象の特定

ARGUMENTSからIssue/PR番号を取得する。未指定の場合は現在のブックマークからPRを探す:

```bash
jj bookmark list
gh pr list --head <bookmark名> --json number,title
```

### Step 2 & 3: アップロードスクリプトを実行

`${CLAUDE_SKILL_DIR}/upload.sh` がクリーンアップ・リリース作成・アップロードを一括で行う。
出力は `ファイル名\tURL` の TSV 形式。

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
NUMBER=<issue-or-pr番号>

"${CLAUDE_SKILL_DIR}/upload.sh" "$REPO" "$NUMBER" <ファイル1> [ファイル2 ...]
```

### Step 4: コメントを投稿/更新

得られた URL をmarkdownに埋め込む。

**重要: コメントbodyに変数を含む場合は `<<'EOF'`（シングルクォートのヒアドキュメント）を使わない。**
変数展開が抑制されてURLがリテラル文字列になる。`-f body="..."` でダブルクォート文字列として渡すこと。

```bash
# 新規コメント
gh pr comment ${NUMBER} --body "## 動作確認
![説明](${URL1})
![説明](${URL2})"

# 既存コメントを更新
gh api --method PATCH "repos/${REPO}/issues/comments/<comment-id>" \
  -f body="..."
```

## 後片付け

upload.sh 実行時に1ヶ月以上前の `[screenshots]` ドラフトリリースを自動削除する。手動対応不要。
