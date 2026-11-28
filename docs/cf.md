# Cloudflare CLI（cf）リファレンス

> **TL;DR**: Cloudflare CLI（`cf`）のベータ版で実際に確かめた挙動と罠。使う方針は `CLAUDE.md` の「Claude Codeで使う道具」にある。ベータなので、コマンドは記憶で組まず、`cf cli search` と公式ドキュメントで確かめてから打つ。

整理する前の版は `archive/2026-11-16/docs/cf.md` に、調べた経緯の細部は [archive/cf-2026-11-28.md](archive/cf-2026-11-28.md) にある。

2026-09-28 にベータ公開（[Changelog](https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/)）。以下は 2026-09-30 に公式ドキュメント（[エージェント向けの使い方](https://developers.cloudflare.com/cf/agents/)・[wrangler からの対応表](https://developers.cloudflare.com/cf/wrangler/reference/)）で確認した内容。安定版までにコマンド・設定・ビルド出力が変わりうると明記されているので、食い違ったらドキュメントを正とする。

## 基本

- 端末でないときは出力が JSON だけになる。そのまま `jq` で読める
- プロジェクトの設定ファイルは `cloudflare.config.ts`（型が付く）。`wrangler.jsonc` からは `cf migrate` で変換できる。変換しなくても、既存の wrangler のプロジェクトで `cf` のリソース操作は使える
- 環境の切り替えは `--env` でなく `--mode`
- バージョンはプロジェクトで固定する（ベータのため）。上げるときは意図して上げる

## コマンドを探す・確かめる

```bash
cf cli search "D1 のマイグレーションを適用する"   # やりたいことからコマンドを探す
cf schema <command>                              # そのコマンドが送る API リクエストの形（JSON）
cf <command> --dry-run                           # 送るリクエストを表示するだけ。認証も要らない
```

## 破壊的な操作

- 削除などの破壊的なコマンドは、端末以外では `--force` が無いと `Aborted.` を出して止まる
- `--force` は利用者に確かめてから付ける。コマンドによっては `--force` が API のパラメータでもあり、「確認を飛ばす」以外の意味を持つ。付ける前に `--dry-run` か `cf schema` で中身を見る
- `--local` を付けると、ローカルの開発用データだけを操作し、API を呼ばない

## wrangler との対応

| wrangler | cf |
|---|---|
| `wrangler dev` | `cf dev` |
| `wrangler deploy` | `cf deploy` |
| `wrangler d1 migrations apply` | `cf d1 migrations apply`（`--dir`・`--pattern`・`--table` はコマンドで渡す。設定ファイルには書かない） |
| `wrangler d1 execute --local` | `cf d1 raw --local --persist-to <置き場所> <D1 の ID> --sql "..."`（`--batch` は結果を出しても終了しないことがあった。下の「ローカル開発」） |
| `wrangler d1 execute --remote` | `cf d1 query`（リモートのリソースだけ） |
| `wrangler types` | `cf workers types`（`cloudflare.config.ts` のプロジェクト。Vite のビルドと dev でも自動で書かれる） |
| `--env <名前>` | `--mode <名前>` |

## cf でまだできないこと（wrangler で補う）

| やりたいこと | 代わり |
|---|---|
| シークレットの登録 | `cf deploy --secrets-file <パス>` で渡すか、`npx wrangler secret put <名前> --name <Worker 名>` |
| ログのリアルタイム表示 | `npx wrangler tail <Worker 名>` |
| Worker に付いている Cron の一覧を読む | 見つからなかった（`cf cli search` で 3 通り探した。1.0.0-beta.5・2026-10-14）。ダッシュボードの Worker の Settings → Triggers で見る |

- **Cron が付いているのに動かないときは、まず Cloudflare の障害を見る**: `curl -sS https://www.cloudflarestatus.com/api/v2/incidents.json | jq '.incidents[] | select(.name | test("Cron"))'`。作成、変更した Cron だけが動かず、前からある Cron は動く障害が 2026-10 に 3 回あった。動いたかは、下の `cf observability telemetry query` で `$workers.event.cron` ごとに数えると分かる

- **過去の Worker のログは `cf observability telemetry query --body '<JSON>'` で読める**（Workers Logs が有効な Worker）。フラグでは絞り込みを書けないので `--body` で渡す。例: `{"queryId":"adhoc-任意","timeframe":{"from":<ミリ秒>,"to":<ミリ秒>},"view":"events","limit":50,"parameters":{"filters":[{"key":"$metadata.service","operation":"eq","type":"string","value":"<Worker 名>"},{"key":"$workers.eventType","operation":"neq","type":"string","value":"fetch"}]}}`。結果は `.events.events[]` の `$metadata.message`・`$metadata.error`・`$workers.eventType`（fetch・scheduled・queue）・`$workers.event`（Cron の式など）。共有アカウントでは、ほかのアプリのログを読まないよう、`$metadata.service` で絞る（2026-10-14 確認）
- **wrangler の OAuth と cf の OAuth は別**: wrangler が別のアカウントにログインしていても、`cf auth whoami` で目的のアカウントと `workers_observability:read`・`d1:write` などの scope が見えれば、`cf` からは読める。`cf d1 query` が `7403 The given account is not valid or is not authorized` を返したあと、同じログインのまま通ったことがある（原因は未確認・2026-10-14）

## 罠

- **`cf builds` のコマンドは `--account-id` を受け付けない**: `cf builds workers get <Worker>` は `Unknown arguments: account-id` で止まる。アカウントは環境変数 `CLOUDFLARE_ACCOUNT_ID` で渡す。OAuth のログイン（`~/Library/Preferences/cloudflare/config/default.json`、1 つだけ）に入っていないアカウントは `[10000] Authentication error`（403）になる。`cf auth whoami` の `accounts` に目的のアカウントがあるかを先に見る（cf 1.0.0-rc.1 を `bunx cf@1.0.0-rc.1` で実行、2026-11-28）
- **Workers Builds の Preview の URL は既定で公開される**: production 以外のブランチへの push ごとに、Preview のビルドが走る（Settings > Build > Branch control の **Enable Preview Builds**）。サインインを求めるには Cloudflare Access をかける（[Previews](https://developers.cloudflare.com/workers/previews/)、[Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、2026-11-28 に読んだ）

- **`cf dev` と `cf deploy` は、中で Vite や wrangler に処理を任せている**。ビルドまわりの不具合は `cf` ではなく Vite・wrangler 側の設定を疑う
- **`cf d1 list` のような API のコマンドは、設定ファイルから `accountId` と `complianceRegion` しか読まない**。`--mode` ごとのバインディングは効かないので、どのリソースを操作しているかは出力で確かめる
- **`cloudflare.config.ts` のビルド出力は `.cloudflare/output/v0/`**: `wrangler.json` は出ない。Worker の設定は `workers/default/worker.config.json`（name・compatibilityDate・compatibilityFlags・observability・`manifest.mainModule`）、本体は `workers/default/bundle/`（cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta で確認・2026-09-30）
- **ドキュメントの `import cloudflare from "@cloudflare/vite-plugin"`（default import）は動かない**: 2.0.0-beta.sha-ad79608dd の export は名前付きの `cloudflare` だけ（2026-09-30 確認）
- **`Env` の型は `cf workers types` が `.cloudflare/types/index.d.ts` に書く**（認証不要）。tsconfig の `types` に相対パスで書いても読まれなかった（TypeScript 7.0.2）。`include` に直接足す。また、この型ファイルは `cloudflare.config.ts` 経由で Worker のコードを import するので、`Env` の無い tsconfig（vite.config.ts 用など）に `cloudflare.config.ts` を入れると型エラーになる
- **Cloudflare 公式のプラグイン（`cloudflare/skills`）のスキルは wrangler を使うよう誘導する**（2026-09-30 時点。`cf` のスキルは無い）。入れている場合も、CLI の操作はこのドキュメントに従う

## ローカル開発（`cf dev`・`--local`）

以下は 2026-10-02 に cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta.sha-ad79608dd で確かめた内容。

- **`cf dev` の中身は Vite プラグインの開発サーバー（`cf-vite dev`）**。`cloudflare.config.ts` の `env` に書いたバインディング（D1 など）がローカルで立つ
- **ローカルのデータの置き場所が `cf dev` と他のコマンドで違う**: `cf dev`（Vite プラグイン）は `<プロジェクト>/.cloudflare/state/v3`、`cf d1 raw --local` などの既定は `~/.config/cloudflare/state`。同じ D1 を見るには `--persist-to .cloudflare/state` を付ける（`v3` は cf が足す）
- **ローカルの D1 のファイル名は、バインディングの ID から決まる**（`.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/<ハッシュ>.sqlite`）。別のプロセス（seed など）と同じ DB を開くなら、`bindings.d1({ name, id })` で ID を固定し、両方で同じ ID を使う
- **`--local` のコマンドが結果を出したあと終了しないときは、`cloudflare.config.ts` の無いディレクトリから実行する**（`cf d1 raw`・`cf d1 migrations apply` で確認）。cf の中の miniflare（5 の alpha）が、ローカル開発用の登録簿（macOS では `~/Library/Preferences/cloudflare/registry`）のファイル監視を閉じないためだ。`--local` の無いリモートの操作は miniflare を起動しないので、CI からリモートの D1 に当てる操作では起きない。`cf dev` を動かしている間に `cf d1 raw --local` が返ってこないこともあった（同じ原因かは未確認）
- **`cloudflare.config.ts` を変えたら、ビルドだけでなく開発サーバーも立ち上げ直して確かめる**。次の 2 つは、起動し直すまで気づけなかった（どちらも cf 1.0.0-beta.5・`@cloudflare/vite-plugin` 2.0.0-beta）
  - `cf dev` を動かしたまま設定ファイルを変えると、Vite が自分で再起動したあと（`[vite] Internal server error: fetch failed` → `server restarted.`）、ブラウザからの `node_modules/.vite/deps/*` の取得が返ってこなくなることがあった。curl での API と HTML は 200 を返し、画面だけが白いまま読み込み続ける。`cf dev` を止めて起動し直すと直る（2026-10-06 に 1 回確認）
  - 設定ファイルから、Worker も読む `src` のファイルを値として import すると、`cf dev` が `Failed to load url /src/... Does the file exist?` で落ちる（Worker の側で同じファイルを読めなくなる）。`vite build` は通る。型だけの import（`import type`）と、`with { type: "cf-worker" }` の entrypoint は問題ない。設定ファイルと Worker の両方で使う定数（Cron の式など）は、設定ファイルには文字列で書き、Worker の側の定数と同じであることをテストで固定する（設定ファイルを文字列として読んで、定数が含まれるかを見る）（2026-10-07）
- **`cf dev` で Cron を手で発火させるには、Local Explorer の API を使う**: `curl -X POST -H 'content-type: application/json' -d '{"cron":"*/10 * * * *"}' '<dev の URL>/cdn-cgi/local/explorer/api/local/scheduled?worker=<Worker の名前>'`。`triggers` に入れていない式でも、`scheduled` にその式が渡って動く（2026-10-09）。`/__scheduled` と `/cdn-cgi/handler/scheduled` は、どちらも静的アセットの SPA の HTML を返す（2026-10-06）。API の一覧は `cf dev` の起動時のログに出る
- **アプリと同じバインディングを外のスクリプト（seed など）から使う手段（wrangler の `getPlatformProxy` に当たるもの）は、`cf`・Vite プラグイン・`@cloudflare/config` のどれにも無い**。ローカルの D1 に書くスクリプトは、miniflare 4（安定版）を直接使う: `new Miniflare({ modules: true, script: "export default {}", d1Databases: { DB: <固定した ID> }, d1Persist: ".cloudflare/state/v3/d1" })` → `await mf.getD1Database("DB")` → 終わったら `await mf.dispose()`。`cf dev` を動かしたままでも書き込め、次のリクエストから見える
- **miniflare 5（alpha）はオプションの形が変わっていて、スクリプトから使いにくい**（`workers: [{ config: <cloudflare.config の形>, dev: {...} }]`）。スクリプトでは miniflare 4 を使う
- **`cf` は環境変数 `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を読む**。CI では設定ファイルが無くても、これでリモートのリソースを操作できる。`CLOUDFLARE_API_TOKEN` は、`cf auth login`（ブラウザで承認する）で保存したログインより優先される
- **`cf d1 migrations apply` は、端末でないとき確認の質問に自動で「yes」と答える**（`Using fallback value in non-interactive context: yes`）。マイグレーションのファイルは既定で `<dir>/*.sql`（drizzle-kit の平らな出力そのまま）。drizzle の入れ子の形なら `--pattern "<dir>/*/migration.sql"`。適用済みの記録は `--table`（既定 `d1_migrations`）
- **D1 の `batch()` は 1 つのトランザクション**: ローカル（miniflare）の D1 で、複数文の batch の途中が失敗すると、それより前の文も含めて丸ごと巻き戻る。リモートの D1 でも、`cf d1 migrations apply`（1.0.0-beta.5）は途中で失敗したマイグレーション 1 ファイルを丸ごと巻き戻し（`DROP TABLE` した表も残る）、`d1_migrations` にも記録しない
- **`cf` がプロジェクトの devDependency にしか無いときは、PATH に無い**。`bun run --cwd <cf の入ったアプリ> cf ...` で動かす（ある案件で確認、2026-10-20）
- **`cf d1 list` に `--json` は無い**（引数のエラーになる。1.0.0-beta.5）。`cf d1 query` は、何もしなくても JSON で返す
- **`cf d1 query <ID> --sql "文1; 文2; …"` は複数の文を 1 回で流せる**。結果は文ごとの配列で返る。DROP TABLE 20 文を 1 回で流して全部通った（2026-10-20、sandbox の D1）。途中で失敗したときに前の文まで巻き戻るかは試していない

## Access（Zero Trust）のアプリを手で設定する

Self-hosted application を手で設定したときに見落とした点（2026-09-18 に確認）。

- **AUD Tag と Application ID を取り違えない**。Overview に似た形の値が 2 つ並ぶ。AUD Tag（JWT の検証に使う）は 64 桁の 16 進数でハイフンが無く、Application ID は 8-4-4-4-12 の UUID だ。Application ID を AUD に入れると、検証のコードが全リクエストに 401 "invalid access token" を返し、設定の漏れ（503）に見えないので気づきにくい
- **ポリシーが 0 件だと誰も通れない**。Access は deny-by-default で、Allow に当たらない人は拒否される。認可を DB だけで管理する設計でも、Access に `Allow` + Include `Everyone` のポリシーが 1 つ要る（Access は本人確認だけを受け持つ）
- **Path のワイルドカードは親のパスを含まない**。`/admin/*` は `/admin` を含まない。ワイルドカードの無いパスが前方一致になるかは公式に書かれていないので、`/admin` と `/admin/*` の両方を登録する
- **One-time PIN は新しい組織の既定に入っていない**。既定の Cloudflare identity provider は Cloudflare のアカウントを持つ人しかログインできない。外部の利用者に使わせるなら、Identity providers に OTP を足す
- **Access の後ろの API を手元から叩くには、`cloudflared access login <URL>` と `cloudflared access curl <URL>` を使う**（cloudflared 2026.5.0、2026-11 に確認）。`login` はブラウザで SSO を通し、トークンを手元に保存する。`curl` はそのトークンを付けて叩き、Worker には画面と同じ `Cf-Access-Jwt-Assertion` が届くので、サービストークンや Access の例外を足さずに本人として呼べる。`login` はトークンを標準出力に出すので、エージェントの会話の中で実行すると会話の記録に残る。`cf` に同じ機能があるかは確かめていない
- **外のクライアント（リモートの MCP など）に OAuth が要るなら、Access の Managed OAuth が認可サーバーを肩代わりできる**（Cloudflare One docs、2026-11 に確認）。動的なクライアント登録（DCR）と RFC 8414/9728 の discovery に対応し、クライアントには RFC 8707 の resource indicator が要る。PKCE S256 と protected resource metadata の扱いは文書に明記が無く、未検証

## API トークンの Workers の権限とプラン

Pulumi（`@pulumi/cloudflare`）で Worker を作ろうとして 403 が返ったときの調査（2026-09-25）。

- **新しい権限体系（2026-09-15 GA）の Editor では、Worker を作れない**。Editor は既存の Worker の読み取り、更新、デプロイ、名前の変更まででき、作成と削除はできない（[Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)）。Worker ごとの権限は、まだ無い Worker には付けられない。初回の作成は product の Admin か、legacy の Workers Scripts: Edit で行い、できた後でその Worker だけの Editor に絞り直す。症状は `403 { "message": "No access to the specified resource." }` だけで、足りない権限は各 API の "Accepted Permissions" を見ないと分からない
- **権限の変更は、反映まで数分かかることがある**。legacy の Workers Scripts Write を足してから約 5 分後に通った。数分待っても直らないときだけ、権限の付け先（Account と Zone のどちらの塊か）を疑う
- **任意の宛先へメールを送るには Workers Paid が要る**。Workers Free では、`send_email` で送れるのは検証済みの宛先だけで、Email Service の API が `403 Unauthorized`（code 2036）を返し、権限の問題と見分けにくい（[Pricing](https://developers.cloudflare.com/email-service/platform/pricing/)）。Free は、1 リクエストの CPU 時間が 10ms、外部の呼び出しが 50 回までで、署名や JWT の検証、外部 API を呼ぶアプリは収まらないことがある（[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)）
