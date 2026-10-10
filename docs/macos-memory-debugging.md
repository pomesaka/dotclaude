# macOS でのメモリ逼迫デバッグ

> **TL;DR**: Claude Code のセッションを並行で動かしていてメモリが逼迫したら、まず `top` で上位のプロセスを見る。krunkit（podman machine）ならホストにメモリを返さない仕組みで、長く動かすほど大きくなる。node / tsserver が積み上がっているなら、親プロセスまで辿って所有しているセッションを特定する。

Claude Code セッションを何本も並行稼働させている環境で「システムが逼迫している」
と言われたときの切り分け方。`top -l 1 -o mem -n 10 -stats pid,command,mem` で上位
プロセスを見てから、以下のどちらに当たるか判定する。

## krunkit（podman machine）はホストにメモリを返さない

podman machine のバックエンド（libkrun/krunkit）は、ホスト RSS の削減を
virtio-balloon の free page reporting だけに頼っている。これはゲストが「完全に
空き」と申告したページしか対象にならず、ゲストの page cache（Prometheus/Loki の
ようなログ・メトリクス系ワークロードが溜め込みやすい）はホストに返らない。さらに
実測では、ゲスト RAM 設定（`--memory 8192` = 8G）を超えてホスト側 RSS が
15G まで膨らむケースも確認した（`podman machine ssh free -m` ではゲスト内
used は 1.4G しかないのに、ホストの `top` では krunkit が 15G 消費。
ゲスト RAM の外側で krunkit プロセス自体が肥大していた。2026-09-10・krunkit
v1.3.2 で確認）。稼働時間が長い（2 日以上）ほど顕著。

- 確認: libkrun メンテナが balloon inflate/deflate 自体を未実装と明言
  （https://github.com/libkrun/libkrun/issues/707 のコメント、2026-09-10 閲覧）
- 対処: `podman machine stop` → `start` で即座に回収できる（他に確実な手段
  なし）。ゲスト RAM 上限を `podman machine set --memory <MB>` で絞るのは気休め
  程度（膨張は上限の外側で起きるため）
- 使い終わったら `podman machine stop` する運用が唯一の予防策。中で `claude`
  セッションのサンドボックス実行（ko-agent-sandbox 等）や監視スタックが動いて
  いると気軽に止められないので、ユーザーに確認してから実行する

## node/tsserver が積み上がっているとき: 所有セッションを親プロセスまで辿る

`typescript-language-server` 配下の `tsserver.js` は Claude Code の LSP 統合が
起動するもので、1 セッションにつき 1 本残る。複数本（600M〜1.5G ずつ）が積み上
がっているときは `ps -o pid,ppid,command -p <pid>` を `claude --name <X>` が
出るまで親を辿ると、どのセッションの持ち物か特定できる。

```
tsserver.js → typescript-language-server --stdio → claude --name <session>
```

特定した名前を `ListAgents` の peer 一覧と突き合わせる。一覧に出てこない
（=もう追跡されていない）名前は、ユーザーが「落としたはず」の tmux ペインの
残骸であることが多い。`--resume <uuid>` 形式（名前なし）で PPID が tmux
セッションの場合は、`~/.claude/projects/<workspace>/<uuid>.jsonl` を
`jq -r 'select(.type=="user") | .message.content'` で読めば、どのリポジトリで
何をしていたセッションかが分かる。ファイル更新日時が最近なら現役なので kill
しない。
