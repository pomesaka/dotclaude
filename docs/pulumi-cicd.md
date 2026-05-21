# Pulumi GitHub Actions CI/CD

> **TL;DR**: S3 バックエンド + IAM ユーザーキー方式の標準パターン。`pulumi/actions@v6` で `up`（deploy）と `preview`（PR コメント）を別 workflow に分割する。StackReference 依存がある場合は `needs:` で直列化。paths-filter で選択実行する場合は `always()` + result チェックが必要。

---

## 標準 Workflow パターン

### Deploy（push to main）

```yaml
name: Infra Deploy
on:
  push:
    branches: [main]
    paths: ["infra/**"]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false  # deploy は途中キャンセル禁止

env:
  AWS_REGION: ap-northeast-1
  PULUMI_CONFIG_PASSPHRASE: ""   # S3 backend: 未設定だと対話プロンプトが出るため空文字
  PULUMI_ACCESS_TOKEN: ""        # S3 backend + cloud-url では不要（同上）

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
          # configure 後は AWS_REGION が自動セットされるため Pulumi env: への再渡しは不要
      - uses: pulumi/actions@v6
        with:
          command: up
          stack-name: organization/noah-infra/dev
          work-dir: infra/shared
          upsert: false
          refresh: true   # drift 検知のため deploy でも推奨
          cloud-url: ${{ secrets.PULUMI_BACKEND_URL }}
```

### Preview（PR）

```yaml
name: Infra Preview
on:
  pull_request:
    paths: ["infra/**"]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true   # preview は古いものをキャンセルしてよい

jobs:
  preview:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      pull-requests: write   # comment-on-pr: true に必要（reusable workflow 経由でも caller 側で宣言が必要）
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}
      - uses: pulumi/actions@v6
        with:
          command: preview
          stack-name: organization/noah-infra/dev
          work-dir: infra/shared
          comment-on-pr: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
          refresh: true
          cloud-url: ${{ secrets.PULUMI_BACKEND_URL }}
```

---

## マルチスタック設計

- **StackReference 依存の直列化**: `needs: [registry, shared]` で依存スタックを順番に実行。依存のないスタックは並列実行可（S3 state lock はスタックごとに独立）
- **preview も deploy と同じ `needs` チェーン**: 並列にすると参照先 state が古い状態でプレビューされる
- **マルチクライアント app deploy**: `apps/<client>/**` でクライアントごとに workflow を分割。`_app-deploy.yml`（reusable）に `ecr-repository`・`stack-name`・`work-dir` を入力として渡す構成が scalable

---

## ECS イメージ更新は `config-map` で統一

`aws ecs update-service --force-new-deployment` は ECS リソース名のハードコードが必要でインフラとアプリのデプロイ機構が分裂する。Pulumi の `config-map` で統一する。

```typescript
// index.ts
const imageTag = config.get("imageTag") ?? "latest";
// タスク定義の image に pulumi.interpolate`${repo.repositoryUrl}:${imageTag}` を使う
```

```yaml
- uses: pulumi/actions@v6
  with:
    command: up
    config-map: |
      imageTag:
        value: ${{ github.sha }}
```

ECS タスク定義更新・ローリングアップデート・安定待機を Pulumi が担う。ECS リソース名のハードコード不要・初回と以降が同一メカニズム。

---

## Gotchas

- **paths-filter で選択実行する場合**: 後続ジョブが `needs: [detect, A, B]` を持つとき A/B がスキップされると後続もデフォルトスキップされる。`if: always() && (needs.A.result == 'success' || needs.A.result == 'skipped')` で依存ジョブのスキップを明示的に許容する
- **`comment-on-pr: true` + reusable workflow**: callee 内の `permissions: pull-requests: write` だけでは不十分。caller 側 workflow にも同じ permission を明示する
- **ECS Fargate のアーキテクチャ**: デフォルトは `X86_64`。`docker/setup-qemu-action` は ARM64 ビルド専用。明示的に ARM64 を使う場合のみ Pulumi の `cpuArchitecture: "ARM64"` とワークフローの `platforms: linux/arm64` を合わせる
- **ECR レジストリ URL**: `amazon-ecr-login@v2` の `${{ steps.login-ecr.outputs.registry }}/<repo>:<tag>` を使う。AWS アカウント ID のハードコード禁止
