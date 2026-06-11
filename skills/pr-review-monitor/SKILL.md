---
name: pr-review-monitor
description: 複数リポジトリの自分宛レビュー依頼を監視し、サブエージェントにレビューさせて difit + HTML ダッシュボードで結果を共有する常駐ループ。
when_to_use: 「レビュー依頼を監視して」「PR 監視ループを回して」と言われたとき。/loop と組み合わせて常駐させる。
---

# PR Review Monitor

## 概要

複数リポジトリの「自分宛レビュー依頼」を定期ポーリングし、新規・更新された PR をサブエージェントにレビューさせる。結果は3経路で共有する:

1. セッションへの整形報告（毎イテレーション、スキップ時も）
2. difit の行位置コメント（`https://difit-pr<番号>.localhost`）
3. HTML ダッシュボード（`https://pr-review.localhost`）

**GitHub への PR コメント投稿はユーザー自身が行う。エージェントは投稿しない。**

## ファイル構成（データプレーン: `~/.claude/tmp/pr-review/`）

| パス | 役割 |
|---|---|
| `config.json` | 監視対象設定（下記スキーマ） |
| `state.json` | 現在のステータス。ダッシュボードが読む & ループの引き継ぎ状態（reviewedSha・dismissed 等）の唯一の置き場 |
| `index.html` | ダッシュボード（このスキルの `dashboard/index.html` のコピー） |
| `<RepoName>/` | ベースクローン（full clone + jj colocate） |
| `<RepoName>-pr<番号>/` | PR ごとの jj workspace |

## config.json スキーマ

```json
{
  "reviewer": "pomesaka",
  "pollIntervalSeconds": 1500,
  "repos": [
    {"repo": "Accel-Hack/ADeT", "reviewerAgent": "reviewer-adet", "authorFilter": "kentau715"},
    {"repo": "Accel-Hack/ADeT-AI", "reviewerAgent": "reviewer-adet-ai", "authorFilter": "kentau715"}
  ]
}
```

- `reviewerAgent` 省略時は汎用エージェント（subagent_type 指定なし）でレビュー
- `authorFilter` 省略時は全作者の PR が対象

## 初回セットアップ

1. `config.json` がなければ AskUserQuestion で監視対象リポジトリ・作者フィルタを確認して作成する
2. リポジトリごとにベースクローンを用意:
   ```bash
   gh repo clone <owner/repo> ~/.claude/tmp/pr-review/<RepoName>
   jj git init --colocate ~/.claude/tmp/pr-review/<RepoName>
   ```
   **`--filter=blob:none`（blob-less clone）は禁止**。WHY NOT: git は missing blob を checkout 時に lazy fetch するが、jj のバックエンドは `Object not found` で checkout に失敗する（2026-06 実機検証）。
3. ダッシュボードを起動（下記）

## ダッシュボード起動

```bash
cp ~/.claude/skills/pr-review-monitor/dashboard/index.html ~/.claude/tmp/pr-review/index.html
mise exec -- portless pr-review sh -c 'python3 -m http.server "$PORT" --bind 127.0.0.1 --directory /Users/pomesaka/.claude/tmp/pr-review'
```

- Bash の `run_in_background` で起動し、`https://pr-review.localhost` をユーザーに共有する
- 起動のたびに cp してダッシュボードを最新化する（スキル側の index.html が原本）
- ページは 30 秒ごとに `state.json` を自動リロードする

## 毎イテレーションの手順

1. **ポーリング**: 各リポジトリで
   ```bash
   gh pr list --repo <repo> --state open --json number,title,author,reviewRequests,headRefOid,url
   ```
   reviewRequests に `config.reviewer` が含まれる PR を抽出（`authorFilter` があれば適用）。**`gh search` は検索インデックス遅延で取りこぼすため使わない。**
2. **差分判定**: `state.json` の `reviewedSha` と比較し、新規 or head 変化のみレビュー。依頼なし・変化なしはスキップ
3. **レビュー準備（jj workspace 方式）**: `gh pr view <番号> --repo <repo> --json headRefName` でブランチ名取得 → `jj -R <base> git fetch` → 初回は
   ```bash
   jj -R <base> workspace add --revision <branch>@origin --name pr<番号> ~/.claude/tmp/pr-review/<RepoName>-pr<番号>
   ```
   再レビューは `jj -R <ワークスペースパス> new <branch>@origin` で head を進める
4. **レビュー実施**: config の `reviewerAgent` サブエージェントに投げる。プロンプトに必ず含める:
   - 周辺コンテキスト・プロジェクトルールは上記 workspace を Read/Grep/Glob で読む（セッションの作業コピーや別のローカルクローンは stale の可能性があるため使わない）
   - 観点: そのエージェントの全観点 + 既存コードベースと設計・命名の乖離 + 不要な複雑さ + 再利用チェック（新規ユーティリティは実装パターン同義語で rg。absence claim には検索コマンドの根拠必須）
   - 各指摘にファイルパス:行番号（diff の new side 基準）を明記
   - 再レビュー時: ユーザー投稿済みコメントへの対応確認 + 前回以降の差分のみゼロベースレビュー。`state.json` の `dismissed` にある指摘は**再指摘禁止**
5. **difit 起動**: difit-review スキルの portless 方式（空きポート取得 → `mise exec -- portless difit-pr<番号> --app-port <P> npx difit --pr <PR URL> --clean --port <P> --host 127.0.0.1 --no-open --comment '...'`、`run_in_background`）で指摘を行位置コメント注入
6. **state.json 更新**: 下記スキーマで全 PR の現状を反映（時刻は `date +%Y-%m-%dT%H:%M:%S%z` で取得。頭で計算しない）。`index.html` が消えていれば再コピー
7. **セッション報告**: state.json の内容を整形して全文報告（スキップ時も。「変化なし」だけで終わらせない）
8. **通知**: レビューを実施したときのみ PushNotification（status: proactive、1行・200字以内、PR番号 + blocker有無 + difit URL）
9. **再アーム**: ScheduleWakeup（delaySeconds は config の `pollIntervalSeconds`、prompt は `/loop /pr-review-monitor` 固定）。引き継ぎ状態は state.json にあるため prompt に埋め込まない

## difit 運用ルール

- difit 終了（ユーザーがタブを閉じる）時の stdout に**残らなかった**指摘 = ユーザーがチェック済み = **スルー判定**。`state.json` の該当 PR の `dismissed` に追記し、以降の再レビューで再指摘しない
- stdout に**残った**指摘 = 採用。ユーザーが自分の口調で GitHub に投稿する

## state.json スキーマ

```json
{
  "updatedAt": "2026-06-11T14:50:00+0900",
  "prs": [
    {
      "repo": "Accel-Hack/ADeT",
      "number": 2536,
      "title": "feat(fe): ...",
      "url": "https://github.com/Accel-Hack/ADeT/pull/2536",
      "state": "waiting_author",
      "blockers": false,
      "reviewedSha": "491424e0...",
      "headSha": "491424e0...",
      "lastReviewedAt": "2026-06-11T13:05:00+0900",
      "difitUrl": "https://difit-pr2536.localhost",
      "difitAlive": false,
      "findings": [{"severity": "should", "file": "src/foo.ts:30-37", "summary": "switch-case 化"}],
      "dismissed": ["github-connection-status.tsx の switch-case 化"],
      "notes": ["ユーザーコメント投稿済み"]
    }
  ]
}
```

`state` の値:

| 値 | 意味 | ダッシュボード表示 |
|---|---|---|
| `action_required` | レビュー済み・ユーザーのコメント投稿待ち | 🔴 あなたのアクション待ち |
| `waiting_author` | 作者の対応待ち | ⏸️ 待ち |
| `waiting_request` | （再）レビュー依頼待ち | ⏸️ 待ち |
| `unwatched` | 依頼が来ていない監視対象外 PR | 監視対象外 |

## クリーンアップ

- PR が close/merge されたら: `jj -R <base> workspace forget pr<番号>` + workspace ディレクトリを rm -rf + state.json から除去
- ループ停止時: portless の静的サーバーと difit プロセスを停止（TaskList でタスク ID を確認して TaskStop）
