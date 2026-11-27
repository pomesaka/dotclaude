# macOS でのメモリ逼迫デバッグ

> **TL;DR**: Claude Code のセッションを並行で動かしていてメモリが逼迫したら、まず `top -l 1 -o mem -n 10 -stats pid,command,mem` で上位のプロセスを見る。krunkit（podman machine）ならホストにメモリを返さない仕組みで、長く動かすほど大きくなる。node / tsserver が積み上がっているなら、親プロセスまで辿って所有しているセッションを特定する。

整理する前の版は `archive/2026-11-16/docs/macos-memory-debugging.md` にある。

## krunkit（podman machine）はホストにメモリを返さない

podman machine のバックエンド（libkrun/krunkit）は、ホスト RSS の削減を virtio-balloon の free page reporting だけに頼っている。ゲストが「完全に空き」と申告したページしか対象にならず、ゲストの page cache（Prometheus/Loki のようなログ・メトリクス系ワークロードが溜め込みやすい）はホストに返らない。ゲスト RAM の設定（`--memory 8192` = 8G）を超えて、krunkit のプロセス自体がホストで 15G まで膨らんだこともある（`podman machine ssh free -m` ではゲスト内の used は 1.4G。2026-09-10、krunkit v1.3.2 で確認）。稼働時間が長い（2 日以上）ほど顕著。

- 確認: libkrun のメンテナが balloon の inflate/deflate を未実装と明言している（https://github.com/libkrun/libkrun/issues/707 のコメント、2026-09-10 閲覧）
- 対処: `podman machine stop` → `start` で即座に回収できる（ほかに確実な手段は無い）。`podman machine set --memory <MB>` でゲスト RAM の上限を絞っても、膨張は上限の外側で起きるので気休め程度
- 予防は、使い終わったら `podman machine stop` する運用だけ。中で `claude` セッションのサンドボックス実行（ko-agent-sandbox など）や監視スタックが動いていると気軽に止められないので、ユーザーに確認してから止める

## node/tsserver が積み上がっているとき: 所有セッションを親プロセスまで辿る

`typescript-language-server` 配下の `tsserver.js` は Claude Code の LSP 統合が起動するもので、1 セッションにつき 1 本残る。複数本（600M〜1.5G ずつ）が積み上がっているときは、`ps -o pid,ppid,command -p <pid>` で `claude --name <X>` が出るまで親を辿ると、どのセッションの持ち物か特定できる。

```
tsserver.js → typescript-language-server --stdio → claude --name <session>
```

特定した名前を `ListAgents` の peer 一覧と突き合わせる。一覧に出てこない（もう追跡されていない）名前は、ユーザーが「落としたはず」の tmux ペインの残骸であることが多い。`--resume <uuid>` 形式（名前なし）で PPID が tmux セッションなら、`~/.claude/projects/<workspace>/<uuid>.jsonl` を `jq -r 'select(.type=="user") | .message.content'` で読めば、どのリポジトリで何をしていたセッションかが分かる。ファイルの更新日時が最近なら現役なので kill しない。
