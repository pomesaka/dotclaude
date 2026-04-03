## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用

## Version Control (Jujutsu)

### 基本概念

- **ステージングエリアがない**: ファイルへの変更は自動的にワーキングコピーコミット（`@`）にスナップショットされる
- **`@`**: 現在のワーキングコピーコミット。常に編集中の状態を指す
- **`@-`**: `@` の親コミット
- **Change ID**: コミットをrebase/amendしても変わらない安定した識別子（小文字）。コミットIDとは別物

### 重要: コミット操作はユーザー指示があるまで自律的に行わない

`jj commit`, `jj new` などのコミット操作は、ユーザーから明示的に指示があるか、`/jjcommit` や `/jjdesc` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

### コミット操作

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

### ブックマーク（= Gitのブランチ）

```bash
jj bookmark create <name>              # @ にブックマーク作成
jj bookmark create <name> -r <rev>    # 指定revisionにブックマーク作成
jj bookmark set <name> -r <rev>       # ブックマークを移動（作成も兼ねる）
jj bookmark list                       # 一覧表示
jj bookmark track <name> --remote=origin  # リモートブックマークをトラッキング
```

### Git リモート操作

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

### Rebase

```bash
jj rebase -r <rev> -d <dest>    # 単一コミットをdestの子に移動（子孫は元の場所に残る）
jj rebase -s <rev> -d <dest>    # revとその子孫すべてをdestに移動
jj rebase -b <rev> -d <dest>    # revを含むブランチ全体をdestに移動
```

- `-r`: 1コミットだけ移動。子孫は自動でリベースされる
- `-s`: サブツリー全体を移動（feature branchをmainに追従させるときなど）
- `-b`: ブランチ全体（mainからの分岐点まで含む）

### PR作成

```bash
jj bookmark create <name> -r @-    # pushするrevisionにブックマーク作成
jj git push --bookmark <name>
gh pr create --head <name> --base main
```

### その他

```bash
jj log                   # コミットログ表示
jj diff                  # WCの差分
jj diffu                 # upstream（@-）との差分
jj status                # 変更ファイル一覧
jj squash                # WCの変更を親コミットにまとめる
```

## ~/.claude の管理

`~/.claude/skills/` と `~/.claude/commands/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` で管理されている。
スキルやコマンドを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink経由で自動反映）。

## Tmp Directory

- ~/.claude/tmp/ を一時ファイル保存場所として使用
- 作業ログや調査中のエラーログなどの保存に利用

## Coding Policy

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- コメント: 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
