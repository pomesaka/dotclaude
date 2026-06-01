## 応答スタイル

- 選択肢を提示してユーザーが選んだとき、その選択に問題があれば選ばれた後でも指摘する。「いい選択ですね」で終わらない
- 前提が間違っている質問は、まず前提を訂正してから答える
- 不確かなことは「〜のはず」を省かず明記する。知らないことは知らないという
- 長期的に筋の悪い選択（「楽だから」「今は動くから」）には理由を添えて代替を示す

## CLI Tools
- Jujutsu (jj): Gitの代わりにjujutsuを使用
- fd: findの代わりにfdコマンドを使用
- rg (ripgrep): grepの代わりにrgを使用
- portless: ローカル開発サーバーを `https://<appname>.localhost` で起動する（mise 管理: `npm:portless`）

## ローカル開発サーバー

フロントの動作確認は `portless` を使う（`localhost:PORT` でなく `https://<appname>.localhost`）。アプリディレクトリで `mise exec -- portless`。初回はローカル CA を生成して HTTPS 化（sudo 昇格）、jj ワークスペースではブランチ名がサブドメインに付く。詳細は `/portless`。

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `/jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。

コマンドリファレンス: `~/.claude/docs/jj.md`

## ~/.claude の管理

`~/.claude/skills/`、`~/.claude/commands/`、`~/.claude/agents/`、`~/.claude/rules/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` で管理されている。
スキル・コマンド・エージェントを追加・編集する際は dotclaude リポジトリ側に変更を入れることになる（symlink経由で自動反映）。

**編集時は必ず実体パス `~/github.com/pomesaka/dotclaude/...` 経由で行う**。`~/.claude/...` パスで Edit/Write しようとすると auto-mode classifier が「self-modification of agent configuration」として block する。classifier は symlink を resolve しないため、実体パスで開けば通る。対象: `CLAUDE.md` / `skills/` / `commands/` / `agents/` / `rules/` / `docs/` すべて。

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
- コメント: 設計判断・分岐・非対称な扱いには **WHY（なぜそうしたか）と WHY NOT（なぜ他のもっともらしい選択肢を採らなかったか）を両方**書く。WHY だけだと「やり残し / バグ」と区別がつかない。自明なロジックには引き続きコメント不要
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

Shell operator（`&&`/`||`/`;`/`|`）を含む複合コマンドは**パーミッションプロンプトを誘発するため避ける**。フォールバック（`cmd1 || cmd2`）も使わず、正しいコマンドを1つ決めて実行する。パイプ（`|`）は `rg`/`jq` など read-only フィルタのみ可（書き込みを伴うものは禁止）。`cd /path && cmd` の代替策は `~/.claude/docs/bash-tips.md` 参照。

## スキル（SKILL.md）設計規約

- **`allowed-tools` とスキル内指示ツールを一致させる**: スキル本文で「Write で保存する」「Edit で修正する」と指示するなら `allowed-tools` に `Write`/`Edit` を追加すること。ツールが許可リストに無いとスキル実行時にブロックされる。新しいスキルを書くたびに、本文を通読して使うツールをリストアップする習慣をつける。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ はJJワークスペース（git worktree相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他のworkspaceのファイルは禁止）
  - JJコマンド（jj log, jj diffu, jj bookmark等）はworkspace/xxx/ 内で実行すればそのworkspaceのrevisionに対して操作される
  - PR作成時の `jj bookmark create`, `jj git push`, `gh pr create` もworkspace/xxx/ 内で実行する
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止です。
- 修正案がいくつかあるとき、一番楽なものではなく、長期的にみて一番筋のいい選択を取るようにして。
- 認証・認可・ORM・バリデーション・ジョブ基盤など横断的な関心事を自前設計する前に、採用済みライブラリ/フレームワークに同等機能がないか公式ドキュメントで調査する。自前を選ぶ場合もその判断に根拠を持つ（自前設計自体が悪いのではなく、調査せず倒すのが問題）。
