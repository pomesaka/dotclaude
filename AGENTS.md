# Codex Global Instructions

共通方針の正本: `~/.codex/docs/shared-agent-policy.md`

## Shared Policy

- Jujutsu (jj): Git の代わりに jujutsu を使用
- fd: find の代わりに fd コマンドを使用
- rg (ripgrep): grep の代わりに rg を使用
- コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `jjcommit` などのスキルが呼ばれるまで自律的に実行しない
- フロントエンド実装では、プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- プロジェクトルートに `CLAUDE.md` があれば、作業前に読み込んでプロジェクト固有の指示として扱う
- AI が生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つ UI を目指す
- 文書はコードから分からない情報に絞る。局所的な判断理由はコードコメント、横断する概念・境界・製品上の約束はドキュメントへ置く。正本を一つにし、詳細は共通方針と `docs/documentation-practices.md` を参照する
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
- `~/.claude/agents/`
- `~/.claude/docs/`

Codex では以下を同じリポジトリからシンボリックリンクして使う。

- `~/.codex/AGENTS.md`
- `~/.agents/skills/<skill-name>/`
- `~/.codex/agents/`
- `~/.codex/docs/`

スキル・エージェントを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink 経由で自動反映）。

Claude Code 由来のスキルには `allowed-tools`、`AskUserQuestion`、`Agent`、`$ARGUMENTS`、`!` コマンド展開など Codex がそのまま解釈しない記法が含まれる場合がある。その場合は Codex の利用可能なツールに読み替えて実行する。
特に `Agent(...)` でサブエージェント起動が指示されている場合は、Codex の multi-agent tool に読み替え、調査・レビューなど read-only な役割は `explorer`、実装・修正など編集を伴う役割は `worker` のサブエージェントで代用する。

Codex スキルを書く・直すときは `~/.codex/docs/codex.md` を参照する。

## Tmp Directory

- 一時ファイル保存場所は基本的に `~/.codex/tmp/` を使用
- Claude Code 用スキルが `~/.claude/tmp/` を前提にしている場合は、そのスキルの意図を保ったまま `~/.codex/tmp/` に読み替えてよい

## Frontend Implementation

- プロジェクトルートに `DESIGN.md` がなければ `~/.codex/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `use-design` スキルで適用できる
- 必要に応じて `~/.agents/skills/frontend-design/SKILL.md` を読む

## スキルの発見

ユーザーがスキルを指定した場合、一覧に出ていなくても `~/.agents/skills/<skill-name>/SKILL.md` を確認する。別名や古いパスは `~/.claude/skills/` と共有リポジトリの `skills/` を探す。競合記号・壊れたfrontmatter・リンク切れがあれば、その原因を報告し、スキルが使えたとは扱わない。
