---
name: demo-record-adet
description: ADeT UIの動作確認動画・スクリーンショットを撮影してPRコメントに投稿する。「動作確認して」「デモ撮って」「スクリーンショット撮って」と言われたときに使用する。
argument-hint: "[pr-number] [確認したい機能の説明]"
---

# demo-record: ADeT UI動作確認スキル

探索フェーズ（操作手順を確定してスクリプトを書く）と撮影フェーズ（スクリプトを実行して録画）を分けて実施する。

## なぜ2フェーズに分けるか

探索しながら撮影すると「次どうするか考える間」が動画に含まれてしまう。
探索フェーズでシェルスクリプトを書き、撮影フェーズで一気に実行することで締まった動画になる。

## 前提

- ADeT: `http://localhost:3001`
- テストユーザー: `user006@example.com` / `password006`
- テストプロジェクトID: `00000000-0000-0000-0000-000000000001`

## フェーズ1: 探索 → シェルスクリプト作成

`playwright-cli` でインタラクティブに操作し、目的の画面へのパスと操作手順を確認する。

```bash
playwright-cli open http://localhost:3001
playwright-cli snapshot
playwright-cli click e31
# ... 操作しながら画面遷移・要素を確認
```

**refは動的に変わる**ため、スクリプトでは `run-code` でセレクタを使う。

確認できたら `~/.claude/tmp/demo-{feature}.sh` にシェルスクリプトとして書き出す。

### スクリプトのテンプレート

```bash
#!/usr/bin/env bash
set -e

# ログイン
playwright-cli open "http://localhost:3001/auth/signin"
playwright-cli resize 1440 900
playwright-cli run-code "async page => {
  await page.getByPlaceholder('メールアドレス').fill('user006@example.com');
  await page.getByRole('button', { name: '次へ' }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('パスワード').fill('password006');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('**/organizations**');
}"

# 目的の画面へ移動してから録画開始
playwright-cli goto "http://localhost:3001/projects/00000000-0000-0000-0000-000000000001/spec"
sleep 1.5
playwright-cli video-start

# 操作（run-code で安定したセレクタを使う）
playwright-cli run-code "async page => await page.getByRole('button', { name: 'APIs' }).click()"
sleep 0.5
playwright-cli run-code "async page => await page.getByRole('tab', { name: 'メンバー' }).click()"
sleep 0.8

# 動画を固定パスに保存
playwright-cli video-stop --filename=/tmp/demo-{feature}.webm
playwright-cli close
```

**ポイント:**
- `run-code` で `getByRole` / `getByPlaceholder` / `getByText` を使う → refより安定
- `sleep` でアニメーション・ページ遷移を待つ
- 録画は `video-start` より前に目的画面へ移動しておく（ログイン画面が映らないように）
- `video-stop --filename` で保存先を固定する（デフォルトは `.playwright-cli/` に自動生成）

## フェーズ2: 録画 → GIF変換 → アップロード

```bash
# スクリプト実行（内部でvideo-start/stopも行う）
bash ~/.claude/tmp/demo-{feature}.sh

# GIF変換＆アップロード
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
NUMBER=<PR番号>
~/.claude/skills/upload-screenshots/upload.sh "$REPO" "$NUMBER" /tmp/demo-{feature}.webm
```

得られたURLをPRコメントに投稿:

```bash
gh pr comment ${NUMBER} --body "## 動作確認
![demo](${GIF_URL})"
```
