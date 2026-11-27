# Scalaの書き方

> **TL;DR**: Scalaを書くときとレビューするときに読む。一般的な作法は書かず、pomesakaが選んだ書き方だけを置く。言語によらない分岐とコメントの決まりは`coding-policy.md`にある。

## 分岐

- `ifM`は、条件が述語の名前の付いた`IO[Boolean]`1つで、両方の枝が1行のときだけ使う。`coding-policy.md`の`if`/`else`と同じ条件だ。片方の枝が`IO.unit`なら`whenA`か`unlessA`にする。それ以外は、調べた結果を値にして`match`で分ける。`ifM`は真の枝がどちらかを引数の順番でしか表さず、枝が長いと読めないためだ

## 関係する文書

- doobieで、TXを保ったまま外部の処理を呼ぶときは`doobie-weakasync.md`
