## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用
- portless: ローカル開発サーバーを `https://<appname>.localhost` で起動する（mise 管理: `npm:portless`）

## ローカル開発サーバー

フロントエンドの動作確認には `portless` を使う。`localhost:PORT` ではなく `https://<appname>.localhost` でアクセスできる。

```bash
# アプリディレクトリで実行（package.json の "dev" スクリプトを自動起動）
cd apps/<appname>
mise exec -- portless
```

- 初回実行時にローカル CA を生成・HTTPS 化（sudo で自動昇格）
- jj ワークスペース（worktree）ではブランチ名がサブドメインに自動付与される

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `/jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

コマンドリファレンス: `~/.claude/docs/jj.md`

## ~/.claude の管理

`~/.claude/skills/`、`~/.claude/commands/`、`~/.claude/agents/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` で管理されている。
スキル・コマンド・エージェントを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink経由で自動反映）。

## Tmp Directory

- ~/.claude/tmp/ を一時ファイル保存場所として使用
- 作業ログや調査中のエラーログなどの保存に利用

## Frontend Implementation

フロントエンド（HTML/CSS/JS/React/Next.js）を実装するときは、デザイン品質を意識すること。

- プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- ない場合は `~/.claude/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `/use-design` で適用できる
- AIが生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つUIを目指す

デザイン原則の詳細: `~/.claude/skills/frontend-design/SKILL.md`

## ユビキタス言語・用語集

プロジェクトに `docs/glossary.md`（または同等の用語集ファイル）がある場合、それはユーザーとコードベースをつなぐ**唯一の共通言語**であり、最重要ドキュメントのひとつ。用語集が腐るとチーム内のコミュニケーションロスが発生しやすくなる。

- **型名・変数名・ファイル名はここに準拠する**。用語集にない概念を実装で勝手に命名しない
- **新しいドメイン型・エンティティを定義したら用語集に追記する**。実装だけが先行してはいけない
- レビューループでも、新しいドメイン型の追加を確認したら `[要更新]` として用語集更新を指摘すること

## Coding Policy

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- コメント: 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る

## Interaction Rules

- ユーザーへの質問は極力 `AskUserQuestion` ツールを使う

## Context Management

- context が 60% を超えたら新しいタスクを始めない
- `/compact` は必ずヒント付きで実行する（例: `/compact focus on X, drop Y`）
- autocompact に自動発火させない — 発火タイミングは intelligence が最低の状態
- tool call の詳細ではなく結論だけ必要なら subagent に投げる（Agent ツール、`context: fork`）
- `/rewind` 前に「summarize from here」を依頼して引き継ぎメモを生成する

## Bash Commands

Shell operator（`&&`、`||`、`;`、`|`）を含む複合コマンドは**パーミッションプロンプトが発生するため極力禁止**。

- `cmd1 && cmd2`、`cmd1 || cmd2`、`cmd1 ; cmd2` は使わない
- フォールバック（`cmd1 || cmd2 || cmd3`）も使わない — 正しいコマンドを1つ決めて実行する
- `cd /path && cmd` の代替:
  - `cmd -C /path` や `cmd --cwd /path` などのフラグ（ツールが対応している場合）
  - `jj diff -R /path` のようにリポジトリ指定フラグを使う
- パイプ（`|`）は `rg`、`jq` などの read-only フィルタに限り許容（ただし書き込みを伴う場合は禁止）

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
