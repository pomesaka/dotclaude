# refs

このセッションが参照した文書やURLの一覧を、paneに出すMod。Claudeが、何が分かったかの一言つきで残す。あとで出どころをたどるためのもの。

一覧に1件以上あると、プロンプトの下の行の右に`refs`の札が出る。押すと一覧のpaneが開く。コマンドを通さずに直接開くので、Claudeが作業している最中でもすぐ出る。

## 読み込み

マーケットプレイス`dotclaude`から入れる。手順は`mods/README.md`にある。

## プロンプトの下の行

この行は、複数のModが重ねて描く。`refs`は、下の層（エンジンの元の表示、`status-band`の帯）が描いたものを受け取り、その右に札を1つ足して返す。ほかのModの中身は知らない。`status-band`が入っていなくても、札は出る。

```
opus   ━━━━━───── 47%   ~/…/dotclaude   ● 14   ↑ 1          commit  diff  log   refs
```

**`settings.json`の`enabledPlugins`で、`refs@dotclaude`を`status-band@dotclaude`より前に書く。** 先に書いたModが外側になる。`claude plugin install`は末尾に足すので、入れた後に行を移す。後ろにあると、`refs`が内側になり、札が帯の右でなく、帯の下の行に出る。

包み方には決まりがある（Claude Code 2.1.296で確認）。

- 下の層の木は、`width`を付けていない`Box`の中に置く。`width`を付けると、エンジンが重ねたhookの全部を捨てて、元の表示だけを描く。ほかのModの帯も消える
- 下の層へ渡す幅（`viewport`）は書き換えられない。幅を指定しなくても、下の層の箱は、足した札の分だけ縮む

## 一覧

```
Mods reference                                                  ×
ui.render の戻り値の形
https://code.claude.com/docs/en/plugins/mods/reference
```

| 入り方 | 題名と一言 |
|---|---|
| Claudeが`add_reference`ツール（`mcp__refs__add_reference`）で残す | 付く。Claudeが書く |
| WebFetchで読んだURL | 付かない。URLだけが自動で入る |
| Bashで`portless <名前> <コマンド>`の形で起動したサーバー（difitもこの形） | 付く。題名は名前、URLは`https://<名前>.localhost` |
| Writeで`tmp`の下に書いたHTML（`explain`のページなど） | 付く。題名はファイルの名前 |

下の2つは根拠の文書ではなく、利用者が開き直す画面だ。サーバーはバックグラウンドで起動するので、URLは出力ではなくコマンドの名前から作る。名前を書かない起動（`portless`、`portless run`）、jjのワークスペースで付く接頭辞、`--tld`には対応していない。

自動で入った分に一言を足したいときは、Claudeが同じURLで`add_reference`を呼ぶ。同じURLは1つにまとまり、先頭に上がる。あとから空で上書きされることはない（同じページをもう一度WebFetchしても、足した一言は残る）。

`add_reference`が受け取るのは、URLかファイルのパス、題名、一言。対象は、答えや設計の根拠にしたWebのページ、ほかのリポジトリのファイル、編集しているコードの外にあるローカルの文書。編集中のファイルは残さない。

開けなくなった参照は、Claudeが`remove_reference`ツール（`mcp__refs__remove_reference`）にURLを渡して外す。difitは利用者がブラウザを閉じるとプロセスが終わり、URLが開けなくなる。終わったことを知らされるのはClaudeなので、Claudeの側に外す手段を持たせている。

一覧を空にするには、paneの「全部外す」を押すか、Claudeに頼む。Claudeは`clear_references`ツール（`mcp__refs__clear_references`）で全部を外す。「全部外す」は取り消せないので、キーを割り当てず、クリックだけにしている。

## paneの操作

選んでいる行には`▸`が付く。キーで動かす。

| キー | 動き |
|---|---|
| `j` / `k` | 下の行、上の行を選ぶ。端では止まる |
| `o` | 選んでいる行をブラウザで開く。`http`と`https`のURLと、絶対パスのHTMLだけ。ほかのファイルのパスでは出ない |
| `x` | 選んでいる行を一覧から外す |
| `y` | 選んでいる1件を、Markdownの1行でコピーする |
| `a` | 一覧の全部を、Markdownの箇条書きでコピーする。PRの本文やメモに貼る用 |
| `q` | 閉じる |

題名と`×`は、クリックでも押せる。「全部外す」はクリックだけで押す。

一覧は、paneに収まる分だけを描く。選んでいる行の前後を出し、はみ出した分は「↑ あと 3 件」「↓ あと 5 件」と件数で示す。キーのヒント（下の2行のボタン）が、一覧に押されて流れないようにするためだ。一言は、選んでいる行だけ全文を出し、ほかの行は1行に切る。

全部のコピーが`Y`でなく`a`なのは、ボタンのhotkeyに大文字を書けないため。Shiftを押しても小文字と同じ扱いになり、`y`と区別できない。

## 保存

一覧はセッションごとに`$.store`へ残す（キーは`refs:<セッションID>`）。セッションを開き直すと戻る。覚えるのは1セッションあたり100件、セッションは30個までで、どちらも古いものから消える。

## Claudeへの説明

セッションの始めに、`hooks/context.ts`の`SESSION_CONTEXT`をClaudeへ渡す。一覧に残すもの、自動で入るもの、外すとき、空にするときを書いてある。起動、再開、fork、`/clear`、compactのたびに渡す。サブエージェントには渡さない。

**仕様を変えたら、`SESSION_CONTEXT`も直す。**

## 開発

```bash
claude plugin validate mods/refs
claude plugin test mods/refs
```

`hooks/cursor.ts`は、`status-band`の同じ名前のファイルと同じ中身だ。Modは1つずつ入れる単位なので、ほかのModのファイルは読み込まず、写しを持っている。
