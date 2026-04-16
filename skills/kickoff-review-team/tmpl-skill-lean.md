# tmpl-skill-lean.md
# lean モード（1名レビュアー + Coordinator直接修正）用テンプレート。
# kickoff-review-team が生成する SKILL.md に使用する。
#
# --- プレースホルダー一覧 ---
# {project}        : プロジェクト名（例: claude-deck）
# {stack_summary}  : スタックの説明（例: Go TUIダッシュボード）
# {reviewer_init}  : reviewer の初期化セクション（!cat で展開）
# {lint_command}   : lint/build コマンド（例: GOEXPERIMENT=jsonv2 go build ./...）
#
# --- ここから生成されるファイルの本文 ---
---
name: review-team-{project}
description: {project}のAgent Teamコードレビュー＆修正ループ。reviewer 1名がレビューし、Coordinator（自分）が直接修正する。{stack_summary}固有ルール適用済み。
---

# review-team-{project}: チームレビュー＆修正ループ（Coordinator用）

あなたはCoordinator。reviewer からレビュー結果を受け取り、修正は自分で直接行う。

**reviewerはドキュメントを初回一度だけ読み込む。差分取得・レビューも自身が行う。Coordinatorは修正とループ制御に集中する。**

## チーム構成

| 役割 | 担当 |
|---|---|
| reviewer（teammate） | 全観点レビュー（ポリシー・設計品質・可読性・凝集度） |
| Coordinator（自分） | 指摘の集約・修正実装・lint確認・ループ制御 |

---

## Step 0: チーム作成

!`ws=$(basename $(git rev-parse --show-toplevel 2>/dev/null || jj workspace root 2>/dev/null || pwd)); rm -rf ~/.claude/teams/review-{project}-$ws ~/.claude/tasks/review-{project}-$ws 2>/dev/null; echo "チーム名: review-{project}-$ws"`

上記のチーム名でチームを作成する:

```
Create an agent team named "<チーム名>" with 1 teammate: reviewer
```

---

## Step 1: reviewer の初期化

reviewer に初期化メッセージを送り、「reviewer 初期化完了」が返るまで待つ。

### reviewer に送るメッセージ:

!`cat ~/.claude/skills/review-team-{project}/teammate-reviewer.md 2>/dev/null`

---

## Step 2: レビューラウンド（最大5ラウンド）

### 2a. レビュー依頼

reviewer に以下を送る:

```
【ラウンドN レビュー開始】

担当の差分を取得してレビューしてください。
```

reviewer から結果が返るまで待つ。

### 2b. 結果集約・分類

- **非Nit**: ポリシー違反・整合性・凝集度・可読性・設計（「提案」も含む）
- **Nit**: 明示的に「Nit:」と書かれているもの

### 2c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 3（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 2d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了（人間に委ねる） |

### 2d. Coordinator が直接修正

Coordinatorが指摘を全て修正する。Nitも可能な範囲で一緒に修正する。

修正後はlintで確認:
```bash
{lint_command}
```

### 2e. 次ラウンドへ

修正が完了したらStep 2aへ戻る。

---

## Step 3: 完了

```
## レビュー＆修正ループ完了

- チーム構成: reviewer + Coordinator修正
- ラウンド数: N
- 修正した指摘数: M件
- 残存するNit: （一覧、なければ「なし」）
```
