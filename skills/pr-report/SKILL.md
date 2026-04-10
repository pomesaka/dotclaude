---
name: pr-report
description: Accel-Hack OrgのPR・Issue集計レポートを生成する。半期評価や定期集計時に使用する。/pr-report [from] [to] で呼び出す。例: /pr-report 2025-10-01 2026-03-31
argument-hint: "[from: YYYY-MM-DD] [to: YYYY-MM-DD]"
disable-model-invocation: true
allowed-tools: Bash(gh *), Bash(python3 *)
model: haiku
---

# PR・Issue 集計レポート生成

対象: Accel-Hack Org の ADeT / ADeT-AI / ADeT-infra / ADeT-genapp

## 引数

- `$0` = from date (例: `2025-10-01`)
- `$1` = to date   (例: `2026-03-31`)
- 省略時はスクリプトが現在の半期を自動判定する（4〜9月 or 10〜3月）

## Step 1: データ取得

```bash
python3 ${CLAUDE_SKILL_DIR}/fetch.py "$0" "$1"
```

完了後に `~/.claude/tmp/pr_report_raw/` 以下に各リポジトリのJSONが保存される。
エラーが出た場合（認証失敗・権限不足など）はユーザーに確認を取り、中断する。

## Step 2: 集計・レポート生成

```bash
python3 ${CLAUDE_SKILL_DIR}/aggregate.py "$0" "$1"
```

完了後に `~/.claude/tmp/pr_report_YYYYMMDD_YYYYMMDD.md` にレポートが出力される。

## Step 3: 結果表示

生成されたレポートのパスをユーザーに伝え、主要な数字（総PR数、メンバー別ランキング上位）をサマリーとして表示する。
