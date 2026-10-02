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

例を挙げる。
- ブックマーク `issue-006` で作業中 → `ms-holdings-issue-006`
- ワークスペース名 `iori-4343` → `ms-holdings-iori-4343`

カスタム名を指定したい場合は `portless <name> <cmd>` 構文を使う（後述）。

### 2. バックグラウンドで起動

`run_in_background: true` で起動してコンテキストを守る。

**通常起動（package.json の name を使用）**
```bash
mise exec --cd /path/to/apps/<appname> -- portless >> ~/.claude/tmp/<appname>-dev.log 2>&1
```

**カスタム名で起動（`portless <name> <cmd>` 構文）**
```bash
mise exec --cd /path/to/apps/<appname> -- portless <custom-name> bun run dev >> ~/.claude/tmp/<custom-name>-dev.log 2>&1
```

- `<cmd>` はスペース区切りでそのまま渡す（`"bun run dev"` のようにクォートしない）
- 起動後の URL は `https://<custom-name>.localhost` になる

### 3. 数秒後にログを確認

起動結果を確認するためにバックグラウンドタスク完了通知を待つ（すぐに完了 = 失敗、長時間起動中 = 成功）。
失敗した場合はログファイルを Read して原因を確認する。

```
Read ~/.claude/tmp/<appname>-dev.log
```

### 4. ログに応じた対応

**プロキシ未起動（`Proxy is not running` が含まれる場合）**

> portless proxy がまだ起動していません。ターミナルで以下を実行してください。
> ```
> sudo portless proxy start --https
> ```
> 完了後にもう一度 `/portless` を呼んでください。

ポートを使いたくない場合の代替は次のとおり。
> ```
> mise exec --cd apps/<appname> -- portless proxy start --port 1355 --https
> ```
> この場合 URL は `https://<appname>.localhost:1355` になります。

**正常起動**

URL をユーザーに案内する。
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
- **portless のホスト名は `apps/<customer>/package.json` の `name` フィールドから決まる。ワークスペースディレクトリ名ではない**: `adachi-anna-8b5d.localhost` のようにワークスペース名を使うと 404 になる。正しいホスト名は `apps/<customer>/package.json` の `"name"` を確認する（例: `"name": "adachi"` → `adachi.localhost`）。`.env.local` の `BETTER_AUTH_URL` 等も同じ名前で設定する。CLAUDE.md の「jj ワークスペースではブランチ名がサブドメインに付く」はカスタム名起動時の話（`portless <custom-name> bun run dev`）で、通常起動では package.json name そのもの。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **Playwright 等の一時スクリプトをワークスペースルートから `bun run` すると `bun add` が走り package.json を汚染する**: `bun run /path/to/script.mjs`（外部 ESM ファイル）をワークスペースルートで実行すると、スクリプト内の `import { chromium } from "playwright"` が解決できず bun が自動で `bun add playwright` を走らせる（または手動実行が必要になる）。毎回 `bun remove playwright` → `jj restore package.json` の手戻りが発生する。対処: 一時スクリプトは scratchpad（`/tmp` 等）に置き、`bun` に直接実行させる（`bun /path/to/script.mjs`）か、Node.js 互換の `node /path/to/script.mjs`（playwright は npx でインストール済みの場合）で走らせる。どうしても bun を使う場合は scratchpad に `package.json`（`{"name":"tmp","type":"module"}`）と `bun add playwright` を行い、ワークスペースルートには触れない。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`next dev --port N` は portless の `PORT` 環境変数を上書きして 502 を引き起こす**: portless は `PORT` env で動的にポートを割り当ててから dev プロセスを起動する。`package.json` の `"dev": "next dev --port 3001"` のように `--port` を固定すると `PORT` が無視され、portless はポートに何もいない状態で転送して 502 になる。対処: `--port` フラグを除去して `next dev`（引数なし）にする。ms-holdings など既存アプリも同じ形式になっているので揃えることで問題が起きない。実例: adachi ブランチが `--port 3001` を付けていたため portless が 502 を返し続けた（`PORT=4368` で転送されたが Next.js は 3001 で待ち受け）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
