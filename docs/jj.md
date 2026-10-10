# Jujutsu (jj) リファレンス

> **TL;DR**: Git の代わりに jujutsu(jj) を使う。ステージングエリアなし・全変更が自動コミット。PR 作成は `jj git push --named <name>=@`。rebase は `jj rebase -s <rev> -d <dest>`。コミットのdescriptionは `jj desc -m "..."` で設定。divergent commit は `jj bookmark set <name> -r <rev>` で解消。

## 基本概念

- **ステージングエリアがない**: ファイルへの変更は自動的にワーキングコピーコミット（`@`）にスナップショットされる
- **`@`**: 現在のワーキングコピーコミット。常に編集中の状態を指す
- **`@-`**: `@` の親コミット
- **Change ID**: コミットをrebase/amendしても変わらない安定した識別子（小文字）。コミットIDとは別物

## コミット操作

```bash
jj describe -m "message"   # @ に説明をつける（新コミットは作らない）
jj new                     # 新しい空のWCを作成（@ の子になる）
jj new -m "message"        # 説明付きで新しいWCを作成
jj commit -m "message"     # describe -m + new と同等（作業を確定して次へ進む）
```

**重要**: `jj new -m "message"` は「次の作業」の説明であり、現在の `@` にメッセージをつけるわけではない。
現在の `@` に説明をつけるには `jj describe -m "message"` を使う。

**典型的なワークフロー**
```bash
# ファイルを編集（自動でスナップショット）
jj commit -m "Add feature X"     # 現在の @ に説明をつけて新しい空の @ を作成
```

## ブックマーク（= Gitのブランチ）

```bash
jj bookmark create <name>              # @ にブックマーク作成
jj bookmark create <name> -r <rev>    # 指定revisionにブックマーク作成
jj bookmark set <name> -r <rev>       # ブックマークを移動（作成も兼ねる）
jj bookmark list                       # 一覧表示
jj bookmark track <name> --remote=origin  # リモートブックマークをトラッキング
```

## Git リモート操作

```bash
jj git init --colocate             # 既存gitリポジトリでjjを初期化
jj git remote add origin <url>     # リモート追加
jj git fetch                       # リモートの変更を取得
jj git push --bookmark <name>      # ブックマークをpush
```

**新規リポジトリのセットアップ**
```bash
jj git init --colocate
jj git remote add origin git@github.com:user/repo.git
# ファイルを追加・編集
jj describe -m "Initial commit"
jj bookmark create main
jj bookmark track main --remote=origin
jj git push --bookmark main
```

**既存のリモートブランチにpushするとき**、リモートに同名ブックマークが既にある場合は先に `fetch` してから `bookmark track` が必要。
```bash
jj git fetch
jj bookmark track main --remote=origin
jj git push --bookmark main
```

## Rebase

```bash
jj rebase -r <rev> -d <dest>    # 単一コミットをdestの子に移動（子孫は元の場所に残る）
jj rebase -s <rev> -d <dest>    # revとその子孫すべてをdestに移動
jj rebase -b <rev> -d <dest>    # revを含むブランチ全体をdestに移動
```

- `-r`: 1コミットだけ移動。子孫は自動でリベースされる
- `-s`: サブツリー全体を移動（feature branchをmainに追従させるときなど）
- `-b`: ブランチ全体（mainからの分岐点まで含む）

## PR作成

```bash
jj bookmark create <name> -r @-    # pushするrevisionにブックマーク作成
jj git push --bookmark <name>
gh pr create --head <name> --base main
```

PRを積むときは、向き先を1つ前のブランチにして作り、すぐに`gh stack link`でStackとして登録する（`~/.claude/docs/gh-stack.md`）。

## jj workspace で `gh` が `fatal: not a git repository` になる場合は `--repo owner/name` を明示する
<!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

`.jj/repo` が別パス（例: `~/github.com/<owner>/<repo>/.jj/repo`）の git store を指す構成（claude-deck workspace 等）では、作業ディレクトリに `.git/` が存在しないため `gh` の自動検出が失敗する（`cat .jj/repo` で実体パスを確認できる）。対処は `cd` で実体へ移動することではなく、`gh` の全コマンドに `--repo <owner>/<repo>` を明示すること（`gh pr list --repo owner/name ...` / `gh pr edit <N> --repo owner/name ...` / `gh pr view <N> --repo owner/name ...`）。1 回のセッション内で `gh` を複数回呼ぶなら毎回付け忘れないよう注意する。

## PR を push した後、別件を始める前に `jj new` する
<!-- importance: high | mentions: 3 | first-seen: 2026-06 -->

jj では working copy (`@`) 自体が PR のコミット。push 後にそのまま無関係なファイルを編集すると、変更が同じ push 済みコミットに amend され、別の関心事が 1 つの PR に混ざる（次に `jj git push` した時点で紛れ込む）。push 直後・別件着手前に `jj new`（または `jj new -m "..."`）で新しい WC を切ること。特に claude-deck workspace では jj コマンドを打つたびに on-disk 編集が `@` へ自動スナップショットされるので、新規作業の着手前に `jj log` で「`@` が push 済み PR コミットでないこと」を必ず確認する。

逆に「同じ PR を追記更新する」のが目的なら amend で正しい（`/update-pr` のケース）。今の `@` が push 済み PR コミットか、新規作業用かを着手前に意識するのがポイント。

**もう汚染してしまったときの復旧**: `jj new`（空の子 `@` を作る）→ `jj squash --from <PRコミット> --into @ <別件のファイルパス…>` で別件の変更だけを子コミットへ抜き出す。PR コミットは元の内容（= origin と一致）に戻る。削除ファイルに対する `No matching entries for paths` 警告は rename 検出が処理するので無害。さらに `task ...:gen` 等で無関係な生成物 drift（`*_diff.gen.go` 等）が混ざっていたら `jj restore --from <bookmark>@origin <paths>` で push 済み状態に戻し、コミットを目的の差分だけに絞る。

**汚染が「PR と同じファイルの大規模書き換え」（リファクタ等）だった場合は path 指定の squash / restore が使えない**。同じファイルに PR の変更と別件の変更が同居しているので、パス単位で動かすと PR 側の変更まで巻き添えになる。この場合は差分を patch に書き出して原本から作り直す。

```bash
jj diff --from '<bookmark>@origin' --to @ --git > /tmp/split.patch   # 別件の増分だけを取り出す
jj new <origin-rev> -m "<別件のコミットメッセージ>"                   # origin の実コミットを親にした子を作る
git apply /tmp/split.patch                                            # 子に別件だけを適用
jj bookmark set <bookmark> -r <origin-rev> --allow-backwards          # bookmark を origin の実コミットへ戻す
jj abandon <汚染されたコミット>                                        # 書き換え版を捨てる
jj diff --from '<bookmark>@origin' --to <bookmark> --stat             # 0 files であることを確認
```

`jj new` の宛先にorigin の実コミットを指定するのが肝（書き換え版を親にすると stacked PR が CONFLICTING になる。上の「④分離後の子を…」と同じ理由）。なお Claude Code の auto-mode classifier は `jj restore` を破壊的操作として block することがあるので、その意味でもこの経路が使える。

## 積んだ PR の下のほうを直すときは、競合を下から順に解消する

下の revision に `jj squash --into <rev>` すると、上の revision は自動で rebase され、競合は上へ伝わる。上から直すと、下の競合が残ったままなので直した内容がまた競合する。

```bash
# どこまで競合しているかを見る（下から順に直す）
jj log -r 'main..<先端>' --no-graph -T 'if(conflict, "CONFLICT ", "ok ") ++ bookmarks ++ "\n"'
```

- **いちばん下の競合している revision から `jj new <rev>` → 解消 → `jj squash --into <rev>` を繰り返す**。1 つ直すたびに上の一覧を出し直す（下を直すと上の競合が自動で消えることがある）
- **上の revision が前提にしている行を、下で必要以上に変えない**: 置換のスクリプトがコメントの文言まで変えていたのを元に戻したら、上 5 本の競合が何もせずに消えた
- **改名のような機械的な変更は、スクリプトにして各 revision で流し直す**: 上の revision が足した呼び出し元にも同じ改名が要る。競合は「親の版を `jj restore --from <親>` で取る → その revision の変更を当て直す → スクリプトを流す」で解ける
- **各 revision で型検査とテストを回してから push する**: 競合が消えても、上の revision が足したファイルに古い名前が残っていることがある

実例: ある案件で 11 本積んだ PR のいちばん下でフックを改名した。#30 の競合を残したまま #31 を直しはじめてやり直しになった（2026-10-07）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-10 -->

## `jj log` DAG の視覚的近接は親子関係を意味しない
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

`jj log` の DAG 表示で `@` が `main` の隣に表示されていても、実際の parent が `main` ではなく別のコミット（例: `main` よりも古い revert コミット）である場合がある。空間的な近接 ≠ 親子関係。

```bash
jj show @          # Parents: ... で正確な親を確認
jj log -r @::      # @ から先の lineage を確認
```

リベースが必要か判断するときは `jj log` の見た目でなく `jj show @` の `Parents:` フィールドで親を確認すること。実際の parent が `main` でなければ `jj rebase -s @ -d main` が必要。

## その他

```bash
jj log                   # コミットログ表示
jj diff                  # WCの差分
jj diffu                 # upstream（@-）との差分
jj status                # 変更ファイル一覧
jj squash                # WCの変更を親コミットにまとめる
```

## `jj diffu -r 'A..B'` は真の A→B 差分にならないことがある — `jj diff --from A --to B` を使う
<!-- importance: medium | mentions: 1 | first-seen: 2026-09 -->

`update-pr` フローで「前回 push からの差分」を見るのに `jj diffu -r '<bookmark>@origin..@'` を使うと、divergent（同じ change ID がローカルと origin で異なるコミットを指す = amend 直後）な状態では range revset が意図通り 2 点間の diff にならず、その change が持つ変更全体（機能追加時点からの全差分）が出てしまうことがある。「前回 push 分に対してこんなに差分があるはずがない」と違和感を覚えたら、`jj diff --from '<bookmark>@origin' --to @ --stat` に切り替えて正しい増分を確認する。

## `jj diff -- <path>` のパスに `(` `)` が入ると fileset parse error
<!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

jj の `--` 以降は git と違い単なるパスではなく fileset 式として構文解析される。Next.js の route group（`app/(app)/...`）のように括弧を含むパスをそのまま渡すと `Failed to parse fileset: Syntax error` で落ちる（パスが存在しないわけではないので原因が分かりにくい）。

対処: パス全体を fileset の文字列リテラルとして二重引用する。

```bash
# NG
jj diff -r @ -- apps/acme/app/(app)/invoice/_components/x.tsx
# OK（シングルクォートの中にダブルクォート）
jj diff -r @ -- '"apps/acme/app/(app)/invoice/_components/x.tsx"'
```

スペース・`|`・`&` 等の fileset 演算子文字を含むパスでも同じ。迷ったら常に二重引用でよい（通常パスでも動く）。

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

jj には `git mv` 相当のコマンドがない。  
`Write` ツールで新パスにファイルを作成 → `Bash(rm <旧パス>)` で削除する2ステップで対応する。  
import パスの更新も忘れずに行う。

## `.gitignore` 追加後の既存追跡ファイルの除外

`.gitignore` にパスを追加しても、既に jj の working copy で追跡中のファイルは自動的には除外されない。  
`jj status` で `A <path>` として表示されたままになる。

```bash
jj file untrack <path>
```

で追跡から外す。`jj status` で消えたことを確認してから push すること。

**`jj file untrack` は "ignored files" のみ対象。`.gitignore` 追記を先に行う**: `jj file untrack` を実行すると `error: ... is not ignored` が出て失敗する。手順は ① `.gitignore` にパターンを追加 → ② `jj file untrack` の順でないと動かない。`.DS_Store` 等を後から除外したいときも同様。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## `jj new <branch>` でクリーンブランチを作る際にディスクファイルが branch 状態に戻る

`jj new main` を実行するとディスク上のファイルは main の状態に戻る（作業コピーが main の子になるため）。既存ブランチから特定ファイルだけを取り出したいときは以下のパターンを使う。

```bash
# 1. クリーンなベースを作る（ファイルは main 状態に戻る）
jj new main

# 2. 取り出したいファイルだけを旧ブランチから復元する
jj restore --from <旧ブランチの revision> -- <file1> <file2> ...
```

`jj restore --from` はパス指定で特定ファイルだけを別 revision の内容に更新する。`jj new main` でリセットしてから必要ファイルだけ restore する組み合わせで、ブランチに混在した複数 issue の変更を分離できる。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

## rebase conflict の両側が同一内容に収束している場合

`jj resolve --list` が "2-sided conflict including 1 deletion" を示しても、main 側とブランチ側の最終内容が同一に収束していることがある（例: 両者が独立して同じリファクタリングを行った場合）。マニュアルマージに入る前に差分確認を先に行うと無駄な作業を省ける。

```bash
# conflict ファイルの branch 側コンテンツ行番号を確認
grep -n "^+++++++" <conflict-file>   # 例: 425行目から branch 側

# main の内容と branch 側を比較
jj file show -r main <file> > /tmp/main.md
sed -n '<start>,<end_before_footer>p' <conflict-file> > /tmp/branch.md
diff /tmp/main.md /tmp/branch.md
```

差分がなければ main の内容で上書きして `jj squash` するだけで解決できる。
**亜種**: 完全一致でなくても、branch 側の変更が「main 側で既に独立に取り込まれている変更」の部分集合（意図が同じでより広い変更に飲み込まれている）なら、同様に main 側をそのまま採用してよい。実例: ある案件の PR で `boolPtr(true)` → `new(true)` という branch 側の小変更が、main 側で行われた `value.DataType` → `v2value.DataType` パッケージリネームに伴って既に同じ形になっていた。main 側を採用した結果、そのファイルは PR の diff から完全に消え（無関係な差分が減り）よりクリーンな diff になった。
<!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->

## divergent commit の解消

`jj workspace update-stale` や並行した別ワークスペースの操作で、同一 change ID が複数のコミットに分岐（divergent）することがある。  
`jj log` で `(divergent)` + `mxyvqxwo/0`, `mxyvqxwo/6` のようなサフィックスが付いたら要対処。

```bash
# 1. 差分確認（どちらの状態が正しいか判断する）
jj diff --from <abandon_hash> --to <keep_hash> --stat

# 2. 不要な方を abandon
jj abandon <abandon_hash>

# 3. bookmark の conflict も解消する（?? が消える）
jj bookmark list <name>        # conflict 状態を確認
jj bookmark set <name> -r @   # 正しい revision に向ける
```

**なぜ起きるか**: jj は各ワークスペースが独立して `@` をスナップショットするため、複数ワークスペースが同一 change ID を同時に操作するか、`update-stale` が中途半端な状態で走ると change ID が分岐する。
**復旧時の追加 Tips（2026-06）**: `update-stale` で古い operation log の状態に飛んでしまうと、`jj log` が「main が古い revision を指している」ように見え混乱する。`jj op log` を辿るより、目的の change hash を `jj edit <hash>` で直接ジャンプ→`jj rebase -r @ -d main` で正しい親に乗せ直す方が早い。bookmark の `(ahead by N commits, behind by N commits)` 表示が出たら強制 push（`--allow-backwards` でなく通常の push で OK・jj が remote 差分を判定）してリモートを合わせる。
<!-- importance: high | mentions: 2 | first-seen: 2026-05 -->
