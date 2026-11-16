# Pulumi AWS リソース定義パターン

> **TL;DR**: Crosswalk（`@pulumi/awsx`）で VPC + Subnet + IGW をワンライナー構築。ECR + ECS Fargate + ALB が標準的な Web サービス構成。ECR には lifecycle policy・protect・encryption を必ずセット。Monorepo は `infra/shared/`（VPC/ECR）と `infra/<client>/`（アプリ固有）に分割する。

---

## AWS リソース定義パターン

### VPC / Subnet / Security Group

```typescript
import * as awsx from "@pulumi/awsx";
import * as aws  from "@pulumi/aws";

const vpc = new awsx.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    subnetSpecs: [
        { type: awsx.ec2.SubnetType.Public,  cidrMask: 24 },
        { type: awsx.ec2.SubnetType.Private, cidrMask: 20 },
    ],
    // NatGateway: prod は Single、dev は None（課金対策）
    natGateways: { strategy: stack === "prod" ? awsx.ec2.NatGatewayStrategy.Single : awsx.ec2.NatGatewayStrategy.None },
});

const appSg = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.vpcId,
    ingress: [{ fromPort: 443, toPort: 443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] }],
    egress:  [{ fromPort: 0,   toPort: 0,   protocol: "-1",  cidrBlocks: ["0.0.0.0/0"] }],
    // DB SG の egress は [] にする（RDS は外部接続を開始しない）
});
```

### ECR

```typescript
const repo = new aws.ecr.Repository("app-repo", {
    name: "my-app",
    imageTagMutability: "IMMUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    encryptionConfigurations: [{ encryptionType: "AES256" }],  // 配列（単数形は型エラー）
}, { protect: stack === "prod" });  // prod のみ保護（全環境に付けると dev のリソース削除で詰まる）

// コスト管理: lifecycle policy は必ずセット（untagged イメージの蓄積でコスト増）
new aws.ecr.LifecyclePolicy("app-repo-lifecycle", {
    repository: repo.name,
    policy: JSON.stringify({
        rules: [{
            rulePriority: 1,
            selection: { tagStatus: "untagged", countType: "sinceImagePushed", countUnit: "days", countNumber: 7 },
            action: { type: "expire" },
        }],
    }),
});
```

### ECS Fargate + ALB

```typescript
const lb      = new awsx.lb.ApplicationLoadBalancer("lb", { subnetIds: vpc.publicSubnetIds });
const cluster = new aws.ecs.Cluster("cluster");

const service = new awsx.ecs.FargateService("app", {
    cluster: cluster.arn,
    desiredCount: 2,
    taskDefinitionArgs: {
        container: {
            name: "app",
            image: pulumi.interpolate`${repo.repositoryUrl}:latest`,
            cpu: 256, memory: 512, essential: true,
            portMappings: [{ containerPort: 8080, targetGroup: lb.defaultTargetGroup }],
            secrets: [{ name: "DB_PASSWORD", valueFrom: dbSecret.arn }],
        },
    },
    networkConfiguration: { subnets: vpc.privateSubnetIds, securityGroups: [appSg.id] },
});
export const serviceUrl = pulumi.interpolate`http://${lb.loadBalancer.dnsName}`;
```

### Lambda

```typescript
const lambdaRole = new aws.iam.Role("lambda-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Action: "sts:AssumeRole", Principal: { Service: "lambda.amazonaws.com" }, Effect: "Allow" }],
    }),
});
new aws.iam.RolePolicyAttachment("lambda-basic", {
    role: lambdaRole, policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});
const fn = new aws.lambda.Function("fn", {
    runtime: aws.lambda.Runtime.NodeJS22dX,
    role: lambdaRole.arn, handler: "index.handler",
    code: new pulumi.asset.AssetArchive({ ".": new pulumi.asset.FileArchive("./dist") }),
    environment: { variables: { TABLE_NAME: table.name } },
});
```

### Secrets Manager

```typescript
const secret = new aws.secretsmanager.Secret("db-secret", {
    name: pulumi.interpolate`/${appName}/db/password`,
});
new aws.secretsmanager.SecretVersion("db-secret-value", {
    secretId: secret.id, secretString: config.requireSecret("dbPassword"),
});
```

### Aurora PostgreSQL Serverless v2

```typescript
const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", { subnetIds: vpc.privateSubnetIds });

const cluster = new aws.rds.Cluster("aurora-cluster", {
    engine: aws.rds.EngineType.AuroraPostgresql, engineVersion: "16.1",
    serverlessv2ScalingConfiguration: { minCapacity: 0.5, maxCapacity: 4 },
    databaseName: "appdb", masterUsername: "admin",
    masterPassword: config.requireSecret("dbPassword"),
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    skipFinalSnapshot: false,
});
new aws.rds.ClusterInstance("aurora-instance", {
    clusterIdentifier: cluster.id, instanceClass: "db.serverless",
    engine: aws.rds.EngineType.AuroraPostgresql, engineVersion: cluster.engineVersion,
});
```

---

## Monorepo 構成パターン

```
infra/
├── shared/               # 共通インフラ（VPC, ECR）
│   ├── Pulumi.yaml
│   ├── Pulumi.dev.yaml
│   └── index.ts
└── <client>/             # クライアント固有（StackReference で shared を参照）
    ├── Pulumi.yaml
    └── index.ts
```

- **スタック命名**: `<org>/<project>/<env>-<client>` 例: `my-org/myproj-infra/prod-acme`
- **env なしスタック**: `Pulumi.main.yaml` を必ず commit する
- **env なしスタックの defaultTags**: `Environment: "shared"` で統一

---

## Gotchas

**IAM ポリシー設計の原則**
- **アカウントレベル API は `Resource: "*"` 必須**: `ecs:DescribeServices`・`ecr:GetAuthorizationToken` など account-level の API は ARN スコープ指定不可。操作ごとに Statement を分けて Resource スコープを使い分ける
- **Pulumi で IAM ロールを管理する場合**: `PassRole` だけでなく `CreateRole`・`DeleteRole`・`GetRole`・`AttachRolePolicy`・`DetachRolePolicy`・`TagRole` も必要。IAM ロール操作は `arn:aws:iam::<ACCOUNT>:role/<prefix>-*` スコープで専用 Statement を追加する
- **ポリシー冗長性の修正方向**: 広いスコープ（`ecs:*`）がある場合は個別ステートメント（`ECSUpdate`）を削除する方向で整理する。ECR は `PulumiInfraAccess` から除外し `ECRAuth`・`ECRRepoAccess` の専用ステートメントに委ねる

**NatGateway・コスト**
- `pulumi preview` 出力に `aws:ec2:NatGateway` が出たら意図した構成か確認（dev で Single にしていないか）

**SaaS マルチテナント: ALB 共有 vs 顧客ごと独立 ALB**
- **「共有 ALB + ホストベースルーティング」はコスパよく見えるが初期の正解ではない**。ALB 1 台（~$22/月）で全顧客をカバーできるが、以下の問題がある
  - 障害ブラスト半径が全顧客になる（Listener Rule ミス・WAF 設定変更が全員に影響）
  - Listener Rule 上限 100/ALB（顧客あたり 2-3 ルール消費で 30-40 顧客で限界。緩和可だが運用負荷）
  - TG はどっちみち顧客ごとに必要（ECS サービスが分かれるため）。簡素化効果は限定的
  - WAF / アクセスログ / CloudWatch メトリクスが全顧客混在し、課金按分・障害切り分けが煩雑
  - IAM: 各顧客スタックが共有 ALB の Listener Rule を変更する権限が必要になり権限が広がる
- **「1顧客=1ALB」の方がスタック設計がクリーン**: スタック完全独立、顧客退出は `pulumi destroy` だけ
- **再評価ライン**: 顧客 50+ でコスト差（$22 vs $22×N/月）が現実的になったら「Tier 別（SMB は共有 / Enterprise は専用）」を検討する
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
