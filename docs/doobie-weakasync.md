# doobieでTXを保ったままFの効果を呼ぶ（WeakAsync）

Scalaのdoobieで、`FOR UPDATE SKIP LOCKED`で取った行ロックを持ったまま業務処理（SMTPの送信など）をして、結果を記録してcommitする、という1つのTXを書くときに読む。整理する前の版は`archive/2026-11-16/docs/doobie-weakasync.md`にある（typeclassの階層の説明と、実装の全体はそちら）。

```scala
def process[F[_]: Async](xa: Transactor[F]): F[Unit] =
  WeakAsync.liftK[F, ConnectionIO].use { fk =>
    dequeue.flatMap {
      case None    => ConnectionIO.unit
      case Some(r) =>
        parseRow(r)
          .flatMap(action => fk(dispatch(action)))   // F[Unit] → ConnectionIO[Unit]
          .attempt
          .flatMap(record(r, _))
    }.transact(xa)                                    // ここで1回だけcommit
  }
```

`WeakAsync`はdoobieのtypeclassで、cats-effectには無い（`import doobie.WeakAsync`）。`ConnectionIO`はfiberのforkもsleepもできないので、`Async[ConnectionIO]`のinstanceは存在しない。`F[_]: Async`の`F`に`ConnectionIO`を渡すとコンパイルエラーになる。公式の文書は薄いので、ソース（`typelevel/doobie`の`modules/free/src/main/scala/doobie/WeakAsync.scala`）を読む。

間違えやすい点は次のとおり。

- **`fk`を`.use { fk => ... }`の外へ持ち出さない**: 中のDispatcherが終わっていて、実行時エラーになる
- **dequeueだけ先にcommitしない**: `FOR UPDATE SKIP LOCKED`のロックはTXの中でしか保たれない。先にcommitすると、別のworkerが同じ行を取る。`.transact(xa)`は最後に1回だけ呼ぶ
- **業務処理は`.attempt`で`Either`にしてから記録する**: 例外のまま伝えると、TXの全体がrollbackされ、失敗の記録（実行の履歴、失敗の回数）も消える
- **外部I/Oはat-least-onceになる**: 送信した後、commitの前にプロセスが落ちると、TXはrollbackされ、別のworkerが拾ってもう一度送る。外部I/OはDBのTXに入らないので、この形では避けられない。対策は、受け手でのidempotency keyによる重複の排除、started→送信→doneの2段のcommit、outboxなど。最初はat-least-onceを受け入れるのが現実的。claimでの冪等化は`async-job-reliability.md`にある
