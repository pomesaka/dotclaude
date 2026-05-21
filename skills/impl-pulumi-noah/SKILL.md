---
name: impl-pulumi-noah
description: noah の Pulumi インフラコードを実装する。infra/ ディレクトリのセットアップ・AWS リソース定義・CI/CD 整備を行う。
when_to_use: 「Pulumiを実装して」「インフラコードを書いて」「deployのセットアップをして」「issue 014を実装して」と言われたとき。
allowed-tools: Bash(pulumi *), Bash(jj *), Bash(mise *), Read, Edit, Write, Grep, Glob
model: sonnet
---

# impl-pulumi-noah: Pulumi インフラ実装フロー

noah の `infra/` ディレクトリに Pulumi TypeScript プロジェクトを作成・実装する。

**必読ドキュメント（実装前に確認)**:
- `~/.claude/docs/pulumi.md` — Pulumi 基本概念・TypeScript パターン・ベストプラクティス
- `~/.claude/docs/pulumi-aws.md` — AWS リソース定義パターン（VPC/ECS/ECR/Lambda/Aurora）
- `~/.claude/docs/pulumi-cicd.md` — GitHub Actions CI/CD ワークフローパターン
- `docs/apps/architecture.md` — noah のデプロイ構成決定事項（ECS/Fargate + Lambda + Pulumi）
- `docs/adr/0001-database.md` — Aurora PostgreSQL の選定理由

---

## Step 0: 現状確認

```bash
ls infra/ 2>/dev/null || echo "infra/ なし"
```

`infra/` が存在しない場合は Step 1 から開始。存在する場合は現状を Read して差分のみ実装する。

---

## Step 1: infra/ ディレクトリ初期化

### ディレクトリ構成

```
infra/
├── shared/           # VPC, ECR, Aurora, S3 — 複数顧客共通
│   ├── Pulumi.yaml
│   ├── Pulumi.dev.yaml
│   ├── Pulumi.prod.yaml
│   ├── package.json
│   ├── tsconfig.json
│   └── index.ts
└── ms-holdings/      # ECS サービス, Lambda, ALB — 顧客固有
    ├── Pulumi.yaml
    ├── Pulumi.dev.yaml
    ├── Pulumi.prod.yaml
    ├── package.json
    ├── tsconfig.json
    └── index.ts
```

### Pulumi.yaml テンプレート

```yaml
# infra/shared/Pulumi.yaml
name: noah-shared
runtime: nodejs
description: noah 共通インフラ（VPC, ECR, Aurora, S3）
```

```yaml
# infra/ms-holdings/Pulumi.yaml
name: noah-ms-holdings
runtime: nodejs
description: MS Holdings 顧客固有インフラ（ECS, Lambda）
```

### package.json（各 Pulumi プロジェクト共通）

```json
{
  "name": "infra-shared",
  "version": "0.1.0",
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5"
  },
  "dependencies": {
    "@pulumi/pulumi": "^3",
    "@pulumi/aws": "^6",
    "@pulumi/awsx": "^2"
  }
}
```

---

## Step 2: shared スタック実装（index.ts）

**スタック命名規則**: `accel-hack/noah-shared/<env>`
例: `accel-hack/noah-shared/prod`

### 必須リソース

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const config = new pulumi.Config();
const stack  = pulumi.getStack();  // "dev" / "prod"
const prefix = `noah-${stack}`;

// AWS Provider with default tags（全リソースに自動付与）
const provider = new aws.Provider("aws", {
    region: "ap-northeast-1",
    defaultTags: {
        tags: {
            Environment: stack,
            Project:     "noah",
            ManagedBy:   "pulumi",
            Owner:       "accel-hack",
        },
    },
});

// VPC（awsx.ec2.Vpc で Public + Private サブネットを自動作成）
const vpc = new awsx.ec2.Vpc(`${prefix}-vpc`, {
    cidrBlock: "10.0.0.0/16",
    subnetSpecs: [
        { type: awsx.ec2.SubnetType.Public,  cidrMask: 24 },
        { type: awsx.ec2.SubnetType.Private, cidrMask: 20 },
    ],
}, { provider });

// ECR リポジトリ（Next.js アプリ用）
const appRepo = new aws.ecr.Repository(`${prefix}-app`, {
    name: `${prefix}/app`,
    imageTagMutability: "IMMUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
}, { provider });

// Aurora PostgreSQL Serverless v2
const dbSg = new aws.ec2.SecurityGroup(`${prefix}-db-sg`, {
    vpcId: vpc.vpcId,
    ingress: [{ fromPort: 5432, toPort: 5432, protocol: "tcp", self: true }],
}, { provider });

const dbSubnetGroup = new aws.rds.SubnetGroup(`${prefix}-db-subnet`, {
    subnetIds: vpc.privateSubnetIds,
}, { provider });

const aurora = new aws.rds.Cluster(`${prefix}-aurora`, {
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: "16.4",
    serverlessv2ScalingConfiguration: { minCapacity: 0.5, maxCapacity: 4 },
    databaseName: "noah",
    masterUsername: "noah",
    masterPassword: config.requireSecret("dbPassword"),
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    skipFinalSnapshot: stack !== "prod",
}, { provider, protect: stack === "prod" });  // 本番のみ protect

new aws.rds.ClusterInstance(`${prefix}-aurora-instance`, {
    clusterIdentifier: aurora.id,
    instanceClass: "db.serverless",
    engine: aws.rds.EngineType.AuroraPostgresql,
    engineVersion: aurora.engineVersion,
}, { provider, protect: stack === "prod" });

// S3（ファイルストレージ）
const storageBucket = new aws.s3.BucketV2(`${prefix}-storage`, {
    bucket: `${prefix}-storage`,
    forceDestroy: stack !== "prod",
}, { provider });

// Exports（ms-holdings スタックが StackReference で参照）
export const vpcId          = vpc.vpcId;
export const privateSubnets = vpc.privateSubnetIds;
export const publicSubnets  = vpc.publicSubnetIds;
export const appRepoUrl     = appRepo.repositoryUrl;
export const auroraEndpoint = aurora.endpoint;
export const storageBucketName = storageBucket.id;
export const dbSgId         = dbSg.id;
```

---

## Step 3: ms-holdings スタック実装（index.ts）

**スタック命名規則**: `accel-hack/noah-ms-holdings/<env>`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const config  = new pulumi.Config();
const stack   = pulumi.getStack();
const prefix  = `noah-ms-holdings-${stack}`;

// shared スタックの出力を参照
const sharedStack   = new pulumi.StackReference(`accel-hack/noah-shared/${stack}`);
const vpcId         = sharedStack.requireOutput("vpcId");
const privateSubnets = sharedStack.requireOutput("privateSubnets") as pulumi.Output<string[]>;
const publicSubnets  = sharedStack.requireOutput("publicSubnets") as pulumi.Output<string[]>;
const appRepoUrl    = sharedStack.requireOutput("appRepoUrl") as pulumi.Output<string>;
const dbSgId        = sharedStack.requireOutput("dbSgId");

const provider = new aws.Provider("aws", {
    region: "ap-northeast-1",
    defaultTags: {
        tags: {
            Environment: stack,
            Project:     "noah",
            Customer:    "ms-holdings",
            ManagedBy:   "pulumi",
        },
    },
});

// ECS 用 Security Group
const appSg = new aws.ec2.SecurityGroup(`${prefix}-app-sg`, {
    vpcId,
    ingress: [
        { fromPort: 3000, toPort: 3000, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }],
}, { provider });

// Secrets Manager（アプリ環境変数）
const appSecret = new aws.secretsmanager.Secret(`${prefix}-app-secret`, {
    name: pulumi.interpolate`/noah/${stack}/ms-holdings/app`,
}, { provider });

// ALB + ECS Fargate
const lb = new awsx.lb.ApplicationLoadBalancer(`${prefix}-lb`, {
    subnetIds: publicSubnets,
}, { provider });

const cluster = new aws.ecs.Cluster(`${prefix}-cluster`, {}, { provider });

const taskRole = new aws.iam.Role(`${prefix}-task-role`, {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Effect: "Allow",
        }],
    }),
}, { provider });

// Secrets Manager 読み取り権限
new aws.iam.RolePolicy(`${prefix}-task-policy`, {
    role: taskRole.id,
    policy: appSecret.arn.apply(arn => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue"],
            Resource: arn,
        }],
    })),
}, { provider });

const imageTag = config.get("imageTag") ?? "latest";
const image    = pulumi.interpolate`${appRepoUrl}:${imageTag}`;

const service = new awsx.ecs.FargateService(`${prefix}-service`, {
    cluster: cluster.arn,
    desiredCount: stack === "prod" ? 2 : 1,
    taskDefinitionArgs: {
        taskRole: { roleArn: taskRole.arn },
        container: {
            name: "app",
            image,
            cpu: 512,
            memory: 1024,
            essential: true,
            portMappings: [{
                containerPort: 3000,
                targetGroup: lb.defaultTargetGroup,
            }],
            secrets: [{
                name: "APP_SECRETS",
                valueFrom: appSecret.arn,
            }],
            environment: [
                { name: "TENANT_SCHEMA", value: "ms_holdings" },
                { name: "NODE_ENV", value: stack === "prod" ? "production" : "development" },
            ],
        },
    },
    networkConfiguration: {
        subnets: privateSubnets,
        securityGroups: [appSg.id, dbSgId],
        assignPublicIp: false,
    },
}, { provider, protect: stack === "prod" });

// Lambda（非同期ジョブ: F02/F03/F05）
const lambdaRole = new aws.iam.Role(`${prefix}-lambda-role`, {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: { Service: "lambda.amazonaws.com" },
            Effect: "Allow",
        }],
    }),
}, { provider });

new aws.iam.RolePolicyAttachment(`${prefix}-lambda-vpc`, {
    role: lambdaRole,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
}, { provider });

const jobLambda = new aws.lambda.Function(`${prefix}-jobs`, {
    runtime: aws.lambda.Runtime.NodeJS22dX,
    role: lambdaRole.arn,
    handler: "index.handler",
    timeout: 900,
    memorySize: 1024,
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("../../apps/ms-holdings/dist/lambda"),
    }),
    vpcConfig: {
        subnetIds: privateSubnets,
        securityGroupIds: [appSg.id, dbSgId],
    },
    environment: {
        variables: {
            TENANT_SCHEMA: "ms_holdings",
        },
    },
}, { provider });

export const serviceUrl  = pulumi.interpolate`http://${lb.loadBalancer.dnsName}`;
export const lambdaArn   = jobLambda.arn;
export const clusterName = cluster.name;
```

---

## Step 4: GitHub Actions CI/CD 設定

`.github/workflows/infra-preview.yml` と `.github/workflows/infra-deploy.yml` を作成する。
フォーマットは `@~/.claude/docs/pulumi.md` のセクション 10 を参照。

---

## Step 5: Dockerfile 作成

`apps/ms-holdings/Dockerfile` に Next.js standalone build のコンテナ定義を作成する。

```dockerfile
FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install -g bun && bun install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm install -g bun && bun run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=builder /app/apps/ms-holdings/.next/standalone ./
COPY --from=builder /app/apps/ms-holdings/.next/static ./apps/ms-holdings/.next/static
COPY --from=builder /app/apps/ms-holdings/public         ./apps/ms-holdings/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/ms-holdings/server.js"]
```

`next.config.ts` に `output: "standalone"` を追加することも忘れずに。

---

## Gotchas

- **`Output<T>` と string の混同**: `prefix + bucket.id` は型エラー。`pulumi.interpolate` を使う
- **`protect: true` の解除**: リソースを削除する前に `protect: false` → `pulumi up` → 削除の2ステップが必要
- **state ロック**: CI 途中失敗時は `pulumi cancel` でロック解除
- **StackReference の遅延**: `shared` スタックが先に `pulumi up` されていないと ms-holdings スタックの参照が失敗する。スタックの実行順序: `shared` → `ms-holdings`
- **Fargate の subnet**: アプリコンテナは Private サブネットに置く。ALB のみ Public サブネット
- **Aurora の `skipFinalSnapshot`**: 本番は `false` に固定（ADR 0001 の要件）
- **Lambda のビルド成果物**: `dist/lambda/` ディレクトリが存在しない場合は Pulumi のビルドが失敗する。CI ではアプリビルド → Pulumi の順で実行すること
