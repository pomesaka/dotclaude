---
name: check-best-practices
description: Claude Code のベストプラクティスリポジトリ（shanraisshan/claude-code-best-practice）を調査し、現在の dotclaude 環境との差分を分析して改善提案を行う。「ベストプラクティス確認して」「dotclaudeを改善したい」と言われたときに使う。
allowed-tools: WebFetch, Read, Glob, Grep
context: fork
agent: general-purpose
model: sonnet
---

# Claude Code ベストプラクティス環境チェック

## 目的

`shanraisshan/claude-code-best-practice` リポジトリの最新内容と、現在の dotclaude 環境を比較し、取り込む価値のある改善点を提案する。

## 手順

### Step 1: ベストプラクティスリポジトリを取得

以下の URL から主要コンテンツを取得する:

- `https://raw.githubusercontent.com/shanraisshan/claude-code-best-practice/main/README.md`
- `https://raw.githubusercontent.com/shanraisshan/claude-code-best-practice/main/best-practice/claude-skills.md`
- `https://raw.githubusercontent.com/shanraisshan/claude-code-best-practice/main/best-practice/claude-subagents.md`
- `https://raw.githubusercontent.com/shanraisshan/claude-code-best-practice/main/best-practice/claude-memory.md`

### Step 2: 現在の環境を読み込む

```
~/.claude/CLAUDE.md
~/github.com/pomesaka/dotclaude/skills/ （各 SKILL.md のフロントマターのみ）
~/github.com/pomesaka/dotclaude/commands/ （ファイル一覧）
~/github.com/pomesaka/dotclaude/docs/ （ファイル一覧）
```

### Step 3: 差分分析

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

### Step 4: 提案レポートを出力

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
