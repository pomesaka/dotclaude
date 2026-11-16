# Claude Codeのhooksの設計規約

> **TL;DR**: hookを作るときに実際に間違えた点を3つまとめてある。fixerを走らせる時点、トリガーの選び方、追跡されているファイルの扱い。

この文書は、Claude Codeのhookを作る、直すときに読む。整理する前の版は`archive/2026-11-16/docs/hooks-policy.md`にある。

- **未使用の検出を持つfixer（biome、`eslint --fix`）は、`PostToolUse:Edit`でなく`Stop`のhookで走らせる**。編集の途中には「変数を定義したが、使う箇所はまだ書いていない」状態があり、fixerがそれを未使用と見て、`_`を付けた名前に変えたりimportを消したりする。次の編集で`Cannot find name 'X'`になる。`--unsafe`を外しても、安全な修正の範囲でimportが消える。ターンの終わりなら、使う箇所もそろっている。
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
- **hookのトリガーは、「何が変わったか」でなく「何が欠けているか」で選ぶ**。変更の検知（`FileChanged`でlockfileを見張る、など）は外れやすい。worktreeで並列に開発するときに欠けているのはnode_modulesで、lockfileは変わっていないので、発火しない。判断基準は「このイベントは、困っている状態のときに実際に発火するか」。イベントの名前から動きを推測せず、公式の文書で発火の条件を読む。`Setup`はふつうのセッションの開始では発火せず、`WorktreeCreate`は通知でなく作成の処理そのものを置き換える。`SessionStart`の標準出力は文脈に入るので、副作用だけが目的なら`> /dev/null`にする。
  <!-- importance: high | mentions: 2 | first-seen: 2026-07 -->
- **自動で走るhookに、追跡されているファイルを書き換えさせない**。hookは利用者が見ていないところで走るので、lockfileなどを書き換えると、作った覚えのない変更がコミットに混ざる。`bun install`でなく`bun install --frozen-lockfile`（npmなら`ci`）のように、書き換えずに失敗する版を使う。エラーにならずに誤った状態が通る形を避ける、という`coding-policy.md`の「失敗を、正しい値と区別できる形にする」と同じ考え方だ。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
