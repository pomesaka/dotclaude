---
name: plan-issue-noah
description: noah の issue に対して impl 前に要件・設計・受け入れ基準を対話で詰める。
when_to_use: 「issueを詰めて」「#NNNを設計して」「実装前に仕様を固めて」と言われたとき。impl-issue-noah の前段として使う。
argument-hint: "<issue-number>"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, Skill
model: opus
---

# plan-issue-noah: Issue 設計フロー

あなたは Planner。impl-issue-noah を実行する**前に**、issue の要件・設計判断・受け入れ基準を対話で詰めて issue ファイルに追記する。

引数 `$ARGUMENTS` に issue 番号（3桁）を受け取る。なければ AskUserQuestion でユーザーに確認する。

## 原則

- **対話で詰める**: 重要な設計判断は AskUserQuestion でユーザーに必ず確認する。勝手に決めない
- **筋のいい選択を提示する**: 楽な選択肢と長期的に筋のいい選択肢が分かれるときは両方提示し、後者を推奨する
- **packages/ 優先**: noah の長期的な競争力は packages/ にある。顧客固有でない限り packages に置く判断を促す
- **用語集準拠**: 新ドメイン型は `docs/glossary.md` を確認し、なければ追記候補として issue に記載する
- **impl の余地を残す**: ファイル単位・関数単位まで決めすぎない。型と配置・主要 API・受け入れ基準まで

## Step 0: Issue 取得・前提確認

```bash
ls issues/$ARGUMENTS-*.md
```

該当ファイルを Read。以下を確認:
- `status` が `open` であること（`in-progress` / `done` / `wontfix` なら中断して、本当に再計画するかユーザーに確認）
- `depends` が全て `done` であること（未完了の依存があれば、先にそちらを実装すべきと指摘）
- 既に `## 設計` セクションがあれば「再度詰め直すか」「追記するか」をユーザーに確認

## Step 1: コンテキスト調査

まず必ず以下を Read（並列）:
- `CLAUDE.md`
- `docs/glossary.md`（用語集）
- `docs/architecture.md`
- `docs/apps/architecture.md`
- `docs/design.md`（packages/ai 設計）

次に issue の内容に応じて追加調査:
- 該当機能の PRD: `docs/prd/f0X-*.md` または `docs/prd/<customer>-*.md`
- 関連 ADR: `ls docs/adr/` で一覧確認し、関連するものを Read
- 参照実装: 類似機能が `packages/features/<x>/` に既にあれば構造を確認（F01 chat が参照実装）
- 既存の関連 issue: `rg -l '<キーワード>' issues/` で同テーマの先行 issue を探す

調査範囲が広くなりそうなら Explore subagent に投げてよい（context: fork で本体を汚さない）。

## Step 2: 設計判断を対話で詰める

AskUserQuestion を使い、以下の観点を**順に**詰める。各質問では推奨案を先頭に置く。

### 2.1 配置（どの package に置くか）
- `packages/features/<feature>/` — ドメイン型・UI・AI 呼び出しロジック（推奨デフォルト）
- `packages/ui/` — 汎用 UI（特定機能に依らないボタン・入力等）
- `packages/ai/` — AI SDK ラッパー・ストリーミング基盤レベルの汎用機能
- `apps/<customer>/` — 顧客固有のデータ取得・mock・page.tsx・system prompt
- `infra/` — Pulumi インフラ

判断基準は CLAUDE.md の「判断基準（apps に残してよいのは）」に従う。

### 2.2 ドメイン型
- 主要なドメイン型を 1〜数個提示し、命名・フィールドの妥当性を確認
- `docs/glossary.md` に対応する用語があるか確認。なければ追記候補として issue に記載する
- `as` キャストを使わずに済む型設計か確認（CLAUDE.md: as キャスト禁止）

### 2.3 主要 API / コンポーネントシグネチャ
- エクスポートする関数・コンポーネントの形（引数・戻り値）を提示
- 顧客側で注入すべき値（system prompt・モックデータ・API クライアント等）を明確化

### 2.4 顧客固有 vs 汎用の切り分け
- packages 側に置く汎用ロジックと、apps 側に残す顧客固有ロジックの境界を確認
- 「楽だから apps に書く」ではなく「将来別顧客で再利用できるか」で判断する

### 2.5 不明点・前提の確認
- 仕様で曖昧な箇所をユーザーに確認（UI 仕様・エラー時挙動・loading 表示・空状態など）

## Step 3: ADR 判定

以下に該当する大きな設計判断があれば `/adr` を呼んで ADR を起票する:
- アーキテクチャ変更（レイヤー追加・パッケージ分割の方針変更）
- 主要ライブラリ・サービスの選定（DB・認証・LLM provider 等）
- 既存の規約から外れる新パターンの導入

該当しないなら ADR は起票しない。起票した場合は issue ファイルの `## 関連ドキュメント` に ADR 番号を記載する。

## Step 4: 受け入れ基準の具体化

元の `## 受け入れ基準` を測定可能なチェックリストに分解する。例:

```markdown
## 受け入れ基準（詳細）
- [ ] `packages/features/<x>/types.ts` に `Foo` 型が定義されている
- [ ] `packages/features/<x>/components/FooView.tsx` が `Foo` を受け取って表示する
- [ ] `apps/ms-holdings/app/<route>/page.tsx` が mock データを注入して `FooView` をレンダリングする
- [ ] `mise exec -- bun run lint` が pass する
- [ ] `mise exec -- bun run typecheck` が pass する
- [ ] mockup（issue NNN）と視覚的に一致する
```

「動く」「実装する」のような曖昧な基準は禁止。**何がどこにあれば完了か**を書く。

## Step 5: issue ファイルに追記

issue ファイルの末尾に以下のセクションを追記する（既存の `## Context` `## やること` `## 受け入れ基準` は残す）:

```markdown
## 設計

### 配置
- 〜は `packages/features/<x>/` に置く（理由: 〜）
- 〜は `apps/ms-holdings/` に置く（理由: 顧客固有のため）

### 主要な型
\`\`\`ts
export type Foo = { ... }
\`\`\`

### 主要 API / コンポーネント
\`\`\`ts
export function fooLoader(...): Promise<Foo>
export function FooView(props: { foo: Foo }): JSX.Element
\`\`\`

### 顧客側で注入するもの
- system prompt
- mock データ
- ...

### 用語集追記候補
- `Foo`: 〜の概念。`docs/glossary.md` に追記する

## 受け入れ基準（詳細）
- [ ] ...

## 関連ドキュメント
- `docs/prd/f0X-*.md`
- `docs/adr/000X-*.md`
- 参照実装: `packages/features/chat/`
```

該当しないセクション（用語集追記候補・関連ドキュメント等）は省いてよい。

## Step 6: 完了報告

- 追記した内容のサマリーをユーザーに伝える
- 次のアクションを案内: `/impl-issue-noah $ARGUMENTS`
- ADR を起票した場合はその ADR 番号も伝える

issue の `status` は `open` のままにする（impl-issue-noah が `in-progress` に変える）。

## Gotchas

- **対話を省略しない**: ユーザーに確認すべき設計判断を勝手に決めてはいけない。AskUserQuestion を使う
- **impl をやらない**: このスキルは設計のみ。コードを書き始めたらスコープ違反
- **顧客固有ロジックを packages に紛れ込ませない**: CLAUDE.md の packages 開発方針を厳守する
- **用語集を無視しない**: 新ドメイン型は必ず `docs/glossary.md` を確認する。追記が必要なら受け入れ基準に「glossary.md 更新」を含める
- **詰めすぎない**: ファイル名・関数名を 1 個ずつ全部決めるのは過剰。型・配置・主要 API・受け入れ基準で止める
- **再計画時の差分扱い**: 既に `## 設計` セクションがある場合、上書きするか追記するかをユーザーに確認する。既存設計を黙って消さない
