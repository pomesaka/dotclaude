## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用

## Version Control
- Use jujutsu (jj) instead of git for version control
- Use `jj --help` for command reference
- When creating pull requests: `gh pr create --head <bookmark name> --base <base bookmark>`
- When starting new phase or task: `jj new -m <description>`
- Use rg instead of grep

## Tmp Directory

- ~/.claude/tmp/ を一時ファイル保存場所として使用
- 作業ログや調査中のエラーログなどの保存に利用

## Coding Policy

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- コメント: 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- jj workflow: jj new -m '...' で新revision作成、または jj commit で説明追加と新空revisionの作成
- jj desc / jj commit は実行しない。
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
