# CLAUDE.md 圧縮 archive (2026-07-29)

**退避元**: `~/.claude/CLAUDE.md`
**退避日**: 2026-07-29
**圧縮 run で扱った原則数**: 18
**圧縮スキル**: `/curate-docs`

前回の圧縮（`CLAUDE.md-2026-07-02.md`）以降、live doc に「亜種」「実例」「再発」が append-only で積み上がり、62KB（推定 25〜35k トークン）に到達した。本 archive は各原則の**具体例チェーン（実例・再発・亜種）を原文のまま退避**したもの。live doc 側には抽象化した原則・判断基準・検索コマンドだけを残し、本ファイルの `#<anchor>` で参照している。

**原則そのものは live doc が正**。本ファイルは「なぜその原則が生まれたか」を辿るための証跡。

---

## 1. why-comment-verification-variants

**live doc の対応原則**: 「WHY コメントに書く前提は一次情報で検証してから書く」（Coding Policy）

前回 archive の `CLAUDE.md-2026-07-02.md#1-why-comment-verification` も参照（亜種 1〜3: PostgreSQL 分離レベル / `Reflect.get` 型 / JSDoc 到達性）。以下は 2026-07 に追加された亜種 4〜6。

### 亜種 4: stacked PR の上流コミットが書いた JSDoc の断言も一次情報ではない

> 上流 PR の未検証 WHY（「照合ジョブが未確定行を skip する」等）を下流実装が「確認済み」として UI 分類・件数計算の設計根拠に再利用し、レビュー最終ラウンドで blocking（新規データで開始ボタンが恒久 disabled になる regression）として発覚した。上流 JSDoc が**存在しない関数名を引用している**のは未検証のシグナル。自分の実装が依存する断言は、書いたのが直前の自分（上流コミット）でも実コード（ジョブ・クエリの実装）で再検証する。実例: noah issue 958 の `isAwaitingVendorResolution` JSDoc → issue 959 が継承し Round 5 で修正（2026-07）。

### 亜種 5: 「フィールドをセットしないと消える」系の防御コードも repository の Update 実装を読んでから書く

> GORM 等で `Update()` が `Select("Status", "ErrorMessage")` のように永続化カラムを限定している場合、他フィールドを構造体にセットする防御は no-op であり、その WHY コメントは偽の前提を文書化する。実例: ADeT PR #2625 の `markFailed` で `TriggeredByUserSystemID` を「NULL 戻り防止」としてセット → reviewer が `analyze_github_job_gorm.go` の Select 指定を確認し no-op と判明、引数ごと削除（2026-07）。

### 亜種 6: WHY コメントが引用する「ドキュメントの節・規約名」も実在検証の対象

> 「conventions §I の read-before-reap と同型」のように典拠節を引用するとき、パターン自体は実在してもその節に該当記述が無いことがある（記憶の中で「どこかで規約化されていたはず」が特定の節名に化ける）。書く前に `rg '<キーワード>' <引用先ファイル>` で該当記述の実在を確認し、無ければ実在する出典（実コードの JSDoc・glossary エントリ等）に差し替える。実例: noah issue 1010 で `rg "reap" docs/apps/conventions.md` が 0 件 → 典拠を `commands/jobs.ts` の read-before-reap パターンに差し替え（policy reviewer 指摘・2026-07）。

---

## 2. placeholder-cleanup

**live doc の対応原則**: 「PR スコープ内で書いた deferral placeholder は実装後に全件消す」（Coding Policy）

### 元の原則

> **JSDoc の「後続 issue で対応予定」コメントは実装後に更新する**: `// #111 値引き/経費 が追加予定` のような placeholder コメントが本 PR で実装済みになったのに残るケースがある。issue を実装した PR のレビュー前に、自分が追加した JSDoc 内の「後続 issue で〜」「追加予定」「TODO(#NNN)」コメントを全文検索し、今 PR で解決済みなら削除・更新する。

### 亜種 1: issue ファイルの Devlog / plan 記述も同じ規律の対象

> 計画を撤回したら「撤回した」旨の新エントリを追加する。Devlog に「issue NNN に切り出し + TODO(#NNN) 設置済み」と書いた後で計画を変えて同 PR 内で実装した場合、その記述は「実態と乖離した記録」として policy reviewer に検出される。過去エントリを黙って書き換えるのではなく（日誌としての時系列が壊れる）、「YYYY-MM-DD: 上記の切り出し方針を撤回し本 PR で実装した」という追記エントリで訂正する。`rg '切り出し|別 PR|別 issue' issues/NNN-*.md` で PR クローズ前に確認する。実例: issue 285 の Devlog に issue 300 切り出し方針が残存し policy reviewer が非 Nit 指摘（2026-07）。

### 亜種 2: JSDoc 以外の通常コメント（テストコード内の line/block コメント等）も同じ規律で消す

> JSDoc に限定したルールだと「テストコード内のラインコメントなら大丈夫」と解釈してすり抜ける。設計段階でテストに `// status フィールドは issue 256 で削除（deriveVendorStatusLabel で導出する）` のような移行期コメントを書いた場合、その issue を done にする PR でも残りやすい。JSDoc / line comment / block comment を問わず、自分が PR スコープ内で書いた「issue NNN で削除/対応」placeholder を全件削除する。検索パターンは `rg '#\d+ で削除|#\d+ で追加|追加予定|後続 issue|TODO\(#\d+\)' <変更ファイル>`（数字 NNN を `\d+` に拡張し JSDoc 外も網羅）。実例: issue 256 の `invoice-months.test.ts` に「issue 256 で削除」コメントが 4 箇所残存し、quality reviewer 指摘で削除（2026-06）。

---

## 3. adopted-design-perspective

**live doc の対応原則**: 「WHY コメントは採用した設計の視点から書く」（Coding Policy）

> 設計検討（案 A を検討 → 却下 → 案 B を実装）の流れで、案 A の WHY を「なぜこうしたか」として書いてしまうミスが起きる。読者は「A が実装されている」と誤解し、将来の開発者が「既に A を選んだ根拠がある」と信じて誤った方向に進む。**正しい形**: 実装した B の視点から `WHY B: ...`（なぜ B を選んだか）と `WHY NOT A: ...`（なぜ A を選ばなかったか）を書く。採用しなかった A の説明は「WHY NOT」節に置き、B の実装コメントに「A を選んだ」かのように書かない。実例: issue 112 で `vendor-hints.ts` の JSDoc に「全ヒント埋め込み方式を選んだ WHY」が書かれていたが、実装は 2-pass 方式だった → コードと文書が乖離し domain review で検出・削除。NG: `// WHY: 全ヒントを system prompt に埋め込む`（実際は 2-pass）／OK: `// WHY 2-pass: ... / WHY NOT 全埋め込み: ...`（実装 B の視点から書く）

---

## 4. doc-conflict-is-drift-signal

**live doc の対応原則**: 「同一 PR 内でドキュメント文言が食い違ったら、揃える前に実装をコードで確かめる」（Coding Policy）

> 新しく書いた説明（OpenAPI description・型の JSDoc）と既存の説明（UI の注意書き・設計ブリーフ）が矛盾したとき、反射的に新しい方へ統一しがちだが、その矛盾は**仕様と実装が既に乖離しているサイン**であることがある（新しい文は実装を読んで書き、古い文は仕様を読んで書かれているため、両者の差がそのまま乖離の位置を指す）。対処: ①どちらが仕様（設計ブリーフ・ADR）でどちらが実装記述かを分ける ②実装コードを読んで事実を確定する ③**仕様側の文言を正として残し**、乖離は `FIXME:`（やること＋スコープ外にした理由）でコードに刻む ④実装記述側は事実に反しない中立表現へ落とす。矛盾を「文言の不統一」として消すと、乖離が文書上から消えて誰も気づけなくなる。実例: ADeT PR #2648 で新規 JSDoc「分岐元の現在の作業状態を引き継ぐ」と既存 UI 文言「未保存の編集は引き継がれません」が衝突 → 実コードを読み、ブリーフ UC-6 に対して実装が未保存編集を引き継いでいる既存バグと判明（2026-07）。

---

## 5. history-narration-comments

**live doc の対応原則**: 「削除・撤去の歴史語りコメントを残さない」（Coding Policy）

> 機能を撤去したとき「X は issue NNN で削除した（周知期間終了）」「旧 Y の redirect は削除済み（現在は not-found）」のような**過去の変更を説明するコメント**をコードに残さない。削除の経緯は git 履歴・PR・issue の Devlog が担う。コードコメントに残すのは①現在の挙動の WHY / WHY NOT（例: `WHY NOT 残差をここへ集約するか: 詳細本体で表示・対応するため`）②将来の作業への具体的な指示（`TODO(#NNN)`）だけ。歴史文脈を WHY に使う場合も「かつては A だったが B に戻した」でなく現在形の WHY NOT A に書き換える。
>
> 実例: noah issue 996/998 の撤去コメント 7 箇所をユーザー指摘で一括削除・現在形化（2026-07-13）。
> 再発: noah issue 1011 で「旧 invoice_confirmations は統合され廃止」系コメント 4 箇所（JSDoc・block comment・schema）をユーザー指摘で現在形の WHY NOT 化（2026-07-29）— **テーブル統合・機能統合の PR は特に出やすい**（「旧 X を Y に統合した」は全部このパターン）。

---

## 6. tool-owned-generated-files

**live doc の対応原則**: 「ツールが所有する生成物ファイルは手書きしない」（Coding Policy）

> lockfile・migration journal/snapshot（drizzle の `_journal.json`・`meta/*_snapshot.json` 等）・チェックサムファイルのような「ツールが読み書きする前提のメタデータ」を手で書くと、ツールが暗黙に守っている不変条件（タイムスタンプの単調増加・snapshot のチェーン整合・ハッシュ一致）を破り、**エラーではなく無音の故障**（migration の無音スキップ・次回生成時の重複 DDL 等）として現れる。エントリの一部だけ手書きするのも同罪（不変条件はファイル全体で守られる）。実例: noah で drizzle の journal エントリを epoch 手計算で追記 → 年を 2025/2026 取り違え、適用済みより古い `when` になり migration が「成功表示のまま」スキップされ続けた。**現在時刻・epoch を書く必要があるときも頭で計算せず `date +%s` 等のコマンドで取得する**（年・タイムゾーンを取り違えやすい）。

関連: 「自動実行される hook に追跡ファイルを書き換えさせない」（Hooks 設計規約）と対になる — あちらは自動書き換え禁止、こちらは手書き禁止。

---

## 7. as-cast-alternatives

**live doc の対応原則**: 「`as` キャスト禁止と検出パターン」（Coding Policy）

### 空配列への型付け

> **空配列に型を付けるときは `satisfies` または変数型注釈を使う — `[] as T[]` は禁止**: オブジェクトリテラル内で空配列に型を与えるとき `[] as T[]` は as キャスト規約に違反する。代替: ① `[] satisfies T[]`（型チェックを通す・キャストなし）、② `const arr: T[] = []`（変数宣言で型注釈）。`satisfies` は関数引数や object literal の value に直接書ける点が強い。実例: `unresolved-count.test.ts` の `statuses: [] as LineItemStatus[]` → `statuses: [] satisfies LineItemStatus[]`（issue 254）。

### 検出パターンが数値 literal を取りこぼす

> `as WizardStep` のように大文字始まりの型は `rg ' as [A-Z]'` で検出できるが、`as 1 | 2 | 3 | 4 | 5` のような数値 literal union は引っかからない。`as [^a-z ]`（小文字・スペース以外が続く `as`）のパターンで `as const` を除く実質的なキャストを網羅できる（`as const` は `as ` + 小文字なのでこのパターンに引っかからない）。実例: adachi invoice モックで `step={wizardStep as 1 | 2 | 3 | 4 | 5}` が `' as [A-Z]'` チェックをすり抜け、`' as [^a-z ]'` で初めて検出された。

### 亜種: contextual typing の `[]` に `satisfies` は不要（reviewer 指摘の false alarm）

> `[]` に `as T[]` キャストが書かれているか、surrounding type から推論されているかは別物。後者（`{ items: [] }` を `Foo` 型の引数に渡す等）は `as` キャストが存在しないため `satisfies T[]` も不要（付けると冗長警告対象になることがある）。`rg ' as [^a-z ]'` で実際に `as` キャストが検出されない場合、reviewer の `satisfies` 推奨は false alarm として却下する。判断: ①`rg` で grep ②該当行を Read ③`[] as T[]` の形なら `satisfies T[]`、`{ items: [] }` の contextual typing なら現状維持。

---

## 8. shared-derivation-consolidation

**live doc の対応原則**: 「2 箇所以上で共有される導出は 1 関数に集約する」（Coding Policy）

もともと「合成キー文字列」の原則として始まり、実例が増えるにつれ適用範囲が **キー文字列 → 補正計算式 → boolean 判定述語 → ドメイン状態の表示分類射影** へ広がった。live doc は最終的な抽象形だけを持つ。

### 元の原則（合成キー）

> `${a ?? ""}:${b ?? ""}` のような合成キーを複数箇所でインライン構築すると、キー形式を変更したとき変更漏れによる無音の不整合（照合ミス・カウント誤差）が生じる。**合成関数（`resolutionKey(a, b)` 等）を1箇所に定義して全ての構築箇所から呼ぶ**。判断基準: 「このキー文字列は2箇所以上で構築されているか？」YES なら関数化する。

### 実例チェーン

- **実例（キー文字列）**: issue 223 で `resolutionKey()` を `unresolved-count.ts` に定義したが `assemble.ts`・`invoice-pairing-detail.ts` が同じ形式をインライン構築していた — quality reviewer 指摘で統一（インライン重複はキー形式変更時にサイレント誤カウントを生む）。
- **再発（キー文字列）**: issue 242 で `vendorKey()` を定義したが `invoice-months.ts` の `carryOverFromPrevKey` 計算で `name:${firstInv.vendorName}` とインライン構築していた — quality reviewer 指摘で `vendorKey()` 経由に統一。**関数を定義してから別ファイルでインライン構築が新たに生まれることがある**。
- **拡張（補正計算式）**: noah issue 1008 の `resolutionDiffAdjustment` — 一覧集計と決着ビュー集計の 2 箇所が共有。インラインに散らすと片側だけ規則が変わるサイレント不整合を生む。
- **拡張（boolean 判定述語）**: noah issue 991 で「繰越があるか」「未対応の合計不整合か」の判定式が 3 箇所（ラベル導出・紫バナー・承認画面アラート）にインライン散在し `carryOverToNext === 0` の解釈（`!== undefined` vs `> 0`）まで食い違っていた — 共有述語 `hasCarryOverToNext`/`hasUnresolvedAmountMismatch` に集約。
- **拡張（ドメイン状態 → 表示分類の射影）**: バッジは状態の畳み込み（discriminated union）から分類し、フィルタ述語は生ファクト（フラグ列・行の形）から独自判定すると、両者が食い違う（「バッジは値引きなのに不一致フィルタに出る」）。状態 → 分類の射影関数（`lineItemStatusKind` 等）を 1 つ定義しバッジ・フィルタ・集計の全 UI がそれを共有する。判断基準: 「この分類は 2 つ以上の UI（表示と絞り込み等）で使われるか？」YES なら射影関数化。実例: noah issue 1013 のフィルタ述語が `amountMismatch` 直参照で `LineItemStatus` の畳み込みを迂回 — ユーザー指摘で発覚し `lineItemStatusKind` に集約（2026-07）。

---

## 9. idor-single-choke-point

**live doc の対応原則**: 「ユーザー入力 ID の帰属検証は解決関数 1 箇所に置く」（Coding Policy）

> `fork` / `restore` / `diff` のように、同じ ID を受け取る入口が複数ある機能では、入口ごとに `if resource.TenantID != tenantID` を書くと**追加された経路で書き忘れる**（既存経路のレビューが通っているぶん、漏れが「意図的な例外」に見えて発見が遅れる）。対処: その ID が**中身に解決される 1 箇所**（ID → 実体 → コンテンツの変換関数。例: `materializeCommit(tenantID, id)`）に検証を寄せ、その関数の契約として WHY コメントに明記する。以後どの経路が増えても構造的に守られる。判断基準: 「このユーザー入力 ID を実体に解決している関数は何個あるか？」1 個なら必ずそこ、複数あるなら**まず解決関数を 1 つに集約してから**検証を置く。応答は NotFound に倒す（Forbidden は他テナントに存在することを漏らす）。実例: ADeT issue #2622 で commit 起点 fork に帰属検証を足したが、ドメインレビューで「同じ commit ID を受ける restore と diff/Resolve が無防備」と判明 → `materializeCommit` へ集約し 3 経路を一度に塞いだ（PR #2648）。

関連: `#8-shared-derivation-consolidation` と同型の「1 箇所に寄せる」原則だが、漏れの代償がサイレント不整合でなく**権限境界の突破**なので優先度が高い。

---

## 10. avoid-premature-extraction

**live doc の対応原則**: 「抽出する前に、より宣言的な形と既存の担い手を確認する」（Coding Policy）

同じ「過剰な抽出を避ける」原則が、変数レベル（mutable local）とコンポーネントレベル（中間層）の 2 スケールで観測された。

### スケール 1: mutable な local 変数

> mutable な local 変数（TS/JS の `let`、Go の再代入 `var`、Kotlin の `var` 等）は「より宣言的な形がないか」を立ち止まる signal — ただし即「関数抽出」に逃げない。再代入される local 変数は default の `const`/`val` から外れるため、「もっと宣言的に書けないか」を考えるトリガーになる。**判断手順**: ① まず宣言的な形（`map/filter/reduce`・三項演算子・switch 式・中間 const の多段分解）で消せないか試す ② それでも mutable が残るなら、その値の lifecycle が**独立した関数として意味を持つか**問う（「2 箇所以上で使われるか」の基準）。意味があり 2 箇所以上で使われるなら抽出、なければ mutable のまま残す ③ ループカウンタ・hot loop（パフォーマンスクリティカル）・state machine の状態など mutable が本質のケースは例外として残す。
>
> NG: `let x; if (a) x = "X"; else x = "Y";` を即 `function getX() { ... }` に抽出 ／ OK: `const x = a ? "X" : "Y";`（より宣言的・関数化不要）／ OK: `const total = items.reduce((s, x) => s + x.price, 0);`（accumulator `let` を消す）／ 抽出が正解な例: `switch` で値を組み立てる処理は switch 全体を関数化して early return（呼び出し側は `const result = computeX(...)`）。

### スケール 2: 「純粋レンダリング層 / 中間コンポーネント」の新設

> Container（データ取得 + loading/error 出し分け）と pure（props 受け取り描画）を分ける指示を受けたとき、pure 層を新しいコンポーネントとして作りがち。しかし多くの codebase では既存の `XxxFormPanel` / `XxxPanel` が既に pure presenter を担っており、新設した pure コンポーネントは「エンティティ → フォーム defaults」程度のトリビアルな変換だけの**冗長な中間層**（Container → 新 pure → 既存 Panel の 3 層）になる。加えて 1 ファイルに Container と pure の 2 コンポーネントを export すると「1 ファイル 1 export コンポーネント・ファイル名 = コンポーネント名」規約に違反する。判断: pure 分割を指示されたら実装前に「その純粋描画は既存 Panel が既に担っていないか？」を確認し、担っているなら中間層を作らず Container が既存 Panel を直接描画する。**ユーザーの明示指示（命名含む）でも、既存コンポーネントとの重複・命名規約違反に気づいたら実装前に指摘する**（応答スタイル「選択後でも問題を指摘する」の適用）。実例: ADeT PR #2646 で「EditFeatureContainer(fetch) + 純粋 EditFeature」を指示通り実装したが、`FeatureFormPanel` が既に pure presenter だったため中間 `EditFeature` が冗長 + 1 ファイル 2 export 規約違反となり、reviewer 指摘で「単一 export `EditFeature` が `FeatureFormPanel` を直接描画」の 2 層へ集約（44 Container 横展開の雛形だったため影響大・2026-07）。

---

## 11. refactor-inherited-fallbacks

**live doc の対応原則**: 「リファクタで既存の fallback を惰性で持ち越さない」（Coding Policy）

> 既存コードが「format A で試して失敗したら B に fallback」「envelope / raw 両対応」「orphaned type の safety 分岐」のような防御的パスを持っていると、リファクタ時に「元々あったから維持する」と無自覚に持ち越しがち。しかし制約が変わる書き換え（例: `[]byte` → `io.Reader` streaming）で、rewind が効かないなど元の書き方が通用しない場合、fallback を streaming で維持しようとすると「先頭を peek して format 判定」等の複雑度が丸ごと乗る。判断: リファクタ着手前に「この防御パスは今も要件か？」を user に確認するか、`git log` で fallback 追加時の PR を辿って理由を確認する。要件でなければ丸ごと削るのが常に単純。実例: PR #2587 の `parseAnalyzeSpecOutput` streaming 化で「envelope + raw 両対応」を bufio.Peek + jsontext で維持したが、user 判断で envelope 一択となり複雑コードが丸ごと消えた（2026-07）。

関連: グローバル指示の「Don't add error handling, fallbacks, or validation for scenarios that can't happen」は新規追加を禁じるルールだが、これはリファクタ時に既存 fallback を惰性で持ち越す方の逆側。

---

## 12. llm-rename-freeze-boundary

**live doc の対応原則**: 「LLM 呼び出しコードの rename 凍結境界は wire 文字列か識別子かで引く」（Coding Policy）

> prompt 本文・出力スキーマの wire フィールド名（zod の key・`.describe()` 文言）・user message 組み立て文言は serialize されて model に届くため、rename すると model 挙動が変わりうる → 凍結し、触るなら eval 再走とセットの独立 issue にする。一方、同じファイル内でも model に送信されない TS 識別子（型名・schema 変数名・関数名・定数名）は通常の rename 対象。「schema.ts / prompt.ts はファイルごと凍結」と粗く引くと識別子の rename 漏れが残り（レビューで指摘される）、逆に境界を意識しないと wire 文字列を巻き込んで無自覚に model 挙動を変える。判断基準: 「この文字列はリクエスト/レスポンスとして model に届くか？」YES → 凍結、NO → rename。実例: noah issue 977 で当初「schema.ts 全体凍結」とし `aiPairingSchema` → `aiPairSchema` 等の識別子 rename が漏れ、ドメインレビューで境界を「wire 内容 vs 識別子名」に正確化した（PR #290）。

---

## 13. multi-stage-test-control

**live doc の対応原則**: 「多段ステージ処理のテストは確定ステージを入力データで制御する」（Testing Policy）

> 複数ステージが順に実行される処理（Stage 1 → Stage 2 → Stage 3 等）では、上流ステージが先に確定するデータを使うと目的のステージに到達しない。例: Stage 3（発注番号 NFKC）を検証するつもりで商品名を一致させると Stage 2（商品名アンカー）が先に確定してしまい Stage 3 は未到達のままテストが通る。各テストケースのフィクスチャに「なぜこのデータは上流ステージをスルーするか」の WHY コメントを入れ、意図したステージで確定していることを `joinBasis` 等のフィールドで assert する（issue 210 Round 2・3 で複数検出）。

---

## 14. cross-implementation-contract-pin

**live doc の対応原則**: 「2 実装が満たす契約は固定値 fixture で pin する」（Testing Policy）

### 元の原則（TS / SQL の hash 一致）

> TS 側の関数（`ledgerContentHash` 等）と DB migration の `md5(coalesce(...) || '|' || ...)`・normalize 関数が同一入力から同一出力を返す契約は、片方だけ変わってもコンパイル/typecheck が通り**silent failure**（rewire が 0 件マッチ → 全 match invalidate 等）を招く。対処: table-driven test で「入力 → 事前計算した hex/文字列」を pin する fixture を用意し、TS 側関数の結果と一致するかを assert する。事前計算は `printf '%s' '<pipe-joined>' | md5` のようにシェルで独立に算出し、SQL 側 `SELECT md5('<pipe-joined>')` と POSIX/PostgreSQL の md5 が同一である事実を利用して間接的に SQL 側 agreement も pin する。除外フィールド（hash 対象に含めるべきでない列）は `@ts-expect-error` で「型が受け付けないこと」を型レベルで担保する（誤って追加されると hash 値が全行で変わり catastrophic failure なので、テストは実行時 assertion より型ガードが強い）。実例: noah PR #340 で `md5` の TS/SQL 一致契約に対して 5 fixture の hex pin + 2 個の型ガード test を追加（Round 3 quality reviewer 指摘）。

### 亜種: サービス間の wire contract（JSON payload のキー名・クエリパラメータ名）

> 送信側の型（`interface NotifyPayload { commit_hash: string }` 等）を書き換えると typecheck は**通ったまま**受信側との契約が壊れる。型はキー名の変更を「正しい変更」として受け入れてしまうため、コンパイラは契約の破壊を検出できない。対処: fetch をモックして送信 body を捕捉し、**キー名と値を文字列で assert する**テストを 1 本置く（`expect(body.git_commit_hash).toBe('commit-abc')`）。「そのキーは wire に出るか？」が判断基準で、TS 側の引数名・変数名は対象外。検証法: 送信側のキーを一時的に旧名へ戻してテストが落ちることを確認する（落ちなければ pin できていない）。実例: ADeT-AI PR #716 で 3 エンドポイントの `commit_hash` → `git_commit_hash` 改名時に assertion を追加（改名前のテストは status / error_message は見ていたがキー名は見ていなかった）。

---

## 15. subagent-completion-verification

**live doc の対応原則**: 「サブエージェントの完了報告は実 diff で検証する」（サブエージェント委譲）

> 委譲されたエージェントがさらに別エージェントへ再委譲し、その再委譲が実体を持たないまま「実装完了」と報告してくることがある（メインセッションが並行で行った無関係な編集を自分の成果と誤認するパターンを実測）。対処: ①委譲結果は self-report でなく `jj st` / `jj diff`（git なら `git status`/`git diff`）で「期待したファイルに期待した変更があるか」を自分で確認する ②typecheck/test の green も自分でコマンドを走らせて確認する ③再委譲が疑わしい場合、再 spawn 時のプロンプトに「他エージェントへの委譲禁止・あなた自身が Read/Edit/Write/Bash で直接実装すること」を明示する。実例: noah issue 966 で委譲チェーンが実装ゼロの完了報告 → 直接実装を明示した再委譲で解決（2026-07）。

---

## 16. hook-trigger-selection

**live doc の対応原則**: 「hook のトリガーは『何が欠けているか』で選ぶ・イベント名から挙動を推測しない」（Hooks 設計規約）

### トリガー選択

> 依存インストール等の「環境を整える」hook では、変更検知イベント（`FileChanged` で lockfile を監視する等）が一見筋が良く見えるが、**外れることが多い**。git worktree / jj workspace を使った並列開発では、欠けているのは node_modules であって lockfile は**変更されていない**（コミットから来た正しい内容がそこにある）ため、変更検知は永遠に発火しない。「このイベントは、私が困っている状態のときに実際に発火するか？」を実際のワークフローに当てて確認してから選ぶ。環境が欠けている状態を拾えるのはセッション開始時点（`SessionStart`）だけ、というケースは多い。

### イベント名が用途を裏切る実例

> `Setup` は通常のセッション開始では発火せず `claude --init-only` / `-p --init|--maintenance`（CI・スクリプト用）専用。`WorktreeCreate` は Claude Code 自身が worktree を作るとき（`--worktree` / `isolation: "worktree"` / background session）だけで、手動の `jj workspace add` では発火せず、しかも「作成後の通知」ではなく**作成処理そのものの置き換え**（stdout に worktree パスを返す契約・非 0 exit で作成失敗）。採用前に必ず公式ドキュメントで発火条件を確認する。

### `SessionStart` の stdout はコンテキストに注入される

> インストールログ等を出しっぱなしにすると毎セッション冒頭が汚れる。副作用目的の hook では `> /dev/null` で捨てる（stderr はログに残るので失敗時の情報は失われない）。

### hook 発火の確認方法

> 成功した hook は会話コンテキストに何も注入しないため「発火したのか、そもそも設定が効いていないのか」がその場では区別できない。しかし `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` に `attachment.type: "hook_success"` として `hookName` / `command` / `exitCode` / `durationMs` / `stdout` / `stderr` が全て記録されている。確認: `rg '"hook_success"|"hook_error"' <session>.jsonl | jq -r '[.timestamp,.attachment.hookName,(.attachment.exitCode|tostring),.attachment.command]|@tsv'`。「hook が走ったか分からない」と答える前にこれを見る。設定変更は次のターンから即反映される（リロード不要）ことも同じログで確認できる。

---

## 17. entrypoint-removal-scope

**live doc の対応原則**: 「『動線を消す』はデフォルト値を読んでから撤去スコープを決める」（Working Rules）

> 「動線を消す」を字面通りに解釈してエントリポイント（トグル・メニュー項目・リンク）だけ外すと、**デフォルトが X 側に倒れる条件を持つユーザーは X に閉じ込められる**（切り替え手段だけ失う）。しかもその状態は「動線が消えた」ように見えるためレビューでも気づかれにくい。判断手順: ①X の初期状態を決めているもの（localStorage・cookie・feature flag・エンティティのフラグ）を読む ②「常に X でない側に倒れる」ことが保証できるならトグル削除だけでよい ③保証できないなら分岐そのもの（Provider / ルート / 切替コンポーネント）を撤去して一本化する。ユーザーが「しばらく使わない・メンテしない」と言っているなら、到達不能なコードを残す方が腐るので③を選び、復元は git 履歴に委ねる。実例: ADeT PR #2653 で quick モードのトグルだけ外すと `from_template=true` のプロジェクトが quick 固定になると判明し、モード分岐ごと撤去した（2026-07）。

---

## 18. removal-inventory

**live doc の対応原則**: 「削除・撤去 PR は前方向・逆方向・文書の 3 方向を棚卸しする」（Working Rules）

### 前方向: 消したものを誰が呼んでいるか

> エンドポイント削除と呼び出し側の更新を別 PR・別タイミングで行うと、削除後の状態でコードが動く間 runtime エラーが発生する（typecheck・lint は通るが実行時に 404 / 500 になる）。削除前に `rg "/<route-path>"` でプロジェクト全体を検索し、dialog・hook・action・test の呼び出し箇所を把握して同 PR に含める。実例: `/api/invoice/matching/reextract` route を削除した際、`match-detail-dialog.tsx` がまだ呼んでいたがコンパイルは通過し domain review で発見（issue 222・PR #171）。
> 再発: issue 977 で `getInvoiceMonthsFromDb` 削除時に conventions.md サンプル・別ファイルのコメント参照が残存しレビュー Round 4 まで検出されなかった — 関数削除時も `rg "<関数名>" docs/ apps/ packages/` でコメント・docs サンプルまで棚卸しする（コード参照だけでは足りない）。

### 逆方向: 消したコードが唯一の消費者だった共有 API の surface

> 削除の棚卸しは「消したものを誰が呼んでいるか」（前方向）に意識が向くが、撤去した機能**だけ**が読んでいた共有 hook / 関数の返り値・引数は、削除後 dead surface として残る（typecheck は「返しているが誰も読まない」を通す）。撤去 PR の最後に「消した箇所が読んでいたフィールドは他に消費者がいるか」を `rg` で確認し、いなければ返り値・引数ごと削る。同じ理屈で、**撤去した機能の制約を回避するために歪んでいた実装も元に戻せる**（制約が消えたので迂回が不要になる）— 撤去 PR は削除だけでなく「その機能のせいで払っていたコストの回収」までがスコープ。実例: ADeT PR #2653 で quick モード撤去時、`useGenerateSpec` の `isLoading`（quick 専用の自動生成 effect だけが読んでいた）が dead surface として残り reviewer 指摘で削除。同 PR で client 側 redirect（parallel route の制約回避だった）を server `redirect()` へ、layout のモード判定専用 API fetch を削除（2026-07）。

### 文書方向: 概念の撤去では docs/ / issues/ の前提記述も陳腐化する

> エラークラス・状態・型のような**ドメイン概念**を撤去するとき、`rg "<概念名>"` でコード参照を消しても、①ADR 内の cross-reference（「(6-c) の write 全禁止と整合」等・別セクションが撤去済み挙動を現在有効として参照）、②その概念の存在を前提にスコープが書かれた兄弟 issue（premise 崩壊）が陳腐化して残る。撤去 PR では `rg "<概念名>|<関連語>" docs/ issues/` で「概念を前提にした記述」まで検索し、ADR は NOTE 追記・issue は Devlog に「前提変更」エントリ追記で追従させる。実例: issue 957 で `MultiInvoiceDegradedError` 撤去時、ADR-0009 (3) の (6-c) cross-reference と issue 286 の degraded 前提スコープが policy reviewer 指摘で発覚（PR #273）。

---

## 19. adr-drift

**live doc の対応原則**: 「ADR と実装が乖離したら ADR 側に追記する（本文は書き換えない）」（Working Rules）

### 元の原則

> ADR は策定時の想定を書くが、実装フェーズで「assemble 時 pre-compute」「lazy getter」等の方向に着地することがある。実装を ADR 想定に合わせる（余分な集約メソッドを追加する等）より、ADR の当該判断セクション末尾に「### 実装メモ」サブセクションで「実際の着地モデル・なぜそうなったか・どういう条件なら元の設計に戻すべきか（再評価条件）」を追記する方が将来の開発者に意図が伝わる。WHY: コードが真実であり ADR は意思決定の記録なので、コードを ADR に合わせてコードを複雑化するより、ADR をコードの実態に追従させる。実例: ADR-0009 (4) で `VendorMatching.lineItemStatus(matchId)` 集約メソッドを想定したが issue 254 実装は assemble 時 pre-compute モデルになった — 集約メソッドを余分に追加せず ADR (4) に実装メモを追記（PR #212）。

### 亜種 1: 「決定済みだがコード未追従」の rename・仕様は分離セクションへ

> 用語集・設計 doc が未実装の新名を現在形で断定すると（「テーブルは `vendor_confirmations`」等）、doc がコードに存在しない状態を主張することになり、レビューでの矛盾指摘・読者の grep 不一致を生む。本文は現行名主体で書き、将来名は issue 番号付きの分離セクションに置いて、コードが追従した PR で本文へ昇格させる。実例: noah issue 977 で `docs/adachi/invoice-matching.md` が issue 978 分（`vendor_confirmations`・`InvoiceMatchingJobStep`・`MatchMethod` 分割）を本文で断定 → policy reviewer 指摘で「rename 決定済み・コード未追従（issue 978）」セクションに分離（PR #290）。

### 亜種 2: 無効化された歴史記述には NOTE を添える（本文は書き換えない）

> 歴史記述をそのまま残すと「現在も有効」と誤読され（policy 観点の矛盾指摘）、書き換えると意思決定の記録が壊れる（quality 観点は「歴史記録として矛盾なし」と判断する）。両レビュー観点の見解相違を NOTE 追記が両立する。実装メモがある節への cross-reference（「実装メモを参照」）を添えると読者が現在の正へ辿れる。
>
> 実例: issue 957 で ADR-0009 (3) の「(6-c) write 全禁止と整合」記述に NOTE を追記（PR #273）。
> 再発: issue 991 で ADR-0010 (4) の優先順位リスト（carry_over 含む）と `isAllConfirmed` 式に「issue 991 で撤廃済み・現在の正は vendor-status-label.ts」NOTE を追記 — policy reviewer の非 Nit 指摘を NOTE 追記で解消（Round 2 approve・PR #338）。

---

## 20. deferral-marker-attribution

**live doc の対応原則**: 「deferral マーカーは `TODO(#NNN)` と `FIXME:` の 2 種のみ」（Working Rules）

### 亜種: 番号のない issue 帰属コメントも禁止

> `<!-- ... (issue で導入・YYYY-MM) -->` のような「番号のない issue 帰属コメント」も禁止。導入経緯の attribution は git blame / PR で辿れるので不要。書くとしても番号付き（`issue NNN で導入`）にする。そもそも WHY コメントに帰属注記を混ぜず「なぜこの列が必要か」だけを書く。実例: noah PR #340 で schema.ts の contentHash JSDoc に `（issue で導入・2026-07）` と番号なしで書き quality reviewer Nit で削除（Round 3）。

---

## 21. design-brief-spec-first

**live doc の対応原則**: 「デザイン要件ドキュメントは正しい仕様の定義として書く」（Working Rules）

前回 archive の `CLAUDE.md-2026-07-02.md#5-design-brief-spec-first` に詳細と実例がある。要点:

> 実装途中・UI 未着手の機能のデザイン依頼ドキュメントは、あるべき仕様を定義するフレームで書き、現行実装が乖離していれば「作り直し対象」と明示する。特に ① 状態変化は「削除される N 件」でなく「到達不能になる版」等の到達性で表現、② 将来実装の操作の引き継ぎ範囲（HEAD のみ / Current も含む等）を必ず明記する（UI の初期状態・空状態が定まる）。

---

## 22. pm-session-issue-status

**live doc の対応原則**: 「PM セッションは issue のステータスを更新しない」（Working Rules）

> 「着手できそう」「もう終わった」と判断しても、issue の `status` フィールド（open → in-progress → done）を変更しない。ステータス更新は**着手した実装セッション**の責務。PM セッションが変更すると、実装セッション側が同じ issue を別の状態で参照したときに意図せず差し戻すか上書きする事故が起きる。
