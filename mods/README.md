# mods

Claude CodeのMod（`plugins/mods`）の置き場。このリポジトリをフォルダのマーケットプレイス`dotclaude`として登録し、そこから入れている。

| Mod | 内容 |
|---|---|
| `jj` | プロンプトの下の行に、jjの件数（未コミット、未push）と`commit`、`log`の札を足す。jjのログをpaneに出す |
| `human-edit` | 利用者にファイルを手で編集してもらう`human_edit`ツール |
| `next-step` | ターンの終わりに、利用者が次に打ちそうな文をプロンプトの上に札として並べる。先頭はClaude Code自身の案、残りは会話を分岐させて聞いた案。押すとその文が送られる |
| `questions` | Claudeが仮に決めて先へ進んだことの一覧。Claudeが`add_question`で残し、利用者がpaneで選んで答える。決める前に、会話を引き継いだ読むだけのエージェントと相談できる。プロンプトの下の行に`pending N`の札を足す |
| `pr` | このセッションで作るか直すかしたPRの一覧。CIとレビューの状態をpaneに出し、CIを見張って、マージとCIの失敗をClaudeへ知らせる。プロンプトの下の行に番号と`pr`の札を足す |
| `publish-guard` | Claudeがpushする前に、リポジトリの`scripts/check-public.sh`を走らせて、公開してはいけない名前や鍵があればpushを止める |
| `refs` | このセッションが参照した文書やURLの一覧。Claudeが`add_reference`で残し、paneに出す。プロンプトの下の行に`refs`の札を足す |
| `rich` | カード、図、質問をターミナルに描く`show`ツール |
| `status-band` | ステータス行の代わりの帯。モデル、コンテキスト、場所。ほかのModが、帯の右に自分の札を足す |
| `devrep` | ONにしたセッションで、Claudeが作業の状況（いましていること、次にすること、自由な節）を書いてpaneに置く`update_devrep`ツール。5ターン書き直しが無いと催促する |

## 読み込みの仕組み

- 一覧は、リポジトリの直下の`.claude-plugin/marketplace.json`にある
- `settings.json`の`extraKnownMarketplaces.dotclaude`が、このリポジトリのフォルダを指している
- 入れたModは`settings.json`の`enabledPlugins`に`<名前>@dotclaude`として並ぶ

マーケットプレイスがフォルダで、一覧の`source`が相対パスなので、Modはコピーではなくこのフォルダから直接読まれる。`claude plugin list`の`Read from:`で確かめられる。

## 新しいマシンで使う

```bash
claude plugin marketplace add ~/github.com/pomesaka/dotclaude
claude plugin install human-edit@dotclaude --scope user
claude plugin install jj@dotclaude --scope user
claude plugin install next-step@dotclaude --scope user
claude plugin install questions@dotclaude --scope user
claude plugin install pr@dotclaude --scope user
claude plugin install publish-guard@dotclaude --scope user
claude plugin install refs@dotclaude --scope user
claude plugin install rich@dotclaude --scope user
claude plugin install status-band@dotclaude --scope user
claude plugin install devrep@dotclaude --scope user
```

プロンプトの下の行に札を足すMod（`jj`、`pr`、`refs`、`questions`）は、`settings.json`の`enabledPlugins`で`status-band@dotclaude`より前に書く。先に書いたModが外側になり、帯の右に札を並べる。札どうしも、先に書いたものが右になる。`questions`、`refs`、`pr`、`jj`、`status-band`の順に書くと、帯の右に、jjの件数とボタン、PRの番号と`pr`、`refs`、`pending 1`の順で並ぶ。`claude plugin install`は末尾に足すので、入れた後に行を移す。

`settings.json`をこのリポジトリから引き継いでいれば、`extraKnownMarketplaces`と`enabledPlugins`はすでに入っている。パスがマシンによって違う場合は、`extraKnownMarketplaces.dotclaude.source.path`を直す。

## Modを足す

1. `mods/<名前>/`に作る。`claude plugin validate mods/<名前>`と`claude plugin test mods/<名前>`を通す
2. `.claude-plugin/marketplace.json`の`plugins`に1行足す
3. `claude plugin install <名前>@dotclaude --scope user`を実行する

## Modを直す

ファイルを編集して、セッションで`/reload-plugins`を打つ。保存しただけでは読み込み直されない。

作っている最中に、保存のたびに読み込み直したいときは、そのセッションだけ`claude --plugin-dir mods/<名前>`で起動する。同じModを入れたままだと二重になるので、`claude plugin disable <名前>@dotclaude`で止めてから使う。
