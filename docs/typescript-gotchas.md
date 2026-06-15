# TypeScript 落とし穴・コンパイラ挙動メモ

> **TL;DR**: 実装中に踏む TypeScript 固有の罠と回避策。カテゴリ: [as禁止下の型付け代替](#as-キャスト禁止下の代替パターン)・[コンパイラの罠](#コンパイラの罠)（narrowing・satisfies・条件型）・[Zod/バリデーション](#zod-バリデーション)・[環境・ツール固有](#環境ツール固有)（Bun・import.meta・g-flag RegExp）。基本規約・設計パターン → `typescript.md`

## `as` キャスト禁止下の代替パターン

### `fetch` レスポンスは `z.discriminatedUnion` で検証する

`Response.json()` の戻り値は `unknown`。`as { ok: boolean; data: T }` で型付けすると不正レスポンスがランタイムで silently 通過し、サーバー contract 違反を検出できない。`z.discriminatedUnion("ok", [success, error])` で envelope を検証し、success バリアントには `data: dataSchema` を渡せば内側 payload も自動検証されて `as` 不要・型安全（"as キャスト禁止" 環境での標準 fetch ヘルパパターン）。
```typescript
const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.unknown() }),
]);
async function fetchOk<T>(url: string, dataSchema: z.ZodType<T>): Promise<T> {
  const env = envelopeSchema.parse(await (await fetch(url)).json());
  if (!env.ok) throw new Error(`API error: ${JSON.stringify(env.error)}`);
  return dataSchema.parse(env.data); // T を返す（as 不要）
}
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### `unknown` からの型ガードで `as` を使わない（`in` + `typeof` チェーン）

型ガード関数（`function f(x: unknown): x is SomeType`）の内部で `(x as Record<string, unknown>).field` のようなキャストを使うのは `as` キャスト禁止ルール違反。代わりに `in` operator + `const obj = value` + typeof チェックの chain で書く。

```typescript
// NG: as キャスト禁止
function isWhisperSegment(value: unknown): value is WhisperSegment {
  return typeof value === "object" && value !== null &&
    "start" in value && typeof (value as Record<string, unknown>).start === "number";
}

// OK: in operator で存在確認後、const に受けてから typeof で型チェック
function isWhisperSegment(value: unknown): value is WhisperSegment {
  if (typeof value !== "object" || value === null) return false;
  const obj = value;
  return "start" in obj && typeof obj.start === "number" &&
         "end" in obj && typeof obj.end === "number" &&
         "text" in obj && typeof obj.text === "string";
}
```

TypeScript は `in` + `typeof` のチェーンで `obj.start` 等のアクセスを安全と判断するため、キャスト不要になる。

**動的キー（変数）でアクセスしたい場合は `Reflect.get`**: リテラルキーではなく文字列変数でプロパティを取り出す必要があるとき、`Reflect.get(obj, key)` が `unknown` を返す唯一の `as` 不要な手段。

```typescript
// NG: string 変数キーで as を使う
const val = (obj as Record<string, unknown>)[key];

// OK: Reflect.get は unknown を返す。その後 typeof で絞り込む
const val: unknown = Reflect.get(obj, key);
if (typeof val === "string") { ... }

// 実用例: 外部APIレスポンスの複数フィールドを動的に取り出す
const strProp = (obj: unknown, key: string): string | undefined => {
  if (typeof obj !== "object" || obj === null) return undefined;
  const val: unknown = Reflect.get(obj, key);
  return typeof val === "string" ? val : undefined;
};
```

判断基準: `in + typeof` はリテラルキーで用いる。string 変数キーなら `Reflect.get`。
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

### `as` キャスト禁止下での型精度向上: `useRef` パターン

`useState<A[]>` が特定のライフサイクル時点で実際には `B[]`（`B extends A`）を保持している場合、`as B[]` キャストは禁止。代わりに Promise/Generator の解決時に `useRef<B[]>` に格納する:

```ts
// NG: as キャスト
const state = { phase: "done", steps: stream.steps as B[] };

// OK: ref に格納して型精度を維持
const doneResultRef = useRef<B[]>([]);
// ...Promise 解決時:
doneResultRef.current = result.steps; // result.steps: B[] なので型安全
// state 構築時:
const state = phase === "done"
  ? { phase: "done", steps: doneResultRef.current }  // B[] として型付け
  : { phase: "running", steps: state.steps };         // A[] のまま
```

判断基準: "この値は特定の状態変化の後にしか意味を持たない" → `useState` に入れず `useRef` に格納して discriminated union の型精度を保つ。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### HTTP 境界で外部 SDK 型を `as` キャストせず型付けする: `z.custom<T>()`

Route Handler などの HTTP 境界で `request.json()` を外部 SDK の複合型（例: `UIMessage[]`）に型付けするとき、`(await request.json()) as { messages: UIMessage[] }` は禁止。`z.custom<T>()` を使うと型推論のみ SDK 型を与えて、最低限のランタイム検査（object かどうか等）と組み合わせられる。
```ts
import type { UIMessage } from "ai";
import { z } from "zod";

// ✅ z.custom<T> で as キャストなしに UIMessage[] 型推論を得る
const bodySchema = z.object({
  messages: z.array(z.custom<UIMessage>((val) => typeof val === "object" && val !== null)),
});

const result = bodySchema.safeParse(await request.json());
if (!result.success) {
  return Response.json({ ok: false, error: { code: "BAD_REQUEST" } }, { status: 400 });
}
// result.data.messages は UIMessage[] として型推論される
```
実際のバリデーションは SDK 側（`convertToModelMessages` 等）に委ねる。クライアントが自社コードで信頼できる場合に適用する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### `test.each` 行の型が行ごとに違う場合は `execute` クロージャで `as` を排除する

`test.each` のテーブル行で factory の返り値型やアクセス先の型が行ごとに異なると、TypeScript が共通型を推論できず `as` キャストが必要になる。`execute: () => result` クロージャに閉じ込めると各行が自己完結し、`as` 完全不要になる。

```ts
// NG: 行ごとに型が違うため as キャストが必要
test.each([
  { factory: (() => ({ answer: 42 })) as () => object, access: (p: never) => (p as { answer: number }).answer, expected: 42 },
])("$label", ({ factory, access, expected }) => { ... });

// OK: execute クロージャで各行を自己完結させる
test.each([
  { label: "returns number", execute: () => lazyProxy(() => ({ answer: 42 })).answer, expected: 42 },
  { label: "returns string", execute: () => lazyProxy(() => ({ name: "noah" })).name, expected: "noah" },
])("$label", ({ execute, expected }) => {
  expect(execute()).toBe(expected);
});
```

**判断基準**: `test.each` 行の型を統一するために `as` を使いそうになったら `execute` クロージャ化を試みる。`factory` + `access` の 2 変数パターンは特に `as` が生まれやすい。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## コンパイラの罠

### `let x: T | null = null` がクロージャ内で代入されると後続で `never` になる

TypeScript は `let` 変数がコールバック/クロージャ内でのみ代入される場合、外側のフローで変数を `null` に保守的 narrow する。そのため `if (x === null) throw` で残りのブランチが `never` に潰れ、プロパティアクセスで型エラーになる。

```ts
// NG: クロージャ内の代入を TS が追跡しない → after throw, observed: never
let observed: Ctx | null = null;
const handler = (ctx: Ctx) => { observed = ctx; };
await run(handler);
if (observed === null) throw new Error('not called');
observed.field; // ❌ Property 'field' does not exist on type 'never'

// OK: 配列に push → 取り出す（配列要素の型は T | undefined で narrow が保たれる）
const observations: Ctx[] = [];
const handler = (ctx: Ctx) => { observations.push(ctx); };
await run(handler);
const observed = observations[0];
if (observed === undefined) throw new Error('not called');
observed.field; // ✅
```

**判断基準**: テストやコールバックで値を capture したいとき、`null` 初期値変数ではなく配列 `[]` を使う。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### `satisfies T[]` は `.reduce()` コールバックの型を絞り込まない

`satisfies T[]` はリテラル型を保持するが、`Array.prototype.reduce()` のコールバックパラメータ `t` の型は配列要素型として推論される。ベース型 `T.field: string` が広い場合、コールバック内で `t.field` が `string` のまま残り、`Partial<Record<LiteralUnion, V>>` へのインデックスアクセスで TS7053 エラーになる。

```ts
// NG: satisfies では絞り込まれない
const ITEMS = [{ category: "A" }, { category: "B" }] satisfies Base[];
ITEMS.reduce<Partial<Record<"A" | "B", Base[]>>>((acc, t) => {
  acc[t.category] = []; // TS7053: 'string' can't index Partial<Record<"A"|"B",…>>
}, {});

// OK: 交差型で明示アノテーション
type NarrowItem = Base & { category: "A" | "B" };
const ITEMS: NarrowItem[] = [{ category: "A" }, { category: "B" }];
ITEMS.reduce<Partial<Record<"A" | "B", NarrowItem[]>>>((acc, t) => {
  acc[t.category] = []; // OK: t.category は "A" | "B"
}, {});
```

### `readonly` 配列のコンピューテッドインデックスは `T | undefined` を返す

`const TABS = ["a","b"] as const; TABS[index]` は `"a" | "b" | undefined` に推論される。`setState(TABS[next])` は型エラー。`const tab = TABS[next]; if (tab) { setState(tab); }` でガードが必要。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### discriminated union のブランチ内 `??` フォールバックは dead code でも型エラーにならない

discriminated union のブランチ内で保証されるフィールドに `??` フォールバックを書いても、TypeScript は何も言わない。

```ts
type Item =
  | { inputMode: "text"; inputText: string }
  | { inputMode: "file" };

function handle(item: Item) {
  if (item.inputMode === "text") {
    // inputText は string が保証されている
    // NG: フォールバックは dead code だが型エラーにならない
    setInput(item.inputText ?? item.sourceName);
    // OK
    setInput(item.inputText);
  }
}
```

discriminated union ブランチ内に `??` や `||` フォールバックがあったら、それが意図的かを確認する。多くの場合は型を絞り込む前の名残（または型変更後の修正漏れ）。

### `noUncheckedIndexedAccess` で正規表現マッチの戻り値が `string | undefined` になる

`noUncheckedIndexedAccess: true`（strict モード相当）が有効なプロジェクトでは `match[1]` の型が `string | undefined` になる。

```typescript
// ❌ match が非 null でも match[1] は string | undefined — コンパイルエラー
const label = text.match(/\[要記入: (.+)\]/)?.[0];
const value: string = label; // NG

// ❌ match を先に guard しても match[1] は undefined の可能性が残る
const m = text.match(pattern);
if (m) {
  const val: string = m[1]; // NG: `string | undefined`
}

// ✅ オプショナルチェーン + nullish coalescing でまとめて対処
const label = text.match(/\[要記入: (.+)\]/)?.[1] ?? "";
```

判断基準: `tsconfig.json` に `"noUncheckedIndexedAccess": true` が入っていたら（または `"strict": true`）、配列・match 戻り値へのインデックスアクセスは全て `T | undefined` になる。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### 条件型と generic の組み合わせ落とし穴

- **`Extract<Union, { field: ConditionalType<T> }>` を generic 関数から返すと型証明できない**: `T` が未解決のまま TS が条件型の evaluate を defer するため、関数本体の戻り値と宣言した戻り型 `ExtractedType<T>` が一致することを TS が証明できず型エラーになる。`as` キャストが必要になるが、`as` 禁止ルールに抵触する。

  **対処**: generic 化を諦めて非 generic のまま実装し、JSDoc で「generic 化には `as` が必要で禁止ルール違反のため非 generic にした」と理由を記載する。ユースケースが増えて本当に必要になったら overload + 型テストで検証してから導入する。

  ```typescript
  // ❌ generic にすると型エラー（内部で as が必要になる）
  function defineAnalyzer<T extends ServiceType>(spec: Spec<T>): Analyzer<T> {
    return { analyze: () => ... }; // ← Analyzer<T> と証明できない
  }

  // ✅ 非 generic で実装。JSDoc に理由を記載
  // NOTE: generic <T> にすると ServiceAnalysisResultFor<T> が Extract<…, ConditionalType<T>>
  // の deferred evaluation になり as が必要。as 禁止ルールに従い非 generic。
  function defineAnalyzer(spec: Spec): Analyzer {
    return { analyze: () => ... };
  }
  ```
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

### `asserts x is T` は tautology になっていないか確認する

`function f(x: T): asserts x is T` という形は意味がない（`x` がすでに `T` 型のため asserts は型情報を変えない）。副作用（エラーのスロー等）のみが目的の関数は `void` を使う。

```typescript
// NG: tautology — raw はすでに T 型なので何も変わらない
function validateSegments(raw: TranslationResultRaw): asserts raw is TranslationResultRaw {
  if (raw.segments.length !== expected) throw new Error("...");
}

// OK: 副作用専用なら void
function validateSegments(raw: TranslationResultRaw, expectedCount: number): void {
  if (raw.segments.length !== expectedCount) throw new Error("...");
}
```

`asserts x is T` が有効なのは `x: unknown` のように入力型が不明確で、バリデーション後に型を絞り込む必要がある場合のみ。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### 型ガードを `filter` に渡すとサイレントドロップになる

`array.filter(isT)` は型ガードを predicate として使えるが、不一致要素が**音もなく消える**。外部データ（API レスポンス・LLM 出力）の場合、予期しない欠損が下流でわかりにくいバグになる。代わりに `map + throw` で早期に検出する。

```typescript
// NG: 意図しない欠損が無音で起きる
const segments = rawSegments.filter(isWhisperSegment).map((s) => ({ ... }));

// OK: 不一致を即時エラーにして欠損を防ぐ
const segments = rawSegments.map((s) => {
  if (!isWhisperSegment(s)) {
    throw new Error(`Unexpected segment shape: ${JSON.stringify(s)}`);
  }
  return { start: s.start, end: s.end, text: s.text.trim() };
});
```

判断基準: 内部データ（型安全なコードが返す値）なら `filter` で ok。外部境界（API・LLM・ユーザー入力）なら `map + throw`。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## 設計・実装 Gotchas

### `Object.keys()` と union 型のキャスト

`Object.keys(x)` は常に `string[]` を返す。`keyof typeof x` の union に絞るために `as` キャストを使いたくなるが、`as` は禁止。

**代替: 静的なキー列挙が分かっている場合はリテラル配列で管理する**

```ts
// NG: as キャスト
const keys = Object.keys(CATEGORY_LABELS) as TemplateCategory[];

// OK: 型付きリテラル配列（TypeScript がリテラル値を検証する）
const keys: TemplateCategory[] = ["運送", "請求", "社内連絡"];
```

**トレードオフ**: 新しいキーを追加した際にリテラル配列も更新する必要がある（WHY コメントで注記推奨）。表示順の明示制御も兼ねるため、カテゴリ表示順が重要な UI では積極的に採用してよい。

### `async` 関数のリファクタリング後に sync 化を確認する

既存の `async function` が内部で呼んでいた非同期関数をリファクタリングで取り除いたとき、関数自体の `async` キーワードと戻り型 `Promise<T>` が残骸として残りやすい。`await` が不要になったら `async` を外して同期関数に変えられる。判断: 関数本体に `await` が1つも残っていなければ sync 化できる（TypeScript は `await` なし `async` 関数を許容するが不要な Promise ラップを生成する）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### バックエンドが常に初期化するフィールドは required にする

バックエンドがジョブ作成時に `steps: []`・`sources: []` で初期化することが確定しているなら、TypeScript の型も `optional?` ではなく required にする。Optional にすると全参照箇所で `?? []` フォールバックが必要になり防衛的コードが増殖する。判断基準: "API が返す JSON にこのフィールドは必ず存在するか？" → Yes なら required。"クライアントがいつ設定するか決まっていない" → optional。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### DB/サーバー関数に渡す型はフィールド名をスキーマと揃える

DB カラムや Server Function の入力型と異なるフィールド名を持つ中間型を作ると、呼び出し側に変換ロジックが漏れる。

```typescript
// NG: LocationState.lat/lon が DB の latitude/longitude と名前が違う
// → post-form.tsx で変換ロジックが必要になる
const loc = await resolveLocationOnSubmit();
createPost({ latitude: loc.lat, longitude: loc.lon }); // lat → latitude の変換が漏れる

// OK: LocationState のフィールド名を DB スキーマに揃える
interface LocationState { latitude: number; longitude: number; placeName: string; }
// → 呼び出し側で変換不要
createPost({ ...loc }); // またはスプレッドで直接渡せる
```

**判断基準**: 型が最終的に特定の schema / API に渡されることが確定しているなら、その schema のフィールド名をそのまま使う。中間的な「アプリ独自名」は変換コードを生む。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### テストが analyzer の内部メソッドに直接依存するリスク

- **公開 interface のメソッドをテストが呼ぶと、interface 変更で全壊する**: `ANALYZER.findFiles()`/`ANALYZER.parse()` のように analyzer オブジェクトのプロパティをテストが直接呼ぶと、interface が変わった瞬間に一斉に型エラーになる。

  **対処**: 実装関数を `@internal export` で直接エクスポートし、テストは公開 interface 経由ではなく実装関数を直接呼ぶ。

  ```typescript
  // analyzer ファイル
  /** @internal テスト用にエクスポート */
  export async function parseApiRoutes(files: string[], pkg: Package): Promise<RestAPISchema> { ... }
  export const ANALYZER: ServiceAnalyzer = { analyze: async (pkg, ctx) => { ... } };

  // テストファイル
  const result = await parseApiRoutes([filePath], pkg); // ✅ 実装関数を直接呼ぶ
  // const result = await ANALYZER.parse([filePath], pkg); // ❌ interface 依存
  ```

  **判断基準**: テストが `ANALYZER.xxx()` という形で analyzer のプロパティにアクセスしていたら要注意。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### JSDoc の連続する `/** */` ブロックは最後のものだけが TSDoc として機能する

関数の直前に `/** 説明 */` と `/** NOTE: ... */` を連続して置くと、最初のブロックが TSDoc から外れて孤立する。NOTE は `//` コメントにするか、1つの `/** */` ブロックに統合する。

```typescript
// ❌ 最初の /** */ が孤立する
/** 関数の説明 */
/** NOTE: この実装は〇〇の理由で非 generic にしてある */
export function foo() { ... }

// ✅ 1つのブロックに統合
/**
 * 関数の説明
 *
 * NOTE: この実装は〇〇の理由で非 generic にしてある
 */
export function foo() { ... }
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## Zod・バリデーション

### LLM 出力の Zod スキーマ数値フィールドには `.nonnegative().finite()` を付ける

LLM は `Infinity`・`NaN`・負数をごくまれに出力することがある。`z.number()` だけでは通過してしまい、下流の表示ロジックや計算で壊れる。タイムスタンプ・カウント・比率など「実用的に非負かつ有限であるべき」数値には制約を追加する。

```typescript
// NG: Infinity/-1 が通ってしまう
z.number()

// OK: 実用範囲に絞る
z.number().nonnegative().finite()
```

`z.number().int().nonnegative()` も一般的なパターン（カウント・インデックス系）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### 環境変数から数値に変換するときは `Number.parseInt` を使う

`Number("abc")` は `NaN` を返しエラーにならない。型は `number` なのでコンパイルエラーにもならない。環境変数（`process.env.PORT`）やフォーム入力など文字列から数値に変換するときは `Number.parseInt(value, 10)` または `Number.parseFloat(value)` を使う（基数 10 を明示）。
```ts
// ❌ NaN を黙過
const port = Number(process.env.PORT ?? 3000); // process.env.PORT="abc" で NaN になる

// ✅ 基数 10 明示
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

// ✅ Zod を使う場合（入力バリデーションがある場所）
const portSchema = z.coerce.number().int().positive();
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### Zod スキーマの合成は `.shape` spread を使う

zod v4 では schema 合成のプライマリ API が `.shape` の object spread。`.extend()` は型推論が浅くなる場面があり、v4 では非推奨方向。複数 schema を組み合わせるときは spread でフラットに合成する。
```ts
// ❌ extend
const envSchema = dbEnvSchema.extend({
  BETTER_AUTH_SECRET: z.string().min(1),
});

// ✅ shape spread
const envSchema = z.object({
  ...dbEnvSchema.shape,
  BETTER_AUTH_SECRET: z.string().min(1),
});
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 環境・ツール固有

### Bun 固有 API は TypeScript 型定義に含まれない

`import.meta.dir`（カレントファイルのディレクトリ絶対パスを返す Bun 拡張）は TypeScript の `ImportMeta` 型に定義されていないため、`tsc --noEmit` や `bun run typecheck` で型エラーになる。

```ts
// NG: Bun 固有。TypeScript 型定義外のため型エラー
const casesDir = import.meta.dir;

// OK: Node.js / Bun 両対応の標準 API
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const casesDir = dirname(fileURLToPath(import.meta.url));
```

`import.meta.url` は ECMAScript Module 仕様に含まれており TypeScript も認識する。Bun スクリプトでも動作する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### `import.meta.glob` を使うモジュールは `bun test` から import できない → 純粋ロジックを分離
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

`import.meta.glob`（Vite のビルド時変換）はテストランナー（`bun test`）上では関数として存在しないため、それを評価するモジュールを直接 import するとロード時にクラッシュする。データソース読み込み（glob）とビジネスロジックが同一ファイルだと、ロジックを単体テストできない。

対処: **純粋関数を別モジュールに切り出し、型は `import type` だけで取り込む**。`import type` はランタイムで完全に消える（elision）ため、テストは glob モジュールを評価せずロジックだけ検証できる。デフォルト引数で実データを束ねる便利版は glob 側に置けば、アプリ呼び出しのエルゴノミクスも保てる。

```ts
// depends.ts — 純粋・テスト可能。型のみ import（ランタイムでは issues.ts を評価しない）
import type { Issue } from "./issues";
export function scheduleConflictsOf(issue: Issue, lookup: Map<number, Issue>): Issue[] { /* ... */ }

// issues.ts — import.meta.glob で *.md を読む。実データを束ねた便利版を再公開
import { scheduleConflictsOf as core } from "./depends";
export const scheduleConflictsOf = (i: Issue, lookup = byNum) => core(i, lookup);
```

テストは合成フィクスチャ（合成 `Map` / 配列）を注入する。同根の一般原則は依存性注入: カリー化ファクトリパターン（`typescript.md`）と同じ — 「実データへの依存をデフォルト引数に追い出し、コアは引数で受ける」。

### `g` フラグ付き RegExp をモジュール定数にしない

`/pattern/g` を `const` でモジュールスコープに置くと、`exec()` や `match()` が `lastIndex` を書き換えるため、2回目以降の呼び出しで結果がずれる。

```ts
// NG: lastIndex が呼び出し間で汚染される
const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

// OK: 毎回新しい RegExp インスタンスを返すファクトリ
const placeholderPattern = () => /\{\{([^}]+)\}\}/g;
```

`replace()` は `lastIndex` をリセットするので定数でも問題ないが、`exec()` / `matchAll()` を使う場合は必ずファクトリ関数にする。

### Biome `noAssignInExpressions` — `while ((match = re.exec(str)))` は書けない

Biome の `noAssignInExpressions` ルールが `while ((match = regex.exec(text)) !== null)` を拒否する。

```ts
// NG: Biome lint error
let match: RegExpExecArray | null;
while ((match = pattern.exec(text)) !== null) {
  foundLabels.add(match[1]);
}

// OK: matchAll + for-of
for (const match of text.matchAll(pattern)) {
  const label = match[1];
  if (label !== undefined) {
    foundLabels.add(label);
  }
}
```

`match[1]` は `string | undefined` に型推論される（正規表現が全体マッチしている限り実行時は常に `string` だが TypeScript はそこまで推論しない）。非 null アサーション（`match[1]!`）は `as` キャストと同様に禁止された場合は `if (label !== undefined)` ガードで代替する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

### `AbortError` 判定は `signal.aborted` で

`catch` ブロックで `err.name === "AbortError"` を使うと、同名の独自 Error クラスによる false positive が起きる。`AbortController` の signal が手元にある場合は `controller.signal.aborted` を参照する方が確実。

```typescript
// NG: 独自エラーが同名を持つと誤判定する
} catch (err: unknown) {
  if (err instanceof Error && err.name === "AbortError") { ... }
}

// OK: signal.aborted で確実に判定
} catch (err: unknown) {
  if (controller.signal.aborted) {
    // cancelled
  } else {
    // failed
  }
}
```

- **`get` トラップだけの Proxy ラッパーは consumer の `"x" in obj` チェックを破る**: 遅延初期化 Proxy（`new Proxy({} as T, { get: ... })`）は、`has` トラップ未実装だと `in` 演算子が target（空オブジェクト）を見て常に false を返す。ライブラリは duck-typing 分岐に `in` を使うことがあり（例: better-auth `toNextJsHandler` の `"handler" in auth ? auth.handler(req) : auth(req)`）、false 側に倒れて「auth is not a function」のような不可解な実行時エラーになる。typecheck は通る（型上は T のまま）ため静的に検出できない。対処: 遅延 Proxy を書くときは `get` に加えて `has: (_t, p) => p in resolve()`（必要なら `ownKeys`/`getOwnPropertyDescriptor` も）を実装し、トラップを resolve 済み実体に委譲する。判断基準: 「この Proxy をライブラリ関数に渡すか？」→ YES なら get 以外のトラップも必須と考える。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
