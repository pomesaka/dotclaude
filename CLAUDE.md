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
  <!-- importance: high | mentions: 9 | first-seen: 2026-06 -->
  **亜種: `Reflect.get` の戻り値を「unknown」と誤記するパターン**: `Reflect.get(obj, key)` は `as` キャスト禁止の代替として使うが、戻り値の静的型は `any`（`unknown` ではない）。コメントに「戻り値は unknown」と書くと「型安全に取り出せる」という誤解を招く。正しい説明: 「`Reflect.get` の戻り値は実質 `any` だが、直後に `unknown` 変数で受け取り `typeof` で narrowing する — `as` キャストは narrowing をバイパスするがこの方法は narrowing を通す」（issue 239 の `open-invoice-pdf.ts` で policy reviewer 指摘・修正）。
  **亜種: JSDoc の手順記述に「通常到達しないパス」が主要ユースケースとして書かれる**: 正規化関数の JSDoc に「"NO." プレフィックスがある場合に数字部分を取り出す」と書いたが、LLM が schema description により NO. なしの数字部分のみを返すため、そのパスは通常到達しない。JSDoc が fallback パスをメインユースケースとして書くと読者が誤解する。**対処**: 通常到達しないパスは「このパスは通常到達しない（なぜなら…）」と明示する。実例: issue 207 の `normalizePurchaseOrderNumber` で「NO. プレフィックスがある場合」→「WHY NOT: LLM は schema description により数字部分のみを返すため、このパスは通常到達しない」に修正（quality reviewer 指摘）。
- **JSDoc の「後続 issue で対応予定」コメントは実装後に更新する**: `// #111 値引き/経費 が追加予定` のような placeholder コメントが本 PR で実装済みになったのに残るケースがある。issue を実装した PR のレビュー前に、自分が追加した JSDoc 内の「後続 issue で〜」「追加予定」「TODO(#NNN)」コメントを全文検索し、今 PR で解決済みなら削除・更新する。`rg 'TODO\(#NNN\)\|追加予定\|後続 issue' <変更ファイル>` で確認する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **WHY コメントは「採用した設計」の視点から書く — 「検討したが採用しなかった設計」の WHY を実装として書かない**: 設計検討（案 A を検討 → 却下 → 案 B を実装）の流れで、案 A の WHY を「なぜこうしたか」として書いてしまうミスが起きる。読者は「A が実装されている」と誤解し、将来の開発者が「既に A を選んだ根拠がある」と信じて誤った方向に進む。**正しい形**: 実装した B の視点から `WHY B: ...`（なぜ B を選んだか）と `WHY NOT A: ...`（なぜ A を選ばなかったか）を書く。採用しなかった A の説明は「WHY NOT」節に置き、B の実装コメントに「A を選んだ」かのように書かない。実例: issue 112 で `vendor-hints.ts` の JSDoc に「全ヒント埋め込み方式を選んだ WHY」が書かれていたが、実装は 2-pass 方式だった → コードと文書が乖離し domain review で検出・削除。NG: `// WHY: 全ヒントを system prompt に埋め込む`（実際は 2-pass）／OK: `// WHY 2-pass: ... / WHY NOT 全埋め込み: ...`（実装 B の視点から書く）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ツールが所有する生成物ファイルは手書きしない — 必ずツールのコマンドで生成する**: lockfile・migration journal/snapshot（drizzle の `_journal.json`・`meta/*_snapshot.json` 等）・チェックサムファイルのような「ツールが読み書きする前提のメタデータ」を手で書くと、ツールが暗黙に守っている不変条件（タイムスタンプの単調増加・snapshot のチェーン整合・ハッシュ一致）を破り、**エラーではなく無音の故障**（migration の無音スキップ・次回生成時の重複 DDL 等）として現れる。エントリの一部だけ手書きするのも同罪（不変条件はファイル全体で守られる）。実例: noah で drizzle の journal エントリを epoch 手計算で追記 → 年を 2025/2026 取り違え、適用済みより古い `when` になり migration が「成功表示のまま」スキップされ続けた。**現在時刻・epoch を書く必要があるときも頭で計算せず `date +%s` 等のコマンドで取得する**（年・タイムゾーンを取り違えやすい）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- TypeScript: as キャストは禁止
- **`as` キャスト全除去チェックは `rg ' as [^a-z ]'` を使う（`as [A-Z]` では数値 literal を取りこぼす）**: `as WizardStep` のように大文字始まりの型は `rg ' as [A-Z]'` で検出できるが、`as 1 | 2 | 3 | 4 | 5` のような数値 literal union は引っかからない。`as [^a-z ]`（小文字・スペース以外が続く `as`）のパターンで `as const` を除く実質的なキャストを網羅できる（`as const` は `as ` + 小文字なのでこのパターンに引っかからない）。実例: adachi invoice モックで `step={wizardStep as 1 | 2 | 3 | 4 | 5}` が `' as [A-Z]'` チェックをすり抜け、`' as [^a-z ]'` で初めて検出された。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **値による分岐は switch-case を使う**: 1つの変数の値によって複数のケースに分岐するコード（step → 型変換・status → ラベル等）は `if (x === "a")` の連鎖ではなく `switch (x) { case "a": ... }` で書く。switch は「この関数は x の全ケースを網羅している」という意図が読み手に伝わりやすく、TypeScript の exhaustive check とも相性が良い。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **合成キー文字列は1つの関数に集約する — インライン構築を散らさない**: `${a ?? ""}:${b ?? ""}` のような合成キーを複数箇所でインライン構築すると、キー形式を変更したとき変更漏れによる無音の不整合（照合ミス・カウント誤差）が生じる。**合成関数（`resolutionKey(a, b)` 等）を1箇所に定義して全ての構築箇所から呼ぶ**。判断基準: 「このキー文字列は2箇所以上で構築されているか？」YES なら関数化する。実例: issue 223 で `resolutionKey()` を `unresolved-count.ts` に定義したが `assemble.ts`・`invoice-pairing-detail.ts` が同じ形式をインライン構築していた — quality reviewer 指摘で統一（インライン重複はキー形式変更時にサイレント誤カウントを生む）。再発: issue 242 で `vendorKey()` を定義したが `invoice-months.ts` の `carryOverFromPrevKey` 計算で `name:${firstInv.vendorName}` とインライン構築していた — quality reviewer 指摘で `vendorKey()` 経由に統一。**関数を定義してから別ファイルでインライン構築が新たに生まれることがある — PR レビュー時に「このキーは vendorKey() 等の合成関数経由か？」を全箇所確認する**。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **mutable な local 変数（TS/JS の `let`、Go の再代入 `var`、Kotlin の `var` 等）は「より宣言的な形がないか」を立ち止まる signal — ただし即「関数抽出」に逃げない**: 再代入される local 変数は default の `const`/`val` から外れるため、「もっと宣言的に書けないか」を考えるトリガーになる。**判断手順**: ① まず宣言的な形（`map/filter/reduce`・三項演算子・switch 式・中間 const の多段分解）で消せないか試す ② それでも mutable が残るなら、その値の lifecycle が**独立した関数として意味を持つか**問う（[[合成キー集約]] と同じ「2 箇所以上で使われるか」の基準）。意味があり 2 箇所以上で使われるなら抽出、なければ mutable のまま残す ③ ループカウンタ・hot loop（パフォーマンスクリティカル）・state machine の状態など mutable が本質のケースは例外として残す。NG: `let x; if (a) x = "X"; else x = "Y";` を即 `function getX() { ... }` に抽出 ／ OK: `const x = a ? "X" : "Y";`（より宣言的・関数化不要）／ OK: `const total = items.reduce((s, x) => s + x.price, 0);`（accumulator `let` を消す）／ 抽出が正解な例: `switch` で値を組み立てる処理は switch 全体を関数化して early return（呼び出し側は `const result = computeX(...)`）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る
- **`test.each` テーブル行に条件分岐フラグ（`needsSegments` 等）を入れない**: ケースによって異なるセットアップが必要なとき、テーブル行の中で `if (flag)` や `condition ? setupA() : setupB()` を使うとテストの意図が不明瞭になる。代わりに独立した `test(...)` に分割する。テーブルの各行は「1ケース = 完全に自己完結した入力と期待値」で成立させる。**assertion パターンが変わるケースも同様**: 例えば「行が0件の場合は `toHaveLength(0)` だけ、1件以上の場合は追加で行の内容も検証」のように assertion 数が変わるケースも `if (expectedRows > 0)` というフラグが必要になり、テーブル化できない。assertion パターンが異なるケースは独立した `test()` に分離し、同じパターンのケースのみ `test.each` でまとめる
  **補足: for ループが 0 回走ること自体は assertion パターンの変化ではない**: `for (let i = 0; i < pairings.length; i++) { ... }` のループ本体が空配列で実行されないのは「assertion コードの構造が同じ・期待値が空なだけ」。`if (flag)` 条件分岐とは別物で、この形のケース（配列 0 件・N 件の両方）は同じ test.each テーブルに共存できる（issue 210 Stage 3 テーブルで確認 2026-06）。
  **補足: テーブルに 1 行しかないなら `test.each` でなく独立した `test(...)` にする**: テーブル駆動の意義は「同じ構造・複数のケース」の共通化にある。行が 1 つしかないと「同じ構造のケース集」としての意味がなく、読み手が「他のケースがあるはず」と誤解する。1 行 `test.each` を見たら独立した `test(...)` に変換すること（quality reviewer がこのパターンを指摘した場合は false alarm でない — 変換が正しい）。実例: issue 231 の `detectMultiPayeeAmbiguous` テスト（1 行テーブル）を `test(...)` に変換。
  <!-- importance: medium | mentions: 4 | first-seen: 2026-06 -->
- **多段ステージ処理のテストは「このケースはどのステージで確定するか」を入力データで明示的にコントロールする**: 複数ステージが順に実行される処理（Stage 1 → Stage 2 → Stage 3 等）では、上流ステージが先に確定するデータを使うと目的のステージに到達しない。例: Stage 3（発注番号 NFKC）を検証するつもりで商品名を一致させると Stage 2（商品名アンカー）が先に確定してしまい Stage 3 は未到達のままテストが通る。各テストケースのフィクスチャに「なぜこのデータは上流ステージをスルーするか」の WHY コメントを入れ、意図したステージで確定していることを `joinBasis` 等のフィールドで assert する（issue 210 Round 2・3 で複数検出）。
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

## Claude Code Hooks 設計規約

- **`biome check --unsafe` を `PostToolUse:Edit` に設定すると中間 Edit で変数名が壊れる**: Biome の `noUnusedVariables` は unsafe fix として「まだ使われていない変数」を `_prefix` にリネームする。複数の Edit でコードを段階的に組み立てる際、「変数を定義したが使用箇所はまだ追加していない」中間状態で hook が走ると次の Edit で `Cannot find name '<変数名>'` が発生する。対処: `PostToolUse:Edit` は `--unsafe` なし（`biome check --write`）にし、`Stop` hook でターン終了後に変更ファイル全体に `--unsafe` を走らせる。`Stop` hook での変更ファイル特定は `jj diff --name-only` を使う（`$CLAUDE_FILE_PATH` は Stop イベントでは使えない）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **Biome の `noUnusedImports`（safe fix）は中間 Edit で未使用 import を削除する — `PostToolUse:Edit` で `biome check --write` を仕込まない**: `noUnusedVariables` は unsafe fix だが `noUnusedImports` は **safe fix** のため、`--unsafe` なし（`biome check --write`）でも中間 Edit で「import を追加 → まだ使用箇所がない」状態で auto-fix が走り import が削除される。次の Edit で `Cannot find name 'X'` が発生するか、使用箇所を追加しても lint が再 import を要求する。**対処: `PostToolUse:Edit` で biome を走らせず、`Stop` hook の `biome check --write --unsafe` だけに集約する**（ターン終了時には使用箇所も揃っているため未使用 import の誤判定が起きない）。「import と使用箇所を同じ Edit ブロックに書く」規律で凌ぐのは脆い（複数ファイル間の追加・段階的リファクタで容易に破れる）。実例: issue 231 の `AmbiguousCandidatePicker` import が JSX 追加前に削除・`updateInvoiceVendorResolution` import が関数呼び出し前に削除（いずれも `noUnusedImports` の safe fix）。noah workspace で PostToolUse:Edit の biome hook を削除。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

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
  - **仕様の精度で特に注意すべき点**: ① ブランチがある仕様で「削除される N 件」と書くと「指定時点以降の全件」に読めてしまうが、実際は「その操作後にどのブランチからも辿れなくなった版だけ」を指すことが多い。「到達不能になる版」と表現する。② 将来実装の操作（ブランチ作成等）の「分岐元の引き継ぎ範囲」（HEAD のみ / Current も含む）は必ず明記する — これが曖昧だと UI の初期状態・空状態の設計が定まらない（実例: ADeT PR #2544 で UC-6 の HEAD/Current 未定義がレビュー指摘になった）。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **作業中に気づいた追加実装・バグ・未配線は、現 PR に「issue 追加 + コード内 `TODO(#NNN)` コメント」をセットで含めて push する**: scope 外と判断したフォローアップ事項を別 PR・別タイミングで起票する運用はもれが発生する（記憶頼りになる・別ブランチ作成のオーバーヘッドで先送りされる）。**現 PR の作業コピーに ① `issues/NNN-*.md` 新規作成、② 該当コード位置に `TODO(#NNN): <要約>` コメント、の 2 つをセットで push する**ことで「コード ↔ issue ↔ PR」の三者が同一コミットで紐付き、後から検索（`rg "TODO\(#"` / `gh issue view N`）で確実に辿れる。プレースホルダ・空ハンドラ・runtime バグ・回避策コメントを残すときは必ず issue を切る。逆に「TODO（issue 番号なし）」「FIXME（誰宛か不明）」だけ残すのは禁止 — 数週間後に「これ何だっけ」となる。実例: PR #147 で UI アップロード配線が 3 箇所未着手 → issue 112 を同 PR に追加し `TODO(#112)` に置換。**亜種: plan / PR ボディ / コードコメントに「別 issue 候補に残す」「後続 issue で対応」のような曖昧なフォローアップ言及を残すのも禁止**。その場で `issues/NNN-*.md` を起票して番号を確定し、「別 issue 候補」を `TODO(#NNN)` に置換する（曖昧表現は「issue を切った気」になるが番号がないので検索できず先送りと同義）。実例: PR #196 の plan に「UnsettledCarryOverSection は別 issue 候補に残す」と書いたままユーザーに指摘され issue 251 を起票・TODO(#251) に置換した。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **Route/API を削除するときは `rg "<パス>"` で呼び出し側 component を全件特定し、同 PR で更新する**: エンドポイント削除と呼び出し側の更新を別 PR・別タイミングで行うと、削除後の状態でコードが動く間 runtime エラーが発生する（typecheck・lint は通るが実行時に 404 / 500 になる）。削除前に `rg "/<route-path>"` でプロジェクト全体を検索し、dialog・hook・action・test の呼び出し箇所を把握して同 PR に含める。実例: `/api/invoice/matching/reextract` route を削除した際、`match-detail-dialog.tsx` がまだ呼んでいたがコンパイルは通過し domain review で発見（issue 222・PR #171）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
