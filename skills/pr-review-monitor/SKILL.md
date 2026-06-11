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
   gh pr list --repo <repo> --state open --json number,title,author,reviewRequests,headRefOid,url,updatedAt
   ```
   `authorFilter` があれば作者で絞る。レビュー対象は2系統 — **(a) formal review request**（reviewRequests に `config.reviewer` が含まれる）と **(b) コメント起因の依頼**（reviewRequests に無くても作者がコメントで依頼している。step 2 で判定）。**`gh search` は検索インデックス遅延で取りこぼすため使わない。**
2. **差分判定**:
   - **difit からユーザーフィードバックを取り込む（pull）**: `difitAlive: true` の PR は判定の前に difit から現在のコメントを pull し、`dismissed`／`action_required` を更新する（詳細は「difit 運用ルール（pull モデル）」）。ユーザーが返信で質問・議論をしていれば action_required、すべて対応指示なら再レビュー候補にする
   - **初回レビュー（formal request + コメント起因）**: まだ現 head をレビューしていない（`reviewedSha != headSha`）PR を、次のいずれかのシグナルで対象にする:
     - **formal request**: reviewRequests に reviewer が含まれる
     - **コメント起因の依頼**: reviewRequests に無くても作者がコメントで依頼している場合（作者によっては review request を付けず「@reviewer 確認お願いします」等のコメントだけで止める運用がある）。効率化のため `updatedAt` ゲートを使う — list の `updatedAt` が state の `lastSeenUpdatedAt` から進んだ候補だけ `gh pr view <番号> --repo <repo> --json comments,body` を引き、**作者本人のコメント**に `@<reviewer>` メンション or 依頼文言（「レビューお願い」「確認お願い」「見てください」「確認ください」「レビューください」等）があれば対象。無ければ `lastSeenUpdatedAt` を更新してスキップ（次に updatedAt が進むまで再取得しない）
     - 上記いずれのシグナルも無ければ対象外（無関係な PR を勝手にレビューしない）
   - **人間が先にレビュー済みのガード**: 初回レビュー対象でも、reviewer（ユーザー）自身が現 head に対してレビューコメント／レビューを既に投稿していて、それが最新の実質的アクティビティなら **bot は二重レビューしない**。state を `waiting_author`（作者対応待ち）にして記録するだけにする。WHY: ユーザーが手動でレビューした PR を bot が後追いで重複レビューしないため
   - **再レビュー**: 一度レビューした PR（state.json に `reviewedSha` がある）で head が変わったとき。re-request、または head 変化後に作者が top-level コメントで依頼（「確認お願いします」等）していれば即対象。**なければレビュースレッドの状態から「作者がボールを返したか」を総合判断する**。WHY: 作者によっては push + インラインコメント返信だけで re-request をしない運用のため、依頼だけ待つと「レビュー再開してほしい」シグナルを取りこぼす:
     ```bash
     gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<番号>){reviewThreads(first:50){nodes{isResolved comments(last:1){nodes{author{login} body}}}}}}}'
     ```
     全スレッドが「resolved または 最後の発言が作者（対応しました等）」→ 論点はすべて返球済み = 再レビュー実施。未返信・未対応のスレッドが残っていれば作者作業中とみなして待つ。**迷ったら再レビュー側に倒す**（取りこぼしより過剰レビューの方が安い）
   - **スレッド返信の分類**: 作者の返信は「対応報告（対応しました等）」と「質問・反論・議論提起」に分けて扱う。後者が1つでもあれば、その PR は **ユーザーが返信すべき = action_required** として報告・ダッシュボードに載せる（スレッドの file:line・質問内容・返信の材料になる技術的評価を添える）。再レビューのサブエージェントにも全返信の本文を読ませ、各スレッドが「修正で完結」か「議論が続きそう」かを判定させる
   - どちらにも該当しなければスキップ
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
5. **difit 起動（keep-alive・pull モデル）**: difit-review スキルの portless 方式で、**`--keep-alive` を付けて**指摘を行位置コメント注入する。`--keep-alive` でブラウザを閉じてもサーバが落ちないため、ユーザーのコメントを開いたまま pull できる:
   ```bash
   # 空きポート P を取得して固定で渡す
   mise exec -- portless difit-pr<番号> --app-port <P> npx difit --pr <PR URL> --clean --keep-alive --port <P> --host 127.0.0.1 --no-open --comment '...'
   ```
   `run_in_background` で起動し、**確保したポート `<P>` を state.json の `difitPort` に保存する**（次イテレーション以降の pull に必須）。サーバはイテレーションをまたいで常駐するので head 変化なしの限り再起動しない。再レビュー（head 変化）時は古い difit を TaskStop し、新しい head の diff + コメントで起動し直す（`difitVersion` は 0 にリセット）
6. **state.json 更新**: 下記スキーマで全 PR の現状を反映（時刻は `date +%Y-%m-%dT%H:%M:%S%z` で取得。頭で計算しない）。`index.html` が消えていれば再コピー
7. **セッション報告**: state.json の内容を整形して全文報告（スキップ時も。「変化なし」だけで終わらせない）
8. **通知**: レビューを実施したときのみ PushNotification（status: proactive、1行・200字以内、PR番号 + blocker有無 + difit URL）
9. **再アーム**: ScheduleWakeup（delaySeconds は config の `pollIntervalSeconds`、prompt は `/loop /pr-review-monitor` 固定）。引き継ぎ状態は state.json にあるため prompt に埋め込まない

## difit 運用ルール（pull モデル）

difit は `--keep-alive` で常駐させ、ユーザーのコメントは HTTP で**開いたまま pull する**（旧: プロセス終了時の stdout を読む push モデルは廃止）。difit はブラウザのコメント編集ごとに `/api/comments` へ同期し、変更で `version` を +1 する（2026-06 実機検証: サーバ `dist/server/server.js:501,517,552` がセッションに保持・配信、クライアントは threads 依存 effect で `/api/comments` に POST + `beforeunload` で sendBeacon）。

**毎イテレーション、`difitAlive: true` の PR ごとに pull する:**

```bash
# difitPort は state.json に保存済み。JSON で現在のスレッドを取得
npx difit comment get --port <difitPort> --format json
# 同等の素の HTTP: curl -s http://127.0.0.1:<difitPort>/api/comments-json
```

返る `{version, threads}` を state.json の `difitVersion` と比較する:

- **`version` が変わっていない** → ユーザー未操作。スキップ
- **`version` が増えた** → 差分を分類して反映し、`difitVersion` を更新:
  - **注入した指摘が threads から消えている**（filePath+line+body で照合）= ユーザーが削除 = **スルー判定** → `dismissed` に追記し以降再指摘しない
  - **注入スレッドにユーザーの追加メッセージ（返信）がある**（`messages[]` が注入時の1件より増えている）→ 返信本文を「対応報告」と「質問・反論・議論提起」に分類。後者なら **action_required**（file:line + 質問内容 + 返信材料を報告）
  - **ユーザーが新規に立てたスレッド**（注入していない id/position）= ユーザー自身のメモ → 報告に載せる
- **接続失敗（connection refused）** → サーバが落ちている → `difitAlive: false`。必要なら findings を再注入して再起動

注入分と現在 threads の差分でスルー判定をライブ算出するため、旧モデルの「ユーザーがタブを閉じる」という明示シグナルは不要。プロセスが killed されてもダンプ消失せず、開いたまま随時取得できる。

**selection 注意**: コメントは diff selection（base/target リビジョン）でキー分けされる（`server.js:143-154`）。`--pr` の単一 diff モードなら `comment get`（クエリ無し）がデフォルト selection を共有して正しく取れるが、UI 上で比較対象を切り替える使い方をすると別 session になり得る。

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
      "lastSeenUpdatedAt": "2026-06-12T11:10:43Z",
      "lastReviewedAt": "2026-06-11T13:05:00+0900",
      "difitUrl": "https://difit-pr2536.localhost",
      "difitPort": 57653,
      "difitAlive": false,
      "difitVersion": 2,
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

- PR が close/merge されたら: 常駐 difit を停止（TaskList で `difit-pr<番号>` を含むタスクを探して TaskStop）+ `jj -R <base> workspace forget pr<番号>` + workspace ディレクトリを rm -rf + state.json から除去
- ループ停止時: portless の静的サーバーと全 difit プロセスを停止（TaskList でタスク ID を確認して TaskStop）

**注**: `--keep-alive` の difit はイテレーションをまたいで常駐する。セッションをまたぐと background タスク ID は失われるため、孤児プロセスは `state.json` の `difitPort` でポートを特定して停止する（`lsof -ti :<difitPort>` で PID 取得）。
