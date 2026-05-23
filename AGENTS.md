# Codex Global Instructions

共通方針の正本: `~/.codex/docs/shared-agent-policy.md`

## Shared Policy

- Jujutsu (jj): Git の代わりに jujutsu を使用
- fd: find の代わりに fd コマンドを使用
- rg (ripgrep): grep の代わりに rg を使用
- コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `jjcommit` などのスキルが呼ばれるまで自律的に実行しない
- フロントエンド実装では、プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- AI が生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つ UI を目指す
- 外部から使用される可能性があるものには必ずドキュメントを記載
- 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止
- テストはできるだけ table driven test で書く
- context が 60% を超えたら新しいタスクを始めない
- compact するときは必ず「何を残し、何を捨てるか」のヒントを付ける
- Shell operator（`&&`、`||`、`;`、`|`）を含む複合コマンドはパーミッションプロンプトが発生しやすいため極力避ける
- workspace/xxx/ は JJ ワークスペース（git worktree 相当）として扱い、workspace/xxx/ 配下のファイルのみ参照・編集する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取る

## Version Control (Jujutsu)

コマンドリファレンス: `~/.codex/docs/jj.md`

## Global Configuration Management

Claude Code では以下を同じリポジトリからシンボリックリンクして使う。

- `~/.claude/CLAUDE.md`
- `~/.claude/skills/`
- `~/.claude/commands/`
- `~/.claude/agents/`
- `~/.claude/docs/`

Codex では以下を同じリポジトリからシンボリックリンクして使う。

- `~/.codex/AGENTS.md`
- `~/.agents/skills/<skill-name>/`
- `~/.codex/commands/`
- `~/.codex/agents/`
- `~/.codex/docs/`

スキル・コマンド・エージェントを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink 経由で自動反映）。

Claude Code 由来のスキルには `allowed-tools`、`AskUserQuestion`、`Agent`、`$ARGUMENTS`、`!` コマンド展開など Codex がそのまま解釈しない記法が含まれる場合がある。その場合は Codex の利用可能なツールに読み替えて実行する。

Codex スキルを書く・直すときは `~/.codex/docs/codex.md` を参照する。

## Tmp Directory

- 一時ファイル保存場所は基本的に `~/.codex/tmp/` を使用
- Claude Code 用スキルが `~/.claude/tmp/` を前提にしている場合は、そのスキルの意図を保ったまま `~/.codex/tmp/` に読み替えてよい

## Frontend Implementation

- プロジェクトルートに `DESIGN.md` がなければ `~/.codex/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `use-design` スキルで適用できる
- 必要に応じて `~/.agents/skills/frontend-design/SKILL.md` を読む
