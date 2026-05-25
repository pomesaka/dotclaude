# TypeScript レビュー観点

> **TL;DR**: `export default` 禁止（named export のみ）・`as` キャスト原則禁止・`any` 禁止・`class` 原則禁止。discriminated union で null 安全に型を表現。Biome を linter として使用。Zod でランタイムバリデーション境界を構築。

プロジェクト固有の規約（CLAUDE.md等）に加え、以下の観点でレビューする。

## エクスポート規約

- `export default` は**原則禁止**。named export を使う
  - 例外: Next.js App Router の `page.tsx` / `layout.tsx` / `loading.tsx` / `error.tsx` などフレームワークが default export を要求するファイルのみ許可
  ```typescript
  // ❌ Bad
  export default function MyComponent() { ... }

  // ✅ Good
  export function MyComponent() { ... }
  ```

## 禁止パターン

- `as` キャスト: **原則禁止**。やむを得ず使う場合は必ず WHY コメントで妥当性を説明すること
  ```typescript
  // ❌ Bad
  const value = data as SomeType;

  // ✅ OK（WHYコメント必須）
  // WHY: 外部ライブラリの型定義が不完全なため。実際の返却値は必ずSomeTypeになる
  const value = data as SomeType;
  ```
- `any` 型: 禁止。`unknown` + 型ガードで対応する
- `!` (non-null assertion): Biome `noNonNullAssertion` 規則で禁止。避けられない場合は WHY コメント必須だが、通常はロジック再設計で回避可能
  ```typescript
  // ❌ Biome で禁止
  const value = maybeNull!;

  // ✅ 再設計: 条件分岐で early return
  if (!value) return fallback;
  // この時点で value は non-null
  ```
  例: `Map.get(key)!` パターン → Map iteration で直接値を取得、またはループ終了時点で値が保証される構造に変更
- **`as const` 配列とユニオン型の二重管理を避ける**: `VariableType = "a" | "b" | "c"` と `VALID_VALUES: readonly VariableType[] = ["a","b","c"]` を別々に定義すると型と配列がずれるリスクがある。`as const` 配列を先に定義して型を導出する:
  ```typescript
  // ❌ 型と配列の二重管理（拡張時に片方を忘れがち）
  export type VariableType = "text" | "number" | "date";
  const VARIABLE_TYPES: readonly VariableType[] = ["text", "number", "date"];

  // ✅ 配列から型を導出（単一の真実の源泉）
  export const VARIABLE_TYPES = ["text", "number", "date"] as const;
  export type VariableType = (typeof VARIABLE_TYPES)[number];
  ```
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`readonly` 配列のコンピューテッドインデックスは `T | undefined` を返す**: `const TABS = ["a","b"] as const; TABS[index]` は `"a" | "b" | undefined` に推論される。`setState(TABS[next])` は型エラー。`const tab = TABS[next]; if (tab) { setState(tab); }` でガードが必要。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **バックエンドが常に初期化するフィールドは required にする**: バックエンドがジョブ作成時に `steps: []`・`sources: []` で初期化することが確定しているなら、TypeScript の型も `optional?` ではなく required にする。Optional にすると全参照箇所で `?? []` フォールバックが必要になり防衛的コードが増殖する。判断基準: "API が返す JSON にこのフィールドは必ず存在するか？" → Yes なら required。"クライアントがいつ設定するか決まっていない" → optional。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- `class`: **原則使わない**。オブジェクトリテラル・関数・型で表現する
  ```typescript
  // ❌ 避ける
  class UserService { ... }

  // ✅ 推奨
  type UserService = { ... };
  const createUserService = (): UserService => ({ ... });
  ```

## 推奨パターン

- `satisfies` で型チェック（`as` の代わり）
- 判別可能ユニオンで boolean フラグを置き換える
- `readonly` を積極的に使う（意図しない mutation を防ぐ）
- 公開関数の戻り値型を明示する（型推論に頼らない）
- **導出可能なフィールドを型に含めない**: 別フィールドから常に計算できる値（例: `url` から `new URL(url).hostname` で得られる `domain`）は型に含めず表示層で導出する。型に入れると、データを組み立てる呼び出し側が一貫性を維持する責務を持つことになり、不整合が生じやすい。同じ概念の型で `domain` あり・なしが混在するとレビューでも見落としやすい。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

### `mode` フィールドがある型は discriminated union にする

`inputMode`・`type`・`status` などのモードフィールドがある型で、モードによって持つフィールドが変わるなら optional ではなく discriminated union で表現する。

```typescript
// ❌ Bad: inputMode によって inputText が有効かどうか型で分からない
type SummarizeHistoryItem = {
  inputMode: "text" | "file";
  inputText?: string;      // text のときのみ有効
  fileType?: SummarizeFileType; // file のときのみ有効
};

// ✅ Good: inputMode でブランチし、各フィールドの有無を型で強制
type SummarizeHistoryItem = {
  id: string;
  summary: string;
} & (
  | { inputMode: "text"; inputText: string }
  | { inputMode: "file"; fileType?: SummarizeFileType }
);

// 利用側: 型の絞り込みが必要
item.inputMode === "file" ? item.fileType : undefined
```

## 依存性注入: カリー化ファクトリパターン

クラスは使わずに **`createFoo(deps): Foo`** のカリー化ファクトリで表現する。deps（DB・クライアント・設定）はリクエストをまたいで安定しており、クロージャで束縛することで呼び出し側は `foo.send(input)` だけになる。テストでは spy を注入し、不要な deps は省略できる。

```typescript
// ❌ deps と input を引数リストに並べる
async function sendMail(input: MailInput, smtp: SmtpClient) { ... }

// ✅ factory(deps).method(input) に分離
export interface MailerDeps {
  smtp: SmtpClient;
  logger: Logger;
  metrics?: Metrics;  // 任意 — 未指定時は計測スキップ
}
export interface Mailer {
  send(input: MailInput): Promise<void>;
}
export function createMailer(deps: MailerDeps): Mailer {
  return { async send(input) { /* deps はクロージャで束縛済み */ } };
}
```

| 役割 | 形 | 例 |
|---|---|---|
| ファクトリ関数 | `create*` | `createMailer`, `createExploreAgent` |
| deps 型 | `*Deps` | `MailerDeps`, `ExploreDeps` |
| 返り値の型 | 機能名 | `Mailer`, `ExploreAgent` |

## 命名規則

- コンポーネント・型・インターフェース: PascalCase
- 関数・変数・カスタムフック: camelCase（フックは `use` prefix）
- ファイル名: ケバブケース（`user-service.ts`）。Reactコンポーネントのみ PascalCase
- boolean には `is` / `has` / `can` / `should` prefix

## `Object.keys()` と union 型のキャスト

`Object.keys(x)` は常に `string[]` を返す。`keyof typeof x` の union に絞るために `as` キャストを使いたくなるが、`as` は禁止。

**代替: 静的なキー列挙が分かっている場合はリテラル配列で管理する**

```ts
// NG: as キャスト
const keys = Object.keys(CATEGORY_LABELS) as TemplateCategory[];

// OK: 型付きリテラル配列（TypeScript がリテラル値を検証する）
const keys: TemplateCategory[] = ["運送", "請求", "社内連絡"];
```

**トレードオフ**: 新しいキーを追加した際にリテラル配列も更新する必要がある（WHY コメントで注記推奨）。表示順の明示制御も兼ねるため、カテゴリ表示順が重要な UI では積極的に採用してよい。

## Bun 固有 API は TypeScript 型定義に含まれない

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

## `import.meta.glob` を使うモジュールは `bun test` から import できない → 純粋ロジックを分離
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

テストは合成フィクスチャ（合成 `Map` / 配列）を注入する。同根の一般原則は [依存性注入: カリー化ファクトリパターン] と同じ — 「実データへの依存をデフォルト引数に追い出し、コアは引数で受ける」。

## `g` フラグ付き RegExp をモジュール定数にしない

`/pattern/g` を `const` でモジュールスコープに置くと、`exec()` や `match()` が `lastIndex` を書き換えるため、2回目以降の呼び出しで結果がずれる。

```ts
// NG: lastIndex が呼び出し間で汚染される
const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

// OK: 毎回新しい RegExp インスタンスを返すファクトリ
const placeholderPattern = () => /\{\{([^}]+)\}\}/g;
```

`replace()` は `lastIndex` をリセットするので定数でも問題ないが、`exec()` / `matchAll()` を使う場合は必ずファクトリ関数にする。

## Biome `organizeImports`

2つのルールがある。`biome check --write` で自動修正できる。

- **type before value**: 同一モジュールからの `import type` / `export type` は値 import/export の前に置く
- **packages before relative**: パッケージ import（`@xxx/`、npm）は相対 import（`../`、`./`）の前に置く

## discriminated union の dead code は型エラーにならない

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

## `as` キャスト禁止下での型精度向上: `useRef` パターン

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

## switch の exhaustive check: 全 case 明示 + `never` アサーション

`default` だけに fallback を置くと、新しい union member を追加したときに修正漏れをコンパイラが検知できない。

```ts
// NG: "text" が default に落ちるため、新型追加時に switch の更新漏れが気づかない
function getProps(type: VariableType) {
  switch (type) {
    case "integer": return { type: "number", step: "1" };
    case "date": return { type: "date" };
    default: return { type: "text" };  // "text" も "time" も全部ここに落ちる
  }
}

// OK: 全 case を明示 + default に never アサーション
function getProps(type: VariableType) {
  switch (type) {
    case "text":    return { type: "text" };
    case "integer": return { type: "number", step: "1" };
    case "decimal": return { type: "number", step: "any" };
    case "date":    return { type: "date" };
    case "time":    return { type: "time" };
    default: {
      // WHY: VariableType に新値を追加したとき、コンパイル時に修正漏れを検知する
      const _exhaustive: never = type;
      return { type: "text" };  // 実行時のフォールバック（到達不能のはず）
    }
  }
}
```

**使い分け**: 戻り値が必要なら上記。`throw new Error(\`Unknown: \${type}\`)` のみでもよいが、型推論で戻り値型が `never` になり呼び出し側の型が壊れることがある。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## `satisfies T[]` は `.reduce()` コールバックの型を絞り込まない

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

## AbortError 判定は `signal.aborted` で

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

## 「別フィールドの値が条件の optional」は discriminated union に

あるフィールドの存在が別フィールドの値に依存する場合（`step === "done"` のとき `minutes` が存在する等）は、optional フィールドではなく discriminated union で型を表現する。

```typescript
// NG: optional のままでは step を確認しなくても minutes にアクセスできてしまう
interface MinutesJob {
  step: "queued" | "done" | "failed";
  minutes?: Minutes;  // step === "done" のときのみ存在、という不変条件が型に入らない
  error?: string;
}

// OK: step ごとに型を分岐させて不変条件を型レベルで保証
type MinutesJob =
  | { step: "queued" }
  | { step: "done"; minutes: Minutes }     // minutes は required
  | { step: "failed"; error: string };     // error は required
```

**判断基準**: 「このフィールドが存在するのは、別フィールドが〇〇の場合のみ」と言えるなら discriminated union にする。optional は「どのケースでも任意」のときだけ使う。

**副次効果**: 「失敗時でも summary を渡せてしまう」のようなランタイムガード（`if (status === 'done' && summary)`）が不要になり、その動作をテストしていたケースも消える。型保証に昇格した分、コードとテストが両方シンプルになる。
<!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

## モジュール境界を越える型は `ReturnType<F>` より明示 `interface` に

`ReturnType<typeof someInternalFn>` で型を派生させると「実装型」として機能する。関数内部でのみ使う型なら許容できるが、他モジュールへ export したり公開 API の引数に使う型には使わない。

- **問題**: `someInternalFn` の戻り型が変わると、`ReturnType` を使っている呼び出し側も暗黙的に変わる。変更が連鎖しても型エラーが出ないケースがある
- **正しいやり方**: `export interface SpecDiff { ... }` のように一次ドメイン型として宣言し、実装関数の戻り型がそのインターフェースに適合するよう型検査させる

```typescript
// NG: 実装から型を引っ張り出している
export type SpecDiff = ReturnType<typeof diff>;

// OK: ドメイン型を先に宣言し、実装がそれに適合することを型検査で保証
export interface SpecDiff {
  features: DiffItem[];
  services: DiffItem[];
  item_relations: DiffItemRelation;
}
type Diff = (prev: ProjectSpec, cur: ProjectSpec) => SpecDiff; // 実装側がインターフェースに従う
```

**判断基準**: 「この型は他モジュールの関数引数/戻り値として export されるか？」→ YES なら明示 interface。NO（内部ヘルパー限定）なら `ReturnType` も許容。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## `unknown` から具体型への型ガードで `as` キャストを使わない

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

## `asserts x is T` は tautology になっていないか確認する

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

## 型ガードを `filter` に渡すとサイレントドロップになる

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

## LLM 出力の Zod スキーマ数値フィールドには `.nonnegative().finite()` を付ける

LLM は `Infinity`・`NaN`・負数をごくまれに出力することがある。`z.number()` だけでは通過してしまい、下流の表示ロジックや計算で壊れる。タイムスタンプ・カウント・比率など「実用的に非負かつ有限であるべき」数値には制約を追加する。

```typescript
// NG: Infinity/-1 が通ってしまう
z.number()

// OK: 実用範囲に絞る
z.number().nonnegative().finite()
```

`z.number().int().nonnegative()` も一般的なパターン（カウント・インデックス系）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## ORM-inferred 型とドメイン interface の名前衝突はインフラ側に Row サフィックス
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

Drizzle の `typeof table.$inferSelect` や Prisma の generated 型が、ドメイン層で定義した interface と同名になることがある。例: `agentActions` テーブルから `AgentAction = typeof agentActions.$inferSelect` を出すと、ドメイン側の `interface AgentAction { ... }` と衝突する。

対処は「**ドメインが canonical な名前を保持し、インフラ側に `Row` / `NewRow` サフィックスを付ける**」。

```ts
// NG: ドメイン側に Domain サフィックス、インフラ側が裸の名前
// ドメイン型は他レイヤーから広く参照されるため、リネーム時の影響範囲が大きい
export interface AgentActionDomain { ... } // domain
export type AgentAction = typeof agentActions.$inferSelect // schema

// OK: ドメインが正規名、インフラに Row サフィックス
export interface AgentAction { ... } // domain
export type AgentActionRow = typeof agentActions.$inferSelect // schema
export type NewAgentActionRow = typeof agentActions.$inferInsert // schema
```

判断基準は「参照される広さ」。ドメイン型は orchestrator・agents・UI から広く import されるため canonical 名を保つ方が長期的に変更コストが低い。Row 型は repository 実装内部で完結することが多く、リネームしても影響範囲が狭い。

合わせて **discriminated union の literal 型（`Kind` enum など）はドメイン層に置く**。infra(schema) が `import type { Kind } from "../domain/types"` で参照し、必要なら `export type { Kind }` で re-export する。逆向き（schema が enum を所有、domain が import）にすると Clean Architecture の依存方向（infra → domain）に反する。

## DB/サーバー関数に渡す型はフィールド名をスキーマと揃える

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

## `let x: T | null = null` がクロージャ内で代入されると後続で `never` になる

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

## 条件型と generic の組み合わせ落とし穴

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

## JSDoc の構造

- **連続する `/** */` ブロックは最後のものだけが TSDoc として機能する**: 関数の直前に `/** 説明 */` と `/** NOTE: ... */` を連続して置くと、最初のブロックが TSDoc から外れて孤立する。NOTE は `//` コメントにするか、1つの `/** */` ブロックに統合する。

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

## モジュール間の循環依存を断つ注入パターン

- **スタック → レジストリ → スタック の循環は `analyze(ctx)` への DI で断つ**: あるモジュール（スタック）がレジストリを使う必要があるが、レジストリがそのスタックを集約していると循環 import になる。解決は「使うものを引数（context）で受け取る」DI パターン。呼び出し元（orchestrator）がレジストリから解決して渡す。

  ```typescript
  // ❌ スタックがレジストリを直接 import → 循環
  import { getClientAnalyzers } from '../../../stack/index'; // stack/index が自分を集約している

  // ✅ orchestrator が解決して ctx 経由で渡す
  type AnalyzeContext = { clientAnalyzers: readonly ClientAnalyzer[] };
  analyze(pkg: Package, ctx: AnalyzeContext): Promise<ServiceAnalysisResult>
  // orchestrator 側:
  analyzer.analyze(pkg, { clientAnalyzers: getClientAnalyzers(pkg.language) });
  ```

  **判断基準**: 「このモジュールが X を必要とするが、X の提供元がこのモジュールを集約している」という構造が見えたら即座に DI を検討する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

## テストが analyzer の内部メソッドに直接依存するリスク

- **公開 interface のメソッドをテストが呼ぶと、interface 変更で全壊する**: `ANALYZER.findFiles()`/`ANALYZER.parse()` のように analyzer オブジェクトのプロパティをテストが直接呼ぶと、interface が変わった瞬間（`ProviderAnalyzer` → `ServiceAnalyzer` で `findFiles`/`parse` が消える等）に一斉に型エラーになる。

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
