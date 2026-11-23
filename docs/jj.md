# Jujutsu (jj) リファレンス

> **TL;DR**: Git の代わりに jj を使う環境で踏んだ罠と、PR まわりの手順。基本の操作は `jj <command> --help` で確かめる（jj は版ごとにコマンドが変わる）。

整理する前の版は `archive/2026-11-16/docs/jj.md` にある。

## 基本操作で間違えやすい点

- `jj new -m "message"` の説明は「次の作業」に付く。いまの `@` に説明を付けるのは `jj describe -m "message"`。`jj commit -m` は、いまの `@` に説明を付けて新しい空の `@` を作る
- `jj diffu` はこの利用者の別名（定義はこのリポジトリに無い）
- **リモートの無いリポジトリでは、`trunk()` が空のルート（`root()`）を指す**: `trunk()` はリモートの既定のブランチを指す別名で、リモートが無いと `root()` に解決する（jj 0.37.0、2026-11に確認）。`jj new trunk()` で作業コピーを作る仕組みは、ローカルだけのリポジトリでファイルの無い作業コピーを作る。デモや検証のためにリポジトリを作ったら、最初に `jj config set --repo 'revset-aliases."trunk()"' main` を入れる。作業コピーを作ったら、まずファイルが入っているかを見る
- **ほかの誰かが git で操作しているリポジトリを見るだけなら、jj でなく git の読み取りのコマンド（`git log`、`git worktree list`）を使う**: git と jj を併用しているリポジトリでは、`jj workspace list` のような読み取りのコマンドでも、走るたびに git の変更を取り込み、届かなくなったコミットを abandon し、子孫を rebase する（jj 0.37.0、2026-11に確認）。サンドボックスの中のエージェントが git で HEAD を動かしているリポジトリでは、調べただけで相手の履歴が書き換わる。判断基準は「書き換える気の無い調査で、jj の取り込みを起こしてよいか」

## PR作成

PRは`/create-pr`のスキルで作る。bookmarkは次の1コマンドで作ってpushする。bookmarkの作成、track、pushをまとめて行うので、新しいbookmarkのtrackingのエラーが出ない。

```bash
jj git push --named <name>=@
gh pr create --head <name> --base main
```

リモートに同名のブックマークが既にあるときは、先に `jj git fetch` して `jj bookmark track <name> --remote=origin` する。

PRを積むときは、向き先を1つ前のブランチにして作り、すぐに`gh stack link`でStackとして登録する（`~/.claude/docs/gh-stack.md`）。

## jj workspace で `gh` が `fatal: not a git repository` になる場合は `--repo owner/name` を明示する

`.jj/repo` が別パス（例: `~/github.com/<owner>/<repo>/.jj/repo`）の git store を指す構成（claude-deck workspace 等）では、作業ディレクトリに `.git/` が存在しないため `gh` の自動検出が失敗する（`cat .jj/repo` で実体パスを確認できる）。対処は `cd` で実体へ移動することではなく、`gh` の全コマンドに `--repo <owner>/<repo>` を明示すること（`gh pr list --repo owner/name ...` / `gh pr edit <N> --repo owner/name ...` / `gh pr view <N> --repo owner/name ...`）。

## PR を push した後、別件を始める前に `jj new` する

jj では working copy (`@`) 自体が PR のコミット。push 後にそのまま無関係なファイルを編集すると、変更が同じ push 済みコミットに amend され、別の関心事が 1 つの PR に混ざる（次に `jj git push` した時点で紛れ込む）。push の後、別件を始める前に `jj new` で新しい WC を切る。claude-deck workspace では jj コマンドを打つたびに on-disk 編集が `@` へ自動スナップショットされるので、新しい作業を始める前に、`@` が push 済みの PR のコミットでないかを `jj log` で見る。

「同じ PR を追記更新する」のが目的なら amend で正しい（`/update-pr` のケース）。

混ざってしまったら、`jj new` で子を作り、別件のファイルだけ `jj squash --from <PRコミット> --into @ <パス>` で移す。PR コミットは origin と同じ内容に戻る。同じファイルに両方の変更があるときはパス単位で動かせないので、`jj diff --from '<bookmark>@origin' --to @ --git` を patch に書き出し、`jj new <origin の実コミット>` で作った子に `git apply` で当て直す。その後 `jj bookmark set <bookmark> -r <origin の実コミット> --allow-backwards` でブックマークを戻し、混ざったコミットを `jj abandon` する。親には origin の実コミットを指定する（書き換えた版を親にすると、積んだ PR が CONFLICTING になる）。生成物の drift を push 済みの状態に戻す `jj restore --from <bookmark>@origin <paths>` は、auto-mode classifier が破壊的操作として block することがある。

## push済みのPRに足す、分ける

jjは作業コピーの編集を、知らせずに`@`のコミットへ入れる。push済みのPRのコミットに別の変更が混ざったとき、またはPRに足したい変更が別のコミットにあるときの操作。

- **パスを指定した`jj squash --from @- --into @ <path>`は、push済みのコミットが元から足していたファイルも丸ごと子へ移す**: pushの後の増分だけを移すときは、squashの後に`jj restore --from <bookmark>@origin --to <bookmark> -- <path>`でbookmarkの側をoriginの状態に戻し、子で増分を当て直す。
- **分けた子をpushする前に、`jj rebase -r <child> -d '<bookmark>@origin'`でoriginの実コミットへ載せ替える**: squashとrestoreは、内容がoriginと同じでもコミットを書き換える。書き換えた版を親にしたまま積むと、差分が0でもPRがCONFLICTINGになる。同じPRの2つ目のコミットとして入れるときも同じで、載せ替えないと1つ目のコミットがforce-pushで差し替わり、CIが走り直してレビュー済みの印が消える。載せ替えた後は`jj bookmark set <bookmark> -r <rev> --allow-backwards`でbookmarkを合わせ、書き換えた版を`jj abandon`する。
- **`jj log`でbookmarkに`*`が付いていたら、手元がoriginと違うコミットを指している**: その先に別の作業が入っていたら、`jj bookmark set <bookmark> --allow-backwards -r <PRのコミット>`で戻す。`--allow-backwards`が無いと拒否される。
- **`@`がbookmarkより上にあり、間に別の作業があるときは、`jj squash --from @ --into <bookmark> <paths>`でPRに入れるファイルだけを移す**: 隣り合っていないコミットの間でもsquashできる。
- **push済みのbookmarkに新しいセッションで追記すると、`@`が説明の無い子のコミットになることがある**: push済みのコミットは、jjの既定の設定でimmutableとして扱われるためだ（`jj st`の`Parent commit (@-)`がbookmarkと同じになる）。そのままpushすると、PRに説明の無いコミットが並ぶ。`EDITOR=true jj squash --from @ --into <bookmark名>`でbookmarkのコミットへまとめてからpushする。`-m`は付けない。付けると、bookmarkのコミットの説明が上書きされる。

## 積んだPRの下がマージされたら、上を`main`へ載せ直す

下がsquash mergeされると、GitHubは上のbaseを`main`に変える。手元の上のbookmarkは下のコミットを親に持ったままなので、`jj git fetch`の後に`@`が衝突する。`jj rebase -b <上のbookmark> -d main`で載せ直し、空になった下のコミットを`jj abandon`して、`jj git push --bookmark <上のbookmark> --force`でpushする。

- fetchの前に気づいたら、`jj rebase -s <積みの根> -d main`で載せ直す。衝突は起きず、下のコミットが`(empty)`で残るので、`jj abandon`する。
- 下がmerge commitでマージされたときは、下のコミットが`main`の祖先になるので、`jj rebase -s <積みの根> -d main`だけで済む。下のbookmarkが手元から消えていたら、マージされている。rebaseの途中でも、pushの前に`jj log -r '<積みの根>-'`が`main`の祖先になっていないかを見る。

## 積んだ PR の下のほうを直すときは、競合を下から順に解消する

下の revision に `jj squash --into <rev>` すると、上の revision は自動で rebase され、競合は上へ伝わる。上から直すと、下の競合が残ったままなので直した内容がまた競合する。

```bash
# どこまで競合しているかを見る（下から順に直す）
jj log -r 'main..<先端>' --no-graph -T 'if(conflict, "CONFLICT ", "ok ") ++ bookmarks ++ "\n"'
```

- いちばん下の競合している revision から `jj new <rev>` → 解消 → `jj squash --into <rev>` を繰り返す。1 つ直すたびに上の一覧を出し直す（下を直すと上の競合が自動で消えることがある）
- 上の revision が前提にしている行を、下で必要以上に変えない（置換のスクリプトがコメントの文言まで変えていたのを元に戻したら、上の競合が何もせずに消えた）
- 改名のような機械的な変更は、スクリプトにして各 revision で流し直す。上の revision が足した呼び出し元にも同じ改名が要る。競合は「親の版を `jj restore --from <親>` で取る → その revision の変更を当て直す → スクリプトを流す」で解ける

## 衝突を解くときの操作と印

`jj rebase`や`jj new A B`で衝突したrevisionを解くときに当てはまる。

- **解く場所**: 衝突したrevisionの上に`jj new <衝突したrev>`で子を作り、編集して`jj squash`で親へ入れる。`jj log`で×が消えたことを見る。`@`自身が衝突したrevisionで、それを直接編集したなら`jj squash`は要らない。その`jj squash`は親（immutableなmain）へ向かうので失敗する。編集は`@`に入っているので、そのまま`jj git push`できる。
- **`jj squash -m "..."`は、宛先の説明を置き換える**: 意味のある説明を持つrevisionへ入れた後は、`jj desc -r <rev> -m '<元の説明>'`で戻す。`-m`を省くと、両方の説明が空でないときにエディタが開く。`EDITOR=true`を付けると開かない。`--message ""`では元の説明を保てない。
- **列を載せ直して下が衝突すると、上もすべて衝突した状態になる**: `@`でファイルを解いても、中間のrevisionに衝突が残り、`jj git push`は`Won't push commit since it has conflicts`で拒否する。上の「積んだ PR の下のほうを直すときは、競合を下から順に解消する」のとおりに解く。1つのrevisionにまとめてよい列なら、`EDITOR=true jj squash --from <上> --into <下>`を繰り返す。`jj squash -r X --into Y`は使えない（`-r`と`--into`は同時に指定できない）。
- **解いた後、印の残りを探す**: `rg -n '^(<<<<<<<|>>>>>>>|%%%%%%%|\+\+\+\+\+\+\+)'`。jjは、差分が大きいと広い範囲を1つの衝突にまとめる。冒頭側（`<<<<<<<`から`+++++++`まで）だけをEditで置き換えると、`>>>>>>> conflict N of M ends`が離れた場所に残る。印の対が崩れるとjjは解消済みと扱うので、`jj st`は警告しない。`.md`の中の印は、biomeなどのlintにも出ない。
- **`+++++++`（自分の側）の節が空なら、自分の側はそのファイルを消している**: `+++++++`と`>>>>>>>`の間に行が無ければ当たる。ファイルを`rm`して解く。残してmainの変更を取り込むと、意図した削除が気づかないうちに元に戻る。
- **祖先に無いファイルを両方が足した衝突では、`%%%%%%%`の節がmainの版を表す**: 節の行はすべて`+`で始まる（空の祖先からmainの版への追加）。`+`を外した中身がmainの版で、その後の`+++++++`の行から先が自分の版。migrationのsnapshotのような大きいファイルは、ReadとWriteでなく、スクリプトで読み書きする。
- **印の中に`\\\\\\\`、Unicode、長い文字列があるときは、スクリプトで解く**: Editの`old_string`は完全に一致しないと当たらず、こういう衝突では一致しにくい。衝突の直前にある一意な行の位置と、`>>>>>>> conflict N of N ends`の位置を`find`で取り、その間を解いた中身に置き換える。最後に`<<<<<<< conflict`が0件であることを確かめる。印の文字列そのものに一致させずに済み、1つのファイルの複数の衝突を1回の書き込みで解ける。

## `jj log` DAG の視覚的近接は親子関係を意味しない

`jj log` の DAG 表示で `@` が `main` の隣に表示されていても、実際の parent が `main` ではなく別のコミット（例: `main` よりも古い revert コミット）である場合がある。リベースが要るかは、`jj log` の見た目でなく `jj show @` の `Parents:` か、`jj st` の `Parent commit (@-)` で判断する。graph の `├─╯` の合流は「`@` がその先のコミットと親を共有する兄弟」という意味で、合流の行のすぐ上に見えるコミットが `@` の親とは限らない。実際の parent が `main` でなければ `jj rebase -s @ -d main` が必要。

## 差分の基準点を確かめる

差分がPRの説明と合わないほど大きいときは、基準点がずれている。

- **branchが古いbaseから分かれたままだと、`--from <base> --to <branch>`に、後から`<base>`へ入った無関係なコミットが巻き戻しとして混ざる**: `jj git fetch`の後に`jj log -r 'fork_point(<base>@origin | <branch>)'`で分岐点を出す。分岐点がbaseの先頭より古ければ、`jj diffu --from <分岐点> --to <branch>`で取るか、rebaseしてから取る。`gh pr view <番号> --json mergeable`が`CONFLICTING`なら、古いと分かる。
- **rebaseの後は、`<bookmark>@origin`が古いbaseを指したままになる**: `--from <bookmark>@origin`で取ると、`main`が進んだ分がすべて差分に出る。rebaseの後は`jj diffu --from main --to <bookmark> --stat`で見る。
- **`jj diff`は、衝突を解いた行を、2つの版が行の中で混ざった形で描く**: 正しい文が壊れて見える。衝突を解いた後の中身は、`jj diff`でなく`rg`とReadで実際のファイルを見る。

## `jj diffu -r 'A..B'` は真の A→B 差分にならないことがある。`jj diff --from A --to B` を使う

`update-pr` フローで「前回 push からの差分」を見るのに `jj diffu -r '<bookmark>@origin..@'` を使うと、divergent（同じ change ID がローカルと origin で異なるコミットを指す = amend 直後）な状態では range revset が意図通り 2 点間の diff にならず、その change が持つ変更全体（機能追加時点からの全差分）が出てしまうことがある。前回 push 分との差分が多すぎると感じたら、`jj diff --from '<bookmark>@origin' --to @ --stat` に切り替える。

## `jj diff -- <path>` のパスに `(` `)` が入ると fileset parse error

jj の `--` 以降は git と違い単なるパスではなく fileset 式として構文解析される。Next.js の route group（`app/(app)/...`）のように括弧を含むパスをそのまま渡すと `Failed to parse fileset: Syntax error` で落ちる。パス全体を fileset の文字列リテラルとして二重引用する。

```bash
# OK（シングルクォートの中にダブルクォート）
jj diff -r @ -- '"apps/acme/app/(app)/invoice/_components/x.tsx"'
```

スペース・`|`・`&` 等の fileset 演算子文字を含むパスでも同じ。通常パスでも動くので、迷ったら二重引用でよい。

## 1 つのファイルの変更の一部だけをコミットする（対話なし）

`jj commit <path>` はファイル単位でしか分けられない。行単位で分けたいときは、`--tool` に「コミットに入れたい中身のファイルを、差分エディタの右側へ上書きするコマンド」を渡す。作業コピーのファイルには触らないので、残りの変更はそのまま残る。

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

`$right` は、jj が用意する「コミット後の状態」のディレクトリ。パスを引数に付けて対象を 1 ファイルに絞っておく（dotclaude の `settings.json` で確認、2026-10-10）。

## ファイルリネーム

jj には `git mv` 相当のコマンドがない。`Write` ツールで新パスにファイルを作成 → `Bash(rm <旧パス>)` で削除する2ステップで対応する。

## `.gitignore` 追加後の既存追跡ファイルの除外

`.gitignore` にパスを追加しても、既に jj の working copy で追跡中のファイルは自動的には除外されず、`jj status` で `A <path>` として表示されたままになる。`jj file untrack <path>` で追跡から外す。

`jj file untrack` が対象にするのは ignored なファイルだけで、`.gitignore` に書く前に実行すると `error: ... is not ignored` で失敗する。① `.gitignore` にパターンを追加 → ② `jj file untrack` の順で行う。

## `jj new <branch>` でクリーンブランチを作る際にディスクファイルが branch 状態に戻る

`jj new main` を実行するとディスク上のファイルは main の状態に戻る（作業コピーが main の子になるため）。ブランチに混在した複数 issue の変更を分けたいときは、`jj new main` の後に、必要なファイルだけを旧ブランチから復元する。

```bash
jj new main
jj restore --from <旧ブランチの revision> -- <file1> <file2> ...
```

## 説明の無い空の変更は、離れると消える

`jj new A B` で 2 つの変更を親に持つ空の変更を作り、合わせた状態を確かめた後、そのまま `jj new main` などで別の変更へ移ると、空の変更は消える。その change ID を指した `jj restore --from <change>` は `Revision doesn't exist` で失敗し、合わせた状態を取り出せない（jj 0.37.0、2026-11に確認）。合わせた状態を取り込むなら、その変更にいる間に写すか、取り込み先を先に作ってから合わせる。

```bash
jj restore --from @ --into <取り込み先> <file1> <file2> ...
```

## rebase conflict の両側が同一内容に収束している場合

`jj resolve --list` が "2-sided conflict including 1 deletion" を示しても、main 側とブランチ側の最終内容が同じになっていることがある（両者が独立して同じリファクタリングを行った場合など）。手でマージする前に、`jj file show -r main <file>` の内容と、conflict ファイルの branch 側の内容を比べる。差分がなければ main の内容で上書きして `jj squash` するだけで解決できる。

完全一致でなくても、branch 側の変更が「main 側で既に独立に取り込まれている変更」の部分集合なら、同じく main 側をそのまま採用してよい。

上流のブランチの上に積んで作業し、上流がsquash mergeでmainに入った後に載せ直すと、上流が触ったファイルがすべて2-sided conflictになる。自分の側は上流の変更をそのまま含むので、衝突の中身は「上流の版」と「mainを経た上流の版」でほぼ同じだ。`jj new <衝突したrev>` → `jj restore --from main -- <パス>...` → `jj squash`で、印を手で消さずにmainの版へ置き換えられる。自分の側がそのファイルを独自に変えていると、その変更が消える。先に`jj diff --from <上流のbookmark> --to <自分のbookmark> -- <パス>`で、独自の変更が無いことを確かめる。

## divergent commit の解消

`jj workspace update-stale` や並行した別ワークスペースの操作で、同一 change ID が複数のコミットに分岐（divergent）することがある。`jj log` で `(divergent)` + `mxyvqxwo/0`, `mxyvqxwo/6` のようなサフィックスが付いたら対処する。

```bash
# 1. 差分確認（どちらの状態が正しいか判断する）
jj diff --from <abandon_hash> --to <keep_hash> --stat

# 2. 不要な方を abandon
jj abandon <abandon_hash>

# 3. bookmark の conflict も解消する（?? が消える）
jj bookmark list <name>        # conflict 状態を確認
jj bookmark set <name> -r @   # 正しい revision に向ける
```

jj は各ワークスペースが独立して `@` をスナップショットするため、複数ワークスペースが同一 change ID を同時に操作するか、`update-stale` が中途半端な状態で走ると change ID が分岐する。

ほかのセッションが同じリポジトリで rebase する環境では、編集を作業コピーにだけ置いたまま長く持たない。区切りごとに `jj st` でスナップショットを取り、自分の変更IDを控えておけば、stale になっても編集はjjの記録の中にあり、ファイルを退避せずに変更IDで追える。`The working copy is stale` と出たら `jj workspace update-stale` を走らせる。`update-stale` は、まだスナップショットされていない編集を分岐した片方のコミットに取り込み、作業コピーを空のほうへ切り替えて、ディスク上のファイルを親の内容に戻すことがある。出力が `Working copy now at: <change>/2 … (divergent) (empty)` なら、これが起きている。親で変わったファイルが自分の編集と重ならなくても起きた（jj 0.37.0、2026-11に確認）。編集はjjの中で取り戻す。`jj log` で `(divergent)` を探し、編集の入ったほうへ `jj edit <commit hash>` で移り、載せ直された親へ `jj rebase` する。scratchpad への写しは、スナップショットを取れなかったときの最後の手段にし、`cmp` で一致を確かめるためだけに使う。作業コピーへ丸ごと書き戻すと、ほかのセッションが親で更新したファイルを古い版で上書きするうえ、macOSの `tar` などで写すと日本語のファイル名の正規化が変わり、同じ文書が2つになる。

`update-stale` で古い operation log の状態に飛ぶと、`jj log` で main が古い revision を指しているように見える。`jj op log` を辿るより、目的の change hash へ `jj edit <hash>` で移り、`jj rebase -r @ -d main` で正しい親に乗せ直す方が早い。bookmark に `(ahead by N commits, behind by N commits)` と出たら、通常の `jj git push` でリモートを合わせる（`--allow-backwards` は要らない）。

## ローカルの`main`が空のコミットを指しているとき

複数のワークスペースが同時に`jj git fetch`などを行うと、`Concurrent modification detected, resolving automatically`の警告とともに、ローカルの`main`が中身のない空のコミットを指すことがある。原因は、いまのワークスペースの操作とは限らない。このまま`jj rebase -s <root> -d main`をしても、空のコミットへ載せ直すだけで、意味のある衝突が出ないか、何も変わらない。

`jj log -r main`で、`main`が`(empty)`のコミットを指し、実際の最新のmerge commit（`gh pr list --state merged`などで確かめる）と違っていたら、次の順で直す。

```bash
jj bookmark set main -r <正しいmerge commitのrev> --allow-backwards
jj abandon <空のコミットのrev>
jj rebase -s <root> -d main
```
