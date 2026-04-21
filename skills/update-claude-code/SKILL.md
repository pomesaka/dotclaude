---
name: update-claude-code
description: Claude Code をバージョン指定で手動アップデートする。changelog を確認してユーザーがバージョンを選択してからインストールする。
when_to_use: 「claude code を更新したい」「バージョンを上げたい」「update-claude-code」と言われたとき。
user-invocable: true
allowed-tools: Bash(claude *), Bash(curl *), Bash(jq *), AskUserQuestion
model: sonnet
---

# Claude Code 手動アップデートスキル

自動アップデートを無効にしている環境向け。changelog を確認してバージョンを選んでからインストールする。

## Step 1: 現在バージョンを取得

```bash
claude --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'
```

出力をそのまま `CURRENT_VERSION` として保持する。

## Step 2: GitHub Releases を取得してフィルタリング

```bash
curl -s "https://api.github.com/repos/anthropics/claude-code/releases?per_page=20" \
  | jq '[.[] | {version: (.tag_name | ltrimstr("v")), tag: .tag_name, body: .body}]'
```

取得した JSON を読み込み、`version` フィールドが `CURRENT_VERSION` より新しいエントリだけを残す（semver 比較）。

新しいバージョンが存在しない場合は「最新バージョン（`CURRENT_VERSION`）を使用中です」と報告して終了する。

## Step 3: ユーザーにバージョンを提示

`AskUserQuestion` でバージョンを選択してもらう。

提示フォーマット（新しい順）:
- 各バージョンのタグ名と `body` の先頭 300 文字を表示
- 選択肢: 新バージョン一覧 ＋ 「スキップ（何もしない）」

「スキップ」が選択された場合はそのまま終了する。

## Step 4: 指定バージョンをインストール

選択されたバージョン番号（例: `1.3.0`、`v` なし）を使ってインストールする:

```bash
curl -fsSL https://claude.ai/install.sh | bash -s <選択バージョン>
```

インストール後に現在バージョンを確認して報告する:

```bash
claude --version
```

## Gotchas

- **`v` プレフィックス**: GitHub tag は `v1.2.3` 形式。インストールスクリプトに渡すときは `ltrimstr("v")` で除去した数字のみを使う
- **GitHub API レート制限**: 未認証だと 60回/時間。通常の使用では問題ない
- **bash -s のバージョン指定**: `install.sh` のバージョン引数は非公式の可能性があるため、インストール失敗時はエラーをそのままユーザーに伝える
