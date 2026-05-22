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
