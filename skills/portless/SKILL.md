---
name: portless
description: ローカル開発サーバーを portless で起動する。ログを tmp に書き出し、コンテキストを汚さない。
when_to_use: 「dev server起動して」「portless起動して」「ローカルで動作確認したい」「開発サーバー立ち上げて」と言われたとき。
allowed-tools:
  - Bash(mise exec *)
  - Read
---

# portless

ローカル開発サーバーを `portless` で起動し、`https://<appname>.localhost` でアクセス可能にする。
ログは `~/.claude/tmp/<appname>-dev.log` に書き出してコンテキストを汚さない。

## 起動フロー

### 1. アプリを特定

スキル引数（例: `/portless ms-holdings`）があればそれを使う。なければ会話のコンテキストから判断する。
パスは `<reporoot>/apps/<appname>` 形式。

**ホスト名の一意性**: 同じプロジェクトを複数の jj ワークスペース（worktree）や異なるブックマークから同時に起動する場合、`package.json` の name をそのまま使うとホスト名が衝突する。その場合は `portless <name> <cmd>` 構文でブックマーク名やワークスペース名を含めた一意な名前を使うこと。

例:
- ブックマーク `issue-006` で作業中 → `ms-holdings-issue-006`
- ワークスペース名 `iori-4343` → `ms-holdings-iori-4343`

カスタム名を指定したい場合は `portless <name> <cmd>` 構文を使う（後述）。

### 2. バックグラウンドで起動

`run_in_background: true` で起動してコンテキストを守る:

**通常起動（package.json の name を使用）:**
```bash
mise exec --cd /path/to/apps/<appname> -- portless >> ~/.claude/tmp/<appname>-dev.log 2>&1
```

**カスタム名で起動（`portless <name> <cmd>` 構文）:**
```bash
mise exec --cd /path/to/apps/<appname> -- portless <custom-name> bun run dev >> ~/.claude/tmp/<custom-name>-dev.log 2>&1
```

- `<cmd>` はスペース区切りでそのまま渡す（`"bun run dev"` のようにクォートしない）
- 起動後の URL は `https://<custom-name>.localhost` になる

### 3. 数秒後にログを確認

起動結果を確認するためにバックグラウンドタスク完了通知を待つ（すぐに完了 = 失敗、長時間起動中 = 成功）。
失敗した場合はログファイルを Read して原因を確認する:

```
Read ~/.claude/tmp/<appname>-dev.log
```

### 4. ログに応じた対応

**プロキシ未起動（`Proxy is not running` が含まれる場合）**:

> portless proxy がまだ起動していません。ターミナルで以下を実行してください:
> ```
> sudo portless proxy start --https
> ```
> 完了後にもう一度 `/portless` を呼んでください。

ポートを使いたくない場合の代替:
> ```
> mise exec --cd apps/<appname> -- portless proxy start --port 1355 --https
> ```
> この場合 URL は `https://<appname>.localhost:1355` になります。

**正常起動**:

URL をユーザーに案内する:
- アクセス先: `https://<appname>.localhost`
- ログ: `~/.claude/tmp/<appname>-dev.log`

## ログの確認

何か問題が起きたときや動作確認したいときのみ、ログを Read で読む。
コンテキスト節約のため Read の `limit` パラメータで末尾100行程度に絞る。

## Gotchas

- **`portless proxy status` は存在しない**: プロキシ状態を事前確認するコマンドはない。起動を試みてログで判定する
- **初回起動は sudo が必要**: TTY なしでは `sudo` が通らないためClaude は代わりに起動できない。ユーザーに案内する
- **`run_in_background` でプロセスが即終了 = 失敗**: 正常起動時は長時間動き続ける。即完了通知が来たらエラーと判断してログを確認する
- **ログファイルは `>>` で追記**: 再起動時に前回のログが残る。古いエラーと混同しないよう末尾を見る
- **同一アプリの複数ワークスペース同時起動**: `package.json` の name をそのまま使うとホスト名が衝突する。ブックマーク名・ワークスペース名を含めたカスタム名（例: `ms-holdings-issue-006`）を使うこと
- **「ホスト名固定 env」を使う認証ライブラリ（BetterAuth 等）が portless ホスト名と不一致で Invalid origin になる**: portless のホスト名はワークスペース/ブックマークで変わるが、認証ライブラリ側は `BETTER_AUTH_URL=https://ms-holdings.localhost` のように env で固定するパターンが多い。dev サーバーログに `Invalid origin: https://ms-holdings-iori-b747.localhost` が出ていたら env と portless ホスト名のミスマッチ。対処の選択肢: (1) ワークスペースごとに `.env.local` の URL を書き換える（毎回必要）、(2) ライブラリの trustedOrigins 設定を関数化して Origin ヘッダーから動的に許可する（要ライブラリ調査）、(3) portless に固定名で起動して env を 1 つに保つ（ただし複数ワークスペース同時起動はできない）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
