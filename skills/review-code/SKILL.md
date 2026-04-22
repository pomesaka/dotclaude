---
name: review-code
description: 変更差分に対してコードレビューを実施する。
when_to_use: 「レビューして」「差分を見て」「PR前に確認して」「コードを見てほしい」と言われたとき。ドメイン設計・型設計の分析は review-domain を使う。
allowed-tools: Read, Grep, Glob, Bash(jj diff *), Bash(jj diffu *), Bash(git diff *)
context: fork
agent: general-purpose
model: sonnet
---

# コードレビュー

変更差分を以下の基準でレビューする。差分に含まれる技術スタックに関係するルールのみ適用し、無関係なものは無視する。

## 基本基準（常に適用）

### 凝集度

!`cat ~/.claude/docs/cohesion.md 2>/dev/null`

### 可読性

!`cat ~/.claude/docs/readability.md 2>/dev/null`

### 設計品質

!`cat ~/.claude/docs/design.md 2>/dev/null`

## 技術スタック別観点（差分に含まれる技術のみ適用）

### Go

!`cat ~/.claude/docs/go.md 2>/dev/null`

### TypeScript

!`cat ~/.claude/docs/typescript.md 2>/dev/null`

### React

!`cat ~/.claude/docs/react.md 2>/dev/null`

### Next.js

!`cat ~/.claude/docs/nextjs.md 2>/dev/null`

## プロジェクト固有ルール（存在する場合のみ適用）

!`cat ./CLAUDE.md 2>/dev/null`

!`[ -d ./.claude/rules ] && cat ./.claude/rules/*.md 2>/dev/null || true`

---

## 手順

### Step 1: 差分の確認

PR のレビューなら `gh pr diff`、ローカル変更のレビューなら `jj diffu -r 'main..@'` を使う。

```bash
# PR のレビュー
gh pr diff 2>/dev/null

# ローカル変更のレビュー
jj diffu -r 'main..@' 2>/dev/null
```

**unified diff の読み方（重要）**:
- `-` で始まる行: 削除された行（変更前の値）
- `+` で始まる行: 追加された行（変更後の値）
- `-` 行と `+` 行が連続している場合は「変更」を意味する
  - 例: `-  DB: false,` の次行 `+  DB: true,` → 「`false` → `true` に変更」
  - **誤読禁止**: 削除行と追加行の内容を連結して読まない（`DB: falsetrue` は誤り）

差分が空の場合は「差分がありません。レビュー対象がありません。」とユーザーに伝えて終了する。

### Step 2: レビュー

差分の各ファイルについて、上記の基準を適用する。些細な指摘は省き、設計上の改善が見込めるものだけを報告する。

プロジェクト固有ルールが読み込まれている場合は、ポリシー違反・アーキテクチャ整合性も確認する。

### Step 3: 報告

```
## レビュー結果

### <ファイルパス>
- [カテゴリ] 説明（行番号と修正案）

### <ファイルパス>
- 問題なし
```

カテゴリ:
- `ポリシー違反` — プロジェクト固有ルールへの違反
- `整合性` — 既存コードのパターンとの不整合
- `凝集度` — 責務の分離、モジュール設計の問題
- `可読性` — 命名、制御フロー、抽象レベルの問題
- `設計` — エラーハンドリング、型安全性、API設計の問題
- `Nit` — 些細な指摘
