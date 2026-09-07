# Cloudflare CLI（cf）リファレンス

> **TL;DR**: Cloudflare の操作は wrangler でなく `cf` を使う。結果は JSON で読み、送る前に `--dry-run` で確かめる。`--force` はユーザーの確認なしに付けない。シークレットの登録とログの tail だけは wrangler で補う。ベータなので、コマンドは記憶で組まず、`cf cli search` と公式ドキュメントで確かめてから打つ。

2026-09-28 にベータ公開（[Changelog](https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/)）。以下は 2026-09-30 に公式ドキュメント（[エージェント向けの使い方](https://developers.cloudflare.com/cf/agents/)・[wrangler からの対応表](https://developers.cloudflare.com/cf/wrangler/reference/)）で確認した内容。**安定版までにコマンド・設定・ビルド出力が変わりうる**と明記されているので、食い違ったらドキュメントを正とする。

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
| `wrangler d1 execute --local` | `cf d1 raw`（ローカル） |
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
