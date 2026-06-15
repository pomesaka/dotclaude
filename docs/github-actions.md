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
- **共有 action / reusable workflow を直しても、それを使う workflow を自動起動しない**: `app-deploy-*.yml` の paths が `apps/<app>/**` のとき、`.github/actions/**` や reusable workflow を編集しても push トリガーにマッチせず再ビルドされない。さらに失敗 run の「Re-run jobs」は**同じ commit SHA**でやり直すため古い action のまま。action 修正を反映するには新 SHA で `workflow_dispatch`（または対象 paths に触る commit）で起動し直す
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`GITHUB_TOKEN` で push した git イベント（tag push・ファイルコミット）は別の workflow を起動しない**: GitHub の再帰実行防止仕様で、デフォルト `GITHUB_TOKEN`（`actions/checkout` のデフォルト credential）が作った push/tag イベントは新しい workflow run を生まない（`workflow_dispatch`/`repository_dispatch` のみ例外）。よって「CI が tag を push → 別 workflow が tag トリガーで起動」「CI がファイルをコミット → paths トリガーで別 workflow 起動」のように **複数 workflow を CI 生成の git イベントで連結する設計はチェーンが切れる**（人間が手で push したときだけ繋がる半自動状態になり、気づきにくい）。検出: `auto-tag` のような「CI が git push する」step を見たら、その push に依存する下流 workflow があるか確認する。対処は 2 択 ——(1) **連結したい一連を 1 workflow 内の直列ジョブに統合**する（cross-workflow トリガー非依存・PAT 不要。推奨）/ (2) **PAT・GitHub App トークンで push**して下流を起動させる（長期 contents:write トークンの発行・ローテーション・漏洩管理コストを負う）。なお下流を起動「させたくない」自動コミット（GitOps の値コミット等）ではこの仕様が逆に好都合で、`GITHUB_TOKEN` push + `[skip ci]` で二重起動を防げる。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
