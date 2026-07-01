# CLAUDE.md 圧縮 archive (2026-07-02)

**退避元**: `~/.claude/CLAUDE.md`
**退避日**: 2026-07-02
**圧縮 run で扱った原則数**: 6
**圧縮スキル**: `/reflection`

各セクションは live doc の対応原則から `archive/CLAUDE.md-2026-07-02.md#<anchor>` で参照される。

---

## 1. why-comment-verification

**live doc の対応原則**: 「WHY コメントに書く前提は実機で検証してから書く」（Coding Policy）

### 元の具体例チェーン

**本節**（statistics: importance high / mentions 10 / first-seen 2026-06）:

> **WHY コメントに書く前提は実機で検証してから書く**（憶測の WHY は将来の罠になる）: 「TypeScript が circular inference で推論できない」「library X が auto-fallback してくれる」のような **ライブラリ・ツールの挙動を断定する WHY** は、必ず実機で検証（型エラーを誘発・公式ドキュメントを当たる・実際に呼び出す）してから書く。検証せず憶測を書くと、後続レビューが「ここは確認済み」とスルーし誤りが温存される。
>
> 実例:
> - noah で `betterAuth() 内で循環推論できないため "role" in ガードが必要` と書いたが実際は外部から推論可能
> - `admin plugin が admin ロールに自動で標準権限を付与する` と書いたが実際は roles 指定時は置換され消える（ドキュメント・型確認で即否定できた憶測）
> - `jp. inference profile は ap-northeast-1 に留める` という未検証の断定がコメントと CLAUDE.md に書かれた結果、「東京リージョンだけ IAM 許可すればよい」という誤実装の根拠として参照され、確率的 403 障害を生んだ（実際は東京+大阪の2リージョン構成・`aws bedrock get-inference-profile` で即確認できた）— **誤った WHY は単に放置されるのでなく、後続実装の「正しさの根拠」として再利用され障害を再生産する**
> - issue 075 で `rowToInProgressStep` に「TypeScript が step を string として扱うため型ガードが必要」という WHY を書いたが、`.$type<MinutesStepDb>()` により TypeScript は literal union を正しく推論しており誤りだった（関数の実目的はランタイム防御）
>
> NG: `// WHY X: library Y がそうする`（未検証）／OK: `// WHY X: library Y vN.M で動作確認・公式パターン a/foo を参照`（検証済み）。
>
> **亜種: 「〜は未検証。現状許容する」という形も同じ規約違反** — 「未検証」を明示した上で「許容」という判断を断言すると、読者は「問題ないと判断済みのはず」と解釈してそれ以上掘り下げなくなる。未検証の前提は「将来確認する」か「確認した上で結論を書く」かのどちらか。issue 049 で `auth.api.getSession が 2 回 DB を叩くかは better-auth の内部キャッシュ実装に依存しており未検証。現状許容する` という WHY を書いたが、`requireAccess` が `React.cache` を使わない事実を確認後に「Request Memoization による重複排除は発生しない（確認済み）、頻度が低いため問題にならない見込み」に改めた。

**亜種 1: PostgreSQL のトランザクション分離レベルをコメントに誤記するパターン**:
`db.transaction()` に「SERIALIZABLE でなくとも SELECT はトランザクション内のスナップショットを参照する」という WHY を書いたが、これは誤り。PostgreSQL のデフォルト分離レベルは **READ COMMITTED** であり、トランザクション内の SELECT は（外部でコミットされた変更を含む）最新コミット状態を読む — スナップショットを固定するのは REPEATABLE READ 以上。`db.transaction()` でアトミックに発行できるのは事実だが「スナップショット保証」ではない。「他セッションのコミットを SELECT が読む可能性が残る（厳密な防止には REPEATABLE READ 以上が必要）」と書くのが正確。issue 258 の `finalizeMinutes` で quality reviewer 指摘・修正。

**亜種 2: `Reflect.get` の戻り値を「unknown」と誤記するパターン**:
`Reflect.get(obj, key)` は `as` キャスト禁止の代替として使うが、戻り値の静的型は `any`（`unknown` ではない）。コメントに「戻り値は unknown」と書くと「型安全に取り出せる」という誤解を招く。正しい説明: 「`Reflect.get` の戻り値は実質 `any` だが、直後に `unknown` 変数で受け取り `typeof` で narrowing する — `as` キャストは narrowing をバイパスするがこの方法は narrowing を通す」（issue 239 の `open-invoice-pdf.ts` で policy reviewer 指摘・修正）。

**亜種 3: JSDoc の手順記述に「通常到達しないパス」が主要ユースケースとして書かれる**:
正規化関数の JSDoc に「"NO." プレフィックスがある場合に数字部分を取り出す」と書いたが、LLM が schema description により NO. なしの数字部分のみを返すため、そのパスは通常到達しない。JSDoc が fallback パスをメインユースケースとして書くと読者が誤解する。**対処**: 通常到達しないパスは「このパスは通常到達しない（なぜなら…）」と明示する。実例: issue 207 の `normalizePurchaseOrderNumber` で「NO. プレフィックスがある場合」→「WHY NOT: LLM は schema description により数字部分のみを返すため、このパスは通常到達しない」に修正（quality reviewer 指摘）。

**亜種 4: ADR 番号引用の誤り — セクション番号の誤記が後続実装の前提を破壊する**:
ドメイン設計を ADR で固定したときに、コメント・ドキュメント・実装から ADR を引用するが、セクション番号を誤記すると読者が ADR を確認した時点で混乱し、「本当の意図は何か」という誤解の根拠になる。実例: issue 225 で「ADR-0009 (1) 集約境界」と誤った ADR セクション番号を書いたため、読者が (1)「用語整理」セクションを確認しても集約の定義が無く、実装の動作と ADR 文書の乖離に気づく遅延が発生した（正しくは (3)「集約境界の明示」）。**対処**: 実装や comment を PR に含める前に、ADR の該当セクション番号を実際に ADR ファイルで確認し、セクション内容が実装の意図と一致していることを検証する。同時に、セクション番号だけでなく「集約ライフサイクル vs UI 投影フィルタ」のように層別を明記し、読者が「どの層の概念を指しているか」を誤解しない工夫も必要。WHY 層別が重要か: 集約は「ライフサイクル上の存在」と「表示判断」で観点が異なり、単に「ADR-0009 集約境界」と書くだけでは後続実装者が「ライフサイクルのどのレベルを指すのか」を誤判断する可能性がある。実例: issue 225 の実装メモで「集約ライフサイクルと UI 投影フィルタの区別」を ADR-0009 に記録し、同じ誤解が再発しないようにした（ADR-0009 実装メモセクションを参照）。

---

## 2. test-each-uniformity

**live doc の対応原則**: 「`test.each` は同じ構造・複数ケースの共通化」（Testing Policy）

### 元の具体例チェーン

**本節**（statistics: importance medium / mentions 5 / first-seen 2026-06）:

> **`test.each` テーブル行に条件分岐フラグ（`needsSegments` 等）を入れない**: ケースによって異なるセットアップが必要なとき、テーブル行の中で `if (flag)` や `condition ? setupA() : setupB()` を使うとテストの意図が不明瞭になる。代わりに独立した `test(...)` に分割する。テーブルの各行は「1ケース = 完全に自己完結した入力と期待値」で成立させる。**assertion パターンが変わるケースも同様**: 例えば「行が0件の場合は `toHaveLength(0)` だけ、1件以上の場合は追加で行の内容も検証」のように assertion 数が変わるケースも `if (expectedRows > 0)` というフラグが必要になり、テーブル化できない。assertion パターンが異なるケースは独立した `test()` に分離し、同じパターンのケースのみ `test.each` でまとめる。

**補足 1: for ループが 0 回走ること自体は assertion パターンの変化ではない**:
`for (let i = 0; i < pairings.length; i++) { ... }` のループ本体が空配列で実行されないのは「assertion コードの構造が同じ・期待値が空なだけ」。`if (flag)` 条件分岐とは別物で、この形のケース（配列 0 件・N 件の両方）は同じ test.each テーブルに共存できる（issue 210 Stage 3 テーブルで確認 2026-06）。

**補足 2: テーブルに 1 行しかないなら `test.each` でなく独立した `test(...)` にする**:
テーブル駆動の意義は「同じ構造・複数のケース」の共通化にある。行が 1 つしかないと「同じ構造のケース集」としての意味がなく、読み手が「他のケースがあるはず」と誤解する。1 行 `test.each` を見たら独立した `test(...)` に変換すること（quality reviewer がこのパターンを指摘した場合は false alarm でない — 変換が正しい）。実例: issue 231 の `detectMultiPayeeAmbiguous` テスト（1 行テーブル）を `test(...)` に変換。

**補足 3: `shouldThrow: boolean` フラグをテーブル行に持つのは「条件分岐フラグを入れない」の典型的な亜種 — 1 PR 内で複数ファイルに再発しやすい**:
「throw するケース / 成功するケース」を 1 つの `test.each` テーブルに `shouldThrow: true/false` フラグで詰めるパターンは、`if (shouldThrow) expect(...).toThrow(...); else expect(...).resolves.toBe(...)` という assertion 分岐を要求する。**同一 PR 内で複数のテストファイルを新規追加/大幅編集するとき、1 ファイルで指摘されて修正しても別ファイルで同じ形が残りやすい**（reviewer が rg で 1 ファイル範囲しか掘らない・別ファイルに同アンチパターンがあることを能動的に検出しにくい）。対処: `test.each` を新規追加/編集した PR は、reviewer round ごとに **PR スコープ全体を `rg "shouldThrow" <PR で変更した *.test.ts>` で横断確認する**。指摘を受けたら「同 PR 内の他テストファイルにも同じフラグを入れていないか」を必ず横断チェックしてから次ラウンドへ進む。実例: noah issue 294 で `invoice.test.ts` と `invoice-store.test.ts` の両方に `shouldThrow` フラグが入り、Round 1 で片方修正 → Round 3 で反対側発覚（PR #256）。

---

## 3. switch-vs-record-vs-if

**live doc の対応原則**: 「値による分岐は switch-case、優先順位付き分類は if + early return、値を選ぶだけなら Record lookup」（Coding Policy）

### 元の具体例チェーン

**本節**（statistics: importance medium / mentions 3 / first-seen 2026-06）:

> **値による分岐は switch-case を使う**: 1つの変数の値によって複数のケースに分岐するコード（step → 型変換・status → ラベル等）は `if (x === "a")` の連鎖ではなく `switch (x) { case "a": ... }` で書く。switch は「この関数は x の全ケースを網羅している」という意図が読み手に伝わりやすく、TypeScript の exhaustive check とも相性が良い。

**亜種 1: 値を「選択」するだけ（全 case が return）なら Record lookup が簡潔**:
`switch (key) { case "a": return 0; case "b": return 1; }` は `const MAP = { a: 0, b: 1 } as const; return MAP[key];` に変換できる。ネスト switch で全内側 case が return を持つ場合、外側の `break` は unreachable になり quality reviewer に指摘される（issue 254 の `statusSortPriority` で検出）。

**亜種 2: 優先順位付き分類は switch-case ではなく `if + early return` の連鎖で書く**:
1 つの変数の値で分岐するのでなく、複数の独立した条件（boolean ファクト群）に優先順位を付けて 1 つを選ぶケース（5 値のステータスラベルを「missing > carry_over > confirmed > unresolved > pending」の順で確定する等）は switch では表現できない（判定対象が単一の値ではなく複数の条件のため）。`if (vm.isInvoiceMissing) return "missing_invoice"; if (vm.carryOverToNext !== undefined) return "carry_over"; ...` のように、各 if が「この条件が成立すれば優先順位上位なのでここで確定」を表す形が読み手に意図が伝わる。判定対象が**単一変数の値**か**複数ファクトの優先順位**かで使い分ける（前者は switch / 後者は if + early return）。実例: `deriveVendorStatusLabel`（issue 256）。

---

## 4. todo-issue-linkage

**live doc の対応原則**: 「作業中のフォローアップは現 PR に issue 追加 + TODO(#NNN) コメントをセットで含める」（Working Rules）

### 元の具体例チェーン

**本節**（statistics: importance high / mentions 2 / first-seen 2026-06）:

> **作業中に気づいた追加実装・バグ・未配線は、現 PR に「issue 追加 + コード内 `TODO(#NNN)` コメント」をセットで含めて push する**: scope 外と判断したフォローアップ事項を別 PR・別タイミングで起票する運用はもれが発生する（記憶頼りになる・別ブランチ作成のオーバーヘッドで先送りされる）。**現 PR の作業コピーに ① `issues/NNN-*.md` 新規作成、② 該当コード位置に `TODO(#NNN): <要約>` コメント、の 2 つをセットで push する**ことで「コード ↔ issue ↔ PR」の三者が同一コミットで紐付き、後から検索（`rg "TODO\(#"` / `gh issue view N`）で確実に辿れる。プレースホルダ・空ハンドラ・runtime バグ・回避策コメントを残すときは必ず issue を切る。逆に「TODO（issue 番号なし）」「FIXME（誰宛か不明）」だけ残すのは禁止 — 数週間後に「これ何だっけ」となる。実例: PR #147 で UI アップロード配線が 3 箇所未着手 → issue 112 を同 PR に追加し `TODO(#112)` に置換。

**亜種: plan / PR ボディ / コードコメントに「別 issue 候補に残す」「後続 issue で対応」のような曖昧なフォローアップ言及を残すのも禁止**:
その場で `issues/NNN-*.md` を起票して番号を確定し、「別 issue 候補」を `TODO(#NNN)` に置換する（曖昧表現は「issue を切った気」になるが番号がないので検索できず先送りと同義）。実例: PR #196 の plan に「UnsettledCarryOverSection は別 issue 候補に残す」と書いたままユーザーに指摘され issue 251 を起票・TODO(#251) に置換した。

---

## 5. design-brief-spec-first

**live doc の対応原則**: 「デザイン要件ドキュメントは『現状の説明』でなく『正しい仕様の定義』として書く」（Working Rules）

### 元の具体例チェーン

**本節**（statistics: importance high / mentions 2 / first-seen 2026-06）:

> **デザイン要件ドキュメント（デザイナーブリーフ）は「現状の説明」でなく「正しい仕様の定義」として書く**: 実装途中・UI 未着手の機能のデザイン依頼ドキュメントは、現在の実装を真実として記述するのでなく、**あるべき正しい仕様を定義する**フレームで書く。現行実装がその仕様から乖離していれば「作り直し対象」として明示し、理由を書く。ユーザーが「このドキュメントは仕様策定の意味合いもある」と言った時点でこのフレームに切り替える。シグナル: 画面のリデザイン、in-progress の機能追加（ブランチ概念追加など）。

**サブ節: 仕様の精度で特に注意すべき点**:
1. ブランチがある仕様で「削除される N 件」と書くと「指定時点以降の全件」に読めてしまうが、実際は「その操作後にどのブランチからも辿れなくなった版だけ」を指すことが多い。「到達不能になる版」と表現する。
2. 将来実装の操作（ブランチ作成等）の「分岐元の引き継ぎ範囲」（HEAD のみ / Current も含む）は必ず明記する — これが曖昧だと UI の初期状態・空状態の設計が定まらない（実例: ADeT PR #2544 で UC-6 の HEAD/Current 未定義がレビュー指摘になった）。

---

## 6. biome-post-edit-hook

**live doc の対応原則**: 「`PostToolUse:Edit` で biome auto-fix を走らせない — `Stop` hook に集約する」（Claude Code Hooks 設計規約）

### 元の具体例チェーン

**元は 2 節に分かれていた**（`biome check --unsafe` の問題と `noUnusedImports` (safe fix) の問題）。統合後は 1 原則。

**元の節 1: `biome check --unsafe` を `PostToolUse:Edit` に設定すると中間 Edit で変数名が壊れる**（importance high / mentions 1 / first-seen 2026-06）:

> Biome の `noUnusedVariables` は unsafe fix として「まだ使われていない変数」を `_prefix` にリネームする。複数の Edit でコードを段階的に組み立てる際、「変数を定義したが使用箇所はまだ追加していない」中間状態で hook が走ると次の Edit で `Cannot find name '<変数名>'` が発生する。対処: `PostToolUse:Edit` は `--unsafe` なし（`biome check --write`）にし、`Stop` hook でターン終了後に変更ファイル全体に `--unsafe` を走らせる。`Stop` hook での変更ファイル特定は `jj diff --name-only` を使う（`$CLAUDE_FILE_PATH` は Stop イベントでは使えない）。

**元の節 2: Biome の `noUnusedImports`（safe fix）は中間 Edit で未使用 import を削除する — `PostToolUse:Edit` で `biome check --write` を仕込まない**（importance high / mentions 1 / first-seen 2026-06）:

> `noUnusedVariables` は unsafe fix だが `noUnusedImports` は **safe fix** のため、`--unsafe` なし（`biome check --write`）でも中間 Edit で「import を追加 → まだ使用箇所がない」状態で auto-fix が走り import が削除される。次の Edit で `Cannot find name 'X'` が発生するか、使用箇所を追加しても lint が再 import を要求する。**対処: `PostToolUse:Edit` で biome を走らせず、`Stop` hook の `biome check --write --unsafe` だけに集約する**（ターン終了時には使用箇所も揃っているため未使用 import の誤判定が起きない）。「import と使用箇所を同じ Edit ブロックに書く」規律で凌ぐのは脆い（複数ファイル間の追加・段階的リファクタで容易に破れる）。実例: issue 231 の `AmbiguousCandidatePicker` import が JSX 追加前に削除・`updateInvoiceVendorResolution` import が関数呼び出し前に削除（いずれも `noUnusedImports` の safe fix）。noah workspace で PostToolUse:Edit の biome hook を削除。

**統合理由**: 両節とも「中間 Edit で auto-fix が走ると次の Edit で `Cannot find name 'X'` が発生する」という同一根本原因。unsafe / safe の違いは検知される対象（変数名 / import）だけで、対処策も同一（`Stop` hook に集約）。
