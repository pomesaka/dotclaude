---
name: adet-cli
description: ADeT CLIを操作する。ログイン・Org一覧・Project一覧の取得ができる。
when_to_use: 「ADeT にログインして」「Orgの一覧を見せて」「プロジェクト一覧を取得して」と言われたとき。
allowed-tools: Bash(adet:*)
model: haiku
---

# ADeT CLI

## セットアップ

```bash
# ログインして access_token を取得
adet login -e <email> -p <password>

# 以降のコマンドで使うトークンをセット
export ADET_TOKEN=<access_token>
```

## コマンド

```bash
# Org 一覧
adet orgs list
# 出力例:
# ### Organizations (2)
#
# - system_id: abc-123
#   name: My Org

# Project 一覧（--org が必須）
adet --org <org-id> projects list
# 出力例:
# ### Projects (1)
#
# - system_id: xyz-789
#   code: MY_PROJECT
#   name: My Project
```

## オプション

`--format` — 出力形式（デフォルト: markdown bullet list）
- デフォルト — `### 見出し` + `- key: value` 形式
- `json` — JSON 配列（`--format json`）

`--org` / `ADET_ORG_ID` — Organization system ID（`projects list` で必須）

`--base-url` / `ADET_BASE_URL` — サーバー URL（デフォルト: `http://localhost:8080`）

`--token` / `ADET_TOKEN` — Bearer トークン

## 典型的なワークフロー

```bash
# 1. ログイン
adet login -e user@example.com -p mypassword

# 2. トークンをセット
export ADET_TOKEN=<access_token>

# 3. Org 一覧から org-id を確認
adet orgs list

# 4. Project 一覧を取得
adet --org <org-id> projects list
```
