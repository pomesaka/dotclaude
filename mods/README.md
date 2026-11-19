# mods

Claude CodeのMod（`plugins/mods`）の置き場。このリポジトリをフォルダのマーケットプレイス`dotclaude`として登録し、そこから入れている。

| Mod | 内容 |
|---|---|
| `jj` | プロンプトの下の行に、jjの件数（未コミット、未push）と`commit`、`log`の札を足す。jjのログをpaneに出す |
| `danger-guard` | ClaudeがBashで実行する前に、マシンや利用者のデータを広く壊しうるコマンド（`sudo`、広い場所や大事なファイルの削除、ディスクの消去、電源、利用者のアプリを巻き込むプロセスの停止など）を止める |
| `human-edit` | 利用者にファイルを手で編集してもらう`human_edit`ツール |
| `next-step` | ターンの終わりに、利用者が次に打ちそうな文をプロンプトの上に札として並べる。先頭はClaude Code自身の案、残りは会話を分岐させて聞いた案。押すとその文が送られる |
| `questions` | Claudeが仮に決めて先へ進んだことの一覧。Claudeが`add_question`で残し、利用者がpaneで選んで答える。決める前に、会話を引き継いだ読むだけのエージェントと相談できる。プロンプトの下の行に`pending N`の札を足す |
| `pr` | このセッションで作るか直すかしたPRの一覧。CIとレビューの状態をpaneに出し、CIを見張って、マージとCIの失敗をClaudeへ知らせる。プロンプトの下の行に番号と`pr`の札を足す |
| `publish-guard` | Claudeがpushする前に、リポジトリの`scripts/check-public.sh`を走らせて、公開してはいけない名前や鍵があればpushを止める |
| `quiet-prompts` | ほかのModが自分から送った文（催促、知らせ）と、エージェントに宛てた依頼文の行を、会話の中で1行に畳む |
| `refs` | このセッションが参照した文書やURLの一覧。Claudeが`add_reference`で残し、paneに出す。プロンプトの下の行に`refs`の札を足す |
| `rich` | カード、図、質問をターミナルに描く`show`ツール |
| `status-band` | ステータス行の代わりの帯。モデル、コンテキスト、場所。ほかのModが、帯の右に自分の札を足す |
| `retro` | reのスキル（振り返り）を裏で回す。compactの直前、コミットやPRの後、直された区間の後に、会話を分岐させて発見を聞き、セッションをまたいで控えに数える。2回出た発見（または害の大きい発見）だけを、会話を持たないサブエージェントに文書へ書かせる。仕組みで防げる発見は、作る候補として控えに残す |
| `write-guard` | ClaudeのWriteが、作業ディレクトリの外に新しいフォルダを作って書いたら、パスの写し間違いでないかを確かめるよう、結果に添えて伝える |
| `check-streak` | 同じ検査（テスト、型検査、lint）が、通らないまま3回続けて落ちたら、それ以上直さずに利用者を呼ぶよう、結果に添えて伝える |
| `dotclaude-ledger` | どのセッションがdotclaudeの作業コピーに書いたかを、リポジトリの外（`~/.claude/dotclaude-ledger/`）に記録する。記録は、書いたファイル、中身の頭、そのときの依頼の文。dotclaudeのセッションが、`dotclaude-sync`のスキルで記録を読み、関心事ごとにコミットする。プロンプトの下の行に`dotclaude N`の札を足す |
| `verify-guide` | Claudeがアプリを起動したとき、リポジトリにアプリの動かし方の手順書（`.claude/skills/verify`、`verifier-*`、`run-*`）があればそれに従うよう、無ければ確かめた後に書くよう、リポジトリごとに1回伝える |
| `devrep` | 作業の状況（いましていること、次にすること、利用者がすること、自由な節）を、会話を分岐させて書かせ、paneに置く。自動更新がONなら5ターンごとに、OFFならpaneの「更新する」で書く。プロンプトの下の行に`devrep`の札を足す |

## 読み込みの仕組み

- 一覧は、リポジトリの直下の`.claude-plugin/marketplace.json`にある
- `settings.json`の`extraKnownMarketplaces.dotclaude`が、このリポジトリのフォルダを指している
- 入れたModは`settings.json`の`enabledPlugins`に`<名前>@dotclaude`として並ぶ

マーケットプレイスがフォルダで、一覧の`source`が相対パスなので、Modはコピーではなくこのフォルダから直接読まれる。`claude plugin list`の`Read from:`で確かめられる。

## 新しいマシンで使う

```bash
claude plugin marketplace add ~/github.com/pomesaka/dotclaude
claude plugin install danger-guard@dotclaude --scope user
claude plugin install human-edit@dotclaude --scope user
claude plugin install jj@dotclaude --scope user
claude plugin install next-step@dotclaude --scope user
claude plugin install questions@dotclaude --scope user
claude plugin install pr@dotclaude --scope user
claude plugin install publish-guard@dotclaude --scope user
claude plugin install quiet-prompts@dotclaude --scope user
claude plugin install refs@dotclaude --scope user
claude plugin install rich@dotclaude --scope user
claude plugin install status-band@dotclaude --scope user
claude plugin install devrep@dotclaude --scope user
claude plugin install retro@dotclaude --scope user
claude plugin install dotclaude-ledger@dotclaude --scope user
claude plugin install verify-guide@dotclaude --scope user
claude plugin install write-guard@dotclaude --scope user
claude plugin install check-streak@dotclaude --scope user
```

プロンプトの下の行に札を足すMod（`jj`、`pr`、`refs`、`questions`、`devrep`、`dotclaude-ledger`）は、`settings.json`の`enabledPlugins`で`status-band@dotclaude`より前に書く。先に書いたModが外側になり、帯の右に札を並べる。札どうしも、先に書いたものが右になる。`devrep`、`questions`、`refs`、`pr`、`jj`、`status-band`の順に書くと、帯の右に、jjの件数とボタン、PRの番号と`pr`、`refs`、`pending 1`、`devrep`の順で並ぶ。`claude plugin install`は末尾に足すので、入れた後に行を移す。

`settings.json`をこのリポジトリから引き継いでいれば、`extraKnownMarketplaces`と`enabledPlugins`はすでに入っている。パスがマシンによって違う場合は、`extraKnownMarketplaces.dotclaude.source.path`を直す。

## Modを足す

1. `mods/<名前>/`に作る。`claude plugin validate mods/<名前>`と`claude plugin test mods/<名前>`を通す
2. `.claude-plugin/marketplace.json`の`plugins`に1行足す
3. `claude plugin install <名前>@dotclaude --scope user`を実行する

## Modを直す

ファイルを編集して、セッションで`/reload-plugins`を打つ。保存しただけでは読み込み直されない。

作っている最中に、保存のたびに読み込み直したいときは、そのセッションだけ`claude --plugin-dir mods/<名前>`で起動する。同じModを入れたままだと二重になるので、`claude plugin disable <名前>@dotclaude`で止めてから使う。
