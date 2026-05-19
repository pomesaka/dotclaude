# TypeScript レビュー観点

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

外部リソース（DB・APIクライアント・設定値など）と呼び出しごとの入力を分離したいとき、
クラスは使わずに **`factory(deps)` → オブジェクト** のカリー化ファクトリで表現する。

```typescript
// ❌ 避ける: deps と input を引数リストで並べる
async function sendMail(input: MailInput, smtp: SmtpClient, logger: Logger) { ... }

// ✅ 推奨: factory(deps).method(input) の形に分離
export function createMailer(deps: MailerDeps): Mailer {
  return {
    async send(input) { /* deps はクロージャで束縛済み */ },
    async sendBatch(inputs) { ... },
  };
}
```

### なぜこの形か

deps（DB・クライアント・設定）はリクエストをまたいで安定している。一度組み立てれば使い回せる。
input は呼び出しごとに変わる。両者を引数リストに並べると、呼び出し側が毎回 deps を用意する羽目になり、
テストでの差し替えも煩雑になる。クロージャで deps を束縛することで、呼び出しは `mailer.send(input)` だけになる。

### インターフェースの定義

```typescript
// 必須と任意を明確に分ける
export interface MailerDeps {
  smtp: SmtpClient;   // 必須
  logger: Logger;     // 必須
  metrics?: Metrics;  // 任意 — 未指定時は計測スキップ
}

// 返り値の型を interface で明示する（クラスの代わり）
export interface Mailer {
  send(input: MailInput): Promise<void>;
  sendBatch(inputs: MailInput[]): Promise<void>;
}

export function createMailer(deps: MailerDeps): Mailer {
  return { ... };
}
```

任意 deps（`?`）は機能の on/off として機能する。
テスト側では spy を注入し、不要な deps は省略する。

```typescript
// テスト: smtp を spy に差し替えて本体ロジックだけ検証
const mailer = createMailer({
  smtp: spySmtp,
  logger: noopLogger,
  // metrics 省略 → 計測スキップで動作
});
await mailer.send(input);
```

### 命名規則

| 役割 | 形 | 例 |
|---|---|---|
| ファクトリ関数 | `create*` | `createMailer`, `createExploreAgent` |
| メソッド | 動詞（何をするか） | `.send`, `.run`, `.explore`, `.reflect` |
| deps 型 | `*Deps` | `MailerDeps`, `ExploreDeps` |
| 返り値の型 | 機能名 | `Mailer`, `ExploreAgent`, `PatternRepository` |

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

## `g` フラグ付き RegExp をモジュール定数にしない

`/pattern/g` を `const` でモジュールスコープに置くと、`exec()` や `match()` が `lastIndex` を書き換えるため、2回目以降の呼び出しで結果がずれる。

```ts
// NG: lastIndex が呼び出し間で汚染される
const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

// OK: 毎回新しい RegExp インスタンスを返すファクトリ
const placeholderPattern = () => /\{\{([^}]+)\}\}/g;
```

`replace()` は `lastIndex` をリセットするので定数でも問題ないが、`exec()` / `matchAll()` を使う場合は必ずファクトリ関数にする。

## Biome `organizeImports`: `type` は値の前に置く

Biome の `organizeImports` ルールは、同一モジュールからの `type` インポート/エクスポートを値インポート/エクスポートの**前**に並べることを要求する。

```ts
// ❌ Biome エラー
export { Foo } from "./foo";
export type { FooProps } from "./foo";

import { bar } from "./bar";
import type { BarType } from "./bar";

// ✅ OK
export type { FooProps } from "./foo";
export { Foo } from "./foo";

import type { BarType } from "./bar";
import { bar } from "./bar";
```

`biome check --write` で自動修正できる。手動修正する場合は `type` を先頭に移動する。

### 相対 import はパッケージ import の後に置く

Biome の `organizeImports` はパッケージ import（`@xxx/`, `npm` パッケージ）を相対 import（`../`, `./`）の**前**に並べることを要求する。

```ts
// ❌ Biome エラー（相対が先）
import type { Foo } from "../types";
import { bar } from "@pkg/bar";

// ✅ OK（パッケージ → 相対の順）
import { bar } from "@pkg/bar";
import type { Foo } from "../types";
```

`biome check --write` で自動修正できる。

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
