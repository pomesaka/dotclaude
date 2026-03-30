---
name: review-team-airi
description: airiのAgent Teamコードレビュー＆修正ループ。design-reviewer・policy-reviewerが並列レビューし、fixerが修正する。TypeScript(Bun)プロジェクト固有ルール適用済み。
---

# review-team-airi: チームレビュー＆修正ループ（Coordinator用）

あなたはCoordinator。teammateを調整してレビュー＆修正サイクルを回す。

**各teammateはドキュメントを初回一度だけ読み込む。差分取得・レビューも各自が行う。Coordinatorは結果の集約とループ制御に集中する。**

## チーム構成

| teammate | 担当 | 差分取得コマンド |
|---|---|---|
| design-reviewer | 凝集度・可読性・設計品質 | `jj diffu -r 'main..@'` |
| policy-reviewer | CLAUDE.md・rules・TypeScriptポリシー | `jj diffu -r 'main..@'` |
| fixer | 修正実装・lint実行 | `jj diffu -r 'main..@'`（参照用） |

---

## Step 0: チーム作成（チームが存在しない場合のみ）

すでに `review-team-airi` チームが存在する場合はそのまま再利用する。存在しない場合のみ作成する:

```
Create an agent team with 3 teammates: design-reviewer, policy-reviewer, fixer
```

チーム作成後、**fixer のパーミッションモードを auto-approve に変更する**。
Shift+Down で fixer に切り替え → パーミッション設定を変更 → Coordinator に戻る。

WHY: fixer は大量のファイル編集を行うため、毎回承認を求めると作業が止まる。

---

## Step 1: 各teammateの初期化

チームを新規作成した場合のみ実施する。既存チームを再利用する場合はスキップしてStep 2へ進む。

全員に**並列で**初期化メッセージを送る。全員から「初期化完了」が返るまで待つ。

### design-reviewer に送るメッセージ:

!`cat ~/.claude/skills/review-team-airi/teammate-design.md 2>/dev/null`

### policy-reviewer に送るメッセージ:

!`cat ~/.claude/skills/review-team-airi/teammate-policy.md 2>/dev/null`

### fixer に送るメッセージ:

!`cat ~/.claude/skills/review-team-airi/teammate-fix.md 2>/dev/null`

---

## Step 2: レビューラウンド（最大5ラウンド）

### 2a. 並列レビュー依頼

全レビュアーに**同時に**以下を送る:

```
【ラウンドN レビュー開始】

担当の差分を取得してレビューしてください。
```

全員から結果が返るまで待つ。

### 2b. 結果集約・分類

全レビュアーの結果をまとめ、以下に分類する:

- **非Nit**: ポリシー違反・整合性・凝集度・可読性・設計（「提案」も含む）
- **Nit**: 明示的に「Nit:」と書かれているもの

### 2c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 3（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 2d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了（人間に委ねる） |

### 2d. 修正依頼

fixer に以下を送る:

```
【ラウンドN 修正依頼】

以下の指摘を全て修正してください。Nitも可能な範囲で一緒に直してください。

## 非Nit指摘
<一覧>

## Nit指摘（任意）
<一覧>

修正後はlintを実行して結果を報告してください。
```

### 2e. 次ラウンドへ

fixerが「修正完了」を報告したらStep 2aへ戻る。

---

## Step 3: 完了

```
## レビュー＆修正ループ完了

- チーム構成: design-reviewer, policy-reviewer, fixer
- ラウンド数: N
- 修正した指摘数: M件
- 残存するNit: （一覧、なければ「なし」）
```
