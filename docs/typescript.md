# TypeScriptの規約と罠

> **TL;DR**: TypeScriptを書くときとレビューするときに読む。一般的な作法から外れるpomesakaの選択、`as`を使わずに型を付ける方法、型検査を通るのに実行時に壊れた罠をまとめてある。道具と版に依る罠（Bun、Biome、開発環境）は`ts-react-tooling-gotchas.md`にある。

整理する前の版は`archive/2026-11-16/docs/typescript.md`と`archive/2026-11-16/docs/typescript-gotchas.md`に、2026-11-27に消した項目は[archive/typescript-2026-11-27.md](archive/typescript-2026-11-27.md)にある。

## 規約

- **named exportだけを使う**。フレームワークがdefault exportを求めるファイル（Next.js App Routerの`page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx`）は除く。
- **型を偽らない**。`as`は使わない（`as const`は別。代わりの書き方は下の表）。`any`でなく`unknown`を型ガードで絞る。`!`（non-null assertion）はBiomeの`noNonNullAssertion`が拒否するので、分岐で絞ってearly returnするか、値が保証される構造に変える（`Map.get(key)!`は、反復で値を直接取る）。避けられないときはWHYコメントを書く。
- **`class`を使わず、型と`createFoo(deps: FooDeps): Foo`のファクトリで書く**。依存をクロージャに束ねると、呼び出し側は`foo.send(input)`だけになり、テストではspyを渡せる。名前は、ファクトリが`create*`、依存の型が`*Deps`、戻り値の型が機能名（`Mailer`）。循環importになるときも、相手をimportせず引数で受け取り、呼び出し元が解決して渡す。
- **Result型には、型と同じ名前の`const`に`ok`と`fail`のコンストラクタを置いてよい**（`KickResult.fail("FORBIDDEN", ...)`）。ガード節で同じ形のエラーを何度も組み立てる箇所に使う。`fail`の中身がどのResult型でも同じなら、共通の関数にする。
- **unionの値は`as const`の配列を先に定義し、型、`z.enum`、UIの選択肢をそこから導く**。別々に書くと、型に足した値がUIに出ない。
- **あるフィールドの有無が`status`などの値で決まるなら、optionalにせずdiscriminated unionにする**。実行時のガードとそのテストが要らなくなる。判別子を確かめる前に読むフィールド（`useEffect`の依存、派生値の計算）と、どの場合でも任意のフィールドはbaseに残す。
- **unionの`switch`は全caseを書き、`default`に`x satisfies never;`を置く**。`const _x: never = x`は`noUnusedLocals`でTS6133になる（`_`の除外はparameterだけに効く。TS 5.9.3と7.0.2で確認）。`default`の後始末は値の出どころで決める。DB由来の値ならwarnして既定値を返し（throwするとサービス全体が止まる）、自前で組み立てた値ならthrowする。`map`や`reduce`のコールバックの中では、Biomeの`useIterableCallbackReturn`が`default`の戻り値を求めるので、`x satisfies never;`の後に`return null`を書く。定数のマップは`Record<Union, V>`にして、`?? fallback`を消す。
- **必ず在るものをoptionalやデフォルト値で受けない**。渡し忘れが型エラーにならない。APIが必ず返すフィールドはrequiredにし、requiredのpropsの分割代入にデフォルト値を付けない。「無い」は`T | null`を必須にして表す（`amount?: number | null`は省略と`null`を区別できない）。
- **モジュールを越える型は明示して宣言する**。`ReturnType<typeof fn>`は実装の変更を型エラーなしで呼び出し側へ伝えるので、内部のヘルパーに限る。判断基準は「この型は、ほかのモジュールの引数か戻り値としてexportされるか」。
- **DBの行の型に`Row`、`NewRow`を付け、ドメインの型が正規の名前を持つ**（`AgentAction`と`AgentActionRow`）。広く参照されるドメインの型の名前を安定させる。discriminated unionのリテラル型もドメイン層に置き、schemaが`import type`で参照する。
- **外部との境界（API、LLMの出力、利用者の入力）はZodで検証し、合わない要素を型ガードの`filter`で捨てずに`map`の中でthrowする**。`filter`は欠損をエラーなしで下流へ流す。内部のデータなら`filter`でよい。
- **型には、ほかのフィールドから計算できる値（`url`から得られる`domain`）を持たせず、表示する層で導く**。持たせると、組み立てる側に整合の責任が生まれる。特定のschemaやAPIに渡す型は、フィールド名をそのschemaに揃える（`lat`でなく`latitude`）。
- **検索と比較の関数は、生の入力を受けて中で正規化する**。呼び出し側に任せると、忘れてもどちらも`string`なのでコンパイルを通り、常に0件になる。branded typeで区別できるなら、呼び出し側の契約にしてよい。
- 値によって引数の要るものと要らないものが混ざる関数のマップは、全キーを同じ関数型に揃える（`satisfies Record<K, (amount: number | null) => string>`）。呼び出し側の分岐が消える。
- `readonly`を積極的に使う。公開する関数の戻り値の型は明示する。
- ファイル名はケバブケース（`user-service.ts`、`action-menu.tsx`）。

## `as`を使いたくなる場面と代わりの書き方

| 場面 | 代わりの書き方 |
|---|---|
| `fetch`の応答や`request.json()`に型を付ける | Zodで検証する。envelopeは`z.discriminatedUnion("ok", [...])`で確かめ、中身は呼び出し側が渡したスキーマで`parse`する |
| `unknown`の型ガードの中でプロパティを読む | `const obj = value`に受けて、`"start" in obj && typeof obj.start === "number"`を連ねる。キーが変数なら`Reflect.get(obj, key)`が`unknown`を返す |
| HTTPの境界で外部SDKの複合型（`UIMessage[]`）を受ける | `z.custom<T>((v) => typeof v === "object" && v !== null)`。中身の検証はSDKに任せる。クライアントが自社のコードのときに使う |
| テスト用の値をSDKの型（`TextStreamPart`など）にする | `node_modules/<pkg>/dist/index.d.ts`を読んで、正確な形で組み立てる。`as`で見せかけると、フィールド名が違っても型検査を通り、実装の側で読み飛ばされる（ai v6.0.xの`text-delta`は`textDelta`でなく`text`で、`id`が要る）。版を上げた後も先にd.tsを読む |
| `Object.keys`をunionに絞る | 型を付けたリテラルの配列を持つ。キーを足したら配列も直す。表示の順番の指定も兼ねる |
| 「この経路ではXしか来ないはず」 | 関数の先頭で`if (v !== expected) throw new Error(...)`。前提が崩れたときに実行時に分かる |
| `useState<A[]>`が、ある時点から実際は`B[]`を持つ | 解決した時点で`useRef<B[]>`に入れ、stateを組み立てるときにそこから読む |
| `test.each`の行ごとに型が違う | 行に`execute: () => 結果`のクロージャを持たせ、`expect(execute()).toBe(expected)`にする |
| `bun:test`の`mock.module`で受けた引数を後で読む | 期待する形の型（`MockConfig`）を、ファクトリの引数と、受け取る変数の両方に付ける |
| genericの関数が条件型（`Extract<Union, { f: Cond<T> }>`）を返し、型を証明できない | genericをやめ、理由をコメントに書く。要るようになったら、overloadと型のテストで確かめてから入れる |
| 空の配列に型を付ける | `[] satisfies T[]`か`const arr: T[] = []`。`{ items: [] }`のように文脈から型が決まる箇所には`satisfies`も要らない |
| 初期化を遅らせるProxyのtargetに型を付ける | ほかに書き方が無いので、`as`を使ってよい唯一の例外にする（`nextjs.md`） |

残っていないかは`rg ' as [^a-z ]'`で探す。`as [A-Z]`では`as 1 | 2 | 3`を取りこぼし、この式なら`as const`には当たらない。

## 型検査を通るのに壊れた罠

- **`get`だけの遅延Proxyは、使う側の`"x" in obj`を壊す**。`in`はtarget（空のオブジェクト）を見て常にfalseを返す。ライブラリは`in`で分岐することがあり（better-authの`toNextJsHandler`の`"handler" in auth`）、「auth is not a function」のような実行時エラーになる。Proxyをライブラリに渡すなら、`has: (_t, p) => p in resolve()`も実装し、要るなら`ownKeys`と`getOwnPropertyDescriptor`も足す。
- **discriminated unionの分岐の中の`??`や`||`のフォールバックは、到達しなくても型エラーにならない**。型を絞る前の名残か、型を変えた後の直し忘れであることが多いので、意図したものかを確かめる。
- **`catch`での中断の判定は`err.name === "AbortError"`でなく`controller.signal.aborted`で行う**。同じ名前の独自のErrorがあると誤って判定する。
- **テストで、optionalな値のassertionを`if (x !== undefined) { expect(...) }`で囲まない**。値が無いとブロックごと飛ばされ、何も確かめずに通る。`?.`でつないだ値を`expect`に渡すのも同じ。値を取り出して`if (!x) throw new Error(...)`を置き、その後にassertionを書く。場合によってassertionの有無が変わる正当な理由があるときは除く。
- **数値は境界で範囲まで検証する**。LLMはごくまれに`Infinity`、`NaN`、負の数を出し、`z.number()`だけでは通るので、`.nonnegative().finite()`を付ける（件数や添字は`z.number().int().nonnegative()`）。環境変数やフォームの文字列は、`Number()`も`Number.parseInt()`も`NaN`をエラーなしで返し、`parseInt("12abc", 10)`は`12`を返す（node 22で確認）ので、`z.coerce.number().int().positive()`に通す。
- **Zodのスキーマの合成は`.shape`のspreadで書く**（`z.object({ ...dbEnvSchema.shape, KEY: z.string() })`）。zod 4.6.7のd.tsで非推奨なのは`.merge()`で、`.extend()`は非推奨ではない。
- **zod v3の`z.discriminatedUnion`は`.refine()`を付けたスキーマを受けない**。`.refine()`が`ZodObject`を`ZodEffects`に変えるので、`z.union([schema.refine(...), other])`を使う。v4では受け、refineも効く（zod 4.6.7で確認）。
- **postgres.jsの`DO`ブロックの中では、テンプレートに埋めた値がbindされない**。postgres.jsは値を`$1`のパラメータで送るが、`DO`ブロックは引数の無い関数の本体なので、`ERROR: there is no parameter $1`で落ちる。文字列を連結して`sql.unsafe()`に渡すとSQLインジェクションになる。`` sql`SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${name}, ${password}) AS stmt` ``でサーバーにエスケープさせ（`%I`は識別子、`%L`はリテラル）、返った文を`sql.unsafe()`で実行する。存在の確かめのような`DO`の要らない部分は、ふつうのparameterizedなクエリにする。

## 型検査の癖

- **`let x: T | null = null`にコールバックの中でだけ代入すると、外側では`null`に絞られ、`if (x === null) throw`の後が`never`になる**（TS 7.0.2で確認）。値を捕まえるときは配列に`push`して、`observations[0]`を取り出して確かめる。
- **`noUncheckedIndexedAccess`を有効にしている**。配列、`match[n]`、`Record[key]`の結果は`T | undefined`になる。`text.match(p)?.[1] ?? ""`のように`?.`と`??`で受けるか、ifで確かめてから使う。
- **リトライのループは`for (let attempt = 0; ; attempt++)`で書く**。上限つきの`for`は、全経路がreturnかthrowでもTS2366になる（TS 5.9.3と7.0.2で確認）。それを消すための末尾の`throw lastError`は、`retries`が負のときに`throw undefined`になる。止まることはcatchの中の`if (attempt >= retries) throw error`が担うので、試す回数を固定するテスト（`retries`が0と負で1回）を書く。
- **`satisfies string[]`は、配列のリテラルの要素を`string`に広げる**。キーとして使う配列（`OBJ[k]`）にすると、`map`や`reduce`のコールバックでTS7053になる。リテラル型を保つなら`as const satisfies readonly K[]`にするか、`K[]`で注釈する（TS 5.9.3と7.0.2で確認）。
