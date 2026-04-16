## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `/jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

コマンドリファレンス: `@~/.claude/docs/jj.md`

## ~/.claude の管理

`~/.claude/skills/` と `~/.claude/commands/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` で管理されている。
スキルやコマンドを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink経由で自動反映）。

## Tmp Directory

- ~/.claude/tmp/ を一時ファイル保存場所として使用
- 作業ログや調査中のエラーログなどの保存に利用

## Frontend Implementation

フロントエンド（HTML/CSS/JS/React/Next.js）を実装するときは、デザイン品質を意識すること。

- プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- ない場合は `~/.claude/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `/use-design` で適用できる
- AIが生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つUIを目指す

@~/.claude/skills/frontend-design/SKILL.md

## Coding Policy

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- コメント: 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る

## Interaction Rules

- ユーザーへの質問は極力 `AskUserQuestion` ツールを使う

## 設計時の原則（Plan モード）

実装詳細に入る前に RDD（責務駆動設計）レンズを当てること:

- 新しい状態フィールドを追加するとき、「この責務は既存の型に属するか、新しい型に分離すべきか」を問う
- 複数のフィールドが不変条件でつながっているなら、それは専用型を作るシグナル
  - 例: `focusDetail bool` + `layoutMode` → 「リスト非表示なら必ずdetailフォーカス」という不変条件 → `Layout` 型に統合
- 「複数フィールドをまとめて操作する処理」が出てきたら型分離を検討する

参考: `~/.claude/docs/domain-design-practices.md`

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
