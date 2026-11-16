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
          stack-name: organization/myproj-infra/dev
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
          stack-name: organization/myproj-infra/dev
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
- **bootstrap の `upsert: false` + `|| true` はデッドロック**: `pulumi stack init ... || true` でエラーを隠蔽した後に `upsert: false` で `pulumi up` を実行すると、init が実際に失敗していた場合「スタックが存在しない」エラーで up も失敗する。bootstrap ワークフロー専用に `upsert: true` を使うことで、init が失敗しても up 時にスタックを作成できる
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **GitOps: prod スタックは必ず `infra-deploy.yml` の matrix に含める**: prod を matrix から外すと、ユーザーが `Pulumi.prod.yaml` の imageTag を PR で更新してマージしても `infra-deploy.yml` が prod に対して何もしない。「prod へのデプロイをユーザーが制御する」とは「Pulumi.prod.yaml の変更を PR で承認する」ことであり、CI 側の matrix には prod を含めておく
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **新しいデプロイ経路は CI の往復で1個ずつ直さない。ただしエラーのクラスで検知手段を変える**: 新サービス追加（例: Lambda）を CI 任せで立ち上げると、`PR→merge→deploy→再実行`（毎回十数分）で 403/400 に1個ずつ当たって消耗する。クラスごとに事前検知の手段が違う。
  - **build / コンテナ manifest 形式 / リソース設定ミス**（権限ではない実行時エラー）→ ローカルを admin creds で `pulumi up` すれば総ざらいできる（`preview` では出ないので `up` で洗い出す）
  - **CI ロールの権限不足（403）→ ローカル admin では検知できない**（admin は全 action 通るので検知されずに通る）。これは runtime 検知を諦め、別手段で対処する: ① ロールを `service:*`（service-level）で持つ → 「action 欠落」クラスが消滅。② `rg 'new aws\.'` で infra が触る AWS サービスを静的列挙し、ロールポリシーの service 群と diff → 「新サービスが丸ごと無い」を発見（①があるので「present だが action 欠落」は気にしなくてよい）。正確に洗い出すなら admin でなく CI ロール / 同ポリシーの複製ロールを assume して up、または `iamlive`（API コール捕捉→必要 action 生成）
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **Pulumi デプロイロールの権限は service-level（`ec2:*`/`rds:*`/`lambda:*` 等）で持つ。例外は IAM**: action 単位の最小権限は `up --refresh` が呼ぶ read 系 API（resource-level 非対応が多い・`rds:DescribeGlobalClusters` 等）で 403 のモグラ叩きになり運用コストに見合わない。デプロイで触るサービスは `service:*` に広げる。ただし IAM だけは広げない（`role/<prefix>-*` スコープ維持）。CI に `iam:*`（Resource `*`）を与えると侵害時に任意ロールへ AdministratorAccess を付与でき実質アカウント乗っ取り。Secrets は action を広げてよいが Resource は自プロジェクト ARN（`secret:<prefix>-*` / `secret:/<prefix>/*`）に限定する（project-prefixed なので whack-a-mole にならず、他人の secret や RDS マネージド master secret に触れない）
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
