# GitHub Actions パターン集

> **TL;DR**: noah CI/CD の GitHub Actions パターン集。matrix + reusable workflow で multi-client を scalable に管理。`config-map` で CI 実行時の config をインライン渡し。Gotchas: boolean を matrix に入れない・`secrets: inherit` は caller の permissions が適用される・Lambda コンテナは `provenance: false` 必須・shared action を直しても既存 workflow は自動再起動しない・CI が `GITHUB_TOKEN` で push した git イベント（tag/コミット）は下流 workflow を起動しない（連結は 1 workflow 統合 or PAT）。

## matrix strategy × reusable workflow（scalable multi-client 構成）

多クライアント・多スタックを管理する場合、ジョブを手書きで並べるのではなく `strategy.matrix.include` でエントリーを管理すると scalable になる。

```yaml
jobs:
  client:
    needs: [shared, registry]
    strategy:
      matrix:
        include:
          - stack-name: organization/noah-ms-holdings/dev
            work-dir: infra/ms-holdings
          # ← 新規クライアント追加はここに2行追加するだけ
    uses: ./.github/workflows/_pulumi-deploy.yml
    secrets: inherit
    with:
      stack-name: ${{ matrix.stack-name }}
      work-dir: ${{ matrix.work-dir }}
      install-components: true   # ← boolean は matrix に入れず with に直接書く
```

**boolean 入力は matrix に入れない**: `matrix.install-components: true` を `${{ matrix.install-components }}` で参照すると文字列 `"true"` になり、`type: boolean` の reusable workflow 入力と型が合わない可能性がある。boolean フラグはマトリクス全体で共通なら `with:` に直書きする。異なる場合は `fromJSON(${{ matrix.flag }})` を使う。

## `pulumi/actions@v6` の `config-map` でインライン config 渡し

`pulumi config set` を別 step で実行しなくても、`pulumi/actions@v6` の `config-map` 入力でデプロイ時に config を上書きできる。

```yaml
- uses: pulumi/actions@v6
  with:
    command: up
    stack-name: ${{ inputs.stack-name }}
    work-dir: ${{ inputs.work-dir }}
    cloud-url: ${{ secrets.PULUMI_BACKEND_URL }}
    config-map: |
      imageTag:
        value: ${{ github.sha }}
        secret: false
```

- `secret: false` で非秘匿、`secret: true` で Pulumi secrets として扱われる
- ローカルの `Pulumi.<stack>.yaml` は変更されない（CI の ephemeral 実行に適している）

## Gotchas

- **`needs:` にマトリクスジョブを指定するとすべての variant を待つ**: `needs: [registry]` で `registry` がマトリクスジョブの場合、全バリアントの完了を待ってから次ジョブが起動する。これは通常望ましい挙動（全顧客の ECR が揃ってから ECS デプロイ開始）
- **reusable workflow の `pull-requests: write` は caller 側にも宣言が必要**: `_pulumi-preview.yml` 内部で `permissions: pull-requests: write` を持っていても、呼び出し元 workflow に `permissions:` ブロックがないとリポジトリデフォルト権限にフォールバックし PR コメントが書けない場合がある。`infra-preview.yml` 等の caller 側にも `pull-requests: write` を明示する
- **reusable workflow の `secrets: inherit` は caller 側の `permissions` が適用される**: secrets 自体は継承されるが、OIDC（`id-token: write`）は caller 側の `permissions` に宣言がないと token が発行されない。caller に `id-token: write` を必ず追加すること
- **composite action の `inputs.default:` で `${{ }}` 式は評価されない**: `default: ${{ github.sha }}` と書いても literal 文字列 `"${{ github.sha }}"` がタグになる。対処: `required: true` にして全呼び出し元で明示的に渡す（reusable workflow とは異なる制約）。dev/prod で異なる値を渡す場合（SHA vs version tag）は特に重要。
  <!-- importance: high | mentions: 2 | first-seen: 2026-05 -->
- **`echo "$SECRET" | gh secret set --body -` で trailing newline が入る**: `echo` は末尾に `\n` を付けるため、保存されたシークレットが `value\n` になりパスフレーズ等の完全一致チェックで不一致になる。正しくは `gh secret set KEY --body "value"` または `printf '%s' "$SECRET" | gh secret set KEY --body -` を使う。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`grep` で部分一致による誤検知**: git tag の存在確認で `git ls-remote --tags origin "$TAG" | grep -q "$TAG"` とすると、`v1.0` を検索して `v1.0.1` にも match する。対処: `grep -qF "refs/tags/$TAG"` で完全パス・固定文字列マッチにする。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **AWS Lambda コンテナ関数は docker buildx の provenance attestation を受け付けない**: `docker/build-push-action@v6` は push 時にデフォルトで provenance を付け、tag が OCI image index（manifest list）になる。Lambda は単一 manifest（Docker V2 schema2 / OCI 単体）しか pull できず、`CreateFunction`/`UpdateFunctionCode` が `The image manifest, config or layer media type ... is not supported` で 400 になる（ECR への push・ECS の pull は許容するので気づきにくい）。対処: build ステップに `provenance: false`（または env `BUILDX_NO_DEFAULT_ATTESTATIONS=1`）。根拠: AWS docs images-create「does not support multi-architecture container images」/ `aws/aws-lambda-roadmap#82`（Open・本エラー文言と一致）
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **共有 action / reusable workflow を直しても、それを使う workflow を自動起動しない**: `app-deploy-*.yml` の paths が `apps/<app>/**` のとき、`.github/actions/**` や reusable workflow を編集しても push トリガーにマッチせず再ビルドされない。さらに失敗 run の「Re-run jobs」は同じ commit SHAでやり直すため古い action のまま。action 修正を反映するには新 SHA で `workflow_dispatch`（または対象 paths に触る commit）で起動し直す
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **PR の「変更ファイル」を git diff で取るときは three-dot（`base...head`）を使う。two-dot は誤検出する**: `pull_request` イベントで `git diff --name-only <base.sha> <head.sha>`（two-dot）を使うと、PR 分岐後に base ブランチ（main）が進んだぶんの変更も差分に含まれてしまう（`base.sha` は `synchronize` で現 main tip に追従しうる）。PR が実際に加えた変更だけが欲しいなら three-dot（`git diff --name-only <base.sha>...<head.sha>`）= merge-base 起点の diff を使う。`actions/checkout@v4` に `fetch-depth: 0` を指定して merge-base を履歴に含めること（shallow だと取れない）。誤検出は「変更していない対象のジョブが余分に走り、main 側の既存 drift で無関係に赤くなる」ノイズ・誤帰責を生む。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **動的 matrix は手書き列挙でなく構造（ディレクトリ・git diff）から導く**: multi-tenant/multi-app の CI で「変更された app だけ検証する」matrix を組むとき、app ごとの filter を手書き列挙（`dorny/paths-filter` の `filters:` + bash の if 分岐）すると、app 追加のたびに複数箇所の追記が要り、列挙漏れが「ワークフローは発火するが matrix が空でサイレントスキップ」というエラーの出ない検証漏れになる。`apps/` のディレクトリ構造を信頼できる唯一の情報源とし `git diff --name-only base...head | grep '^apps/[^/]+/...' | sed 's#...#\1#' | sort -u | jq -R . | jq -s -c 'map(select(. != ""))'` で app 名を動的抽出すれば、`apps/<app>/` を足すだけでワークフロー無編集で横展開でき、外部 action 依存も消える。`on.paths` もワイルドカード（`apps/*/...`）で自動カバーされる。空入力時に `jq` が `[]` を返すので `if: needs.detect.outputs.apps != '[]'` でスキップ制御できる。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **service container 使用時の `DB_HOST` は `localhost`（コンテナ名ではない）**: `runs-on: ubuntu-latest` で runner に直接 step を実行する構成では、service container の port を `ports:` でホストにマップし、step からは `localhost` で接続する。`container:` で job 全体をコンテナ内で動かす場合のみ、service コンテナ名（`postgres` 等）がホスト名になり `ports:` マッピングが不要になる。混同すると `connection refused` か名前解決失敗で落ちる。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **composite action の `run:` 内で複数コマンドを `cd A && cmd1; cmd2` で chain するな。別 step に分ける**: `cd A && cmd1` が成功し `cmd2` が repo root で実行されると、`cmd2` の対象パスが解決されずエラーを出さずにスキップされることがある（例: `git diff apps/<app>/drizzle` が root から見えても対象ファイルが untracked でスキップ）。別 `run:` ステップに分割すれば CI ログの可視性も上がり、どのコマンドが失敗したか即座にわかる。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`git diff --exit-code <path>` は untracked ファイルを検出しない**: drizzle-kit generate のように「差分あれば新規ファイルを生成・なければ何も書かない」ツールの drift を検出するとき、新規ファイルは untracked なので `git diff` では exit code 1 にならない。`git add --intent-to-add <path>` を直前に実行することで untracked ファイルを「全削除された tracked ファイル」として diff の対象に加えられる（ファイルの実内容は変わらない）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`GITHUB_TOKEN` で push した git イベント（tag push・ファイルコミット）は別の workflow を起動しない**: GitHub の再帰実行防止仕様で、デフォルト `GITHUB_TOKEN`（`actions/checkout` のデフォルト credential）が作った push/tag イベントは新しい workflow run を生まない（`workflow_dispatch`/`repository_dispatch` のみ例外）。よって「CI が tag を push → 別 workflow が tag トリガーで起動」「CI がファイルをコミット → paths トリガーで別 workflow 起動」のように複数 workflow を CI 生成の git イベントで連結する設計はチェーンが切れる（人間が手で push したときだけ繋がる半自動状態になり、気づきにくい）。検出: `auto-tag` のような「CI が git push する」step を見たら、その push に依存する下流 workflow があるか確認する。対処は 2 択。(1) 連結したい一連を 1 workflow 内の直列ジョブに統合する（cross-workflow トリガー非依存・PAT 不要。推奨）/ (2) PAT・GitHub App トークンで pushして下流を起動させる（長期 contents:write トークンの発行・ローテーション・漏洩管理コストを負う）。なお下流を起動「させたくない」自動コミット（GitOps の値コミット等）ではこの仕様が逆に好都合で、`GITHUB_TOKEN` push + `[skip ci]` で二重起動を防げる。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
