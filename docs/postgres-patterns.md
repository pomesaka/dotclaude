# PostgreSQL で踏んだ罠（postgres.js / Drizzle）

> **TL;DR**: postgres.js で `DO` ブロックにパラメータを渡せない問題と、その安全な書き方。

整理する前の版は `archive/2026-11-16/docs/postgres-patterns.md` にある。

## DO ブロック内でのパラメータバインドは機能しない
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

postgres.js の template literal（`sql\`...\``）は Extended Query Protocol で `$1`, `$2` バインドパラメータを送る。しかし PostgreSQL の `DO` ブロックは「引数なし無名関数の本体」として扱われるため、`$1` を参照すると `ERROR: there is no parameter $1` で失敗する。

```typescript
// NG: postgres.js が $1 = appPassword で送るが、DO ブロック内で $1 が解決されない
await sql`
  DO $$
  DECLARE x TEXT := ${appPassword};
  BEGIN
    CREATE ROLE my_role LOGIN PASSWORD x;
  END $$
`;

// OK: SELECT + format + sql.unsafe
// 1. 存在チェックは parameterized で
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

`format()` はサーバー側で実行され、`%I`（`quote_ident`）と `%L`（`quote_literal`）が PostgreSQL の組み込みのエスケープを使うので、ロール名やパスワードがどんな文字列でも正しくエスケープされる。

- `sql(identifier)` は postgres.js のクライアント側のダブルクォートエスケープで、GRANT/REVOKE の識別子には使える（ALTER DEFAULT PRIVILEGES の `TO ${sql(roleName)}` 等）
- `sql.unsafe()` はパラメータを束縛しないので、PostgreSQL の `format()` や自前のエスケープを通してから渡す
