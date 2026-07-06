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
- **WHY コメントに書く前提は実機で検証してから書く**: 憶測の WHY は「確認済み」として後続実装の根拠に再利用され、障害を再生産する（レビューが「ここは確認済み」としてスルーする構造的な罠）。ライブラリ・ツール・仕様の挙動を断言する WHY は必ず一次情報（公式ドキュメント・型エラー誘発・実行結果）で検証してから書く。「未検証・現状許容する」も同じ違反 — 読者は「判断済み」と解釈しスルーするため、「将来確認する」か「確認後の結論」のどちらかに書き分ける。NG: `// WHY X: library Y がそうする`（未検証）／OK: `// WHY X: library Y vN.M で動作確認・公式パターン a/foo を参照`（検証済み）。詳細と亜種（PostgreSQL 分離レベル / Reflect.get 型 / JSDoc 到達性 / ADR 番号引用）は `archive/CLAUDE.md-2026-07-02.md#1-why-comment-verification` を参照。
  **亜種: stacked PR の上流コミットが書いた JSDoc の断言も一次情報ではない**: 上流 PR の未検証 WHY（「照合ジョブが未確定行を skip する」等）を下流実装が「確認済み」として UI 分類・件数計算の設計根拠に再利用し、レビュー最終ラウンドで blocking（新規データで開始ボタンが恒久 disabled になる regression）として発覚した。上流 JSDoc が**存在しない関数名を引用している**のは未検証のシグナル。自分の実装が依存する断言は、書いたのが直前の自分（上流コミット）でも実コード（ジョブ・クエリの実装）で再検証する。実例: noah issue 958 の `isAwaitingVendorResolution` JSDoc → issue 959 が継承し Round 5 で修正（2026-07）。
  <!-- importance: high | mentions: 11 | first-seen: 2026-06 -->
- **JSDoc の「後続 issue で対応予定」コメントは実装後に更新する**: `// #111 値引き/経費 が追加予定` のような placeholder コメントが本 PR で実装済みになったのに残るケースがある。issue を実装した PR のレビュー前に、自分が追加した JSDoc 内の「後続 issue で〜」「追加予定」「TODO(#NNN)」コメントを全文検索し、今 PR で解決済みなら削除・更新する。`rg 'TODO\(#NNN\)\|追加予定\|後続 issue' <変更ファイル>` で確認する。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
  **亜種: issue ファイルの Devlog / plan 記述も同じ規律の対象 — 計画を撤回したら「撤回した」旨の新エントリを追加する**: Devlog に「issue NNN に切り出し + TODO(#NNN) 設置済み」と書いた後で計画を変えて同 PR 内で実装した場合、その記述は「実態と乖離した記録」として policy reviewer に検出される。過去エントリを黙って書き換えるのではなく（日誌としての時系列が壊れる）、「YYYY-MM-DD: 上記の切り出し方針を撤回し本 PR で実装した」という追記エントリで訂正する。コードコメントの placeholder と同様、`rg '切り出し|別 PR|別 issue' issues/NNN-*.md` で PR クローズ前に確認する。実例: issue 285 の Devlog に issue 300 切り出し方針が残存し policy reviewer が非 Nit 指摘（2026-07）。
  **亜種: JSDoc 以外の通常コメント（テストコード内の line/block コメント等）も同じ規律で消す**: JSDoc に限定したルールだと「テストコード内のラインコメントなら大丈夫」と解釈してすり抜ける。設計段階でテストに `// status フィールドは issue 256 で削除（deriveVendorStatusLabel で導出する）` のような移行期コメントを書いた場合、その issue を done にする PR でも残りやすい。JSDoc / line comment / block comment を問わず、自分が PR スコープ内で書いた「issue NNN で削除/対応」placeholder を全件削除する。検索パターンは `rg '#\d+ で削除|#\d+ で追加|追加予定|後続 issue|TODO\(#\d+\)' <変更ファイル>`（数字 NNN を `\d+` に拡張し JSDoc 外も網羅）。実例: issue 256 の `invoice-months.test.ts` に「issue 256 で削除」コメントが 4 箇所残存し、quality reviewer 指摘で削除（2026-06）。
- **WHY コメントは「採用した設計」の視点から書く — 「検討したが採用しなかった設計」の WHY を実装として書かない**: 設計検討（案 A を検討 → 却下 → 案 B を実装）の流れで、案 A の WHY を「なぜこうしたか」として書いてしまうミスが起きる。読者は「A が実装されている」と誤解し、将来の開発者が「既に A を選んだ根拠がある」と信じて誤った方向に進む。**正しい形**: 実装した B の視点から `WHY B: ...`（なぜ B を選んだか）と `WHY NOT A: ...`（なぜ A を選ばなかったか）を書く。採用しなかった A の説明は「WHY NOT」節に置き、B の実装コメントに「A を選んだ」かのように書かない。実例: issue 112 で `vendor-hints.ts` の JSDoc に「全ヒント埋め込み方式を選んだ WHY」が書かれていたが、実装は 2-pass 方式だった → コードと文書が乖離し domain review で検出・削除。NG: `// WHY: 全ヒントを system prompt に埋め込む`（実際は 2-pass）／OK: `// WHY 2-pass: ... / WHY NOT 全埋め込み: ...`（実装 B の視点から書く）
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **ツールが所有する生成物ファイルは手書きしない — 必ずツールのコマンドで生成する**: lockfile・migration journal/snapshot（drizzle の `_journal.json`・`meta/*_snapshot.json` 等）・チェックサムファイルのような「ツールが読み書きする前提のメタデータ」を手で書くと、ツールが暗黙に守っている不変条件（タイムスタンプの単調増加・snapshot のチェーン整合・ハッシュ一致）を破り、**エラーではなく無音の故障**（migration の無音スキップ・次回生成時の重複 DDL 等）として現れる。エントリの一部だけ手書きするのも同罪（不変条件はファイル全体で守られる）。実例: noah で drizzle の journal エントリを epoch 手計算で追記 → 年を 2025/2026 取り違え、適用済みより古い `when` になり migration が「成功表示のまま」スキップされ続けた。**現在時刻・epoch を書く必要があるときも頭で計算せず `date +%s` 等のコマンドで取得する**（年・タイムゾーンを取り違えやすい）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- TypeScript: as キャストは禁止
- **空配列に型を付けるときは `satisfies` または変数型注釈を使う — `[] as T[]` は禁止**: オブジェクトリテラル内で空配列に型を与えるとき `[] as T[]` は as キャスト規約に違反する。代替: ① `[] satisfies T[]`（型チェックを通す・キャストなし）、② `const arr: T[] = []`（変数宣言で型注釈）。`satisfies` は関数引数や object literal の value に直接書ける点が強い。実例: `unresolved-count.test.ts` の `statuses: [] as LineItemStatus[]` → `statuses: [] satisfies LineItemStatus[]`（issue 254）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`as` キャスト全除去チェックは `rg ' as [^a-z ]'` を使う（`as [A-Z]` では数値 literal を取りこぼす）**: `as WizardStep` のように大文字始まりの型は `rg ' as [A-Z]'` で検出できるが、`as 1 | 2 | 3 | 4 | 5` のような数値 literal union は引っかからない。`as [^a-z ]`（小文字・スペース以外が続く `as`）のパターンで `as const` を除く実質的なキャストを網羅できる（`as const` は `as ` + 小文字なのでこのパターンに引っかからない）。実例: adachi invoice モックで `step={wizardStep as 1 | 2 | 3 | 4 | 5}` が `' as [A-Z]'` チェックをすり抜け、`' as [^a-z ]'` で初めて検出された。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
  **亜種: object literal の value として渡す `[]` は contextual typing で型が付くため `satisfies` 不要 — quality reviewer の「`satisfies` を付けろ」指摘は実コードを Read して確認する**: `[]` に `as T[]` キャストが書かれているか、surrounding type から推論されているかは別物。後者（`{ items: [] }` を `Foo` 型の引数に渡す等）は `as` キャストが存在しないため `satisfies T[]` も不要（付けると冗長警告対象になることがある）。`rg ' as [^a-z ]'` で実際に `as` キャストが検出されない場合、reviewer の `satisfies` 推奨は false alarm として却下する。判断: ①`rg` で grep ②該当行を Read ③`[] as T[]` の形なら `satisfies T[]`、`{ items: [] }` の contextual typing なら現状維持。
- **分岐の書き分け — 単一変数の値による分岐は switch、値を選ぶだけなら Record、複数ファクトの優先順位付けは `if + early return`**: 判定対象の構造で書き方を選ぶ。単一変数の値による分岐は `switch` で網羅性を示す（exhaustive check と相性が良い）。全 case が return するだけなら `const MAP = {...} as const; return MAP[key];` の Record lookup が簡潔（ネスト switch で全内側 case が return を持つと外側の `break` が unreachable になる）。複数の独立した boolean ファクトに優先順位を付けて 1 つを選ぶケースは switch では表現できず `if + early return` の連鎖で書く。詳細と亜種は `archive/CLAUDE.md-2026-07-02.md#3-switch-vs-record-vs-if` を参照。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **合成キー文字列は1つの関数に集約する — インライン構築を散らさない**: `${a ?? ""}:${b ?? ""}` のような合成キーを複数箇所でインライン構築すると、キー形式を変更したとき変更漏れによる無音の不整合（照合ミス・カウント誤差）が生じる。**合成関数（`resolutionKey(a, b)` 等）を1箇所に定義して全ての構築箇所から呼ぶ**。判断基準: 「このキー文字列は2箇所以上で構築されているか？」YES なら関数化する。実例: issue 223 で `resolutionKey()` を `unresolved-count.ts` に定義したが `assemble.ts`・`invoice-pairing-detail.ts` が同じ形式をインライン構築していた — quality reviewer 指摘で統一（インライン重複はキー形式変更時にサイレント誤カウントを生む）。再発: issue 242 で `vendorKey()` を定義したが `invoice-months.ts` の `carryOverFromPrevKey` 計算で `name:${firstInv.vendorName}` とインライン構築していた — quality reviewer 指摘で `vendorKey()` 経由に統一。**関数を定義してから別ファイルでインライン構築が新たに生まれることがある — PR レビュー時に「このキーは vendorKey() 等の合成関数経由か？」を全箇所確認する**。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **mutable な local 変数（TS/JS の `let`、Go の再代入 `var`、Kotlin の `var` 等）は「より宣言的な形がないか」を立ち止まる signal — ただし即「関数抽出」に逃げない**: 再代入される local 変数は default の `const`/`val` から外れるため、「もっと宣言的に書けないか」を考えるトリガーになる。**判断手順**: ① まず宣言的な形（`map/filter/reduce`・三項演算子・switch 式・中間 const の多段分解）で消せないか試す ② それでも mutable が残るなら、その値の lifecycle が**独立した関数として意味を持つか**問う（[[合成キー集約]] と同じ「2 箇所以上で使われるか」の基準）。意味があり 2 箇所以上で使われるなら抽出、なければ mutable のまま残す ③ ループカウンタ・hot loop（パフォーマンスクリティカル）・state machine の状態など mutable が本質のケースは例外として残す。NG: `let x; if (a) x = "X"; else x = "Y";` を即 `function getX() { ... }` に抽出 ／ OK: `const x = a ? "X" : "Y";`（より宣言的・関数化不要）／ OK: `const total = items.reduce((s, x) => s + x.price, 0);`（accumulator `let` を消す）／ 抽出が正解な例: `switch` で値を組み立てる処理は switch 全体を関数化して early return（呼び出し側は `const result = computeX(...)`）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **LLM 呼び出しコードの rename では凍結境界を「model が実際に読む文字列か」で引く — ファイル単位で凍結しない**: prompt 本文・出力スキーマの wire フィールド名（zod の key・`.describe()` 文言）・user message 組み立て文言は serialize されて model に届くため、rename すると model 挙動が変わりうる → 凍結し、触るなら eval 再走とセットの独立 issue にする。一方、同じファイル内でも model に送信されない TS 識別子（型名・schema 変数名・関数名・定数名）は通常の rename 対象。「schema.ts / prompt.ts はファイルごと凍結」と粗く引くと識別子の rename 漏れが残り（レビューで指摘される）、逆に境界を意識しないと wire 文字列を巻き込んで無自覚に model 挙動を変える。判断基準: 「この文字列はリクエスト/レスポンスとして model に届くか？」YES → 凍結、NO → rename。実例: noah issue 977 で当初「schema.ts 全体凍結」とし `aiPairingSchema` → `aiPairSchema` 等の識別子 rename が漏れ、ドメインレビューで境界を「wire 内容 vs 識別子名」に正確化した（PR #290）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る
- **`test.each` は「同じ構造・複数ケース」の共通化に限る — setup/assertion パターンが変わるケースは独立 `test()` に分割する**: 行に条件分岐フラグ（`needsSegments`・`shouldThrow` 等）を入れて `if (flag)` で assertion を切り替えると意図が不明瞭になる。1 行しかない `test.each` も同理由で `test()` に変換する。判断: 「全行で assertion コードが同一構造か」YES なら table、NO なら分割。`shouldThrow` フラグは同 PR 内の複数テストファイルに再発しやすいので、`test.each` を新規追加/編集した PR は `rg "shouldThrow" <PR で変更した *.test.ts>` で横断確認する。詳細と補足（for 0 回ループ・1 行 table・shouldThrow 亜種）は `archive/CLAUDE.md-2026-07-02.md#2-test-each-uniformity` を参照。
  <!-- importance: medium | mentions: 5 | first-seen: 2026-06 -->
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

- **サブエージェントの「完了報告」は作業ツリーの実 diff で必ず検証する — 実装ゼロのまま「完了」と報告するケースがある**: 委譲されたエージェントがさらに別エージェントへ再委譲し、その再委譲が実体を持たないまま「実装完了」と報告してくることがある（メインセッションが並行で行った無関係な編集を自分の成果と誤認するパターンを実測）。対処: ①委譲結果は self-report でなく `jj st` / `jj diff`（git なら `git status`/`git diff`）で「期待したファイルに期待した変更があるか」を自分で確認する ②typecheck/test の green も自分でコマンドを走らせて確認する ③再委譲が疑わしい場合、再 spawn 時のプロンプトに「他エージェントへの委譲禁止・あなた自身が Read/Edit/Write/Bash で直接実装すること」を明示する。実例: noah issue 966 で委譲チェーンが実装ゼロの完了報告 → 直接実装を明示した再委譲で解決（2026-07）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## Bash Commands

Shell operator（`&&`/`||`/`;`/`|`）を含む複合コマンドは**パーミッションプロンプトを誘発するため避ける**。フォールバック（`cmd1 || cmd2`）も使わず、正しいコマンドを1つ決めて実行する。パイプ（`|`）は `rg`/`jq` など read-only フィルタのみ可（書き込みを伴うものは禁止）。`cd /path && cmd` の代替策は `~/.claude/docs/bash-tips.md` 参照。

## Claude Code Hooks 設計規約

- **`PostToolUse:Edit` で biome auto-fix を走らせない — `Stop` hook に集約する**: 中間 Edit で「変数を定義したが使用箇所はまだ」「import を追加したが使用箇所はまだ」の状態を biome が誤検知し、`_prefix` リネーム（`noUnusedVariables` unsafe fix）や未使用 import 削除（`noUnusedImports` safe fix）を行う。次の Edit で `Cannot find name 'X'` が発生する。`--unsafe` を外しても safe fix で import が消えるので `PostToolUse:Edit` からは biome を完全に外し、`Stop` hook で `jj diff --name-only` の変更ファイルに `biome check --write --unsafe` を一括適用する（ターン終了時は使用箇所も揃っている）。詳細は `archive/CLAUDE.md-2026-07-02.md#6-biome-post-edit-hook` を参照。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->

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
- **デザイン要件ドキュメント（デザイナーブリーフ）は「現状の説明」でなく「正しい仕様の定義」として書く**: 実装途中・UI 未着手の機能のデザイン依頼ドキュメントは、あるべき仕様を定義するフレームで書き、現行実装が乖離していれば「作り直し対象」と明示する。特に ① 状態変化は「削除される N 件」でなく「到達不能になる版」等の到達性で表現、② 将来実装の操作の引き継ぎ範囲（HEAD のみ / Current も含む等）を必ず明記する（UI の初期状態・空状態が定まる）。詳細と実例は `archive/CLAUDE.md-2026-07-02.md#5-design-brief-spec-first` を参照。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **作業中のフォローアップは現 PR に「issue 追加 + `TODO(#NNN)` コメント」をセットで含める**: 別 PR / 別タイミング起票は記憶頼りになり漏れる。現 PR に ① `issues/NNN-*.md` 新規作成、② 該当コード位置に `TODO(#NNN): <要約>` コメント、を同一コミットで含めれば「コード ↔ issue ↔ PR」が紐付き `rg "TODO\(#"` / `gh issue view N` で辿れる。「TODO（issue 番号なし）」「FIXME」も禁止。**plan / PR ボディ / コードコメントに「別 issue 候補に残す」「後続 issue で対応」のような曖昧な言及も禁止** — 「起票した気」になるが番号がないので検索不能・実質先送り。その場で `issues/NNN-*.md` を起票して番号を確定し `TODO(#NNN)` に置換する。詳細と実例は `archive/CLAUDE.md-2026-07-02.md#4-todo-issue-linkage` を参照。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **Route/API を削除するときは `rg "<パス>"` で呼び出し側 component を全件特定し、同 PR で更新する**: エンドポイント削除と呼び出し側の更新を別 PR・別タイミングで行うと、削除後の状態でコードが動く間 runtime エラーが発生する（typecheck・lint は通るが実行時に 404 / 500 になる）。削除前に `rg "/<route-path>"` でプロジェクト全体を検索し、dialog・hook・action・test の呼び出し箇所を把握して同 PR に含める。実例: `/api/invoice/matching/reextract` route を削除した際、`match-detail-dialog.tsx` がまだ呼んでいたがコンパイルは通過し domain review で発見（issue 222・PR #171）。再発: issue 977 で `getInvoiceMonthsFromDb` 削除時に conventions.md サンプル・別ファイルのコメント参照が残存しレビュー Round 4 まで検出されなかった — 関数削除時も `rg "<関数名>" docs/ apps/ packages/` でコメント・docs サンプルまで棚卸しする（コード参照だけでは足りない）。
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
  **亜種: 「概念の撤去」PR ではコード参照だけでなく「その概念を前提に書かれた docs/ / issues/ の記述」も棚卸しする**: エラークラス・状態・型のような**ドメイン概念**を撤去するとき、`rg "<概念名>"` でコード参照を消しても、①ADR 内の cross-reference（「(6-c) の write 全禁止と整合」等・別セクションが撤去済み挙動を現在有効として参照）、②その概念の存在を前提にスコープが書かれた兄弟 issue（premise 崩壊）が陳腐化して残る。撤去 PR では `rg "<概念名>|<関連語>" docs/ issues/` で「概念を前提にした記述」まで検索し、ADR は NOTE 追記・issue は Devlog に「前提変更」エントリ追記で追従させる。実例: issue 957 で `MultiInvoiceDegradedError` 撤去時、ADR-0009 (3) の (6-c) cross-reference と issue 286 の degraded 前提スコープが policy reviewer 指摘で発覚（PR #273）。
- **ADR と実装が乖離したとき: 実装を ADR に合わせるより ADR に実装メモを追記する**: ADR は策定時の想定を書くが、実装フェーズで「assemble 時 pre-compute」「lazy getter」等の方向に着地することがある。実装を ADR 想定に合わせる（余分な集約メソッドを追加する等）より、ADR の当該判断セクション末尾に「### 実装メモ」サブセクションで「実際の着地モデル・なぜそうなったか・どういう条件なら元の設計に戻すべきか（再評価条件）」を追記する方が将来の開発者に意図が伝わる。WHY: コードが真実であり ADR は意思決定の記録なので、コードを ADR に合わせてコードを複雑化するより、ADR をコードの実態に追従させる。実例: ADR-0009 (4) で `VendorMatching.lineItemStatus(matchId)` 集約メソッドを想定したが issue 254 実装は assemble 時 pre-compute モデルになった — 集約メソッドを余分に追加せず ADR (4) に実装メモを追記（PR #212）。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
  **亜種: 「決定済みだがコード未追従」の rename・仕様は、現行実装を正とする本文に混ぜず「決定済み・未追従（issue NNN）」セクションへ分離する**: 用語集・設計 doc が未実装の新名を現在形で断定すると（「テーブルは `vendor_confirmations`」等）、doc がコードに存在しない状態を主張することになり、レビューでの矛盾指摘・読者の grep 不一致を生む。本文は現行名主体で書き、将来名は issue 番号付きの分離セクションに置いて、コードが追従した PR で本文へ昇格させる。実例: noah issue 977 で `docs/adachi/invoice-matching.md` が issue 978 分（`vendor_confirmations`・`InvoiceMatchingJobStep`・`MatchMethod` 分割）を本文で断定 → policy reviewer 指摘で「rename 決定済み・コード未追従（issue 978）」セクションに分離（PR #290）。
  **亜種: ADR 内の歴史記述（当時の判断根拠）が後続 issue で無効化されたときも本文を書き換えず「NOTE: issue NNN で撤廃済み — 本項は当時の記録」を添える**: 歴史記述をそのまま残すと「現在も有効」と誤読され（policy 観点の矛盾指摘）、書き換えると意思決定の記録が壊れる（quality 観点は「歴史記録として矛盾なし」と判断する）。両レビュー観点の見解相違を NOTE 追記が両立する。実装メモがある節への cross-reference（「実装メモを参照」）を添えると読者が現在の正へ辿れる。実例: issue 957 で ADR-0009 (3) の「(6-c) write 全禁止と整合」記述に NOTE を追記（PR #273）。
