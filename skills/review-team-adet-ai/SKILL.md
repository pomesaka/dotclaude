---
name: review-team-adet-ai
description: adet-aiのコードレビュー＆修正ループ。reviewer 1名が全観点をレビューし、Coordinator（自分）が直接修正する。
---

# review-team-adet-ai: レビュー＆修正ループ（Coordinator用）

あなたはCoordinator。reviewer 1名にレビューを依頼し、指摘に基づいて**自分で修正**する。

## チーム構成

| teammate | 担当 |
|---|---|
| reviewer | TypeScriptポリシー・設計品質・凝集度・可読性・ドキュメント・テスト網羅性を一括レビュー |

fixer は不要。**Coordinatorが直接修正する。**

---

## Step 0: チーム作成

毎回新規作成する。reviewer 1名のみ:

```
Create an agent team with 1 teammate: reviewer
```

---

## Step 1: reviewer の初期化

**毎回実施する。** teammate のコンテキストはセッションをまたいで保持されない。

reviewer に以下を送る。返信を待つ。

---

# reviewer 初期化

あなたはコードレビュアー（reviewer）。以下の全観点を一人で担当する。

**今すぐ以下のドキュメントを Read で読み込んでください。** 以降のレビュー依頼では再読込しない。

プロジェクト固有ルール（優先）:
- ./CLAUDE.md

設計・可読性基準:
- ~/.claude/docs/cohesion.md
- ~/.claude/docs/readability.md
- ~/.claude/docs/design.md

TypeScript/Bunスタック:
- ~/.claude/docs/typescript.md

ドキュメント品質:
- ~/.claude/docs/technical-writing.md

加えて、プロジェクトの `.md` ファイル一覧を Glob で把握しておく（内容は読まない）。

## 担当する観点

- **TypeScript ポリシー**: `as` キャスト禁止、型安全性、Valibot スキーマ
- **プロジェクト規約**: CLAUDE.md のコーディングポリシー（WHY コメント重視）
- **Bunスタック**: Bun 固有イディオム、アーキテクチャ整合性
- **設計品質**: 凝集度・可読性・設計（言語非依存の構造的問題）
- **ドキュメント品質**: 差分に含まれる `.md` の明瞭性・WHY・用語揺れ
- **ドキュメント網羅性**: 仕様変更・機能追加に対応する `.md` 更新漏れ
- **テスト網羅性**: カバレッジ不足・エッジケース漏れ・テスト未作成

## レビュー時の姿勢

**毎回ゼロベースで。** 過去のラウンドの内容は考慮しない。差分だけを見て判断する。

## レビュー手順

1. 差分を取得: `jj diffu -r 'main..@'`
2. 差分に含まれるテストファイル・ソースファイルを必要に応じて Read する
3. 差分に含まれる `.md` ファイルがあれば Read する
4. 全観点でレビューを実施する

## レポートフォーマット

```
## Review Result

### <ファイルパス>
- [カテゴリ] 説明（行番号と修正案）
- Nit: 説明

### <ファイルパス>
- 問題なし
```

カテゴリ: `ポリシー違反` / `整合性` / `設計` / `凝集度` / `可読性` / `ドキュメント` / `テスト` / `Nit`

初期化が完了したら「reviewer 初期化完了」と team-lead に SendMessage で報告してください。

---

## Step 2: レビューラウンド（最大5ラウンド）

### 2a. レビュー依頼

reviewer に送る:

```
【ラウンドN レビュー開始】

差分を取得してレビューしてください。
```

返信を待つ。

### 2b. 結果集約・分類

- **非Nit**: ポリシー違反・整合性・設計・凝集度・可読性・ドキュメント・テスト
- **Nit**: 明示的に「Nit:」と書かれているもの

### 2c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 3（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 2d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了 |

### 2d. Coordinator が直接修正

reviewer の指摘リストをもとに**自分で**修正を適用する。

修正後:
```bash
bun run typecheck   # 型チェック
bun run format      # フォーマット
```

通過したら Step 2a へ戻る。

---

## Step 3: 完了

reviewer をシャットダウン後、TeamDelete でチームを削除する。

```
## レビュー＆修正ループ完了

- ラウンド数: N
- 修正した指摘数: M件
- 残存するNit: （一覧、なければ「なし」）
```
