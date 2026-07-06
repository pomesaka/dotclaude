# PostgreSQL パターン集（postgres.js / Drizzle）

> **TL;DR**: postgres.js / Drizzle での落とし穴と安全パターン。DO ブロック内のパラメータバインドは非対応（PostgreSQL の仕様）→ `SELECT format('%I', ...) + sql.unsafe()` で DB サーバー側エスケープを使う。

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

## ループクエリ（N+1）→ バルククエリ化で「結果完全不変」を担保する設計
<!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

per-key のループクエリ（`WHERE key = ?` を N 回）を 1 本のバルククエリ（`WHERE key IN (...)` / 上位スコープの `WHERE`）+ アプリ内グルーピングに置き換えるリファクタでは、「出力が 1 バイトも変わらない」ことを次の 2 点セットで保証する:

1. **ORDER BY を（グルーピングキー, 元の per-key ソートキー）の複合にする**: 単一キー版が `WHERE key = ? ORDER BY sort_col` だったなら、バルク版は `ORDER BY key, sort_col` にする。グルーピングを出現順 `push` で行えば、グループ内の各配列は単一キー版と同順になることが SQL レベルで保証される（グルーピング後にアプリ側で再ソートする必要がなく、再ソート実装のバグ余地も消える）
2. **既存テストの assertion を 1 文字も変更せず green にする**: 「テストも一緒に直した」場合は結果不変の証明にならない。assertion 無修正 green が回帰確認そのもの

補足: グルーピングはIO-free の純関数（`groupXxxByKey(rows): Map<key, rows[]>`）として fetch から分離して export すると、DB なしの table driven test で並び・境界（空グループ・単一要素）を直接検証できる。
