## CLI Tools

- Jujutsu (jj): Git の代わりに jujutsu を使用
- fd: find の代わりに fd コマンドを使用
- rg (ripgrep): grep の代わりに rg を使用

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

## Frontend Implementation

フロントエンド（HTML/CSS/JS/React/Next.js）を実装するときは、デザイン品質を意識すること。

- プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- AI が生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つ UI を目指す

## Coding Policy

- 文書・コメント: 1 つの実装に閉じた理由はコードコメントに、複数の実装をまたぐ概念・境界・製品上の約束と運用の手順はドキュメントに書く。同じ規則は 1 か所にだけ書き、経緯は Git と PR に任せる。詳細: `documentation-practices.md`
- コメント: 複雑なロジックには WHY（なぜそうしたか）を重視したコメントを記載
- TypeScript: as キャストは禁止

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）
- 個別の `test(...)` 呼び出しは、テーブル化できない固有のセットアップが必要なケースに限る

## Context Management

- context が 60% を超えたら新しいタスクを始めない
- compact するときは必ず「何を残し、何を捨てるか」のヒントを付ける
- autocompact に自動発火させない
- tool call の詳細ではなく結論だけ必要なら subagent に投げる

## Bash Commands

Shell operator（`&&`、`||`、`;`、`|`）を含む複合コマンドはパーミッションプロンプトが発生しやすいため極力避ける。

- `cmd1 && cmd2`、`cmd1 || cmd2`、`cmd1 ; cmd2` は使わない
- フォールバック（`cmd1 || cmd2 || cmd3`）も使わない
- `cd /path && cmd` の代替:
  - ツールの working directory 機能を使う
  - `cmd -C /path` や `cmd --cwd /path` などのフラグを使う
  - `jj diff -R /path` のようにリポジトリ指定フラグを使う
- パイプ（`|`）は `rg`、`jq` などの read-only フィルタに限り許容（ただし書き込みを伴う場合は禁止）

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ は JJ ワークスペース（git worktree 相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他の workspace のファイルは禁止）
  - JJ コマンド（jj log, jj diffu, jj bookmark 等）は workspace/xxx/ 内で実行すればその workspace の revision に対して操作される
  - PR 作成時の `jj bookmark create`, `jj git push`, `gh pr create` も workspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取る
