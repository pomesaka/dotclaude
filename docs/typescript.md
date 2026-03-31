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

## 命名規則

- コンポーネント・型・インターフェース: PascalCase
- 関数・変数・カスタムフック: camelCase（フックは `use` prefix）
- ファイル名: ケバブケース（`user-service.ts`）。Reactコンポーネントのみ PascalCase
- boolean には `is` / `has` / `can` / `should` prefix
