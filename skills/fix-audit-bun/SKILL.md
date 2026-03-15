---
name: fix-audit-bun
description: bun audit --audit-level=highを実行し、脆弱性を修正してPRを作成する。
user-invocable: true
argument-hint: "[project-dir]"
---

# Bun Audit Fix & PR作成スキル

bun auditで検出された脆弱性を修正し、PRを作成する。
$ARGUMENTS が指定されている場合はそのディレクトリで作業する。

## Step 1: mainから新しいrevisionを作成

```bash
jj new main -m 'fix: security audit vulnerabilities'
```

## Step 2: 脆弱性の確認

```bash
bun audit --audit-level=high
```

結果を分析し、修正が必要なパッケージを特定する。
脆弱性が検出されなかった場合は「脆弱性は検出されませんでした」と報告し、revisionを破棄(`jj abandon`)して終了する。

## Step 3: 脆弱性の修正

検出された脆弱性に対して、以下の方針で修正を行う:

1. **直接依存の場合**: `package.json` のバージョンを更新し `bun install` を実行
2. **間接依存の場合**: 直接依存のパッケージを更新して解消を試みる
3. **overrides が必要な場合**: `package.json` の `overrides` フィールドで間接依存のバージョンを固定

修正後に再度 `bun audit --audit-level=high` を実行して脆弱性が解消されたことを確認する。

## Step 4: revisionの説明を更新

修正内容に基づいて説明を更新する:

```bash
jj desc -m "$(cat <<'EOF'
fix: resolve high severity audit vulnerabilities

<修正したパッケージと脆弱性の概要>

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Step 5: bookmarkを作成してpush

bookmark名は `audit/YYYY-MM-DD` 形式（当日の日付）を使用する。

```bash
jj bookmark create audit/YYYY-MM-DD
jj git push --allow-new --bookmark audit/YYYY-MM-DD
```

## Step 6: PRを作成

```bash
gh pr create --base main --head audit/YYYY-MM-DD --title 'fix: resolve high severity audit vulnerabilities' --body "$(cat <<'EOF'
## 概要
`bun audit --audit-level=high` で検出された脆弱性を修正

## 変更点
- <修正したパッケージと内容を列挙>

## 確認方法
```
bun audit --audit-level=high
```

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

PRのURLを表示して完了。

## 注意事項
- メジャーバージョンアップが必要な場合は、ユーザーに確認を取ること
- lockfileの変更(`bun.lock`)も含めてコミットすること
- 修正が不可能な脆弱性がある場合は、その旨をPR本文に記載すること
