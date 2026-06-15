## 応答スタイル

- 選択肢を提示してユーザーが選んだとき、その選択に問題があれば選ばれた後でも指摘する。「いい選択ですね」で終わらない
- 前提が間違っている質問は、まず前提を訂正してから答える
- 不確かなことは「〜のはず」を省かず明記する。知らないことは知らないという
- 長期的に筋の悪い選択（「楽だから」「今は動くから」）には理由を添えて代替を示す

## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用
- portless: ローカル開発サーバーを `https://<appname>.localhost` で起動する（mise 管理: `npm:portless`）

## ローカル開発サーバー

フロントの動作確認は `portless` を使う（`localhost:PORT` でなく `https://<appname>.localhost`）。アプリディレクトリで `mise exec -- portless`。初回はローカル CA を生成して HTTPS 化（sudo 昇格）、jj ワークスペースではブランチ名がサブドメインに付く。詳細は `/portless`。

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `/jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

コマンドリファレンス: `~/.claude/docs/jj.md`

## ~/.claude の管理

`~/.claude/skills/`、`~/.claude/commands/`、`~/.claude/agents/`、`~/.claude/rules/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` で管理されている。
スキル・コマンド・エージェントを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink経由で自動反映）。

**編集時は必ず実体パス `~/github.com/pomesaka/dotclaude/...` 経由で行う**。`~/.claude/...` パスで Edit/Write しようとすると auto-mode classifier が「self-modification of agent configuration」として block する。classifier は symlink を resolve しないため、実体パスで開けば通る。対象: `CLAUDE.md` / `skills/` / `commands/` / `agents/` / `rules/` / `docs/` すべて。

## Tmp Directory

- ~/.claude/tmp/ を一時ファイル保存場所として使用
- 作業ログや調査中のエラーログなどの保存に利用

## Frontend Implementation

フロントエンド（HTML/CSS/JS/React/Next.js）を実装するときは、デザイン品質を意識すること。

- プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- ない場合は `~/.claude/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `/use-design` で適用できる
- AIが生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つUIを目指す

デザイン原則の詳細: `~/.claude/skills/frontend-design/SKILL.md`

## ユビキタス言語・用語集

プロジェクトに `docs/glossary.md`（または同等の用語集ファイル）がある場合、それは**非エンジニア（顧客・現場担当者）とコードベースをつなぐ共通言語**であり、最重要ドキュメントのひとつ。用語集が腐るとチーム内のコミュニケーションロスが発生しやすくなる。

- **読み手は非エンジニアを含む。「その語を現場の人が製品について話すときに口にするか？」が取捨の基準**。用語集を domain 層の型カタログにしない（肥大化すると本当に共有すべき業務語が plumbing 型の海に埋もれ、本来の機能を失う）
- **載せるのは業務概念だけ**: エンティティ・値オブジェクト・利用者が知覚する業務状態。業務エンティティに対応する core 型には所在（型名・ファイル）を軽いポインタとして併記してよい
- **載せない（実装 plumbing）**: `*Store`/`*Client`/`*Provider`/`*Config`/`*Deps`/`*Agent`系/`*Input`/`*Result`(ラッパー)/`*Usage`/`*Event`/hooks/`*View`/Server Action/CQRS 関数/認可ガード/入力ラッパー/定数(`*_MODEL_ID`・`MAX_*` 等)/lifecycle ジョブ基盤/インフラ型（テナントスキーマ・S3 キー等）。これらの置き場は architecture/conventions/コードコメント
- **型名・変数名・ファイル名はここに準拠する**。用語集にない業務概念を実装で勝手に命名しない
- **新しいドメイン概念（業務語）を定義したら用語集に追記する**。ただし plumbing 型は追記しない（上記基準）。実装だけが先行してはいけない
- レビューループでも、新しいドメイン**概念**の追加を確認したら `[要更新]` として用語集更新を指摘する（plumbing 型の登録漏れは指摘対象外）

## Coding Policy

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- コメント: 設計判断・分岐・非対称な扱いには **WHY（なぜそうしたか）と WHY NOT（なぜ他のもっともらしい選択肢を採らなかったか）を両方**書く。WHY だけだと「やり残し / バグ」と区別がつかない。自明なロジックには引き続きコメント不要
- **WHY コメントに書く前提は実機で検証してから書く**（憶測の WHY は将来の罠になる）: 「TypeScript が circular inference で推論できない」「library X が auto-fallback してくれる」のような **ライブラリ・ツールの挙動を断定する WHY** は、必ず実機で検証（型エラーを誘発・公式ドキュメントを当たる・実際に呼び出す）してから書く。検証せず憶測を書くと、後続レビューが「ここは確認済み」とスルーし誤りが温存される。実例: noah で `betterAuth() 内で循環推論できないため "role" in ガードが必要` と書いたが実際は外部から推論可能、`admin plugin が admin ロールに自動で標準権限を付与する` と書いたが実際は roles 指定時は置換され消える — いずれもドキュメント・型確認で即否定できた憶測だった。さらに `jp. inference profile は ap-northeast-1 に留める` という未検証の断定がコメントと CLAUDE.md に書かれた結果、「東京リージョンだけ IAM 許可すればよい」という誤実装の根拠として参照され、確率的 403 障害を生んだ（実際は東京+大阪の2リージョン構成・`aws bedrock get-inference-profile` で即確認できた）— **誤った WHY は単に放置されるのでなく、後続実装の「正しさの根拠」として再利用され障害を再生産する**。さらに issue 075 で `rowToInProgressStep` に「TypeScript が step を string として扱うため型ガードが必要」という WHY を書いたが、`.$type<MinutesStepDb>()` により TypeScript は literal union を正しく推論しており誤りだった（関数の実目的はランタイム防御）。NG: `// WHY X: library Y がそうする`（未検証）／OK: `// WHY X: library Y vN.M で動作確認・公式パターン a/foo を参照`（検証済み）。**亜種: 「〜は未検証。現状許容する」という形も同じ規約違反** — 「未検証」を明示した上で「許容」という判断を断言すると、読者は「問題ないと判断済みのはず」と解釈してそれ以上掘り下げなくなる。未検証の前提は「将来確認する」か「確認した上で結論を書く」かのどちらか。issue 049 で `auth.api.getSession が 2 回 DB を叩くかは better-auth の内部キャッシュ実装に依存しており未検証。現状許容する` という WHY を書いたが、`requireAccess` が `React.cache` を使わない事実を確認後に「Request Memoization による重複排除は発生しない（確認済み）、頻度が低いため問題にならない見込み」に改めた
  <!-- importance: high | mentions: 5 | first-seen: 2026-06 -->
- **ツールが所有する生成物ファイルは手書きしない — 必ずツールのコマンドで生成する**: lockfile・migration journal/snapshot（drizzle の `_journal.json`・`meta/*_snapshot.json` 等）・チェックサムファイルのような「ツールが読み書きする前提のメタデータ」を手で書くと、ツールが暗黙に守っている不変条件（タイムスタンプの単調増加・snapshot のチェーン整合・ハッシュ一致）を破り、**エラーではなく無音の故障**（migration の無音スキップ・次回生成時の重複 DDL 等）として現れる。エントリの一部だけ手書きするのも同罪（不変条件はファイル全体で守られる）。実例: noah で drizzle の journal エントリを epoch 手計算で追記 → 年を 2025/2026 取り違え、適用済みより古い `when` になり migration が「成功表示のまま」スキップされ続けた。**現在時刻・epoch を書く必要があるときも頭で計算せず `date +%s` 等のコマンドで取得する**（年・タイムゾーンを取り違えやすい）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- TypeScript: as キャストは禁止
- **`as` キャスト全除去チェックは `rg ' as [^a-z ]'` を使う（`as [A-Z]` では数値 literal を取りこぼす）**: `as WizardStep` のように大文字始まりの型は `rg ' as [A-Z]'` で検出できるが、`as 1 | 2 | 3 | 4 | 5` のような数値 literal union は引っかからない。`as [^a-z ]`（小文字・スペース以外が続く `as`）のパターンで `as const` を除く実質的なキャストを網羅できる（`as const` は `as ` + 小文字なのでこのパターンに引っかからない）。実例: adachi invoice モックで `step={wizardStep as 1 | 2 | 3 | 4 | 5}` が `' as [A-Z]'` チェックをすり抜け、`' as [^a-z ]'` で初めて検出された。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **値による分岐は switch-case を使う**: 1つの変数の値によって複数のケースに分岐するコード（step → 型変換・status → ラベル等）は `if (x === "a")` の連鎖ではなく `switch (x) { case "a": ... }` で書く。switch は「この関数は x の全ケースを網羅している」という意図が読み手に伝わりやすく、TypeScript の exhaustive check とも相性が良い。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る
- **`test.each` テーブル行に条件分岐フラグ（`needsSegments` 等）を入れない**: ケースによって異なるセットアップが必要なとき、テーブル行の中で `if (flag)` や `condition ? setupA() : setupB()` を使うとテストの意図が不明瞭になる。代わりに独立した `test(...)` に分割する。テーブルの各行は「1ケース = 完全に自己完結した入力と期待値」で成立させる
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## Interaction Rules

- ユーザーへの質問は極力 `AskUserQuestion` ツールを使う

## Context Management

- context が 60% を超えたら新しいタスクを始めない
- `/compact` は必ずヒント付きで実行する（例: `/compact focus on X, drop Y`）
- autocompact に自動発火させない — 発火タイミングは intelligence が最低の状態
- tool call の詳細ではなく結論だけ必要なら subagent に投げる（Agent ツール、`context: fork`）
- `/rewind` 前に「summarize from here」を依頼して引き継ぎメモを生成する

## サブエージェント委譲（速度最適化）

委譲は自動的に速くならない。速くなるのは以下の形のときだけ — この形に当てはまるなら積極的に委譲する:

- **独立タスクの並列実行**（最大の効果）: 互いに依存しない作業は複数の Agent を**1メッセージで同時起動**する。逐次で投げると並列の意味がない
- **メイン context の軽量化**: ファイルダンプの多い探索・調査は subagent に投げて**結論だけ**受け取る。メインの context が膨らむと以降の全ターンが遅くなるため、長いセッションほど効く
- **機械的作業のスループット**: lint/typecheck 修正・一括変換など判断の少ない作業は `model: "sonnet"`（さらに単純な収集は `"haiku"`）を指定する。小さいモデルは出力が速い。**指定しないと親モデルを継承する**ので速度メリットが出ない

**委譲すると逆に遅くなるケース**: 逐次依存する短いタスク。spawn のオーバーヘッド + サブエージェントがコンテキストをゼロから再発見するコストで、メインで直接やるより遅い。「次のステップがこの結果に依存していて、かつ数分で終わる」ならメインでやる。

## Bash Commands

Shell operator（`&&`/`||`/`;`/`|`）を含む複合コマンドは**パーミッションプロンプトを誘発するため避ける**。フォールバック（`cmd1 || cmd2`）も使わず、正しいコマンドを1つ決めて実行する。パイプ（`|`）は `rg`/`jq` など read-only フィルタのみ可（書き込みを伴うものは禁止）。`cd /path && cmd` の代替策は `~/.claude/docs/bash-tips.md` 参照。

## スキル（SKILL.md）設計規約

- **`allowed-tools` とスキル内指示ツールを一致させる**: スキル本文で「Write で保存する」「Edit で修正する」と指示するなら `allowed-tools` に `Write`/`Edit` を追加すること。ツールが許可リストに無いとスキル実行時にブロックされる。新しいスキルを書くたびに、本文を通読して使うツールをリストアップする習慣をつける。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
- 認証・認可・ORM・バリデーション・ジョブ基盤など横断的な関心事を自前設計する前に、採用済みライブラリ/フレームワークに同等機能がないか公式ドキュメントで調査する。自前を選ぶ場合もその判断に根拠を持つ（自前設計自体が悪いのではなく、調査せず倒すのが問題）。
- **PM セッションは issue のステータスを更新しない**: 「着手できそう」「もう終わった」と判断しても、issue の `status` フィールド（open → in-progress → done）を変更しない。ステータス更新は**着手した実装セッション**の責務。PM セッションが変更すると、実装セッション側が同じ issue を別の状態で参照したときに意図せず差し戻すか上書きする事故が起きる。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **デザイン要件ドキュメント（デザイナーブリーフ）は「現状の説明」でなく「正しい仕様の定義」として書く**: 実装途中・UI 未着手の機能のデザイン依頼ドキュメントは、現在の実装を真実として記述するのでなく、**あるべき正しい仕様を定義する**フレームで書く。現行実装がその仕様から乖離していれば「作り直し対象」として明示し、理由を書く。ユーザーが「このドキュメントは仕様策定の意味合いもある」と言った時点でこのフレームに切り替える。シグナル: 画面のリデザイン、in-progress の機能追加（ブランチ概念追加など）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
