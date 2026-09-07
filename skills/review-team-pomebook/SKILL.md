---
name: review-team-pomebook
description: pomebookのコードレビュー＆修正ループ。reviewer subagentがレビューし、Coordinator（自分）が直接修正する。TypeScript(Bun)・React(TanStack Start)プロジェクト固有ルール適用済み。
model: sonnet
---

# review-team-pomebook: レビュー＆修正ループ（Coordinator用）

あなたはCoordinator。reviewer subagent からレビュー結果を受け取り、修正は自分で直接行う。

---

## Step 1: レビューラウンド（最大5ラウンド）

### 1a. reviewer を起動

Agent ツールで `reviewer-pomebook` subagent を起動する:
- `subagent_type`: `"reviewer-pomebook"`
- `prompt`: `"ラウンドN のレビューをしてください。"`

結果が返るまで待つ。

### 1b. 結果集約・分類

- **非Nit**: ポリシー違反・整合性・凝集度・可読性・設計・ドキュメント不整合（「提案」も含む）
- **Nit**: 明示的に「Nit:」と書かれているもの

> **注意**: reviewer の指摘を採用する前に、`rg` または `Read` で実ファイルを確認すること。reviewer は diff の削除行を「現在のファイルに存在する内容」と誤認して指摘することがある。存在しない問題への修正コストをかけない。

### 1c. 終了判定

| 状態 | 次のアクション |
|---|---|
| 非Nit = 0 | Step 2（完了）へ |
| 非Nit > 0 かつラウンド < 5 | 1d へ |
| ラウンド = 5 到達 | 残存指摘を表示して終了（人間に委ねる） |

### 1d. Coordinator が直接修正

Coordinatorが指摘を全て修正する。Nitも可能な範囲で一緒に修正する。

修正後はlintで確認:
```bash
bun run lint
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
- **このスキルの前に review-domain を実行すること**: `impl-issue-pomebook` フローでは Step 3（review-domain）が先。このスキルを呼ぶ前に `Skill("review-domain")` を実行済みであることを確認する。両者をスキップまたは逆順にしない
- **reviewer は隣接 stale 参照も指摘する**: 今回の変更が直接引き起こしていない stale（旧パス・削除済みファイル名）でも、今回触ったファイルにある場合は指摘対象になる。修正機会があったのに放置した、という判断基準。docs ファイルを修正するとき周辺もスキャンしておくとラウンド数を減らせる
- **reviewer が diff の削除行を現在のファイルと混同する**: reviewer は差分の「削除された行」を現在のファイルに存在する内容と誤認して指摘することがある（特にラウンドが進んで多くのファイルを読んだ後）。対処: 指摘された内容を `rg` や `Read` で実ファイルを確認してから修正判断する。存在しない問題に修正コストをかけない。根本対策として reviewer-pomebook agent は `jj diffu`（unified diff）を使うよう修正済み — `jj diff` のカラー装飾フォーマットが混同の主因だった
  <!-- importance: high | mentions: 3 | first-seen: 2026-05 -->
