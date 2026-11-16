# Pulumi（TypeScript / AWS）で踏んだ罠と、この利用者の構成

> **TL;DR**: PulumiでAWSのインフラを書く、レビューする、GitHub Actionsからデプロイするときに読む。入門の内容は書かず、この利用者の構成の決めごとと、実際に間違えた点だけを置く。

整理する前の版は`archive/2026-11-16/docs/`の`pulumi.md`、`pulumi-aws.md`、`pulumi-cicd.md`にある（この文書は3つをまとめたもの）。GitHub Actionsだけの話は`github-actions.md`にある。

## 構成の決めごと

- stateはS3バックエンドに置く。ログインは`pulumi login 's3://<bucket>?region=ap-northeast-1&awssdk=v2'`
- S3バックエンドの`StackReference`は`organization/<project>/<stack>`と書く（orgは常に文字列の`organization`）
- `apply`の中で外部APIを呼ばない。実行時に決まる値はConfigか`StackReference`で渡す
- Monorepoは`infra/shared/`（VPC、ECRなどの共通）と`infra/<client>/`（クライアントごと。`StackReference`で`shared`を読む）に分ける
- スタックの名前は`<org>/<project>/<env>-<client>`（例: `my-org/myproj-infra/prod-acme`）。envの無いスタックは`Pulumi.main.yaml`をコミットし、`defaultTags`は`Environment: "shared"`にする
- NAT Gatewayは、prodが`Single`、devは`None`（課金を避ける）。`pulumi preview`に`aws:ec2:NatGateway`が出たら、devで`Single`にしていないかを見る
- DBのSecurity Groupのegressは`[]`にする（RDSは外へ接続を始めない）
- ECRには、lifecycle policy（untaggedのイメージが溜まると費用が増える）、暗号化、prodだけの`protect`を付ける。`protect`を全環境に付けると、devのリソースを消せなくなる。`encryptionConfigurations`は配列（単数形は型エラー）
- マルチテナントのSaaSでは、初めは1顧客に1つのALBを持たせる。共有のALBとホスト名でのルーティングは、設定の誤りが全顧客に及び、ログと費用の按分が混ざり、各顧客のスタックに共有ALBのListener Ruleを変える権限が要る。顧客が50を超えて費用の差が効いてきたら、Tierごと（小口は共有、大口は専用）を考える
  <!-- mentions: 1 | first-seen: 2026-05 -->

## Configとstate

- **`config.require`を足したら、全スタックの`Pulumi.<stack>.yaml`に同じ変更でキーを足す**: 値が決まっていないprodにも、コメントアウトでなく仮の値（`"https://placeholder-replace-after-ISSUENUM.example.com"`など）を入れる。コメントアウトは`require`で落ちる。`Pulumi.dev.yaml`を作ったら、`Pulumi.prod.yaml`と`Pulumi.main.yaml`も一緒に作る。
  <!-- mentions: 2 | first-seen: 2026-06 -->

- **リソースに渡すローカルのファイルパスは、実行時の作業ディレクトリからの相対パスにする**: `contentFile`や`directory`に`path.resolve(...)`した絶対パスを渡すと、その文字列がstateに入る。CI（`/home/runner/work/...`）と手元（`/Users/...`）で先頭が違うので、中身が同じでも`pulumi preview`が毎回「更新あり」と出す。stateに書く前に`path.relative(process.cwd(), absolutePath)`で直す。`pulumi`を実行するディレクトリ（`Pulumi.yaml`のある場所）を、CIと手元で揃えておく。Cloudflare Workerの`contentFile`、`assets.directory`と、`command.local.Command`の`dir`で起きた。
  <!-- mentions: 1 | first-seen: 2026-09 -->

- **`pulumi.output(urlMap)`は、内側のOutputをほどかない**: `urlMap`が`Record<string, Output<string>>`のとき、`pulumi.output(urlMap)`は`Output<Record<string, Output<string>>>`になる。`pulumi.all(urlMap)`なら`Output<Record<string, string>>`になる。前者を`StackReference.requireOutput("ecrUrls")`で読む側は、`.apply(urls => urls["key"])`が`string`として扱われ、実行時エラーになる。
  <!-- mentions: 1 | first-seen: 2026-05 -->

- **`requireOutput()`の`as`キャスト**: `requireOutput()`は`Output<any>`を返すため型アノテーション方式はコンパイルエラー。`as pulumi.Output<string>`が唯一の実用的な型付け方法。CLAUDE.mdの「as禁止」はTypeScriptのappコードのルールであり、Pulumiのinfraコードには適用しない

## Secrets Manager

- **Pulumiで管理するのはSecretの入れ物（`aws.secretsmanager.Secret`）だけにし、値（`SecretVersion`）は管理しない**: `SecretVersion`を管理すると、値が変わるたびに`pulumi up`でupdateが走り、CIが壊れる。初期値や手でのローテーションが要る値は、AWS CLIかコンソールから入れる。入れ物だけなら、CIのロールに値を読む権限は要らない（`CreateSecret`、`DescribeSecret`、`DeleteSecret`、`GetResourcePolicy`で足りる）。`SecretVersion`を管理するなら`secretsmanager:GetSecretValue`が要る。`pulumi up --refresh`が`SecretVersion`を読むときにこのAPIを呼び、無いと`AccessDenied`で落ちる。付けるときは、Resourceを自プロジェクトのARN（`secret:myproj-*`、`secret:/myproj/*`）に限り、RDSが管理するmaster secret（`rds!`で始まる）には及ばせない。
  <!-- mentions: 3 | first-seen: 2026-06 -->

- **Secretに`name`を固定すると、devでNameConflictになりやすい**: 消したSecretは既定で30日のあいだ「pending deletion」になり、同じ名前で作り直せない。devでは`recoveryWindowInDays: 0`ですぐ消えるようにする。prodは既定の30日のままにして、誤って消したときに戻せるようにする。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## 既にあるリソースをComponentResourceの下へ移す

スタックの直下のリソースをcomponentの下へ移すと、parentが変わってURNが変わり、previewにreplaceかdelete+createが出る。子リソースのoptsに`aliases: [{ parent: pulumi.rootStackResource }]`を書くと、旧URNを引き継げる（新しいスタックでは旧URNが無く何も起きないので、付けたままでよい）。論理名も変えるなら`aliases: [{ name: "<旧論理名>", parent: pulumi.rootStackResource }]`と`name`も書く。

移すPRでは、旧コードをVCSから開き（`jj file show -r main <file>`）、リソースごとに次の3点を突き合わせる。注意がaliasに向くので、2と3を落としやすい。

1. **論理名が同じか**: componentの側は`${name}-<suffix>`で組むので、`name`に既にsuffixが入っていると二重になり（`-jobs-jobs-`など）、aliasが効かない
2. **optsが保たれているか**: 旧コードが付けていた`protect: isProduction`や`dependsOn`が、`{ parent: this, provider }`への書き換えで消えていないか
3. **statementとargsの中身が同じか**: 中身が変わると、aliasが効いてもupdateかreplaceが出る

previewでは、componentのcreate、意図した改名のcreate+delete（IAMのRolePolicyは同じroleに別名で共存でき、createが先なので権限の空白は無い）、TaskDefinitionのrevisionのreplaceは、出てよい差分。状態を持つリソース（Secret、RandomPassword、S3、SecurityGroupRule、ECS Service）のreplaceやdeleteは、aliasが漏れている兆候。
<!-- mentions: 1 | first-seen: 2026-06 -->

## ALBのアクセスログ

- **`accessLogs`のバケットには、`bucket.id`でなく`bucketPolicy.id`を渡す**: ALBは`accessLogs`を有効にするとき、バケットへ試しにPutObjectする。`BucketPolicy`は別のリソースなので、`bucket.id`を渡すだけでは、ポリシーが付く前にALBが動いてAccess Deniedになる。`bucketPolicy.id`（値はバケット名と同じ）を渡すと、Outputの依存が`BucketPolicy`を通り、付くまで待つ。`dependsOn: [secBucket]`はComponentResourceの単位なので、中のリソースの順序までは決まらない。
  <!-- mentions: 1 | first-seen: 2026-06 -->

- **ログを書き込むPrincipalは、サービスプリンシパル（`logdelivery.elasticloadbalancing.amazonaws.com`）にする**: AWSの公式ドキュメント「Enable access logs for your Application Load Balancer」は、`aws.elb.getServiceAccount`（リージョンごとのELBのアカウントID）を「Legacy bucket policy」としている。サービスプリンシパルなら、`getServiceAccount`の呼び出しも、CIのロールへの`elasticloadbalancing:DescribeAccountLimits`も要らない。Resourceは`${bucketArn}/AWSLogs/${accountId}/*`、Conditionに`ArnLike: { "aws:SourceArn": "arn:aws:elasticloadbalancing:*:${accountId}:loadbalancer/*" }`を足して、同じアカウントのALBに限る（2026-06-11に確認）。
  <!-- mentions: 1 | first-seen: 2026-06 -->

- **バケット自身のARNを参照するStatementは、componentの中で組み立てる**: `extraPolicyStatements`のように外からStatementを渡す形だと、`Resource`に`bucket.arn`を入れたいときに循環する。`albLogDelivery?: { accountId }`のような専用の引数を持たせ、constructorの中で組み立てる。外から渡す形は、バケットのARNを含まないStatementに限る。
  <!-- mentions: 1 | first-seen: 2026-06 -->

## IAM

- **Pulumiのデプロイロールは、触るサービスを`service:*`で持つ。IAMだけは広げない**: action単位にすると、`up --refresh`が呼ぶread系のAPI（`rds:DescribeGlobalClusters`など、resource-levelに対応しないものが多い）で403が続く。IAMは`role/<prefix>-*`に絞ったままにする（CIに`iam:*`をResource `*`で渡すと、侵害されたときに任意のロールへAdministratorAccessを付けられる）。Secretsはactionを広げてよいが、Resourceは自プロジェクトのARNに限る。新しいサービスを足すときは、手元のadminで`pulumi up`して権限以外の誤り（ビルド、コンテナのmanifestの形、リソースの設定）を先に出す（`preview`では出ない）。adminでは権限不足は見つからないので、`rg 'new aws\.'`でinfraが触るサービスを並べてロールと比べる。正確に洗い出すなら、CIのロールか同じポリシーのロールをassumeして`up`するか、`iamlive`を使う。CIの往復（毎回十数分）で1つずつ直さない。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- アカウント単位のAPI（`ecs:DescribeServices`、`ecr:GetAuthorizationToken`など）はARNで絞れず、`Resource: "*"`が要る。操作ごとにStatementを分けて、Resourceの範囲を使い分ける
- PulumiでIAMロールを管理するなら、`PassRole`に加えて`CreateRole`、`DeleteRole`、`GetRole`、`AttachRolePolicy`、`DetachRolePolicy`、`TagRole`が要る。`arn:aws:iam::<ACCOUNT>:role/<prefix>-*`に絞った専用のStatementにする
- ポリシーが重なっているときは、広い範囲（`ecs:*`）を残し、個別のStatement（`ECSUpdate`）を消す。ECRは`PulumiInfraAccess`から外し、専用のStatement（`ECRAuth`、`ECRRepoAccess`）に任せる

## GitHub Actionsからのデプロイ

AWSの認証（IAMユーザーのキーか、OIDCか）は、プロジェクトと時期で違う。そのプロジェクトのworkflowに合わせる。

- `up`（mainへのpushでデプロイ）と`preview`（PRにコメント）は、別のworkflowにする。デプロイは`cancel-in-progress: false`（途中で止めない）、previewは`true`
- S3バックエンドでは`PULUMI_CONFIG_PASSPHRASE: ""`と`PULUMI_ACCESS_TOKEN: ""`を置く（未設定だと対話の質問が出る）。バックエンドは`cloud-url: ${{ secrets.PULUMI_BACKEND_URL }}`で渡す
- `pulumi/actions`には`refresh: true`（driftを見つける）と`upsert: false`を付ける
- `StackReference`で依存するスタックは`needs:`で順に実行する。依存の無いスタックは並べてよい（S3のstateのロックはスタックごと）。previewもデプロイと同じ`needs`にする（並べると、参照先のstateが古いままpreviewされる）
- クライアントごとのアプリのデプロイは、`apps/<client>/**`でworkflowを分け、reusable workflow（`_app-deploy.yml`）に`ecr-repository`、`stack-name`、`work-dir`を渡す
- ECRのレジストリのURLは`amazon-ecr-login`の`${{ steps.login-ecr.outputs.registry }}`から取り、AWSのアカウントIDを直に書かない
- Fargateを明示してARM64にするなら、Pulumiの`cpuArchitecture: "ARM64"`と、workflowの`platforms: linux/arm64`を揃える

- **ECSのイメージの更新は、`aws ecs update-service`でなく`config-map`で渡す**: `update-service --force-new-deployment`はECSのリソース名を直に書くことになり、インフラとアプリでデプロイの仕組みが分かれる。`index.ts`で`const imageTag = config.get("imageTag") ?? "latest"`を読み、`pulumi/actions`の`config-map`で`imageTag: { value: ${{ github.sha }} }`を渡す。タスク定義の更新、ローリングアップデート、安定を待つ処理をPulumiが受け持ち、初回と2回目以降が同じ仕組みになる。`config-map`は手元の`Pulumi.<stack>.yaml`を書き換えない。

- **bootstrapのworkflowでは`upsert: true`を使う**: `pulumi stack init ... || true`で失敗を隠した後に`upsert: false`で`up`すると、initが本当に失敗していたとき「スタックが無い」で`up`も落ちる。
  <!-- mentions: 1 | first-seen: 2026-05 -->

- **prodのスタックも`infra-deploy.yml`のmatrixに入れる**: 外すと、`Pulumi.prod.yaml`の`imageTag`をPRで変えてマージしても、何も起きない。「prodへのデプロイを利用者が決める」は「`Pulumi.prod.yaml`の変更をPRで承認する」ことで、CIのmatrixからprodを外すことではない。
  <!-- mentions: 1 | first-seen: 2026-05 -->
