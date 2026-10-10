# Cloudflare CLI（cf）リファレンス

> **TL;DR**: Cloudflare の操作は wrangler でなく `cf` を使う。結果は JSON で読み、送る前に `--dry-run` で確かめる。`--force` はユーザーの確認なしに付けない。シークレットの登録とログの tail だけは wrangler で補う。ベータなので、コマンドは記憶で組まず、`cf cli search` と公式ドキュメントで確かめてから打つ。

2026-09-28 にベータ公開（[Changelog](https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/)）。以下は 2026-09-30 に公式ドキュメント（[エージェント向けの使い方](https://developers.cloudflare.com/cf/agents/)・[wrangler からの対応表](https://developers.cloudflare.com/cf/wrangler/reference/)）で確認した内容。安定版までにコマンド・設定・ビルド出力が変わりうると明記されているので、食い違ったらドキュメントを正とする。

## 基本

- Cloudflare API のほぼ全体（約 3,000 操作）を扱う。wrangler は約 280
- 端末でないときは出力が JSON だけになる。エージェントからはそのまま `jq` で読める
- プロジェクトの設定ファイルは `cloudflare.config.ts`（型が付く）。`wrangler.jsonc` からは `cf migrate` で変換できる。変換しなくても、既存の wrangler のプロジェクトで `cf` のリソース操作は使える
- 環境の切り替えは `--env` でなく `--mode`
- バージョンはプロジェクトで固定する（ベータのため）。上げるときは意図して上げる

## コマンドを探す・確かめる

```bash
cf cli search "D1 のマイグレーションを適用する"   # やりたいことからコマンドを探す
cf schema <command>                              # そのコマンドが送る API リクエストの形（JSON）
cf <command> --dry-run                           # 送るリクエストを表示するだけ。認証も要らない
```

## 認証

- 人がいるとき: `cf auth login`（ブラウザで承認する）
- 自動で動かすとき（CI・エージェント）: 環境変数 `CLOUDFLARE_API_TOKEN`。保存済みのログインより優先される

## 破壊的な操作

- 削除などの破壊的なコマンドは、端末以外では `--force` が無いと `Aborted.` を出して止まる
- **`--force` はユーザーの確認なしに付けない**。コマンドによっては `--force` が API のパラメータでもあり、「確認を飛ばす」以外の意味を持つ。付ける前に `--dry-run` か `cf schema` で中身を見る
- `--local` を付けると、ローカルの開発用データだけを操作し、API を呼ばない

## wrangler との対応

| wrangler | cf |
|---|---|
| `wrangler dev` | `cf dev` |
| `wrangler deploy` | `cf deploy` |
| `wrangler d1 migrations apply` | `cf d1 migrations apply`（`--dir`・`--pattern`・`--table` はコマンドで渡す。設定ファイルには書かない） |
| `wrangler d1 execute --local` | `cf d1 raw --local --persist-to <置き場所> <D1 の ID> --sql "..."`（`--batch` は結果を出しても終了しないことがあった。下の「ローカル開発」） |
| `wrangler d1 execute --remote` | `cf d1 query`（リモートの資源だけ） |
| `wrangler types` | `cf workers types`（`cloudflare.config.ts` のプロジェクト。Vite のビルドと dev でも自動で書かれる） |
| `--env <名前>` | `--mode <名前>` |

## cf でまだできないこと（wrangler で補う）

| やりたいこと | 代わり |
|---|---|
| シークレットの登録 | `cf deploy --secrets-file <パス>` で渡すか、`npx wrangler secret put <名前> --name <Worker 名>` |
| ログのリアルタイム表示 | `npx wrangler tail <Worker 名>` |

## 罠

- **`cf dev` と `cf deploy` は、中で Vite や wrangler に処理を任せている**。ビルドまわりの不具合は `cf` ではなく Vite・wrangler 側の設定を疑う
- **`cf d1 list` のような API のコマンドは、設定ファイルから `accountId` と `complianceRegion` しか読まない**。`--mode` ごとのバインディングは効かないので、どの資源を操作しているかは出力で確かめる
- **`cloudflare.config.ts` のビルド出力は `.cloudflare/output/v0/`**: `wrangler.json` は出ない。Worker の設定は `workers/default/worker.config.json`（name・compatibilityDate・compatibilityFlags・observability・`manifest.mainModule`）、本体は `workers/default/bundle/`（cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta で確認・2026-09-30）
- **ドキュメントの `import cloudflare from "@cloudflare/vite-plugin"`（default import）は動かない**: 2.0.0-beta.sha-ad79608dd の export は名前付きの `cloudflare` だけ（2026-09-30 確認）
- **`Env` の型は `cf workers types` が `.cloudflare/types/index.d.ts` に書く**（認証不要）。tsconfig の `types` に相対パスで書いても読まれなかった（TypeScript 7.0.2）。`include` に直接足す。また、この型ファイルは `cloudflare.config.ts` 経由で Worker のコードを import するので、`Env` の無い tsconfig（vite.config.ts 用など）に `cloudflare.config.ts` を入れると型エラーになる
- **Cloudflare 公式のプラグイン（`cloudflare/skills`）のスキルは wrangler を使うよう誘導する**（2026-09-30 時点。`cf` のスキルは無い）。入れている場合も、CLI の操作はこのドキュメントに従う

## ローカル開発（`cf dev`・`--local`）

以下は 2026-10-02 に cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta.sha-ad79608dd で確かめた内容。

- **`cf dev` の中身は Vite プラグインの開発サーバー（`cf-vite dev`）**。`cloudflare.config.ts` の `env` に書いたバインディング（D1 など）がローカルで立つ
- **ローカルのデータの置き場所が `cf dev` と他のコマンドで違う**: `cf dev`（Vite プラグイン）は `<プロジェクト>/.cloudflare/state/v3`、`cf d1 raw --local` などの既定は `~/.config/cloudflare/state`。同じ D1 を見るには `--persist-to .cloudflare/state` を付ける（`v3` は cf が足す）
- **ローカルの D1 のファイル名は、バインディングの ID から決まる**（`.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/<ハッシュ>.sqlite`）。別のプロセス（seed など）と同じ DB を開くなら、`bindings.d1({ name, id })` で ID を固定し、両方で同じ ID を使う
- **`--local` のコマンドは、`cloudflare.config.ts` のあるディレクトリで実行すると終了しないことがある**（`cf d1 raw`・`cf d1 migrations apply` で確認）。結果を出したあと止まる。原因は cf の中の miniflare（5.20260926.0-alpha）が、ローカル開発用の登録簿（macOS では `~/Library/Preferences/cloudflare/registry`）のファイル監視を始め、終わっても閉じないこと（`fs.watch` の呼び出し履歴で確認）。設定ファイルの無いディレクトリから実行すると 2 秒で終わる。`--local` の無いリモートの操作は miniflare を起動しないので、この問題は無い（CI から `cf d1 migrations apply <ID> --dir <パス>` をリモートの D1 に当て、3 秒で終了したことを確認・2026-10-02）
- **`cf dev` を動かしたまま `cloudflare.config.ts` を変えると、Vite が自分で再起動したあと、ブラウザからの `node_modules/.vite/deps/*` の取得が返ってこなくなることがあった**（`[vite] Internal server error: fetch failed` → `server restarted.` のあと。curl での API と HTML は 200 を返すので気づきにくく、画面だけが白いまま読み込み続ける）。`cf dev` を止めて起動し直すと直る（cf 1.0.0-beta.5・@cloudflare/vite-plugin 2.0.0-beta で 2026-10-06 に 1 回確認）。`cloudflare.config.ts` を変えたら、起動し直してから画面を確かめる
- **`cloudflare.config.ts` から、Worker も読む `src` のファイルを値として import すると、`cf dev` が起動しない**: 設定ファイルと Worker の両方で使う定数（Cron の式など）を 1 つのファイルに置いて両方から読むと、`cf dev` が `Failed to load url /src/... Does the file exist?` で落ちる（Worker の側で同じファイルを読めなくなる）。`vite build` は通るので、開発サーバーを立ち上げ直すまで気づかない。型だけの import（`import type`）と、`with { type: "cf-worker" }` の entrypoint は問題ない。対処: 設定ファイルには文字列で書き、Worker の側の定数と同じであることをテストで固定する（設定ファイルを文字列として読んで、定数が含まれるかを見る）。cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta で確認（2026-10-07）。**設定ファイルを変えたら、ビルドだけでなく開発サーバーも立ち上げ直して確かめる**
- **`cf dev` で Cron を手で発火させるには、Local Explorer の API を使う**: `curl -X POST -H 'content-type: application/json' -d '{"cron":"*/10 * * * *"}' '<dev の URL>/cdn-cgi/local/explorer/api/local/scheduled?worker=<Worker の名前>'`。`triggers` に入れていない式でも、`scheduled` にその式が渡って動く（2026-10-09）。`/__scheduled` と `/cdn-cgi/handler/scheduled` は、どちらも静的アセットの SPA の HTML を返す（2026-10-06）。API の一覧は `cf dev` の起動時のログに出る
- **`cf dev` を動かしている間は、`cf d1 raw --local` が返ってこないことがあった**。上の問題と同じ原因かは未確認
- **アプリと同じバインディングを外のスクリプト（seed など）から使う手段（wrangler の `getPlatformProxy` に当たるもの）は、`cf`・Vite プラグイン・`@cloudflare/config` のどれにも無い**。ローカルの D1 に書くスクリプトは、miniflare 4（安定版）を直接使う: `new Miniflare({ modules: true, script: "export default {}", d1Databases: { DB: <固定した ID> }, d1Persist: ".cloudflare/state/v3/d1" })` → `await mf.getD1Database("DB")` → 終わったら `await mf.dispose()`。`cf dev` を動かしたままでも書き込め、次のリクエストから見える
- **miniflare 5（alpha）はオプションの形が変わっていて、スクリプトから使いにくい**（`workers: [{ config: <cloudflare.config の形>, dev: {...} }]`）。スクリプトでは miniflare 4 を使う
- **`cf` は環境変数 `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を読む**。CI では設定ファイルが無くても、これでリモートの資源を操作できる
- **`cf d1 migrations apply` は、端末でないとき確認の質問に自動で「yes」と答える**（`Using fallback value in non-interactive context: yes`）。マイグレーションのファイルは既定で `<dir>/*.sql`（drizzle-kit の平らな出力そのまま）。drizzle の入れ子の形なら `--pattern "<dir>/*/migration.sql"`。適用済みの記録は `--table`（既定 `d1_migrations`）
- **D1 の `batch()` は 1 つのトランザクション**: miniflare の D1（ローカル）で、複数文の batch の途中（既存行が新しい NOT NULL 列に引っかかる等）が失敗すると、それより前の文も含めて丸ごと巻き戻り、表も行も変更前のまま残ることを確認した（2026-10-02）。`cf d1 migrations apply` がリモートの D1 でも同じ単位でまとめて当てるかは未確認（マイグレーション 1 ファイルを 1 batch として送っているか、1 文ずつ送っているかを cf のソースか実機で確かめてから断定する）
