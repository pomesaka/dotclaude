# Web セキュリティパターン

> **TL;DR**: Web API で繰り返し現れるセキュリティパターンの実践ガイド。認証(authn)と認可(authz)は別レイヤー。IDOR 対策は存在秘匿（404）で。domain store に認証コンテキストを持ち込まない。

---

## 認証（authn）と認可（authz）の分離

| レイヤー | 責務 | 問い |
|---|---|---|
| 認証（authn） | 「あなたは誰か」 | セッションが有効か？ → 401 |
| 認可（authz） | 「あなたはこれをしていいか」 | このリソースはあなたのものか？ → 403 or 404 |

認証基盤（BetterAuth / NextAuth 等）は authn だけを扱う。authz（ユーザー間のデータ分離）はアプリ層で別途実装する。

---

## IDOR（Insecure Direct Object Reference）

### 脆弱性の概要

認証済みユーザーが他人のリソース ID を直接指定してアクセスできる脆弱性。

```
GET /api/jobs/abc123  （abc123 は他人のジョブ）
```

認証チェック（401）だけでは防げない。認証済みユーザーが他人のリソースを読む経路が残る。

### 対策: 2段階チェック

1. **認証チェック**: `session` がなければ 401
2. **所有チェック**: リソースが自分のものでなければ 404（存在秘匿）

**403 ではなく 404 を返す理由**: 403 はリソースの存在を認めてしまう。404 は「存在しないか他人のもの」を同一視して返すことで、リソースの存在自体を漏らさない（存在秘匿、Existence Concealment）。

### パターン: クエリ層で owner を解決する

アプリ層での post-hoc チェックは避ける。クエリ側に `userId` を渡し DB レベルで解決する。

```ts
// ✅ クエリ層で id AND user_id を照合
async function getResourceByIdAndOwner(db, id, userId) {
  return db.select().from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .then(r => r[0] ?? null);
}

// Route Handler
const session = await auth.api.getSession({ headers: req.headers });
if (!session) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

const record = await getResourceByIdAndOwner(db, params.id, session.user.id);
if (!record) return json({ ok: false, error: "Not found" }, { status: 404 });
```

```ts
// ❌ アプリ層での post-hoc チェック（DB が全件返し、アプリで弾く）
const record = await getResourceById(db, params.id);
if (!record || record.userId !== session.user.id) { ... }
```

後者は DB がデータを全件返したあとアプリでフィルタするため、誤って owner なしクエリを書いたときの安全網がない。

### ドメインストアに認証コンテキストを持ち込まない

Domain Store（lifecycle store 等）は認証コンテキストを知るべきではない。

```
Route Handler  ← session.user.id を持つ
    ↓ userId を引数として渡す
db/queries/    ← WHERE id = ? AND user_id = ?
    ↑ null なら404
Domain Store   ← jobId のキー解決のみ。userId は知らない
```

---

## マルチテナントとユーザー間アクセス制御の2レイヤー

テナント分離とユーザー間アクセス制御は別レイヤー。混同しない。

| レイヤー | 手法 | 目的 |
|---|---|---|
| テナント分離 | DB スキーマ分離 / サブドメイン / env 分離 | 顧客 A のデータが顧客 B から見えない |
| ユーザー間アクセス制御 | `WHERE user_id = ?` | テナント内で自分のデータだけ見える |

「テナント分離があれば安全」という誤解に注意。テナント内の IDOR は別途対策が必要。

---

## user-owned テーブルの設計原則

業務データテーブルには owner FK（`user_id`）を必須カラムとして持たせる。

```ts
// ✅ owner FK 必須
export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  // ...
});
```

**クエリは userId を必須引数に**: owner を引数に取らないクエリ関数は IDOR の温床。

```ts
// ✅ 正しい
async function getDocumentsByUser(db, userId: string) { ... }

// ❌ 禁止
async function getAllDocuments(db) { ... }
```

---

## 権限昇格防止（Privilege Escalation Prevention）

### 高権限アカウントの権威を DB 外に置く

super-admin / system-admin のような最上位権限を DB のカラムで管理すると、DB 操作（SQL 直打ち・ORM バグ等）で誰でも昇格できる状態になる。権威を顧客が書き込めない領域（環境変数・デプロイ設定）に置くことで、昇格を原理的に不可能にする。

```
# ✅ env allowlist パターン — DB の外に権威を置く
SYSTEM_ADMIN_EMAILS=ops@provider.com,support@provider.com

# session 構築時に判定（DB role より優先）
if (allowlist.has(session.email)) role = "system-admin"
```

- **DB の `users.role`** には system-admin を含めない（`admin | member` だけ）
- **env は実行時の権威**: 起動時の seed として使うのではなく、毎リクエストの session 構築時に評価する
- **リスト形式**: 複数運用者・ローテーション対応のためカンマ区切りで複数メールを受け付ける

### 前提: メール詐称を塞ぐ

env allowlist がメールアドレスで本人を指す以上、「そのメールを名乗れる経路」が塞がれていないと allowlist が穴になる。
- 登録が招待制 or メール検証必須（オープン登録で allowlist メールを勝手に取られると突破される）
- ユーザーが自分のメールアドレスを自由変更できない設計
