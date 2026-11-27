# Jujutsu (jj) リファレンス

> **TL;DR**: Gitの代わりにjjを使う環境で間違えやすい挙動と、PRまわりの手順。基本の操作は`jj <command> --help`で確かめる（jjは版ごとにコマンドが変わる）。

整理する前の版は`archive/2026-11-16/docs/jj.md`に、2026-11-27の整理で別の手順に置き換えた元の文は[archive/jj-2026-11-27.md](archive/jj-2026-11-27.md)にある。

## 基本操作で間違えやすい点

- **jjのコマンドは、読み取りだけのもの（`jj log`、`jj st`、`jj workspace list`）でも、走るたびに作業コピーの編集を`@`へ取り込み（スナップショット）、gitの側の変更も取り込む**: 見ただけで次のことが起きる。
  - `@`がpush済みのPRのコミットなら、その後の編集はそのコミットに入る（「PR を push した後、別件を始める前に `jj new` する」）
  - gitと併用しているリポジトリでは、届かなくなったコミットをabandonし、子孫をrebaseする（jj 0.37.0、2026-11に確認）。ほかの誰か（サンドボックスの中のエージェントなど）がgitでHEADを動かしているリポジトリを見るだけなら、`git log`、`git worktree list`のようなgitの読み取りのコマンドを使う
- `jj new -m`の説明は、新しく作る`@`に付く。いまの`@`に付けるのは`jj describe -m`。`jj commit -m`は、いまの`@`に付けて新しい空の`@`を作る
- **`jj squash -m`は、宛先の説明を置き換える**（jj 0.37.0で確認）: 宛先の説明を保つなら`-m`を付けず、`EDITOR=true jj squash ...`でエディタを開かせない。`-m`を省くと、両方の説明が空でないときにエディタが開く。`--message ""`でも元の説明は保てない。置き換えてしまったら`jj desc -r <rev> -m '<元の説明>'`で戻す
- `jj diffu`はpomesakaの別名（定義はこのリポジトリに無い）
- **リモートの無いリポジトリでは、`trunk()`が空のルート（`root()`）を指す**（jj 0.37.0、2026-11に確認）: `jj new trunk()`で作業コピーを作る仕組みは、ローカルだけのリポジトリでファイルの無い作業コピーを作る。デモや検証のためにリポジトリを作ったら、最初に`jj config set --repo 'revset-aliases."trunk()"' main`を入れ、作業コピーを作ったらファイルが入っているかを見る
- **`jj restore <path>`は、ファイルを親の版に戻す。親に無いファイル（作業コピーで新しく足したもの）は、戻らずに消える**（jj 0.37.0、2026-11に確認。「removed 1 files」と出る）: 検査が落ちるかを見るために一時的に壊したファイルを戻すときに起きやすい。壊す前に控えを取って控えから戻すか、作業コピーを書き換えない`mutation-test`のスキルで壊す。戻す前に`jj file list -r @- <path>`で、そのファイルが親にあるかを見る
- **`--`の後ろのパスは、gitと違ってfilesetの式として読まれる**: `(`、`)`、空白、`|`、`&`を含むパス（Next.jsのroute groupの`app/(app)/...`など）は`Failed to parse fileset: Syntax error`で落ちるので、`jj diff -r @ -- '"apps/acme/app/(app)/x.tsx"'`のように二重に引用する。ふつうのパスでも動く
- ファイルの名前を変えるコマンド（`git mv`に当たるもの）は無い。`mv`で動かせば、次のjjのコマンドで取り込まれる
- **`.gitignore`にパスを足しても、追跡中のファイルは外れない**: `jj file untrack <path>`で外す。`untrack`はignoredなファイルしか受け付けず、`.gitignore`に書く前に走らせると`error: ... is not ignored`で失敗するので、`.gitignore`が先

## PR作成

PRは`/create-pr`のスキルで作る。bookmarkは次の1コマンドで作ってpushする。作成、track、pushをまとめて行うので、新しいbookmarkのtrackingのエラーが出ない。

```bash
jj git push --named <name>=@
gh pr create --head <name> --base main
```

リモートに同名のbookmarkが既にあるときは、先に`jj git fetch`して`jj bookmark track <name> --remote=origin`する。

PRを積むときは、向き先を1つ前のブランチにして作り、すぐに`gh stack link`でStackとして登録する（`~/.claude/docs/gh-stack.md`）。

`.jj/repo`が別のパスのgit storeを指すワークスペース（claude-deckのワークスペースなど。実体は`cat .jj/repo`で見る）には`.git/`が無く、`gh`がリポジトリを見つけられずに`fatal: not a git repository`で止まる。`cd`で実体へ移らず、`gh`のすべてのコマンドに`--repo <owner>/<repo>`を付ける。

## PR を push した後、別件を始める前に `jj new` する

`@`がpush済みのPRのコミットのまま無関係なファイルを編集すると、編集はそのコミットに入り、次の`jj git push`でPRに混ざる。pushの後、別件を始める前に`jj new`し、新しい作業を始める前に`jj log`で、`@`がpush済みのPRのコミットでないかを見る。同じPRを追記で更新するなら、そのコミットに入ってよい（`/update-pr`）。

混ざったときの分け方は、次の節にある。

## push済みのPRに足す、分ける

push済みのPRのコミットは、originにある実コミットのまま保つ。`jj squash`と`jj restore`は、内容がoriginと同じになってもコミットを書き換える。書き換えた版を親にして積むと、差分が0でも上のPRがCONFLICTINGになる。同じPRの2つ目のコミットとして入れるときも、書き換えた版の上に積むと1つ目のコミットがforce-pushで差し替わり、CIが走り直してレビュー済みの印が消える。

混ざったものは、originの実コミットの上に子を作り、混ざった状態を丸ごと写して分ける。子の差分がpushの後の増分になるので、同じファイルに両方の変更があっても、パスを選ばずに分けられる（jj 0.37.0で確認）。混ざったコミットはoriginの版と同じ変更IDを持つ（`(divergent)`と出る）ので、コミットのIDで指す。

```bash
jj new '<bookmark>@origin'
jj restore --from <混ざったコミットのID> --into @
jj rebase -s 'children(<混ざったコミットのID>)' -d @   # 上に積んだ変更があるときだけ
jj bookmark set <bookmark> -r '<bookmark>@origin' --allow-backwards
jj abandon <混ざったコミットのID>
```

パスを指定した`jj squash --from <PRのコミット> --into @ <path>`は、そのファイルの差分を丸ごと動かすので、PRが元から足していた行まで子へ移る。

- **`jj log`でbookmarkに`*`が付いていたら、手元がoriginと違うコミットを指している**: その先に別の作業が入っていたら、`jj bookmark set <bookmark> --allow-backwards -r <PRのコミット>`で戻す。`--allow-backwards`が無いと拒否される
- **PRに足したい変更だけを入れるときは、`jj squash --from @ --into <bookmark> <paths>`で移す**: 間に別の作業があって隣り合っていないコミットの間でも動く
- **push済みのbookmarkに新しいセッションで追記すると、`@`が説明の無い子のコミットになることがある**: push済みのコミットは、jjの既定の設定でimmutableとして扱われるためだ（`jj st`の`Parent commit (@-)`がbookmarkと同じになる）。そのままpushすると、PRに説明の無いコミットが並ぶ。`EDITOR=true jj squash --from @ --into <bookmark>`でまとめてからpushする。`-m`は付けない（「基本操作で間違えやすい点」）
- 生成物の差分をpush済みの状態に戻す`jj restore --from <bookmark>@origin <paths>`は、auto-modeのclassifierが破壊的な操作として止めることがある

## 積んだPRの下がマージされたら、上を`main`へ載せ直す

下がsquash mergeされると、GitHubは上の向き先を`main`に変える。手元の上のbookmarkは下のコミットを親に持ったままなので、`jj git fetch`の後に`@`が衝突する。`jj rebase -b <上のbookmark> -d main`で載せ直し、空になった下のコミットを`jj abandon`して、`jj git push --bookmark <上のbookmark> --force`でpushする。

- fetchの前に気づいたら、`jj rebase -s <積みの根> -d main`で載せ直す。衝突は起きず、下のコミットが`(empty)`で残るので、`jj abandon`する
- 下がmerge commitでマージされたときは、下のコミットが`main`の祖先になるので、`jj rebase -s <積みの根> -d main`だけで済む。下のbookmarkが手元から消えていたら、マージされている。rebaseの途中でも、pushの前に`jj log -r '<積みの根>-'`が`main`の祖先になっていないかを見る

## 衝突を解くときの操作と印

`jj rebase`、`jj new A B`、積んだ列の下への`jj squash --into`で衝突したrevisionを解くときに当てはまる。

- **解く場所**: 衝突したrevisionの上に`jj new <衝突したrev>`で子を作り、編集して`jj squash`で親へ入れる。`jj log`で×が消えたことを見る。`@`自身が衝突したrevisionで、それを直接編集したなら`jj squash`は要らない。その`jj squash`は親（immutableなmain）へ向かうので失敗する。編集は`@`に入っているので、そのまま`jj git push`できる
- **積んだ列は、いちばん下の衝突から解く**: 下のrevisionが衝突すると、上のrevisionもすべて衝突した状態になる。`@`でファイルを解いても中間に衝突が残り、`jj git push`は`Won't push commit since it has conflicts`で拒否する。上から直すと、下の衝突が残ったまま上へ伝わり、直した内容がまた衝突する。下から`jj new <rev>`、解く、`jj squash --into <rev>`を繰り返し、1つ直すたびに次の一覧を出し直す（下を直すと上の衝突が消えることがある）

  ```bash
  jj log -r 'main..<先端>' --no-graph -T 'if(conflict, "CONFLICT ", "ok ") ++ bookmarks ++ "\n"'
  ```

  - 上のrevisionが前提にしている行を、下で必要以上に変えない。変えた分だけ、上の衝突が増える
  - 改名のような機械的な変更は、スクリプトにして各revisionで流し直す。上のrevisionが足した呼び出し元にも同じ改名が要る。衝突は「`jj restore --from <親>`で親の版を取る、そのrevisionの変更を当て直す、スクリプトを流す」で解ける
  - 1つのrevisionにまとめてよい列なら、`EDITOR=true jj squash --from <上> --into <下>`を繰り返す。`jj squash -r X --into Y`は、`-r`と`--into`を同時に指定できないので使えない（jj 0.37.0で確認）
- **解いた後、印の残りを探す**: `rg -n '^(<<<<<<<|>>>>>>>|%%%%%%%|\+\+\+\+\+\+\+)'`。jjは、差分が大きいと広い範囲を1つの衝突にまとめる。冒頭側（`<<<<<<<`から`+++++++`まで）だけをEditで置き換えると、`>>>>>>> conflict N of M ends`が離れた場所に残る。印の対が崩れるとjjは解消済みと扱うので、`jj st`は警告しない。`.md`の中の印は、biomeなどのlintにも出ない
- **`+++++++`（自分の側）の節が空なら、自分の側はそのファイルを消している**: `+++++++`と`>>>>>>>`の間に行が無ければ当たる。ファイルを`rm`して解く。残してmainの変更を取り込むと、意図した削除が気づかないうちに元に戻る
- **祖先に無いファイルを両方が足した衝突では、`%%%%%%%`の節がmainの版を表す**: 節の行はすべて`+`で始まる（空の祖先からmainの版への追加）。`+`を外した中身がmainの版で、その後の`+++++++`の行から先が自分の版
- **Editの`old_string`が印の範囲に一致しにくいときは、スクリプトで解く**: 大きいファイル（migrationのsnapshotなど）、印の中の`\\\\\\\`、Unicode、長い文字列が当たる。衝突の直前にある一意な行の位置と、`>>>>>>> conflict N of N ends`の位置をスクリプトで探し、その間を解いた中身に置き換える。最後に`<<<<<<< conflict`が0件であることを確かめる。印の文字列そのものに一致させずに済み、1つのファイルの複数の衝突を1回の書き込みで解ける

## 衝突の両側が同じ内容になっているとき

`jj resolve --list`が"2-sided conflict including 1 deletion"を示しても、main側とブランチ側の最終の中身が同じになっていることがある（両方が独立して同じリファクタリングをした場合など）。手でマージする前に、`jj file show -r main <file>`と、衝突したファイルのブランチ側の中身を比べる。差分が無いか、ブランチ側の変更がmain側に既に入った変更の部分集合なら、mainの中身で上書きして`jj squash`する。

上流のブランチの上に積んで作業し、上流がsquash mergeでmainに入った後に載せ直すと、上流が触ったファイルがすべて2-sided conflictになる。自分の側は上流の変更をそのまま含むので、衝突の中身は「上流の版」と「mainを経た上流の版」でほぼ同じだ。`jj new <衝突したrev>`、`jj restore --from main -- <パス>...`、`jj squash`の順で、印を手で消さずにmainの版へ置き換えられる。自分の側がそのファイルを独自に変えていると、その変更が消える。先に`jj diff --from <上流のbookmark> --to <自分のbookmark> -- <パス>`で、独自の変更が無いことを確かめる。

## 差分の基準点を確かめる

親や差分の基準は、グラフの見た目、`<bookmark>@origin`、範囲のrevsetから決めず、2つのrevisionを指して確かめる。どれも思った点を指さないことがある。差分がPRの説明と合わないほど大きいときは、基準点がずれている。

- **`jj log`のグラフで隣に描かれたコミットが、親とは限らない**: `@`が`main`の隣にあっても、親が別のコミット（`main`より古いrevertのコミットなど）のことがある。`├─╯`の合流は「`@`がその先のコミットと親を共有する兄弟」という意味だ。親は`jj show @`の`Parents:`か、`jj st`の`Parent commit (@-)`で見る。親が`main`でなければ`jj rebase -s @ -d main`が要る
- **branchが古いbaseから分かれたままだと、`--from <base> --to <branch>`に、後から`<base>`へ入った無関係なコミットが巻き戻しとして混ざる**: `jj git fetch`の後に`jj log -r 'fork_point(<base>@origin | <branch>)'`で分岐点を出す。分岐点がbaseの先頭より古ければ、`jj diffu --from <分岐点> --to <branch>`で取るか、rebaseしてから取る。`gh pr view <番号> --json mergeable`が`CONFLICTING`なら、古いと分かる
- **rebaseの後は、`<bookmark>@origin`が古いbaseを指したままになる**: `--from <bookmark>@origin`で取ると、`main`が進んだ分がすべて差分に出る。rebaseの後は`jj diffu --from main --to <bookmark> --stat`で見る
- **2点の間の差分は、`-r 'A..B'`でなく`--from A --to B`で取る**: amendの直後のdivergent（同じ変更IDがローカルとoriginで別のコミットを指す）な状態では、`jj diffu -r '<bookmark>@origin..@'`がその変更の全体（機能を足した時点からの差分）を出すことがある。前回のpushからの差分は`jj diff --from '<bookmark>@origin' --to @ --stat`で見る
- **`jj diff`は、衝突を解いた行を、2つの版が行の中で混ざった形で描く**: 正しい文が壊れて見える。衝突を解いた後の中身は、`jj diff`でなく`rg`とReadで実際のファイルを見る

## 1 つのファイルの変更の一部だけをコミットする（対話なし）

`jj commit <path>`はファイル単位でしか分けられない。行単位で分けたいときは、`--tool`に「コミットに入れたい中身のファイルを、差分エディタの右側へ上書きするコマンド」を渡す。作業コピーのファイルには触らないので、残りの変更はそのまま残る。

```bash
# 1. 親の版を別の場所に書き出し、コミットに入れたい変更だけを足す
jj file show -r @- settings.json > /tmp/wanted.json   # この後、Edit で必要な行だけを足す

# 2. その中身を「選んだ結果」として渡してコミットする
jj commit \
  --config 'merge-tools.pick.program="cp"' \
  --config 'merge-tools.pick.edit-args=["/tmp/wanted.json", "$right/settings.json"]' \
  --tool pick -m "..." settings.json

# 3. 入った差分と、残った差分を確かめる
jj diff --git -r @-
jj diff --stat
```

`$right`は、jjが用意する「コミット後の状態」のディレクトリ。パスを引数に付けて対象を1ファイルに絞っておく（dotclaudeの`settings.json`で確認、2026-10-10）。

## 説明の無い空の変更は、離れると消える

`jj new A B`で2つの変更を親に持つ空の変更を作り、合わせた状態を確かめた後、そのまま`jj new main`などで別の変更へ移ると、空の変更は消える。その変更IDを指した`jj restore --from <change>`は`Revision doesn't exist`で失敗し、合わせた状態を取り出せない（jj 0.37.0、2026-11に確認）。合わせた状態を取り込むなら、その変更にいる間に写すか、取り込み先を先に作ってから合わせる。

```bash
jj restore --from @ --into <取り込み先> <file1> <file2> ...
```

## divergentとstaleを解く

並行した別のワークスペースの操作や`jj workspace update-stale`で、同じ変更IDが複数のコミットに分かれる（divergent）ことがある。`jj log`に`(divergent)`と、`mxyvqxwo/0`、`mxyvqxwo/6`のような印が付く。

```bash
jj diff --from <捨てるほう> --to <残すほう> --stat   # どちらが正しいかを決める
jj abandon <捨てるほう>
jj bookmark list <name>                             # bookmarkに ?? が付いていたら
jj bookmark set <name> -r <残すほう>
```

ほかのセッションが同じリポジトリでrebaseする環境では、編集を作業コピーにだけ置いたまま長く持たない。区切りごとに`jj st`で取り込ませ、自分の変更IDを控えておけば、staleになっても編集はjjの記録の中にあり、ファイルを退避せずに変更IDで追える。

`The working copy is stale`と出たら`jj workspace update-stale`を走らせる。`update-stale`は、まだ取り込まれていない編集を分かれた片方のコミットに入れ、作業コピーを空のほうへ切り替えて、ディスク上のファイルを親の中身に戻すことがある。出力が`Working copy now at: <change>/2 … (divergent) (empty)`なら、これが起きている。親で変わったファイルが自分の編集と重ならなくても起きた（jj 0.37.0、2026-11に確認）。編集はjjの中で取り戻す。`jj log`で`(divergent)`を探し、編集の入ったほうへ`jj edit <コミットのID>`で移り、`jj rebase -r @ -d main`で正しい親へ載せ直す。`update-stale`で古いoperation logの状態に飛び、`main`が古いrevisionを指して見えるときも、`jj op log`をたどるより同じ手順のほうが早い。bookmarkに`(ahead by N commits, behind by N commits)`と出たら、ふつうの`jj git push`でリモートを合わせる（`--allow-backwards`は要らない）。

scratchpadへの写しは、取り込めなかったときの最後の手段にし、`cmp`で一致を確かめるためだけに使う。作業コピーへ丸ごと書き戻すと、ほかのセッションが親で更新したファイルを古い版で上書きするうえ、macOSの`tar`などで写すと日本語のファイル名の正規化が変わり、同じ文書が2つになる。

## ローカルの`main`が空のコミットを指しているとき

複数のワークスペースが同時に`jj git fetch`などを行うと、`Concurrent modification detected, resolving automatically`の警告とともに、ローカルの`main`が中身の無い空のコミットを指すことがある。原因は、いまのワークスペースの操作とは限らない。このまま`jj rebase -s <root> -d main`をしても、空のコミットへ載せ直すだけで、意味のある衝突が出ないか、何も変わらない。

`jj log -r main`で、`main`が`(empty)`のコミットを指し、実際の最新のmerge commit（`gh pr list --state merged`などで確かめる）と違っていたら、次の順で直す。

```bash
jj bookmark set main -r <正しいmerge commitのrev> --allow-backwards
jj abandon <空のコミットのrev>
jj rebase -s <root> -d main
```
