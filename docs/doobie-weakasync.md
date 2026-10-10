# doobie + cats-effect: WeakAsync と Dispatcher

> **TL;DR**: TX を保持しながら F（IO）の効果（SMTP 等）を呼ぶには `WeakAsync.liftK[F, ConnectionIO].use { fk => ... fk(fa) ... .transact(xa) }` パターンを使う。`WeakAsync` は doobie 固有の typeclass（cats-effect にはない）。`import doobie.WeakAsync` する。落とし穴: `commitNoLog` で即 commit すると行ロック解放・`fk` を `.use` 外に持ち出すと runtime エラー・SMTP 等の外部 I/O は at-least-once 問題あり。

doobie で「トランザクション境界を保持したまま F の効果 (SMTP 送信等) を埋め込む」パターンに必要な道具のメモ。

`FOR UPDATE SKIP LOCKED` で取った行ロックを保持して業務処理 → NanoQueueRun 記録 → commit、を 1 TX でやりたい時の典型パターン。

## 登場人物 (どれが誰のものか — 混乱の温床)

| 何 | どこにある |
|---|---|
| `cats.effect.kernel.Async` (typeclass) | cats-effect |
| `cats.effect.std.Dispatcher` (fiber pool) | cats-effect |
| `cats.effect.IO` (具体的な effect 型) | cats-effect |
| **`doobie.WeakAsync` (typeclass)** | **doobie** ← cats-effect ではない |
| **`WeakAsync.liftK` (natural transformation factory)** | **doobie** |
| `doobie.ConnectionIO` (TX context 型) | doobie |
| `WeakAsync[ConnectionIO]` instance | doobie が提供 |
| `Async[ConnectionIO]` instance | **存在しない** |

特に注意: `WeakAsync` は doobie 固有の typeclass。cats-effect には無い。doobie が cats-effect の `Async` と `Dispatcher` を借りた上で、自分の typeclass `WeakAsync` を定義している。

## なぜ WeakAsync が要るか

cats-effect の typeclass 階層は次のとおり。

```
Sync → MonadCancel → Concurrent → Temporal → Async
       (キャンセル)   (fiber fork)  (sleep)    (callback ↔ F の橋渡し)
```

`ConnectionIO` の能力は次のとおり。
- ✓ 同期 I/O (delay) はできる
- ✓ async 表現 (callback) もできる
- ✗ **fiber を fork できない** (1 connection は sequential)
- ✗ **sleep もできない** (TX を開いたまま sleep は意味不明)

つまり「Async ほど強くないが、Sync より強い中間」。Async typeclass を要求すると ConnectionIO に instance を定義できない。これに精密にフィットする typeclass として doobie が `WeakAsync` を定義した。

## TX-holding パターンの実装テンプレート

job queue worker の per-iteration: dequeue → execute → record の 3 段を 1 TX で書く形。

```scala
import cats.effect.Async
import doobie.*
import doobie.implicits.*
import doobie.WeakAsync

def process[F[_]: Async](xa: Transactor[F]): F[Unit] =
  WeakAsync.liftK[F, ConnectionIO].use { fk =>
    dequeue.flatMap {
      case None    => ConnectionIO.unit
      case Some(r) =>
        parseRow(r)
          .flatMap(action => fk(dispatch(action)))   // F[Unit] → ConnectionIO[Unit]
          .attempt                                    // → ConnectionIO[Either[Throwable, Unit]]
          .flatMap(record(r, _))                      // → ConnectionIO[Unit]
    }.transact(xa)                                    // ConnectionIO → F、TX commit
  }

private def parseRow(row: NanoQueue): ConnectionIO[NanoQueueAction] =
  NanoQueueAction.parse(row.action, row.actionParams).liftTo[ConnectionIO]

private def record(row: NanoQueue, result: Either[Throwable, Unit]): ConnectionIO[Unit] =
  result match
    case Right(_) => recordRunSuccess(row) *> completeQueue(row)
    case Left(e)  => recordRunFailure(row, e) *> bumpFailCount(row, e)
```

### 設計判断の根拠

- **for-comp ではなく flatMap chain**: 各ステップが 2 段以下で、for-comp の旨味 (複数中間値の命名) が活きない
- **`traverse_` ではなく pattern match (`case None / Some(r) =>`)**: `LIMIT 1` で必ず Option なので、抽象化より明示の方が読みやすい。`r` が `Some(r) =>` 枝で scope に入って record にそのまま渡せる
- **executeRow helper を作らず inline**: helper 1 個だけだと旨味が薄い。helper を増やすときに `using (F ~> ConnectionIO)` で fk を implicit に流す案がある (Scala 3 慣用句)
- **`.attempt` を process 層で呼ぶ**: 業務処理 (parseRow + dispatch) は throw する素直な関数。失敗ハンドリングは record でやる、と層を分ける
- **table 操作 (dequeue, record, completeQueue, bumpFailCount) を process 層に揃える**: 上から下に読むと「queue とどう interact してるか」が一望できる

### ポイント

- **for-comp / flatMap chain の中身は `ConnectionIO` で書く** (dequeue, parseRow, record 系はすべて CIO)
- **`F[_]` の effect は `fk(...)` で CIO に lift** して呼ぶ (例: `fk(runner.run(action))`)
- **`.transact(xa)` で TX を commit** して F に戻る
- **`fk` を `.use { fk => ... }` のブロック外に持ち出さない** (内部の Dispatcher が死んで runtime エラー)
- **失敗時も TX を commit する**: `.attempt` で `Either` 化して record まで実行。これにより NanoQueueRun に失敗記録が残る。throw のままだと TX 全体が rollback されて記録も消える

### 完全な TX で起きる DB 操作

```
BEGIN
  SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1     -- dequeue (行ロック取得)
  parse + dispatch + runner.run                  -- 業務処理 (失敗しても TX 継続)
  ┌── 成功 ──────────────────────────────────┐
  │  INSERT NanoQueueRun (success)            │
  │  DELETE NanoQueue WHERE id = ?            │   ← queue から除去
  └───────────────────────────────────────────┘
  ┌── 失敗 ──────────────────────────────────┐
  │  INSERT NanoQueueRun (failure, error)     │
  │  UPDATE NanoQueue                          │
  │    SET failCount = failCount + 1,          │   ← retry に向けて状態更新
  │        lastFail = NOW()                    │
  └───────────────────────────────────────────┘
COMMIT  -- 行ロック解放
```

### 各部品の役割

| 部品 | 役割 |
|---|---|
| `Async[F]` | 強い能力 (fiber fork できる)。外側の F (IO) はこれ |
| `WeakAsync[G]` | 弱い能力 (sequential)。内側の G (ConnectionIO) はこれ |
| `WeakAsync.liftK[F, G]` | F → G の翻訳器 `Resource[F, F ~> G]` を作る |
| `Dispatcher.parallel[F]` (内部使用) | F の runtime に外から F[A] を依頼できる fiber pool |
| `.transact(xa)` | ConnectionIO → F の変換 (TX を commit) |

## メンタルモデル

```
F の世界 (Async, IO の runtime)
  │
  │ ① WeakAsync.liftK で F ~> G を作る (Dispatcher 構築)
  │
  ▼
G の for-comp (ConnectionIO で組む)
  │
  │ ② fk(fa) で F[A] を G[A] に embed
  │   裏で Dispatcher が F の runtime で fa を実行 → 結果を G[A] として返す
  │
  ▼
G[Unit] が完成
  │
  │ ③ .transact(xa) で G → F に変換
  │   ここで初めて SQL TX が始まる
  │
  ▼
F[Unit] になって runtime が実行
```

一文要約: 「F のランタイムを使って、G の program を、F の効果も呼びつつ実行する基盤」。

## 落とし穴

1. **`.commitNoLog` で即 commit すると行ロックが解放される**
   `FOR UPDATE SKIP LOCKED` で取ったロックは TX 内でしか保持されない。dequeue だけ即 commit すると別 worker が同じ行を取れてしまう。TX を全体で 1 つにまとめる必要がある (`.transact(xa)` を最後に 1 回だけ呼ぶ)。

2. **`fk` を Resource scope の外に持ち出さない**
   内部の Dispatcher が cancelled fiber を保持する状態になり runtime エラー。`.use { fk => ... }` のブロック内で完結させる。

3. **`WeakAsync` を cats-effect から探さない**
   doobie 内にしか無い。`import doobie.*` または `import doobie.WeakAsync` する。

4. **`Async[ConnectionIO]` を要求しない**
   存在しないので。`def foo[F[_]: Async]` の F に ConnectionIO を渡すとコンパイルエラー。`F[_]: WeakAsync` で書くべき。

5. **失敗時の record も rollback される**
   業務処理 (parseRow + dispatch) を `.attempt` で wrap せず例外を伝播させると、TX 全体が rollback されて record (NanoQueueRun 記録 + failCount++) も巻き戻る → 失敗が DB に残らない。`.attempt` を必ず process 層で挟んで Either 化し、record 自体は正常 CIO 値として実行されるようにする。

6. **at-least-once 問題 (SMTP 等の外部 I/O)**
   `fk(runner.run)` で SMTP 送信した後で commit する前にプロセスが落ちると、メールは送られたが TX は rollback → 行ロック解放 → 別 worker が拾ってメール 2 通。これは TX-holding パターンの本質的な制約 (SMTP は DB の TX に参加しない)。対策案: idempotency key で受信側 dedup、2-phase pattern (started 状態 commit → send → done 状態 commit)、outbox pattern など。最初は at-least-once を受け入れるのが現実的。

## Dispatcher 自体について

doobie 経由で使う場合、Dispatcher は `WeakAsync.liftK` が隠してくれるので直接触らないのが普通。

直接 Dispatcher を扱うのは次の場合。
- Java callback API から F[A] を実行したい時 (`dispatcher.unsafeRunSync(fa)` 等)
- Reactive Streams Subscriber 実装
- 他の effect system (FS2 など) との橋渡し

`Dispatcher.parallel` vs `Dispatcher.sequential` は次のとおり。
- `parallel`: 並行に submit された effect を並列実行
- `sequential`: 1 つずつ順次実行

doobie の `WeakAsync.liftK` は `parallel` を使ってる。「1 TX 内で複数 F[A] を並列に投げる」想定。

## ドキュメント

- cats-effect Dispatcher: https://typelevel.org/cats-effect/docs/std/dispatcher
- doobie 公式: https://typelevel.org/doobie/
- WeakAsync ソース: github.com/typelevel/doobie 内 `modules/free/src/main/scala/doobie/WeakAsync.scala` 周辺
- 実例コード探索: GitHub で `WeakAsync.liftK` 検索

doobie の WeakAsync 周りは公式ドキュメントが薄い領域。ソース直読み + Metals goto-definition が結局一番速い。

## 関連概念の対応表 (cats-effect 由来 vs doobie 由来)

| 概念 | cats-effect 側 | doobie 側 |
|---|---|---|
| effect 型 | `IO`, `F[_]: Async` | `ConnectionIO` |
| 能力契約 | `Async[F]`, `Sync[F]`, ... | `WeakAsync[G]` |
| runtime | IOApp の internal | Transactor の commit/rollback |
| 効果間 lift | `Resource.eval`, `MonadCancel.liftK` 等 | **`WeakAsync.liftK`** |
| fiber pool | `Dispatcher.parallel/sequential` | (doobie が内部で使う) |

両者は別ライブラリだが typeclass エコシステムで噛み合っている。doobie が cats-effect の上で SQL DSL を提供している、と理解する。
