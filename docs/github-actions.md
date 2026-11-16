# GitHub Actionsで踏んだ罠

> **TL;DR**: GitHub Actionsのworkflowを書く、直すときに読む。reusable workflowの権限、matrix、`GITHUB_TOKEN`でのpush、差分の取り方で実際に間違えた点を置く。Pulumiのデプロイの話は`pulumi.md`にある。

整理する前の版は`archive/2026-11-16/docs/github-actions.md`にある。

## reusable workflowとcomposite action

- **reusable workflowの中で`permissions`を宣言しても、呼び出し元に無い権限は付かない**: PRコメント（`pull-requests: write`。`pulumi/actions`の`comment-on-pr: true`に要る）も、OIDC（`id-token: write`）も、呼び出し元のworkflowに書く。`secrets: inherit`で引き継がれるのはsecretsだけ。
- **booleanの入力はmatrixに入れない**: `matrix.install-components: true`を`${{ matrix.install-components }}`で参照すると文字列の`"true"`になり、`type: boolean`のreusable workflowの入力と型が合わない可能性がある。booleanのフラグは、matrixの全体で共通なら`with:`に直に書く。異なる場合は`fromJSON(${{ matrix.flag }})`を使う。
- **composite actionの`inputs.default:`では、`${{ }}`の式は評価されない**: `default: ${{ github.sha }}`と書くと、文字列の`"${{ github.sha }}"`がそのまま値になる。`required: true`にして、全部の呼び出し元で渡す（reusable workflowには無い制約）。
  <!-- mentions: 2 | first-seen: 2026-05 -->
- **composite actionの`run:`で`cd A && cmd1; cmd2`とつながず、stepを分ける**: `cmd2`はリポジトリのルートで動くので、対象のパスが見つからず、エラーを出さずに飛ばされることがある。stepを分ければ、どのコマンドが失敗したかもログで分かる。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **共有のactionやreusable workflowを直しても、それを使うworkflowは起動しない**: `app-deploy-*.yml`のpathsが`apps/<app>/**`なら、`.github/actions/**`の編集はトリガーに当たらない。失敗したrunの「Re-run jobs」は同じコミットでやり直すので、古いactionのままになる。直したactionを効かせるには、新しいコミットで`workflow_dispatch`するか、対象のpathsに触るコミットで起動し直す。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## ジョブの連結

- **paths-filterで選んで実行するとき、飛ばされたジョブに`needs`で依存する後続も飛ばされる**: 後続に`if: always() && (needs.A.result == 'success' || needs.A.result == 'skipped')`を書いて、依存先が飛ばされた場合を通す。
- **`GITHUB_TOKEN`でpushしたイベント（tagのpush、ファイルのコミット）は、別のworkflowを起動しない**: GitHubが再帰を防ぐための仕様で、例外は`workflow_dispatch`と`repository_dispatch`だけ。「CIがtagをpushし、別のworkflowがtagで起動する」設計は、人が手でpushしたときだけつながる。つなぎたい一連は1つのworkflowの直列のジョブにまとめる（PATが要らないので、こちらを先に考える）か、PATかGitHub Appのトークンでpushする（長く生きる`contents:write`のトークンを管理する手間がかかる）。起動させたくない自動コミット（GitOpsの値のコミットなど）では、この仕様がそのまま使える。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## 差分の検出

- **PRが変えたファイルは、three-dot（`git diff --name-only <base.sha>...<head.sha>`）で取る**: two-dotは、PRが分かれた後にbaseが進んだ分まで拾い、変えていない対象のジョブが余分に走る。`actions/checkout`に`fetch-depth: 0`を付けて、merge-baseを履歴に入れる。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **変更されたappの一覧は、手書きのフィルタでなくディレクトリの構造から導く**: `dorny/paths-filter`の`filters:`やbashの分岐にappを並べると、appを足すたびに複数の箇所を直すことになり、漏れたappはmatrixが空のまま、エラーも出ずに飛ばされる。`apps/`の下のディレクトリ名を`git diff --name-only base...head`から取り出してJSONの配列にし、空のときは`if: needs.detect.outputs.apps != '[]'`で飛ばす。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **`git diff --exit-code <path>`は、untrackedのファイルを見つけない**: drizzle-kit generateのように、差分があるときだけ新しいファイルを作る道具のdriftは、これでは検出できない。直前に`git add --intent-to-add <path>`を実行すると、untrackedのファイルもdiffの対象になる（ファイルの中身は変わらない）。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## そのほか

- **AWS Lambdaのコンテナ関数は、docker buildxのprovenance attestationを受け付けない**: `docker/build-push-action@v6`は既定でprovenanceを付け、tagがOCI image indexになる。Lambdaは単一のmanifestしかpullできず、`CreateFunction`と`UpdateFunctionCode`が`The image manifest, config or layer media type ... is not supported`の400になる（ECRへのpushとECSのpullは通るので気づきにくい）。buildのstepに`provenance: false`（または環境変数`BUILDX_NO_DEFAULT_ATTESTATIONS=1`）を付ける。根拠はAWSのドキュメントのimages-create「does not support multi-architecture container images」と、`aws/aws-lambda-roadmap#82`。
  <!-- mentions: 1 | first-seen: 2026-06 -->
- **`echo "$SECRET" | gh secret set KEY --body -`は、末尾に改行が入る**: 保存された値が`value\n`になり、完全一致の照合で外れる。`gh secret set KEY --body "value"`か、`printf '%s' "$SECRET" | gh secret set KEY --body -`を使う。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **tagがあるかを`git ls-remote --tags origin "$TAG"`の出力から調べるときは、`refs/tags/$TAG`を固定文字列で照合する**: `$TAG`だけで照合すると、`v1.0`が`v1.0.1`にも当たる。
  <!-- mentions: 1 | first-seen: 2026-05 -->
- **service containerに、runnerで直接動くstepからつなぐときのホストは`localhost`**: `ports:`でホストに出したポートへつなぐ。service containerの名前（`postgres`など）がホスト名になるのは、`container:`でジョブ全体をコンテナの中で動かすときだけ。
  <!-- mentions: 1 | first-seen: 2026-06 -->
