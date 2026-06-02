# PostgreSQL パターン集（postgres.js / Drizzle）

よくある落とし穴と安全な実装パターン。

## DO ブロック内でのパラメータバインドは機能しない

postgres.js の template literal（`sql\`...\``）は Extended Query Protocol で `$1`, `$2` バインドパラメータを送る。しかし PostgreSQL の `DO` ブロックは「引数なし無名関数の本体」として扱われるため、`$1` を参照すると `ERROR: there is no parameter $1` で失敗する。

**NG パターン**:
```typescript
// postgres.js が $1 = appPassword で送るが、DO ブロック内で $1 が解決されない
await sql`
  DO $$
  DECLARE x TEXT := ${appPassword};
  BEGIN
    CREATE ROLE my_role LOGIN PASSWORD x;
  END $$
`;
```

**OK パターン — SELECT + format + sql.unsafe**:
```typescript
// 1. 存在チェックは parameterized で安全に
const existing = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${roleName} LIMIT 1`;
if (existing.length === 0) {
  // 2. PostgreSQL の format() で DB サーバー側エスケープ（%I=識別子・%L=リテラル）
  const [{ stmt }] = await sql<[{ stmt: string }]>`
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${roleName}, ${password}) AS stmt
  `;
  // 3. エスケープ済み文字列を sql.unsafe() で実行
  await sql.unsafe(stmt);
}
```

**なぜ安全か**: `format()` はサーバー側で実行され `%I`（`quote_ident`）と `%L`（`quote_literal`）が PostgreSQL の組み込みエスケープを使う。ロール名・パスワードがどんな文字列でも正しくエスケープされる。

**注意点**:
- `sql(identifier)` は postgres.js のクライアント側ダブルクォートエスケープで GRANT/REVOKE の識別子には使える（ALTER DEFAULT PRIVILEGES の `TO ${sql(roleName)}` 等）
- `sql.unsafe()` は parameterized ではないため、必ず PostgreSQL の `format()` や自前エスケープを通してから渡すこと
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
