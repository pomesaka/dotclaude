# check-streak

Claudeが同じ検査（テスト、型検査、lint）を、通らないまま3回続けて落としたら、それ以上直さずに利用者を呼ぶよう、3回目の結果に添えて伝えるMod。止めはしない。

3回直して通らないなら、原因の見立てそのものが外れていることが多い。続けるほど、検査を緩めるか、関係ない所を変える直し方に流れる（[How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/)の「Failing tests require human attention」）。文書に書いても、直している最中のモデルは自分の回数を数えないので、Modで数える。

## 数え方

- 検査は、コマンドの中の道具の名前（`bun test`、`tsc`、`go test`、`claude plugin test`、`scripts/check.sh`など）で見分ける。対象のファイルやフラグが変わっても、同じ道具なら同じ検査として数える
- 落ちたかは、Bashの結果がエラー（0以外で終わった）かで見る。1回通れば数え直す
- エージェントごとに数える。サブエージェントの失敗は、メインの回数に入らない
- 裏で走らせたコマンドと、`mutate.ts`（生き残りがあると1で終わる）は数えない
- 回数はモジュールの変数に持つ。読み込み直すと0から数える

## 開発

```bash
claude plugin validate mods/check-streak
claude plugin test mods/check-streak
```
