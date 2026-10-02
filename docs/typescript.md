# TypeScript レビュー観点

> **TL;DR**: `export default` 禁止（named export のみ）・`as` キャスト原則禁止・`any` 禁止・`class` 原則禁止。discriminated union で null 安全に型を表現。Biome を linter として使用。Zod でランタイムバリデーション境界を構築。実装中の見落としやすい点・コンパイラ挙動 → `typescript-gotchas.md`

プロジェクト固有の規約（CLAUDE.md等）に加え、以下の観点でレビューする。

## エクスポート規約

- `export default` は原則禁止。named export を使う
  - 例外: Next.js App Router の `page.tsx` / `layout.tsx` / `loading.tsx` / `error.tsx` などフレームワークが default export を要求するファイルのみ許可
  ```typescript
  // ❌ Bad
  export default function MyComponent() { ... }

  // ✅ Good
  export function MyComponent() { ... }
  ```

## 禁止パターン

- `as` キャスト: 原則禁止。やむを得ず使う場合は必ず WHY コメントで妥当性を説明すること
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
  例: `Map.get(key)!` → iteration で直接値取得、または値が保証される構造に変更
- **`as const` 配列とユニオン型の二重管理を避ける**: `VariableType = "a" | "b" | "c"` と `VALID_VALUES: readonly VariableType[] = ["a","b","c"]` を別々に定義すると型と配列がずれるリスクがある。`as const` 配列を先に定義して型を導出する。
  ```typescript
  // ❌ 型と配列の二重管理（拡張時に片方を忘れがち）
  export type VariableType = "text" | "number" | "date";
  const VARIABLE_TYPES: readonly VariableType[] = ["text", "number", "date"];

  // ✅ 配列から型を導出（単一の真実の源泉）
  export const VARIABLE_TYPES = ["text", "number", "date"] as const;
  export type VariableType = (typeof VARIABLE_TYPES)[number];
  ```
  特に zod を併用する場合は値配列必須: `z.enum(VARIABLE_TYPES)` のように渡せる。型のみ export だと `z.enum` に渡せず（型消去）、結局 zod schema 内に値を直書きすることになり真実が分散する。値配列を真の単一情報源にする。UI の選択肢リスト（ラジオ・セレクト）も同じ値配列から `.map` で導出する。UI 側に選択肢を直書きすると「型は増えたが UI に出ない」欠落がエラーを出さずに起きる（実例: noah issue 1013 で `RESOLUTION_METHODS` を z.enum / UI ラジオ / 型の単一ソースに統一）。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-05 -->
- `class`: 原則使わない。オブジェクトリテラル・関数・型で表現する
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
- **導出可能なフィールドを型に持たせない**: 別フィールドから常に計算できる値（例: `url` から `new URL(url).hostname` で得られる `domain`）は型に含めず表示層で導出する。型に入れると、データを組み立てる呼び出し側が一貫性を維持する責務を持つことになり、不整合が生じやすい。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

## 条件付き optional は discriminated union にする

フィールドの存在が別フィールド（`mode`/`type`/`status`）の値に依存するなら optional でなく discriminated union にする。WHY: optional だと discriminant を確認せずアクセスでき、不変条件が型に入らない（ランタイムガードとそのテストが必要になる。型保証に昇格すればガードとそのテストが両方消える）。

```typescript
// ❌ Bad: step を確認しなくても minutes にアクセスできてしまう
type MinutesJob = {
  step: "queued" | "done" | "failed";
  minutes?: Minutes;  // step === "done" のときのみ存在、という不変条件が型に入らない
  error?: string;
};

// ✅ Good: Base & union で不変条件を型レベルで保証（共通フィールドは Base に）
type MinutesJob = {
  id: string;
} & (
  | { step: "queued" }
  | { step: "done"; minutes: Minutes }     // minutes は required
  | { step: "failed"; error: string }      // error は required
);
```

**判断基準**: 「`status === X` を確認してからしかアクセスしない」フィールドは variant 専用、「discriminant チェック前にアクセスしうる（`useEffect` 依存配列・computed value の計算）」または「どのケースでも任意」なら base type に残す。実例: `MinutesDetail` で `summary`/`decisions` は view の計算・`useEffect` から参照するため base、`fileName` は `failed` 確認後のみ参照するため variant 専用（issue 258）。
<!-- importance: medium | mentions: 3 | first-seen: 2026-05 -->

## discriminated union Result 型に型と同名の companion object でコンストラクタを付ける

TypeScript は type 名前空間と value 名前空間が独立しているため、`type Foo` と `const Foo` は同名で共存できる。これを利用して Result 型に `ok`/`fail` コンストラクタを「型名で呼べる」形で付与するパターン。

```ts
export type KickResult = { ok: true; jobId: string } | { ok: false; code: string; status: number };

// 同名の const（value 名前空間）にコンストラクタを置く
const KickResult = {
  ok: (jobId: string): KickResult => ({ ok: true, jobId }),
  fail: (code: string, message: string, status: number): KickResult => ({ ok: false, code, message, status }),
};

// 利用側: ガード節が 1 行に畳まれ本筋のフローが読みやすくなる
if (!valid) return KickResult.fail("FORBIDDEN", "Access denied", 403);
return KickResult.ok(jobId);
```

**適用基準**: ガード節で何度も同じ型のエラーオブジェクトを組み立てる箇所。`{ ok: false, code, message, status }` のリテラルが 5〜6 行 × N 箇所になるなら companion に畳む価値がある。`fail` の実装が全 Result 型で同一なら共通関数（`serviceError` 等）に切り出して再利用する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## 依存性注入: カリー化ファクトリパターン

クラスは使わずに `createFoo(deps): Foo` のカリー化ファクトリで表現する。deps（DB・クライアント・設定）はリクエストをまたいで安定しており、クロージャで束縛することで呼び出し側は `foo.send(input)` だけになる。テストでは spy を注入し、不要な deps は省略できる。

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

## Biome `organizeImports`

2つのルールがある。`biome check --write` で自動修正できる。

- **type before value**: 同一モジュールからの `import type` / `export type` は値 import/export の前に置く
- **packages before relative**: パッケージ import（`@xxx/`、npm）は相対 import（`../`、`./`）の前に置く

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
      type satisfies never;
      return { type: "text" };  // 実行時のフォールバック（到達不能のはず）
    }
  }
}
```

**アサーションの形は `x satisfies never;`（変数を作らない）を使う**: `const _exhaustive: never = x` は `noUnusedLocals` 環境で TS6133（declared but never read）になる（`_` プレフィックスの除外は parameter のみで local には効かない）。`satisfies` 式文なら変数を作らないため lint/compiler の未使用検査に引っかからない（TS 5.x で確認・2026-06-11）。

**使い分け**: 戻り値が必要なら上記。`throw new Error(\`Unknown: \${type}\`)` のみでもよいが、型推論で戻り値型が `never` になり呼び出し側の型が壊れることがある。
<!-- importance: medium | mentions: 3 | first-seen: 2026-05 -->

## 定数マップは `Record<UnionType, V>` で exhaustive に

`Record<string, string>` ではなく `Record<MyUnion, string>` にすると、union に値が追加されたときコンパイルエラーで検知できる。フォールバック（`?? "fallback"`）は到達不能になるため削除する。

```typescript
// NG: union が広がっても検知できない
const LABELS: Record<string, string> = { a: "A", b: "B" };
const label = LABELS[value] ?? value; // フォールバックが必要

// OK: union 追加でコンパイルエラー → `?? fallback` 不要
type Status = "matched" | "diff" | "missing" | "extra";
const LABELS: Record<Status, string> = {
  matched: "一致",
  diff: "差異",
  missing: "欠落",
  extra: "余剰",
};
const label = LABELS[status]; // フォールバック不要（exhaustive が保証）
```
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

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

## ORM-inferred 型とドメイン interface の名前衝突はインフラ側に Row サフィックス
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

Drizzle の `typeof table.$inferSelect` や Prisma の generated 型が、ドメイン層で定義した interface と同名になることがある。例: `agentActions` テーブルから `AgentAction = typeof agentActions.$inferSelect` を出すと、ドメイン側の `interface AgentAction { ... }` と衝突する。

対処は「ドメインが canonical な名前を保持し、インフラ側に `Row` / `NewRow` サフィックスを付ける」。

```ts
// NG: ドメイン側に Domain サフィックス、インフラ側が裸の名前
export interface AgentActionDomain { ... } // domain
export type AgentAction = typeof agentActions.$inferSelect // schema

// OK: ドメインが正規名、インフラに Row サフィックス
export interface AgentAction { ... } // domain
export type AgentActionRow = typeof agentActions.$inferSelect // schema
export type NewAgentActionRow = typeof agentActions.$inferInsert // schema
```

判断基準は「参照される広さ」。ドメイン型は orchestrator・agents・UI から広く import されるため canonical 名を保つ方が長期的に変更コストが低い。Row 型は repository 実装内部で完結することが多く、リネームしても影響範囲が狭い。

合わせて discriminated union の literal 型（`Kind` enum など）はドメイン層に置く。infra(schema) が `import type { Kind } from "../domain/types"` で参照し、必要なら `export type { Kind }` で re-export する。逆向き（schema が enum を所有、domain が import）にすると Clean Architecture の依存方向（infra → domain）に反する。

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

## 型ガードとしての early throw — `as` なし narrowing

関数の特定ブランチで「この値は X のはず」という不変条件が成り立つとき、`as X` でキャストするより `if (val !== expected) throw new Error(...)` を関数頭に置く方が型安全かつ実行時検証も兼ねる。

```typescript
// ❌ as キャスト: ランタイム検証なし・UI 許可テーブルが変わっても気づかない
const saveDiscount = (outcome: UnresolvedOutcome | undefined) => {
  const o = outcome as "mismatch";  // "under_billed" が来たとき silent breakage
  submitResolution({ outcome: o, amount });
};

// ✅ early throw: TypeScript が "mismatch" に narrowing + ランタイム不変条件を保証
const saveDiscount = (outcome: UnresolvedOutcome | undefined) => {
  if (outcome !== "mismatch") throw new Error(`Expected mismatch, got ${outcome}`);
  // この時点で outcome: "mismatch" に narrowing 済み
  submitResolution({ outcome, amount });
};
```

**適用基準**: 「このパスでは X の値しか来ないはずだが、型上は広い union になっている」かつ「その前提が崩れたとき silent breakage になる」ケース。UI 許可テーブル・フロー設計が変わったとき `throw` が検知するため、`as` キャストより変更に強い。実例: issue 252 の `handleDiscountSave`（`outcome !== "mismatch"` は UI 上ありえないが、許可テーブルが変わった場合に気づけるよう throw を置く）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## 定数マップは `Record<K, (arg) => string>` で関数型を統一する

値によって引数シグネチャが変わる定数マップ（ラベル生成関数等）は、全 key で同じ関数型にそろえる。一部の key だけ引数ありにすると呼び出し側で分岐が発生し、key が増えるたびに呼び出しパターンが増える。

```typescript
// ❌ discount だけ amount あり → 呼び出し側で分岐が必要
const LABEL = {
  holdover: () => "★帳端",
  discount: (amount: number | null) => `値引き ${amount ?? 0}`,
  expense: () => "経費",
} satisfies Partial<Record<ResolutionMethod, () => string>>;  // 型が揃わない

// ✅ 全 key を (amount: number | null) => string に統一
const RESOLUTION_LABEL = {
  holdover: () => "★帳端",
  discount: (amount: number | null) => `値引き ¥${amount ?? 0}`,
  expense: (_amount: number | null) => "経費",
} satisfies Record<ResolutionMethod, (amount: number | null) => string>;

// 呼び出し側は常に 1 形
const label = RESOLUTION_LABEL[method](amount);
```

**適用基準**: 「大多数の key は引数不要だが、特定の key だけ引数が必要」と感じたとき。引数を `_` で無視する key が増えても呼び出し側の統一性を保てる。`Record<K, V>` と `satisfies` で key 網羅チェックも兼ねる。実例: issue 252 の `RESOLUTION_LABEL`（holdover/expense は amount 不要だが統一して `(amount: number | null) => string` にした）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **検索/比較関数は raw 入力を受け内部で正規化する defensive 契約にする**: WHY: caller に正規化を期待すると `string` 同士で型が同じため normalize 忘れがコンパイルを通り silent miss（ヒット 0 件・常に false）になる。判断基準: 引数を生/正規化済みで取り違えてコンパイルエラーになるか？ NO なら defensive、branded type 等で型区別できるなら caller 契約可。NG: `matchesVendorSearch(v, normalizedQuery)` ／ OK: 内部で `normalizeVendorName(rawQuery)`（issue 263）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
