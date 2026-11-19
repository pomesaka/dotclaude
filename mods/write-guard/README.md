# write-guard

ClaudeがWriteで、作業ディレクトリの外に新しいフォルダを作って書いたら、パスの写し間違いでないかを確かめるよう、Writeの結果に添えて伝えるMod。止めはしない。

Writeは、親のフォルダが無ければ作って成功するので、パスを1文字違えてもエラーにならない。claude-deckのワークスペースのパス（`…-xwhiteboard/emiri-0f3a`）は`-`と`/`が並び、手で組み立てて1文字違えたWriteが、ワークスペースの外にフォルダを作って成功したことがある。

## 知らせる条件

次の全部に当たるとき。

- 書く先が絶対パスで、作業ディレクトリの外
- 書く前に、親のフォルダが無かった
- 一時の置き場（`/tmp`、`/private/tmp`、`~/.claude/tmp`）でない

作業ディレクトリの外に書くこと自体は、ほかのリポジトリの文書を直すときにふつうにあるので、親のフォルダがあれば知らせない。

## 開発

```bash
claude plugin validate mods/write-guard
claude plugin test mods/write-guard
```
