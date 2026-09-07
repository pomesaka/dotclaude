# Pulumi 実践ガイド（TypeScript / AWS）

> **TL;DR**: Stack=環境単位、State=現在状態のスナップショット、Config=スタック別設定値。バックエンドは Pulumi Cloud（ゼロ設定）か S3（DIY）を選択。`pulumi preview` で差分確認、`pulumi up` で適用。AWS リソース → `pulumi-aws.md`、GitHub Actions CI/CD → `pulumi-cicd.md`。

---

## コアコンセプト

| 概念 | 説明 |
|------|------|
| **Project** | `Pulumi.yaml` を含むディレクトリ |
| **Stack** | プロジェクトの環境別インスタンス（dev/staging/prod）。State はスタックごとに分離 |
| **Resource** | 宣言的に定義するクラウドリソース。エンジンが diff を計算して適用 |
| **State** | スタックの現在状態スナップショット。`pulumi up` 時に desired state と比較 |
| **Config** | スタック別の設定値。`Pulumi.<stack>.yaml` に保存 |

---

## State バックエンド

| 項目 | Pulumi Cloud | S3 |
|------|---|---|
| セットアップ | ゼロ設定 | バケット + IAM 設定が必要 |
| State ロック | 自動 | 自動（DynamoDB 不要） |
| Drift Detection | 組み込み | 手動 `refresh` |
| コスト | 無料枠あり、チーム以上は有料 | S3 料金のみ |

S3 バックエンド: `pulumi login 's3://<bucket>?region=ap-northeast-1&awssdk=v2'`

---

## 基本コマンド

```bash
pulumi new aws-typescript          # プロジェクト作成
pulumi stack init dev              # スタック作成
pulumi stack select prod           # スタック切り替え
pulumi stack output vpcId          # 出力値の確認

pulumi preview --diff              # 変更の詳細確認（適用しない）
pulumi up --yes                    # 変更を適用（CI 用: --yes）
pulumi refresh                     # 実際の状態を state に同期（drift 解消）
pulumi cancel                      # 実行中操作のキャンセル（ロック解除）
pulumi destroy --yes               # 全リソース削除（要注意）

pulumi state unprotect <urn>       # 特定リソースの protect 解除
pulumi stack export > backup.json  # state のバックアップ
pulumi config set --secret key val # 暗号化して保存
```

---

## TypeScript プロジェクト初期化

```bash
mkdir infra && cd infra
pulumi new aws-typescript
```

生成物: `Pulumi.yaml`（プロジェクト定義）、`Pulumi.dev.yaml`（スタック設定）、`index.ts`（エントリーポイント）

---

## Input / Output 型システム

リソースのプロパティは作成後に確定するため `Output<T>` で非同期値を表現する。

```typescript
// 値の変換
const name = bucket.id.apply(id => `prefix-${id}`);

// 文字列補間（シンタックスシュガー）
const url = pulumi.interpolate`https://${lb.dnsName}/api`;

// 複数 Output をまとめて参照
const info = pulumi.all([bucket.id, bucket.arn]).apply(([id, arn]) => `${id}:${arn}`);
```

`Output<T>` は `string` ではない: `bucket.id + "-suffix"` は型エラー → `pulumi.interpolate` を使う。`apply` 内での外部 API 呼び出し（async/await）は避ける。動的データは Config か StackReference で渡す。

---

## Config と Secret

```typescript
const config  = new pulumi.Config();
const appName = config.require("appName");             // 必須文字列
const port    = config.getNumber("port") ?? 3000;      // 任意・デフォルト付き
const dbPass  = config.requireSecret("dbPassword");    // Output<string>（state に暗号化保存）
```

---

## ベストプラクティス

### ComponentResource — 再利用可能なコンポーネント

```typescript
class AppService extends pulumi.ComponentResource {
    public readonly url: pulumi.Output<string>;
    constructor(name: string, args: AppServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super("mycompany:index:AppService", name, {}, opts);
        const sg = new aws.ec2.SecurityGroup(`${name}-sg`, { ... }, { parent: this });
        // ...
        this.registerOutputs({ url: this.url });
    }
}
```

`parent: this` を子リソースに指定するとリソースが階層表示される。

### 既存リソースの ComponentResource 化（reparent state 移行）

スタックルート直下のリソースを component 配下に移すと parent 変更で URN が変わり、preview に replace / delete+create が出る。`aliases: [{ parent: pulumi.rootStackResource }]` を子リソースの opts に宣言すると旧 URN を引き継げる（新規スタックでは旧 URN が無く no-op なので付けっぱなしで害がない）。論理名も変える場合は `aliases: [{ name: "<旧論理名>", parent: pulumi.rootStackResource }]` のように name も併記する。

移行 PR では旧コードを VCS から開き（`git show main:<file>` / `jj file show -r main <file>`）、リソースごとに次の 3 点を機械的に突き合わせる。意識が alias（URN）に向くため 2. と 3. が静かに脱落しやすい:

1. **論理名の一致**: component 側は `${name}-<suffix>` で組むため、`name` に既に suffix が含まれると二重付加（`-jobs-jobs-` 等）で旧名と不一致になり alias が効かない
2. **opts 水準の維持**: 旧コードが付けていた `protect: isProduction`・`dependsOn` 等が `{ parent: this, provider }` 直書きへの置き換えで消えていないか
3. **statement / args 内容の一致**: 内容が変わると alias が効いても update / replace が出る

preview の読み方: component プレースホルダの create・意図したリネームの create+delete（IAM RolePolicy は同一 role に別名共存でき create 先行のため権限の空白なし）・TaskDefinition の revision replace は期待される差分。**stateful リソース（Secret / RandomPassword / S3 / SecurityGroupRule / ECS Service）の replace / delete は alias 漏れの兆候**。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

### Stack Reference — スタック間の出力参照

```typescript
// S3 バックエンド: organization/<project>/<stack>（org は常にリテラル "organization"）
// Pulumi Cloud:   <your-org>/<project>/<stack>
const infra = new pulumi.StackReference("organization/infra/production");
const vpcId = infra.requireOutput("vpcId");
```

### Default Tags — 全リソースに一括タグ

```typescript
const provider = new aws.Provider("aws", {
    region: "ap-northeast-1",
    defaultTags: { tags: { Environment: stack, Project: "my-app", ManagedBy: "pulumi" } },
});
// リソース作成時に { provider } を渡す
```

### 命名規則・protect

```typescript
const stack  = pulumi.getStack();    // "dev" / "staging" / "prod"
const prefix = `my-app-${stack}`;

// 本番リソースは protect: true。削除前に protect: false で pulumi up してから
const db = new aws.rds.Cluster("prod-db", { ... }, { protect: true });

// スタック全体を保護
pulumi.runtime.registerStackTransform((args) => ({ props: args.props, opts: { ...args.opts, protect: true } }));
```

---

## Gotchas

- **`requireOutput()` の `as` キャスト**: `requireOutput()` は `Output<any>` を返すため型アノテーション方式はコンパイルエラー。`as pulumi.Output<string>` が唯一の実用的な型付け方法。CLAUDE.md の「as 禁止」は TypeScript app コードのルールであり Pulumi infra コードには適用しない
- **state ロック**: CI で途中失敗した場合は `pulumi cancel` でロック解除する
- **`pulumi.output(urlMap)` は inner Output を unwrap しない**: `urlMap` が `Record<string, Output<string>>` のとき `pulumi.output(urlMap)` は `Output<Record<string, Output<string>>>` になる（内側の Output が残る）。`pulumi.all(urlMap)` を使うと `Output<Record<string, string>>` に正しく解決される。`StackReference.requireOutput("ecrUrls")` 経由で参照する側の `.apply(urls => urls["key"])` が `Output<string>` ではなく `string` として扱われてしまい実行時エラーになる
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **LifecyclePolicy への `protect: true`**: 変更時は `pulumi state unprotect <urn>` で保護を解除してから実施
- **`Pulumi.prod.yaml` は必須**: `pulumi stack init prod` 後に忘れがち。`Pulumi.dev.yaml` を作ったら `Pulumi.prod.yaml`（および `Pulumi.main.yaml` があれば）も同時に作る
- **Secrets Manager シークレットに `name` を明示指定すると dev で NameConflict になりやすい**: `name: "/noah/dev/ms-holdings/app"` のように名前を固定すると、削除後に同名シークレットが「pending deletion」状態（デフォルト30日）に入り、同じ名前で再作成しようとすると NameConflict が発生する。dev では `recoveryWindowInDays: 0` を設定して即時削除を有効にすること。prod はデフォルト（30日猶予）のままにして誤削除に対する保護を維持する
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **GitHub Actions (Pulumi CI) ロールの `secretsmanager:GetSecretValue` 要否は「何を Pulumi 管理するか」で変わる**: Secret コンテナ（`aws.secretsmanager.Secret`）だけを管理するなら値の読み取りは不要（`CreateSecret`/`DescribeSecret`/`DeleteSecret` + `GetResourcePolicy` で足りる）。**だが `aws.secretsmanager.SecretVersion` を Pulumi 管理する場合は `GetSecretValue` が必須**: `pulumi up --refresh` が SecretVersion を Read する際、AWS provider は `GetSecretValue` を呼ぶ（version の実体＝値のため `DescribeSecret` では足りない）。これが無いと refresh が `AccessDenied` で落ちる（noah で実際に CI が落ちた）。付与する場合は Resource を自プロジェクトの secret ARN（`secret:noah-*` / `secret:/noah/*`）に限定し、RDS マネージド master secret（`rds!` プレフィックス）には及ばせない。ブラスト半径懸念はあるが、CI ロールは同 ARN に既に `Put/Delete/CreateSecret` を持つため、書き換え・削除できる相手の値を読める追加リスクは小さい（読み取りを避けたいのは人間が投入する機微シークレット。Pulumi 生成の random 値は別物）
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **`SecretVersion` を Pulumi で管理すると差分で毎回 update が走る**: `aws.secretsmanager.SecretVersion` を Pulumi で管理すると、値が変わるたびに `pulumi up` で update が走り CI が壊れる。初期値や手動ローテーションが必要なシークレットは `SecretVersion` を Pulumi 管理外にし、AWS CLI / コンソールから直接値を投入する運用を選ぶ。Pulumi で管理するのはシークレットの「コンテナ（`Secret`）」だけに留める。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ALB アクセスログ有効化では `BucketPolicy.id` を渡して implicit 依存を作る — `bucket.id` では不足**: ALB は `accessLogs` 有効化時（`ModifyLoadBalancerAttributes`）にバケットへテスト PutObject を行う。`SecureBucket` 内の `BucketPolicy` は別リソースなので `bucket.id`（`BucketV2`）を渡すだけでは BucketPolicy が未配置でも ALB が起動しようとし Access Denied になる。対処: `bucketPolicy.id`（`BucketPolicy.id` = バケット名と同値だが Output の依存チェーンが BucketPolicy を経由する）を `accessLogsBucket` に渡す。`LoadBalancer` がこの `Output` を消費することで BucketPolicy 完了まで暗黙的に待機する。`dependsOn: [secBucket]` は ComponentResource ごとで粗すぎる（内部リソース順序を保証しない）ため `.id` チェーン方式が正確。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **ALB アクセスログ配送の Principal はサービスプリンシパル方式を使う（旧 ELB アカウント ID 方式は非推奨）**: AWS 公式ドキュメント "Enable access logs for your Application Load Balancer" は `logdelivery.elasticloadbalancing.amazonaws.com` を現行推奨とし、旧 `aws.elb.getServiceAccount`（リージョン固定 ELB アカウント ID）を "Legacy bucket policy" として置き換え推奨。サービスプリンシパル方式なら `aws.elb.getServiceAccount` 呼び出し・CI ロールへの `elasticloadbalancing:DescribeAccountLimits` 権限追加がいずれも不要。Statement の Resource は `${bucketArn}/AWSLogs/${accountId}/*`、Condition に `ArnLike: { "aws:SourceArn": "arn:aws:elasticloadbalancing:*:${accountId}:loadbalancer/*" }` を加えて同アカウントの ALB のみに絞る（AWS 推奨・2026-06-11 確認）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **バケットポリシー Statement がバケット自身の ARN を参照する場合は component 内部で組み立てる**: `SecureBucket` への `extraPolicyStatements` のような「外から Statement を注入する」方式では、Statement の `Resource` フィールドに `bucket.arn` を含める場合に循環参照になる（バケット ARN が確定する前に Statement を組み立てる必要があるため）。この場合は `albLogDelivery?: { accountId }` のような専用引数を component に持たせ、constructor 内で `bucket.arn` が参照可能になってから Statement を組み立てる。外部注入で使える `extraPolicyStatements` はバケット ARN を含まない Statement（例: 特定プリンシパルの読み取り許可）に限る。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **リソースに渡すローカルファイルパスは、実行時の作業ディレクトリからの相対パスにする — 絶対パスは CI と手元で値が変わり、無限に差分が出続ける**: `contentFile` / `directory` のようなプロパティに `path.resolve(...)` した絶対パスを渡すと、その文字列が state に保存される。CI（`/home/runner/work/...`）と手元（`/Users/...`）で絶対パスの先頭が違うため、内容が同一でも `pulumi preview` が毎回「更新あり」と報告し続ける。対処: state に書く直前に `path.relative(process.cwd(), absolutePath)` で相対パスへ変換する。前提として `pulumi` の実行ディレクトリ（`Pulumi.yaml` のある場所）が CI・手元で揃っている必要がある（CLAUDE.md 等に「必ず `infra/` で実行する」と明記する）。実例: MEGURU の Cloudflare Worker（`contentFile`・`assets.directory`）と `command.local.Command` の `dir` で発生（2026-09-25）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->
- **`config.require()` を追加したら対応する `Pulumi.*.yaml` も同時に更新する**: `config.require("key")` を実装した後に `Pulumi.dev.yaml`（や `.prod.yaml`）へのキー追加を忘れると、`pulumi up` / `pulumi preview` が即時クラッシュする。infra 実装後に「`config.require` / `config.get` しているキー」と「`Pulumi.*.yaml` に存在するキー」の整合を目視確認すること。**特に `Pulumi.prod.yaml`**: dev にキーを追加しても prod をコメントアウトのままにするのは NG。ドメイン未確定などの理由で本値が決まっていなくても `"https://placeholder-replace-after-ISSUENUM.example.com"` 等のプレースホルダーを入れること（コメントアウトは `config.require` でクラッシュするため等価でない）。issue 060 で `betterAuthUrl` を prod で `# コメントアウト` にして Round 3 のレビューで検出した。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
