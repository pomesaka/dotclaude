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
