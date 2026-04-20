---
name: check-best-practices
description: Claude Code のベストプラクティスリポジトリを調査し、dotclaude 環境との差分を分析して改善提案を行う。
when_to_use: 「ベストプラクティス確認して」「dotclaudeを改善したい」と言われたとき。
allowed-tools: Bash(bash ~/.claude/skills/check-best-practices/fetch.sh), Bash(bash ~/.claude/skills/check-best-practices/env.sh)
context: fork
agent: general-purpose
model: sonnet
---

# Claude Code ベストプラクティス環境チェック

## ベストプラクティスリポジトリ（スキルロード時に取得済み）

!`bash ~/.claude/skills/check-best-practices/fetch.sh`

## 現在の dotclaude 環境（スキルロード時に取得済み）

!`bash ~/.claude/skills/check-best-practices/env.sh`

---

## 目的

上記のベストプラクティス内容と現在の dotclaude 環境を比較し、取り込む価値のある改善点を提案する。

## 手順

### Step 1: 差分分析（スキルロード時に取得済みのデータを使う）

以下の観点で比較する:

**CLAUDE.md の品質**
- 行数は200行以下か（目標60行）
- `settings.json` に移すべき強制動作が CLAUDE.md に書かれていないか
- 明らかなこと（Claudeが既に知っていること）を書いていないか

**スキルの品質**
- `description` フィールドがモデルのトリガー条件として書かれているか（ユーザー向け説明になっていないか）
- Gotchas セクション（落とし穴・失敗パターン）があるか
- Progressive Disclosure（references/ や examples/ の活用）ができているか
- Agent Skill（`user-invocable: false`）と User Skill の使い分けができているか

**未実装の価値あるパターン**
- オンデマンドフック（`/careful`, `/freeze` のようなスキルスコープのフック）
- コンテキスト管理の指示（50% でコンパクト等）
- human-gated task list ワークフロー

### Step 2: 提案レポートを出力

以下の形式で報告する:

```
## ベストプラクティス環境チェック結果

### 現状サマリー
- スキル数: N 個
- CLAUDE.md 行数: N 行

### すぐに取り込めるもの（低コスト・高効果）
1. ...

### 検討価値があるもの（中コスト）
1. ...

### 参考程度（今は不要かも）
1. ...

### 既にカバーできているもの（確認済み）
- ...
```

各提案には「なぜ価値があるか」と「具体的に何をするか」を書く。抽象的な提案は禁止。

$ARGUMENTS
