# GitHub Actions パターン集

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
