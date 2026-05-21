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
- **LifecyclePolicy への `protect: true`**: 変更時は `pulumi state unprotect <urn>` で保護を解除してから実施
- **`Pulumi.prod.yaml` は必須**: `pulumi stack init prod` 後に忘れがち。`Pulumi.dev.yaml` を作ったら `Pulumi.prod.yaml`（および `Pulumi.main.yaml` があれば）も同時に作る
