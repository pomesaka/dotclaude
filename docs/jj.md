# Jujutsu (jj) リファレンス

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

**重要**: `jj new -m "message"` は「次の作業」の説明であり、**現在の `@` にメッセージをつけるわけではない**。
現在の `@` に説明をつけるには `jj describe -m "message"` を使う。

**典型的なワークフロー**:
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

**新規リポジトリのセットアップ**:
```bash
jj git init --colocate
jj git remote add origin git@github.com:user/repo.git
# ファイルを追加・編集
jj describe -m "Initial commit"
jj bookmark create main
jj bookmark track main --remote=origin
jj git push --bookmark main
```

**既存のリモートブランチにpushするとき**、リモートに同名ブックマークが既にある場合は先に `fetch` してから `bookmark track` が必要:
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

## PR を push した後、別件を始める前に `jj new` する
<!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

jj では **working copy (`@`) 自体が PR のコミット**。push 後にそのまま無関係なファイルを編集すると、変更が**同じ push 済みコミットに amend され**、別の関心事が 1 つの PR に混ざる（次に `jj git push` した瞬間に紛れ込む）。push 直後・別件着手前に `jj new`（または `jj new -m "..."`）で新しい WC を切ること。

逆に「同じ PR を追記更新する」のが目的なら amend で正しい（`/update-pr` のケース）。**今の `@` が push 済み PR コミットか、新規作業用かを着手前に意識する**のがポイント。

## その他

```bash
jj log                   # コミットログ表示
jj diff                  # WCの差分
jj diffu                 # upstream（@-）との差分
jj status                # 変更ファイル一覧
jj squash                # WCの変更を親コミットにまとめる
```

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

## rebase conflict の両側が同一内容に収束している場合

`jj resolve --list` が "2-sided conflict including 1 deletion" を示しても、main 側とブランチ側の最終内容が**同一**に収束していることがある（例: 両者が独立して同じリファクタリングを行った場合）。マニュアルマージに入る前に差分確認を先に行うと無駄な作業を省ける。

```bash
# conflict ファイルの branch 側コンテンツ行番号を確認
grep -n "^+++++++" <conflict-file>   # 例: 425行目から branch 側

# main の内容と branch 側を比較
jj file show -r main <file> > /tmp/main.md
sed -n '<start>,<end_before_footer>p' <conflict-file> > /tmp/branch.md
diff /tmp/main.md /tmp/branch.md
```

差分がなければ main の内容で上書きして `jj squash` するだけで解決できる。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

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
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
