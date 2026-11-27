---
name: send-to-sessions
description: claude-deck の止まっているセッションに、入力欄が空のときだけ、利用者が打ったのと同じ形で1行の文を送る（/reload-plugins など）。
when_to_use: 利用者が「ほかのセッションに /reload-plugins 送って」「全部のセッションで読み込み直して」「止まってるセッションに〜を打って」と頼んだとき。頼まれていないのに、自分の判断でほかのセッションへ打ち込まない。
allowed-tools: Bash(bun ~/.claude/skills/send-to-sessions/send.ts:*)
---

# ほかのセッションに文を送る

claude-deck のセッションは tmux のウィンドウで動いている。`send.ts` は、そのウィンドウの入力欄に文を打って Enter を送る。利用者が入力欄に打って送ったのと同じに届くので、`/reload-plugins` のようなスラッシュコマンドも動く。SendMessage と違い、相手の会話には「ほかのセッションからのメッセージ」でなく、利用者の発言として入る。

```bash
bun ~/.claude/skills/send-to-sessions/send.ts --dry-run [--text <文>] [--only <名前か alias,...>]
bun ~/.claude/skills/send-to-sessions/send.ts [--text <文>] [--only <名前か alias,...>]
```

`--text` を省けば `/reload-plugins`。`--only` は名前か alias の部分一致で、省けば止まっている全部が対象になる。

## 送る前に

まず `--dry-run` で送る先と飛ばす理由を出し、利用者に見せてから送る。打ち込んだ文は利用者の発言として相手の会話に残り、取り消せないためだ。利用者が送る先と文をもう言っていれば、続けて送ってよい。

スクリプトは、次のセッションには送らない。

- 状態が `idle` か `waiting_action` でないもの。動いているセッションに打つと、打った文が次の発言として積まれる。承認や回答の画面が開いていると、その画面に入る
- 入力欄に打ちかけの文があるもの。打ちかけの後ろに足されて、別の文になる。入力欄に薄い字で出る次の発言の案は、打った文に数えない
- 自分のセッション。自分の入力欄に打つと、このターンの後に自分あての発言として届く

飛ばしたセッションは、名前と理由を利用者に伝える。

## 報告

送った数と、飛ばしたセッションの名前と理由を書く。送った文が効いたかは、1つのウィンドウの画面を `tmux capture-pane -p -t claude-deck:<deck の ID>` で読んで確かめる（`/reload-plugins` なら、`Reloaded:` の行と、読み直した Mod の名前が出る）。
