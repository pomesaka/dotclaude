---
name: fix-audit-bun
description: bun audit で脆弱性を検出・修正して PR を作成する。
when_to_use: 「脆弱性を修正して」「audit を通して」「セキュリティの問題を直して」と言われたとき。
user-invocable: true
argument-hint: "[project-dir]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(task *), Bash(bun *), Read, Glob, Edit, Write, Grep
model: sonnet
---

# Bun Audit Fix & PR作成スキル

bun auditで検出された脆弱性を修正し、PRを作成する。
$ARGUMENTS が指定されている場合はそのディレクトリで作業する。

## Step 1: 脆弱性の確認

```bash
bun audit --audit-level=high
```

結果を分析し、修正が必要なパッケージを特定する。
脆弱性が検出されなかった場合は「脆弱性は検出されませんでした」と報告して終了する。

## Step 2: 脆弱性の修正

検出された脆弱性に対して、以下の方針で修正を行う。

1. **直接依存の場合**: `package.json` のバージョンを更新し `bun install` を実行
2. **間接依存の場合**: 直接依存のパッケージを更新して解消を試みる
3. **overrides が必要な場合**: `package.json` の `overrides` フィールドで間接依存のバージョンを固定

修正後に再度 `bun audit --audit-level=high` を実行して脆弱性が解消されたことを確認する。

## Step 3: revisionの説明を設定してPR作成

修正内容に基づいて `jj desc` で説明を設定し、`/create-pr` でPRを作成する。

```bash
jj desc -m "$(cat <<'EOF'
fix: resolve high severity audit vulnerabilities

<修正したパッケージと脆弱性の概要>

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

その後 `/create-pr` を呼び出してPRを作成する。

## 注意事項
- メジャーバージョンアップが必要な場合は、ユーザーに確認を取ること
- lockfileの変更(`bun.lock`)も含めてコミットすること
- 修正が不可能な脆弱性がある場合は、その旨をPR本文に記載すること

## Gotchas

- **間接依存のパッケージに `bun update <pkg>` を使わない。`overrides` で直す**: `bun update js-yaml` は、間接依存だった js-yaml を `dependencies` に `^4.3.0` で追加した上で、脆弱な 4.3.0 のまま解決した（2026-08-07）。直接依存に無いパッケージは、最初から `overrides` で版を指定する
  <!-- importance: high | mentions: 1 | first-seen: 2026-08 -->
- **指摘されたパッケージに既存の `overrides` があれば、その下限が脆弱範囲に入っていないか確かめる**: 既存の `"brace-expansion": ">=5.0.8"` は条件を満たしているので lock は 5.0.8 のまま更新されず、脆弱範囲 `<5.0.9` に残っていた（2026-08-05）。`rg '"<pkg>@' bun.lock` で解決版を見て、下限を引き上げる
  <!-- importance: high | mentions: 1 | first-seen: 2026-08 -->
- **新しく足す `overrides` には、使う側が許す範囲で上限も付ける**: 上限なしだとメジャー版を飛び越える。fast-uri の最新は 4.1.2 だが、使う側の ajv は 3.x を要求するので `>=3.1.5 <4.0.0` にした（2026-08-05）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-08 -->
