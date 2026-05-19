# Pulumi 実践ガイド（TypeScript / AWS）

Pulumi を使ったことがないエンジニア向けに、基本概念から AWS リソース定義パターン・CI/CD 統合まで体系的にまとめたリファレンス。

---

## 1. コアコンセプト

### Project
ソースコードと実行メタデータを含むディレクトリ。`Pulumi.yaml` がルートに置かれる。

### Stack
プロジェクトの「隔離された、独立して設定可能なインスタンス」。同一プログラムから `dev` / `staging` / `prod` など複数環境を独立してデプロイするための単位。状態（State）はスタックごとに分離される。

```bash
pulumi stack init dev          # スタック作成
pulumi stack select production # スタック切り替え
pulumi stack ls                # 一覧表示
```

### Resource
クラウドリソースを表すオブジェクト。宣言的に「望ましい状態」を定義し、Pulumi エンジンが差分を計算して適用する。

### State
スタックの現在状態を記録するスナップショット（checkpoint）。`pulumi up` 実行時にエンジンが「現在の state」と「コードで定義した望ましい状態」を比較し、必要な操作を計算する。

### Config
スタックごとに異なる設定値を管理する仕組み。`Pulumi.<stack-name>.yaml` ファイルに保存される。

---

## 2. State バックエンド：Pulumi Cloud vs S3

| 項目 | Pulumi Cloud（マネージド） | S3（DIY） |
|---|---|---|
| セットアップ | ゼロ設定 | バケット作成・IAM 設定が必要 |
| State ロック | 自動 | 自動（DynamoDB 不要） |
| Drift Detection | 組み込み（定期 `refresh`） | 手動 |
| 監査ログ | あり | なし |
| コスト | 無料枠あり、チーム以上は有料 | S3 料金のみ |
| 推奨用途 | チーム・本番 | 小規模・コスト重視 |

**S3 バックエンドへのログイン:**
```bash
pulumi login 's3://<bucket-name>?region=ap-northeast-1&awssdk=v2'
```

---

## 3. 基本フロー

```bash
pulumi preview    # 変更点の確認（適用しない）
pulumi up         # 変更を適用
pulumi refresh    # 実際のクラウド状態を state に同期（drift 解消）
pulumi destroy    # 全リソース削除（危険）
pulumi cancel     # 実行中の操作をキャンセル
```

---

## 4. TypeScript プロジェクトの初期化

```bash
mkdir infra && cd infra
pulumi new aws-typescript
```

生成されるファイル:
```
infra/
├── Pulumi.yaml              # プロジェクト名・ランタイム定義
├── Pulumi.dev.yaml          # dev スタックの設定値
├── index.ts                 # エントリーポイント
├── package.json
└── tsconfig.json
```

---

## 5. Input / Output 型システム

Pulumi の最重要概念。クラウドリソースは作成後に初めて値が確定するため、`Output<T>` で非同期値を表現する。

### Output<T> の性質
- リソースのプロパティ（ARN、ID など）は常に `Output<T>` 型
- `console.log(bucket.arn)` は「`[object Object]`」になるので直接使えない
- 値を取り出すには `apply()` か `pulumi.interpolate` を使う

### apply() — 値を変換・参照する
```typescript
const bucketName = bucket.id.apply(id => `bucket-name: ${id}`);

// 副作用にも使える（デバッグ目的のみ推奨）
bucket.arn.apply(arn => console.log("ARN:", arn));
```

### pulumi.interpolate — 文字列補間
`apply()` のシンタックスシュガー。URL などの文字列構築に使う。
```typescript
const url = pulumi.interpolate`https://${lb.dnsName}/api`;
```

### pulumi.all() — 複数 Output をまとめて参照
```typescript
const combined = pulumi.all([bucket.id, bucket.arn]).apply(([id, arn]) => {
    return `${id} -> ${arn}`;
});
```

### 注意: Output<T> を文字列として直接渡せない
```typescript
// NG: pulumi.Output<string> は string ではない
const name = bucket.id + "-suffix";  // 型エラー

// OK
const name = pulumi.interpolate`${bucket.id}-suffix`;
```

---

## 6. Config と Secret の管理

```typescript
const config = new pulumi.Config();

// 文字列取得（必須）
const appName = config.require("appName");

// 型付き取得（任意、デフォルト値付き）
const port = config.getNumber("port") ?? 3000;

// Secret（Output<string> として返る、state に暗号化保存）
const dbPassword = config.requireSecret("dbPassword");
```

**CLI でのセット:**
```bash
pulumi config set appName my-app
pulumi config set --secret dbPassword s3cr3t  # 暗号化して保存
```

**スタック設定ファイル（`Pulumi.dev.yaml`）:**
```yaml
config:
  aws:region: ap-northeast-1
  myapp:appName: my-app
  myapp:dbPassword:
    secure: AAABxxxxxxxx  # 暗号化済み
```

---

## 7. AWS リソース定義パターン

### VPC / Subnet / Security Group

```typescript
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";

// Crosswalk（awsx）を使うと VPC + Subnet + IGW + NAT GW を一括作成
const vpc = new awsx.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    subnetSpecs: [
        { type: awsx.ec2.SubnetType.Public,  cidrMask: 24 },
        { type: awsx.ec2.SubnetType.Private, cidrMask: 20 },
    ],
});
export const vpcId = vpc.vpcId;

// Security Group
const appSg = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.vpcId,
    ingress: [
        { fromPort: 443, toPort: 443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [
        { fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] },
    ],
});
```

### ECR リポジトリ

```typescript
const repo = new aws.ecr.Repository("app-repo", {
    name: "my-app",
    imageTagMutability: "IMMUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
});
export const repoUrl = repo.repositoryUrl;
```

### ECS Fargate + ALB（awsx を使った簡潔パターン）

```typescript
const lb = new awsx.lb.ApplicationLoadBalancer("lb", { subnetIds: vpc.publicSubnetIds });
const cluster = new aws.ecs.Cluster("cluster");

const service = new awsx.ecs.FargateService("app", {
    cluster: cluster.arn,
    desiredCount: 2,
    taskDefinitionArgs: {
        container: {
            name: "app",
            image: pulumi.interpolate`${repo.repositoryUrl}:latest`,
            cpu: 256,
            memory: 512,
            essential: true,
            portMappings: [{ containerPort: 8080, targetGroup: lb.defaultTargetGroup }],
            environment: [{ name: "ENV", value: "production" }],
            secrets: [
                { name: "DB_PASSWORD", valueFrom: dbSecret.arn },
            ],
        },
    },
    networkConfiguration: {
        subnets: vpc.privateSubnetIds,
        securityGroups: [appSg.id],
    },
});

export const serviceUrl = pulumi.interpolate`http://${lb.loadBalancer.dnsName}`;
```

### Lambda 関数 + IAM ロール

```typescript
const lambdaRole = new aws.iam.Role("lambda-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: { Service: "lambda.amazonaws.com" },
            Effect: "Allow",
        }],
    }),
});

new aws.iam.RolePolicyAttachment("lambda-basic", {
    role: lambdaRole,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

const fn = new aws.lambda.Function("my-func", {
    runtime: aws.lambda.Runtime.NodeJS22dX,
    role: lambdaRole.arn,
    handler: "index.handler",
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("./dist"),
    }),
    environment: { variables: { TABLE_NAME: table.name } },
});
```

### Secrets Manager

```typescript
const dbSecret = new aws.secretsmanager.Secret("db-secret", {
    name: pulumi.interpolate`/${appName}/db/password`,
});

const dbSecretValue = new aws.secretsmanager.SecretVersion("db-secret-value", {
    secretId: dbSecret.id,
    secretString: config.requireSecret("dbPassword"),
});
```

### Aurora PostgreSQL Serverless v2

```typescript
const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
    subnetIds: vpc.privateSubnetIds,
});

const cluster = new aws.rds.Cluster("aurora-cluster", {
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: "16.1",
    serverlessv2ScalingConfiguration: { minCapacity: 0.5, maxCapacity: 4 },
    databaseName: "appdb",
    masterUsername: "admin",
    masterPassword: config.requireSecret("dbPassword"),
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    skipFinalSnapshot: false,
});

new aws.rds.ClusterInstance("aurora-instance", {
    clusterIdentifier: cluster.id,
    instanceClass: "db.serverless",
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: cluster.engineVersion,
});
```

---

## 8. ベストプラクティス

### ComponentResource によるモジュール化

関連リソースをまとめて再利用可能なコンポーネントにする。

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

interface AppServiceArgs {
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<pulumi.Input<string>[]>;
    image: pulumi.Input<string>;
    port: number;
}

class AppService extends pulumi.ComponentResource {
    public readonly url: pulumi.Output<string>;

    constructor(name: string, args: AppServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super("mycompany:index:AppService", name, {}, opts);

        const sg = new aws.ec2.SecurityGroup(`${name}-sg`, {
            vpcId: args.vpcId,
            ingress: [{ fromPort: args.port, toPort: args.port, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] }],
        }, { parent: this });  // parent を指定することでリソースが階層表示される

        // ... ALB, ECS など

        this.url = pulumi.interpolate`http://...`;
        this.registerOutputs({ url: this.url });
    }
}

// 使い方
const svc = new AppService("api", { vpcId, subnetIds, image, port: 8080 }, { protect: true });
```

### Stack Reference（スタック間の出力参照）

```typescript
// infra スタックで VPC ID を export
export const vpcId = vpc.vpcId;

// app スタックから参照
const infraStack = new pulumi.StackReference("myorg/infra/production");
const vpcId = infraStack.requireOutput("vpcId");
```

### AWS Provider の Default Tags

全リソースに一括でタグを付ける。

```typescript
const provider = new aws.Provider("aws", {
    region: "ap-northeast-1",
    defaultTags: {
        tags: {
            Environment: stack,     // "dev" / "staging" / "prod"
            Project:     "noah",
            ManagedBy:   "pulumi",
            Owner:       "infra-team",
        },
    },
});

// リソース作成時に provider を指定
const vpc = new awsx.ec2.Vpc("vpc", {}, { provider });
```

### 命名規則

```typescript
const config = new pulumi.Config();
const stack  = pulumi.getStack();   // "dev" / "staging" / "prod"
const prefix = `noah-${stack}`;     // "noah-dev", "noah-prod" など

const bucket = new aws.s3.Bucket(`${prefix}-assets`);
```

### protect オプション（誤削除防止）

```typescript
// 本番リソースには protect: true を付ける
const db = new aws.rds.Cluster("prod-db", { ... }, { protect: true });

// 削除する場合は先に protect を外してから
// 1. protect: false に変更して pulumi up
// 2. pulumi destroy または リソース削除
```

スタック全体を保護する場合は stack transforms を使う:
```typescript
pulumi.runtime.registerStackTransform((args) => {
    return { props: args.props, opts: { ...args.opts, protect: true } };
});
```

---

## 9. Monorepo での構成パターン（noah 向け）

```
noah/
├── apps/
│   └── customer-a/           # アプリケーションコード
└── infra/
    ├── shared/               # 共通インフラ（VPC, ECR など）
    │   ├── Pulumi.yaml
    │   ├── Pulumi.dev.yaml
    │   ├── Pulumi.prod.yaml
    │   └── index.ts
    └── customer-a/           # 顧客固有のインフラ
        ├── Pulumi.yaml
        ├── Pulumi.dev.yaml
        ├── Pulumi.prod.yaml
        └── index.ts          # shared スタックを StackReference で参照
```

**スタック命名規則:** `<org>/<project>/<env>-<customer>`
例: `accel-hack/noah-infra/prod-ms-holdings`

---

## 10. GitHub Actions CI/CD

```yaml
# .github/workflows/preview.yml
name: Pulumi Preview
on:
  pull_request:
    paths: ["infra/**"]

jobs:
  preview:
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: infra/shared
      - uses: pulumi/actions@v6
        with:
          command: preview
          stack-name: accel-hack/noah-infra/dev
          work-dir: infra/shared
          comment-on-pr: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
          refresh: true   # 実行前に state を同期
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
          AWS_ACCESS_KEY_ID:   ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

```yaml
# .github/workflows/deploy.yml
name: Pulumi Deploy
on:
  push:
    branches: [main]
    paths: ["infra/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: infra/shared
      - uses: pulumi/actions@v6
        with:
          command: up
          stack-name: accel-hack/noah-infra/prod
          work-dir: infra/shared
          upsert: false   # 本番は自動作成しない
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
          AWS_ACCESS_KEY_ID:   ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

---

## 11. 落とし穴・注意点

### Output<T> の非同期性
```typescript
// NG: Output<string> は string ではない
const url = "https://" + lb.dnsName;  // 型エラー

// OK
const url = pulumi.interpolate`https://${lb.dnsName}`;
```

### state のロック
- Pulumi は並列実行を防ぐため state をロックする
- CI で途中失敗した場合は `pulumi cancel` でロック解除

### pulumi destroy の保護
- 重要リソースには `protect: true` を必ず設定
- CI/CD パイプラインから `destroy` を実行できないようにする（専用 workflow のみ許可）
- `pulumi preview --diff` で変更内容を必ず確認してから `up` を実行

### Output<T> の中で async/await は使えない
```typescript
// NG
const size = await bucket.id.apply(async id => {
    const res = await fetch(`https://api.example.com/${id}`);
    return res.json();
});

// OK: apply の中は同期的に扱えるが、外部 API 呼び出しは避ける
// 動的データは Config か StackReference で渡す
```

### AWS provider のリージョン設定
Pulumi.yaml や環境変数 `AWS_REGION` だけでなく、Provider リソースで明示的に指定することを推奨:
```typescript
const aws = require("@pulumi/aws");
// pulumi config set aws:region ap-northeast-1 が確実
```

---

## 12. よく使うコマンドリファレンス

```bash
# プロジェクト・スタック管理
pulumi new aws-typescript          # 新規プロジェクト作成
pulumi stack init dev              # スタック作成
pulumi stack select prod           # スタック切り替え
pulumi stack output vpcId          # 出力値の確認

# デプロイ
pulumi preview --diff              # 変更の詳細確認
pulumi up --yes                    # 確認なしで適用（CI 用）
pulumi refresh                     # 実際の状態を state に同期
pulumi destroy --yes               # 全リソース削除（要注意）

# 状態管理
pulumi state unprotect <urn>       # 特定リソースの protect 解除
pulumi cancel                      # 実行中操作のキャンセル（ロック解除）
pulumi stack export > backup.json  # state のバックアップ

# 設定
pulumi config set key value
pulumi config set --secret key secret-value
pulumi config get key
```

---

## 13. Gotchas（よくあるミスと対処）

- **NatGatewayStrategy は環境で分岐する**: `NatGatewayStrategy.Single` を全環境に適用すると dev でも NAT Gateway が課金される。`stack === "prod" ? NatGatewayStrategy.Single : NatGatewayStrategy.None` のように条件分岐する
- **DB Security Group の egress を開けない**: Aurora/RDS は外部接続を開始しないので egress は `[]`（空配列）にする。デフォルトの `0.0.0.0/0` を残すとレビューで指摘される
- **ECR の protect は prod だけで有効**: `protect: stack === "prod"` にする。全環境に `protect: true` を付けると dev のリソース削除時に詰まる
- **Pulumi.prod.yaml は必須**: `pulumi stack init prod` 後に設定ファイルを忘れがち。`Pulumi.dev.yaml` を作ったら `Pulumi.prod.yaml` も同時に作る
- **ECR lifecycle policy を忘れるとコスト増**: untagged イメージが蓄積してコストが増える。`aws.ecr.LifecyclePolicy` で `sinceImagePushed: 7 days` のルールを必ずセットで定義する
- **`pulumi up` 実行前は必ず NatGateway 数を確認**: `pulumi preview` の出力で `aws:ec2:NatGateway` が出たら意図した構成かチェックする（dev で Single にしていないか）
