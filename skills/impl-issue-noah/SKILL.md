---
name: impl-issue-noah
description: GitHub IssueをNoah実装フローで実装してPRを作成する。
when_to_use: 「issueを実装して」「#123を実装して」「このissueをやって」と言われたとき。
argument-hint: "<issue-number>"
allowed-tools: Bash(gh *), Bash(jj *), Bash(mise *), Read, Edit, Write, Grep, Glob
model: sonnet
---

# impl-issue-noah: Issue実装フロー

あなたはCoordinator。GitHub Issueの内容を元に実装→レビュー→PR作成のフローを自動化する。

引数 `$ARGUMENTS` に issue 番号（3桁、例: `001`）を受け取る。なければ AskUserQuestion でユーザーに確認する。

## Step 0: Issue 取得

```bash
ls issues/$ARGUMENTS-*.md
```

該当ファイルを Read して内容を把握する。特に以下を確認:
- `status` が `open` または `in-progress` であること（`done` / `wontfix` なら中断してユーザーに確認）
- `depends` に記載された issue が全て `done` であること
- 実装すべき機能・修正内容の詳細
- どの app / package に変更が入るか（`apps/ms-holdings`、`packages/features`、`packages/ai` 等）
- UIへの変更が含まれるか

issue ファイルの `status` を `in-progress` に更新する。

## Step 1: 実装（サブエージェント）

Agent ツールで `general-purpose` sub-agentを起動し、実装を委譲する。

プロンプトには以下を含める:
- noahモノレポ（Bun + Next.js App Router）のissueを実装するタスクであること
- `issues/$ARGUMENTS-*.md` の内容（全文）
- 「まず `CLAUDE.md`, `docs/apps/architecture.md`, `docs/apps/conventions.md` を読んでアーキテクチャ・規約を確認してください」
- 「実装後は `mise exec -- bun run lint` でlintを、`mise exec -- bun run typecheck` で型チェックを通してください。エラーが残っていれば修正してください」
- 「jjコマンドは使わず、ファイル編集のみ行ってください」

sub-agentの返答を確認し、lint・typecheckが通ったことを確認してから次のステップへ進む。
エラーが残っていればCoordinatorが自分で追加修正する。

## Step 2: ドメインレビュー

`review-domain` スキルを呼び出す（Skill ツール使用）。

結果を確認し:
- **重大な設計問題**（責務の誤配置・レイヤー境界の侵犯・型設計の欠陥）→ Coordinatorが自分で修正し lint/typecheck を通す
- **提案レベルの指摘**→ 判断してスキップ or 反映（issue のスコープを超える変更は避ける）

## Step 3: PR作成

`create-pr` スキルを呼び出す（Skill ツール使用）。

PRのタイトル・本文に `closes #<issue番号>` を含めるよう指示する。

## Step 4: コードレビュー＆修正ループ

`review-team-noah` スキルを呼び出す（Skill ツール使用）。

内部でreviewer subagentによるレビュー→Coordinatorによる修正→update-prのサイクルが実行される。

## Step 5: 受け入れ基準を照合して issue を done にする

1. **受け入れ基準のチェックボックスを1つずつ照合して埋める**: issue ファイルの `## 受け入れ基準` / `## 受け入れ基準（詳細）` の `- [ ]` を、実際に満たしたものだけ `- [x]` にする。満たしていない・部分的にしか検証できていない項目は `- [ ]` のまま残し、検証メモを添える（例: 「ストリーミングは Nova で確認・本番 Claude は外部要因で未検証」）。**「status を done にする」だけで済ませてチェックボックスを放置しない** — 実態と記録が乖離する
2. issue ファイルの `status` を `done` に更新する。Devlog は Step 6 の `re` が書く。

## Step 6: 振り返り（Devlog 込み）

`re` スキルを呼び出す（Skill ツール使用）。

**このプロジェクトでは `re` が Devlog も書く**。`re` 実行時に以下を伝える:
- 対象 issue ファイルのパス（`issues/NNN-*.md`）
- Devlog の各セクションを会話ヒストリーから埋めること

`re` が Devlog を書く際の各セクション:

| セクション | 書く内容 |
|---|---|
| `### 実装内容` | 何を実装したか（変更ファイル・追加した型・関数の概要） |
| `### 設計判断` | なぜそのアプローチを選んだか。却下した代替案があれば理由も |
| `### レビューで指摘・修正した点` | レビューループで修正した非 Nit 指摘の一覧 |
| `### 困ったこと・ハマったこと` | 詰まった箇所と解決のきっかけ |

空欄のまま残すセクションがあれば `（なし）` と書く。

知見の書き先（`re` がドキュメントへ反映する際の判断基準）:

| 知見の性質 | 反映先 |
|---|---|
| noah 固有の規約・禁止事項 | `CLAUDE.md` または `docs/apps/conventions.md` |
| reviewer が複数 issue で同じ観点を指摘 | `docs/apps/conventions.md` に規約として明文化 |
| TypeScript / React / Next.js の一般的なプラクティス | `~/.claude/docs/typescript.md` 等の言語ドキュメント（規約・設計パターンは本体、実装中の落とし穴は `typescript-gotchas.md` / `react-gotchas.md`） |
| reviewer スキルが見落としている観点 | `dotclaude/skills/review-team-noah/teammate-reviewer.md` |

## Gotchas

- **Issue番号なしで起動**: `$ARGUMENTS` が空なら AskUserQuestion でユーザーに確認する
- **実装サブエージェントがjjを使う**: jjコマンドを使わないよう明示すること（ファイル編集のみ）
- **create-prの前にreview-team-noahを呼ぶ**: review-team-noahはupdate-prを呼ぶためPRが存在しないと失敗する。Step 3（create-pr）→ Step 4（review-team-noah）の順を守ること
- **lint/typecheckコマンド**: `mise exec -- bun run lint` と `mise exec -- bun run typecheck`。直接 `bun` はPATHに入っていない場合があるため必ず `mise exec --` を前置する
- **変更フィルタ**: `bun run lint` / `bun run typecheck` はモノレポルートで実行すれば全パッケージをチェックする。変更したパッケージのみ絞る場合は `mise exec -- bun --filter='@noah/xxx' lint` を使う
- **bun install 未実施**: 実装前に `bun install` 済みかを確認する。`node_modules` がなければ lint/typecheck が依存解決エラーで全滅する。`ls node_modules 2>/dev/null | head -1` で確認し、空なら `mise exec -- bun install` を先に実行すること
  <!-- importance: high | mentions: 2 | first-seen: 2026-05 -->
- **deps 削除は既存コードへの影響を確認**: サブエージェントが「新機能では使っていない」と判断して deps を削除することがある。削除前に `rg 'package-name'` で他ファイルへの import がないかを確認させること。CI でしか気づけず PR を汚す
- **`.claude/scheduled_tasks.lock` がコミットに混入する**: Claude Code は `.claude/scheduled_tasks.lock` をワークスペース内に生成する。`.gitignore` に追加しないと jj の working copy に入り push されてしまう。対処: プロジェクトの `.gitignore` に `.claude/scheduled_tasks.lock` と `.claude/settings.local.json` を追加する（`.claude/skills/` は意図的に追跡するため `.claude/` ディレクトリごと除外しない）。既に tracking 中なら `jj file untrack .claude/scheduled_tasks.lock` で外す。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **新しいドメインエンティティを設計するとき、管理 UI の有無を先に確認する**: issue の AskUserQuestion 段階で「この概念を CRUD できる管理画面があるか」を確認すると無駄な汎用テーブル設計を防げる。管理 UI がなければ汎用テーブル（例: `departments`）は不要で、「ロール（role）」のような opaque な文字列で代替し具体値をアプリ層に委ねる設計が正しい。今回の事例: 部門管理機能がないのに `departments` テーブルを設計し始め、ユーザーの補足で修正した。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **UI/UX デザイナー subagent レビューは PR 作成前に挟む**: review-team-noah の policy/quality reviewer は「型・規約・a11y 属性の有無」しか見ない。design token 使用 / 主動線の配置 / スクリーンリーダーへの動的フィードバック / 空状態 / キーボードフォーカス可視化 / URL に乗せる値の妥当性などは指摘されない。これらは UI/UX デザイナーロールの subagent（「業界のベストプラクティスと照らし合わせて UI モックをレビュー」）に Agent ツールで明示的に投げる必要がある。タイミングは Step 1（実装）完了直後・Step 3（create-pr）前が良い。PR 作成後に大量の UX 修正が乗ると「v3.1 UX 改善」のような追加コミットが発生し、PR diff が膨らむ。今回の事例: PR #32（v3）作成後にユーザーから UI/UX レビュー指示があり、9 カテゴリの追加修正が同 PR に乗った。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`infra/` 変更時も biome format が CI で走る**: `infra/` の TypeScript は Pulumi スタックだが、ルート `biome.json` の `includes: ["**", ...]` に含まれるため CI の `biome check` でフォーマット検査される。`tsc --noEmit` だけ通しても `lineWidth: 100` 超過行があると CI で fail する。ローカルで `mise exec -- bun run lint` がルート `biome.json` の設定エラー（古い biome 同梱バージョンとの互換問題等）で動かないことがあるので、`infra/` だけ確認するには `mise exec -- bunx @biomejs/biome@<version> check infra/` を使う（バージョンは `biome.json` 1行目の `$schema` URL から取得）。CI と同じバージョンで走るためズレが出ない。今回の事例: PR #45 で `infra/ms-holdings/index.ts` の 100 文字超過行が CI でしか発見できず、format fail で 1 度 push やり直し。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **issue の「やること」節は `docs/apps/architecture.md` の既決定事項との整合を実装前に確認する**: issue ファイルの「やること」は architecture.md が更新される前に書かれたり、ドラフト段階のままになっていることがある。実装サブエージェントに渡す前に「やること」のひとつひとつが architecture.md の決定と矛盾しないかを確認すること。矛盾があれば実装前に issue ファイルを修正し、設計節に「撤回・修正の経緯」を記録する。今回の事例: 「やること」に `TENANT_SCHEMA` が env 分解対象として含まれていたが、architecture.md 決定 #1（TENANT_SCHEMA は定数・env 化禁止）と矛盾。plan-issue 段階の AskUserQuestion で検出し修正した。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **AI SDK v6: `useChat({ api })` が廃止、`DefaultChatTransport` に変更**: v5 までの `useChat({ api: "/api/chat" })` は v6 で動作しない。`transport: new DefaultChatTransport({ api: "/api/chat" })` を使う（`DefaultChatTransport` は `ai` パッケージから import）。conventions.md 規約 H の例を参照すること。issue の「やること」や設計文書に `useChat` の API 例が書かれていても v6 形式に読み替えること。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **AI SDK v6: `convertToModelMessages` が async 関数に変更**: v5 以前は同期関数だったが v6 では `Promise<ModelMessage[]>` を返す。`UIMessage[]` を `ModelMessage[]` に変換する Service 関数や Route Handler は `async` にして `await convertToModelMessages(messages)` とすること。同期で呼ぶと型エラーではなく Promise オブジェクトが渡るため、typecheck 通過後に実行時エラーになる危険がある。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`status: done` にする前に受け入れ基準のチェックボックスを埋める**: 実装・検証が済んでいても、issue ファイルの `- [ ]` を `- [x]` に更新する作業を忘れやすい（status だけ done にして次へ進んでしまう）。Step 5 で受け入れ基準を1項目ずつ照合し、満たしたものを `- [x]`、未検証・部分検証は `- [ ]` のまま検証メモを添える。記録（チェック状態）と実態を一致させる。ユーザーに「なぜチェックが付いていないのか」と指摘されてから直すのは手戻り。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **実装サブエージェントへのプロンプトに import 方向ルールを明示する**: サブエージェントは `@noah/ai` の型・関数（`JobRecord` / `JobStatus` / `createMemoryJobStore` 等）を使うとき、`apps/*` から `@noah/ai`（またはその subpath `@noah/ai/stt` 等）を直接 import する違反を繰り返す（CLAUDE.md に規約があっても、ソースパッケージに手が伸びる）。Step 1 のプロンプトに「`@noah/ai` 由来の型・関数を `apps/*` で使うときは必ず `@noah/features` 経由で import する（root barrel が re-export 済み。直接 import は禁止）。Lambda 等の非 React consumer は `@noah/features/jobs` subpath を使い UI 引き込みを避ける。`@noah/ai/<subpath>` の型が必要な場合は `@noah/features/<feature>/<subpath>` に re-export を追加してから使う」を1行入れて予防する。発生例: 009（`schema.ts`）・034（`db/queries/jobs.ts`・`src/jobs/store.ts`）・019/035（`jobs/lambda.ts`・`db/job-store.ts`）・047（`db/commands/transcription.ts` が `@noah/ai/stt` subpath から `TranscriptionSegment` を直接 import）。いずれもレビューや /re で初めて検出された（typecheck は通るため気づけない）。
  <!-- importance: high | mentions: 4 | first-seen: 2026-06 -->
- **apps から `UIMessage` 等の AI SDK 型が必要な場合は `@noah/features/chat/server` 経由で import する**: `apps/*` は `ai` パッケージを直接依存しない（CLAUDE.md「apps は AI SDK 非依存」方針）。`UIMessage` 等の SDK 型が `apps/*/src/db/queries/` や `commands/` で必要になる場合、`@noah/features/chat/server` が `export type { UIMessage } from "ai"` として re-export しているためそこから import する。直接 `import type { UIMessage } from "ai"` と書いても typecheck で `Cannot find module 'ai'` になる。今回の事例: 038（`db/queries/messages.ts`・`db/commands/messages.ts`）で発生し修正。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **AI SDK v6: `UIMessage` は `content` フィールドを持たず `parts` のみ**: v4/v5 の `UIMessage` は `content: string` を持っていたが v6 では削除され `parts: UIMessagePart[]` のみになった。DB rows → UIMessage 変換時に `content` フィールドを含めると typecheck エラー（`Object literal may only specify known properties, and 'content' does not exist in type 'UIMessage'`）。`parts: textParts` のみを返すよう修正する。今回の事例: 038 の `db/queries/messages.ts` で発生。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`toUIMessageStreamResponse` の `onFinish` は必ず `async` にして `await` する**: `onFinish` を同期関数にすると、`return store.saveTurn(...)` の Promise が SDK にアタッチされないまま返却される（SDK は戻り値を待たない）。その結果、保存失敗がサイレントに飲まれる。`onFinish: async ({ responseMessage, isAborted }) => { await store.saveTurn(...) }` と async + await にすること。また `onFinish` の event 型は `UIMessageStreamOnFinishCallback<UIMessage>` で、`{ messages, responseMessage, isAborted, isContinuation, finishReason }` を含む（`responseMessage` と `isAborted` だけでなく他のフィールドもある点に注意）。今回の事例: 038 の `packages/features/src/chat/server.ts` でレビュー指摘後に修正。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **新 feature を追加したら `packages/features/package.json` の `exports` subpath も追加する**: `packages/features/src/<feature>/` ディレクトリを作成しても、`package.json` の `exports` に `"./feature": "./src/feature/index.ts"` を追加しないと `@noah/features/feature` の import がランタイムエラーになる。実装前に既存 feature と `exports` を突き合わせて欠落がないか確認すること。今回の事例: issue 044 で `summarize` の subpath export が欠落していたことを plan フェーズの `packages/features/package.json` 確認で発見し、044 のスコープに修正を含めた。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`bun:test` を使うテストファイルは tsconfig の `exclude` に追加する**: `apps/ms-holdings` には `@types/bun`（bun-types）が未インストール。テストファイルを `tsconfig.json` の `exclude` に追加しないと `Cannot find module 'bun:test'` などの typecheck エラーが出る。対処: `"exclude": ["node_modules", "**/*.test.ts", "**/*.test.tsx"]` を追加する（実行は `bun test` で正常動作する）。今回の事例: issue 045 で `system-admin.test.ts` 追加時に発生。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **quality reviewer が `test.each` の case object の `as const` を「redundant」と指摘することがある**: `test.each([{ step: "transcribing" as const }])` のように literal 型を持つ property を後で型付き関数に渡す場合、`as const` がないと TypeScript が `string` に widening する。結果として呼び出し先（例: `setStep(step: "queued" | "transcribing" | "generating")`）の型チェックが通らなくなる。この指摘は false alarm — `as const` を除去すると typecheck が落ちるか確認してから判断する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`JobStore.create` は `string` でなく `JobRecord` を返す — kick service でのパターン**: `createDbJobStore(db).create({ type, userId, expiresAt, onCancel })` の戻り値は `Promise<JobRecord>`。`const jobId = await store.create(...)` と書くと typecheck エラー。正しいパターン: `const job = await store.create({ ..., onCancel: async () => {} })` → `const { id: jobId } = job`。`onCancel` は DB store では無視されるが interface 上は必須。後続 kick service（F03/F06 等）では同パターンで実装する。今回の事例: issue 041 の kick service で発生し修正。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`@noah/features` の root barrel・サブパッケージ barrel は廃止されている（Convention V-1）— import は全て subpath 形式**: `import { X } from "@noah/features"` も `import { X } from "@noah/features/<feature>"` も動かない（`package.json` の exports に `.` と `./<feature>`（barrel）の登録が無いため）。正しい形は `@noah/features/<feature>/<concern>`（例: `@noah/features/minutes/types`・`@noah/features/minutes/components`・`@noah/features/minutes/job`・`@noah/features/jobs`・`@noah/features/providers`）。実装サブエージェントへのプロンプトに「barrel 廃止・subpath 直接 import」を必ず1行入れる（古いコード／README／会話履歴の barrel サンプルをコピーすると壊れる）。conventions.md §V-1 が正の出典。今回の事例: issue 041 rebase 時に旧 barrel import で typecheck 全滅し、ユーザー指摘で気付いた。
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->
- **`@noah/features/<feature>/job/types` という subpath は exports に存在しない — `/job` で止める**: `packages/features/package.json` の `exports` は `"./*/job": "./src/*/job/index.ts"` のみで、`"./*/job/types"` は登録されていない（`job/` 以下の subpath は全て未登録）。`job/index.ts` から re-export された型を使う場合は `@noah/features/<feature>/job` を使う。**テストファイルも同じルールが適用される**（apps/packages どちらも Convention V 対象）。誤例: `import type { X } from "@noah/features/transcription/job/types"` → 正: `import type { X } from "@noah/features/transcription/job"`。今回の事例: issue 047 で queries・store・テストファイルの 3 箇所で発生し、レビュー Round 1〜3 で順次修正。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`@noah/ai` から features へ re-export するときは concern ごとに subpath を分ける**: lifecycle infrastructure（`runAsJob` / `createJobLambdaHandler` 等）は `packages/features/src/jobs.ts` → `@noah/features/jobs`、LLM/STT provider（`bedrockModel` / `awsTranscribeProvider` 等）は `packages/features/src/providers.ts` → `@noah/features/providers`。一つの re-export ファイルに混ぜると概念がぼやけ、Lambda 等の非 React consumer が必要以上の依存を引き込む。新しい `@noah/ai/<x>` を apps から使う必要が出たら、既存 subpath への追加と新 subpath の新設を「意味のまとまり」で判断する。conventions.md §V「concern ごとに subpath を切る」が正。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
