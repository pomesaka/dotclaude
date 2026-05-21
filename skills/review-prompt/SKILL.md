---
name: review-prompt
description: Claude が読むファイル（docs/・skills/・CLAUDE.md）のプロンプト品質と整合性を監査する。
when_to_use: 「プロンプトを見直して」「docsとskillがあっているか確認して」「スキルにdocsの知見が反映されているか」「review-prompt」と言われたとき。
allowed-tools: Read, Edit, Bash(fd *), Bash(rg *), Bash(wc *)
model: sonnet
---

# review-prompt

Claude が読むファイル全体（`~/.claude/docs/`・`~/.claude/skills/`・`CLAUDE.md`）を対象に、プロンプトとしての品質と相互整合性を監査する。

プロンプト品質の基準は `~/.claude/docs/prompt-engineering.md` に準拠する。

---

## フロー

### Step 1: スキャン

以下を並行して収集する。

**1-a. 全スキルの docs 参照を抽出**

```bash
# !cat パターン（正しい runtime embed）
rg '!\`cat ~/.claude/docs/\S+' ~/.claude/skills/*/SKILL.md -o

# @~/.claude/docs/ パターン（アンチパターン）
rg '@~/.claude/docs/\S+' ~/.claude/skills/*/SKILL.md -o

# plain path 参照（ポインタ）
rg '~/.claude/docs/\S+\.md' ~/.claude/skills/*/SKILL.md -o
```

**1-b. 存在するdocsファイル一覧**

```bash
fd -e md . ~/.claude/docs/ --exclude 'design-md'
```

**1-c. 全スキルの frontmatter（name/description/when_to_use）**

```bash
rg -m 5 '^(name|description|when_to_use):' ~/.claude/skills/*/SKILL.md
```

**1-d. docs の NG/OK マーカー有無**

```bash
# ❌ マーカーを持つファイル
rg -l '❌' ~/.claude/docs/

# ✅ マーカーを持つファイル
rg -l '✅' ~/.claude/docs/
```

2つの結果を比較し、`❌` はあるが `✅` がないファイル（またはその逆）を Check E の対象とする。

---

### Step 2: 5種類のチェック

#### Check A: @-embed アンチパターン（スキル）

`@~/.claude/docs/xxx.md` 形式はロード時に全文が埋め込まれる。
`!cat ~/.claude/docs/xxx.md` または plain path 参照に変えるべき。

Critical として報告。

#### Check B: デッド参照（スキル）

`!cat ~/.claude/docs/xxx.md` で参照されているが存在しないファイルを 1-b と突き合わせて検出する。

Critical として報告。

#### Check C: ドメインギャップ（docs → スキル）

以下のドメインマップを使い、docs が存在するのに参照すべきスキルが参照していないケースを検出する。

| docs ファイル | 参照すべきスキルの特徴 |
|---|---|
| `typescript.md` | TypeScript コードを生成・レビューするスキル |
| `react.md` | React コンポーネントを扱うスキル |
| `react-a11y.md` | React レビュースキル（`react.md` 参照済みのもの） |
| `nextjs.md` | Next.js アプリを扱うスキル |
| `pulumi.md` | Pulumi インフラを実装・レビューするスキル |
| `pulumi-aws.md` | Pulumi 実装スキル（`pulumi.md` 参照済みのもの） |
| `pulumi-cicd.md` | Pulumi + CI/CD を扱うスキル |
| `github-actions.md` | CI/CD・GitHub Actions を扱うスキル |
| `go.md` | Go コードを生成・レビューするスキル |
| `cohesion.md` + `readability.md` + `design.md` | コードレビュースキル全般 |
| `domain-design-practices.md` | ドメイン設計・型設計レビュースキル |
| `responsive.md` + `tailwind-cva-patterns.md` | UI 実装・フロントエンドスキル |
| `prompt-engineering.md` | スキル作成・docs 管理スキル（`create-skill`, `curate-docs`, `re`） |
| `llm-memory-management.md` | docs 管理・スキル管理スキル（`curate-docs`, `re`, `create-skill`） |
| `documentation-practices.md` | ドキュメント作成スキル |
| `technical-writing.md` | ドキュメント作成スキル |

Warning として報告。

#### Check D: docs 参照ゼロのスキル（孤立スキル）

docs を一切参照していないスキルを列挙する。以下は除外（docs 参照が不要な性質）:
- `jjcommit` / `jjdesc` / `rebase-main` / `resolve-conflict`
- `upload-screenshots` / `portless`
- `pr-report` / `create-pr` / `update-pr`
- `check-pr` / `difit` / `difit-review`

残った孤立スキルを Info として報告。

#### Check E: docs のプロンプト品質

各 docs ファイルを対象に以下を確認する（LLM 判断）。

| 観点 | チェック内容 |
|---|---|
| NG/OK ペア | `❌` だけで `✅` のない一方通行ルールがないか（1-d で検出） |
| テスタビリティ | 「〜すること」止まりで判定不可能な抽象ルールが多い doc がないか |
| 強度の混在 | 全ルールが「禁止」相当でグラデーションがないか |
| 先頭優位 | TL;DR の次に最重要ルールが来ているか |

Info（品質改善提案）として報告。重大な誤りでなければ修正は任意。

---

### Step 3: レポート出力

```
## review-prompt 監査レポート

### 🔴 Critical（今すぐ対処すべき）
- @-embed アンチパターン: `スキル名` に `@~/.claude/docs/xxx.md`
- デッド参照: `スキル名` の `!cat ~/.claude/docs/xxx.md` → ファイルが存在しない

### 🟡 Warning（ドメインギャップ）
- `xxx.md` が未参照: `スキル名`（関連 docs は参照済み）

### 🟢 Info（品質改善提案）
- docs 参照ゼロのスキル: xxx, yyy
- `yyy.md`: NG 例が `❌` なしで説明のみ → OK/NG ペアにすると分かりやすい
- `zzz.md`: 全ルールが「禁止」相当 → 強度ラダーの導入を検討

### ✅ 問題なし
- ...
```

---

### Step 4: アクションの選択

AskUserQuestion で対応方針を確認する。

**選択肢の例:**
- Critical をすべて修正する
- 特定のスキル/docs だけ修正する
- Warning のドメインギャップを埋める
- 今は確認だけ（何もしない）

---

### Step 5: 修正実行

ユーザーの選択に基づいて実行する。

#### 5-a. @-embed → runtime embed 変換

対象スキルの `@~/.claude/docs/xxx.md` 行を runtime embed 形式に Edit で書き換える。
書式は `~/.claude/skills/review-code/SKILL.md` の Go/TypeScript/React セクションを Read して参照する（`!` + バッククォート + cat コマンドの組み合わせ）。

#### 5-b. docs 参照の追加

**review スキル向け（ルールをその場で展開する）**:

対象スキルの該当セクションに以下を追加する（`<対象>.md` を実際のファイル名に置換）:

```
### [技術名]
```

その直後に docs を runtime embed するコマンドを1行追加する。書式は `review-code/SKILL.md` の既存セクションを参照。

**impl スキル向け（ポインタのみ）**:

```
**参照ドキュメント**:
- ~/.claude/docs/<対象>.md — [一行説明]
```

#### 5-c. docs のプロンプト品質修正

- NG 例に `❌` を追加、OK 例に `✅` を追加
- 「〜すること」ルールを具体的・テスタブルな形に書き直す
- 強度の弱いルールに `推奨:` プレフィックスを追加

---

## Gotchas

- **`design-md/` は除外**: `frontend-design` スキルがオンデマンドで読む設計。Check C/E の対象外
- **Check E は提案のみ**: docs 品質は主観要素が強い。Critical 扱いにせず修正は任意
- **週1サイクルが目安**: `re` スキルで docs に知見が蓄積されたあと、`review-prompt` でスキルへの反映と品質を確認するのが自然なリズム
- **impl スキルに `!cat` は不要なことが多い**: 実装スキルはポインタ参照で十分。コンテキストを圧迫する `!cat` を無闇に増やさない
- **`review-team-*` スキルは除外しない**: チームレビューエージェント定義も整合性チェック対象
- **runtime embed 構文を例示コードに書かない**: SKILL.md 内の「感嘆符 + バッククォート + コマンド + バッククォート」パターンはコードフェンス内でもロード時に実行される。テンプレート例示には既存スキルへの参照誘導で代替する
