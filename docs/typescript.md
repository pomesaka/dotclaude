# TypeScript レビュー観点

> **TL;DR**: `export default` 禁止（named export のみ）・`as` キャスト原則禁止・`any` 禁止・`class` 原則禁止。discriminated union で null 安全に型を表現。Biome を linter として使用。Zod でランタイムバリデーション境界を構築。実装中の落とし穴・コンパイラ挙動 → `typescript-gotchas.md`

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
  特に **zod を併用する場合は値配列必須**: `z.enum(VARIABLE_TYPES)` のように渡せる。型のみ export だと `z.enum` に渡せず（型消去）、結局 zod schema 内に値を直書きすることになり真実が分散する。値配列を真の単一情報源にする。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->
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
- **導出可能なフィールドを型に持たせない**: 別フィールドから常に計算できる値（例: `url` から `new URL(url).hostname` で得られる `domain`）は型に含めず表示層で導出する。型に入れると、データを組み立てる呼び出し側が一貫性を維持する責務を持つことになり、不整合が生じやすい。
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
      const _exhaustive: never = type;
      return { type: "text" };  // 実行時のフォールバック（到達不能のはず）
    }
  }
}
```

**使い分け**: 戻り値が必要なら上記。`throw new Error(\`Unknown: \${type}\`)` のみでもよいが、型推論で戻り値型が `never` になり呼び出し側の型が壊れることがある。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

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

## ORM-inferred 型とドメイン interface の名前衝突はインフラ側に Row サフィックス
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

Drizzle の `typeof table.$inferSelect` や Prisma の generated 型が、ドメイン層で定義した interface と同名になることがある。例: `agentActions` テーブルから `AgentAction = typeof agentActions.$inferSelect` を出すと、ドメイン側の `interface AgentAction { ... }` と衝突する。

対処は「**ドメインが canonical な名前を保持し、インフラ側に `Row` / `NewRow` サフィックスを付ける**」。

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

合わせて **discriminated union の literal 型（`Kind` enum など）はドメイン層に置く**。infra(schema) が `import type { Kind } from "../domain/types"` で参照し、必要なら `export type { Kind }` で re-export する。逆向き（schema が enum を所有、domain が import）にすると Clean Architecture の依存方向（infra → domain）に反する。

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
