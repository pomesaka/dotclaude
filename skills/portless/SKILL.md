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

スキル引数（例: `/portless acme`）があればそれを使う。なければ会話のコンテキストから判断する。
パスは `<reporoot>/apps/<appname>` 形式。

**ホスト名の一意性**: 同じプロジェクトを複数の jj ワークスペース（worktree）や異なるブックマークから同時に起動する場合、`package.json` の name をそのまま使うとホスト名が衝突する。その場合は `portless <name> <cmd>` 構文でブックマーク名やワークスペース名を含めた一意な名前を使うこと。

例を挙げる。
- ブックマーク `issue-006` で作業中 → `acme-issue-006`
- ワークスペース名 `iori-4343` → `acme-iori-4343`

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
ログは `>>` で追記され、再起動の前のエラーも残るので、Read の `offset` と `limit` で末尾100行程度を読む。

## Gotchas

- **`portless proxy status` は存在しない**: プロキシ状態を事前確認するコマンドはない。起動を試みてログで判定する
- **初回起動は sudo が必要**: TTY なしでは `sudo` が通らないためClaude は代わりに起動できない。ユーザーに案内する
- **通常起動のホスト名は、アプリの`package.json`の`name`で決まる**: ワークスペースのディレクトリ名ではないので、ワークスペース名を付けたホスト名は404になる（`"name": "acme"`なら`acme.localhost`）。ワークスペース名やブックマーク名が付くのは、`portless <custom-name> <cmd>`で起動したときだけだ。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **ホスト名をenvで固定する認証ライブラリ（BetterAuthなど）は、portlessのホスト名と食い違うと`Invalid origin`になる**: devサーバーのログに`Invalid origin: https://<起動したホスト名>`が出たら、`BETTER_AUTH_URL`などのenvと、起動したホスト名が違う。直し方は3つある。ワークスペースごとに`.env.local`のURLを書き換える。ライブラリのtrustedOriginsを、Originヘッダーから決める関数にする（ライブラリの調査が要る）。固定の名前で起動してenvを1つに保つ（複数のワークスペースを同時には起動できない）。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **`next dev --port N`のようにポートを固定したdevコマンドは、502になる**: portlessは`PORT`の環境変数でポートを割り当ててからdevのプロセスを起動する。`--port`を固定すると`PORT`が無視され、portlessは誰も待ち受けていないポートへ転送する。`package.json`の`dev`から`--port`を外す。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- 起動した画面をPlaywrightなどの一時スクリプトで確かめるときは、`~/.claude/docs/bash-tips.md`の「一時スクリプトは、ワークスペースのルートで走らせない」を読む。
