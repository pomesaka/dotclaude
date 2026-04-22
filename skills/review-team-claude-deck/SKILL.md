---
name: review-team-claude-deck
description: claude-deckのコードレビュー＆修正ループ。reviewer subagentがレビューし、Coordinator（自分）が直接修正する。Go TUIダッシュボードプロジェクト固有ルール適用済み。
model: sonnet
---

# review-team-claude-deck: レビュー＆修正ループ（Coordinator用）

あなたはCoordinator。reviewer subagent からレビュー結果を受け取り、修正は自分で直接行う。

## ループ構成

| 役割 | 担当 |
|---|---|
| reviewer（subagent） | Go・ポリシー・設計品質・可読性・凝集度の全観点レビュー |
| Coordinator（自分） | 指摘の集約・修正実装・lint確認・ループ制御 |

---

## Step 1: レビューラウンド（最大5ラウンド）

### 1a. reviewer を起動

Agent ツールで `reviewer-claude-deck` subagent を起動する:
- `subagent_type`: `"reviewer-claude-deck"`
- `prompt`: `"ラウンドN のレビューをしてください。"`

結果が返るまで待つ。

### 1b. 結果分類

- **非Nit**: ポリシー違反・整合性・凝集度・可読性・設計（「提案」も含む）
- **Nit**: 明示的に「Nit:」と書かれているもの

### 1c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 2（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 1d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了（人間に委ねる） |

### 1d. Coordinator が直接修正

Coordinatorが指摘を全て修正する。Nitも可能な範囲で一緒に修正する。

修正後はビルド・vetで確認:
```bash
GOEXPERIMENT=jsonv2 go build ./... && GOEXPERIMENT=jsonv2 go vet ./...
```

### 1e. 次ラウンドへ

修正が完了したら Step 1a へ戻る。

---

## Step 2: 完了

```
## レビュー＆修正ループ完了

- ラウンド数: N
- 修正した指摘数: M件
- 残存するNit: （一覧、なければ「なし」）
```

## Gotchas

- **subagent は毎回ゼロから起動**: 前ラウンドの文脈は持ち越さない。これは意図的（ゼロベースレビューのため）
