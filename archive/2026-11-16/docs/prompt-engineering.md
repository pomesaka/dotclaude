# プロンプトエンジニアリング — CLAUDE.md・スキル設計への適用

> **TL;DR**: 重要ルールは先頭と末尾に（U字注意曲線）。指示はテスト可能な具体形で書く。禁止と推奨は必ずペアで。長いドキュメントはデータ先・指示後。強度ラダーで確実性を制御する。

---

## U字注意曲線（Lost in the Middle）

モデルの注意はプロンプトの先頭と末尾に集中し、中間は30%以上精度が落ちる。

```
CLAUDE.md の推奨セクション順:
1. 役割・責務（1〜3文）← 先頭優位
2. NEVER/MUST の絶対制約
3. ツール・フロー規則
4. ドメイン知識（オンデマンドロード推奨）
5. 重要ルールの再掲（2〜3件）← 末尾優位
```

長い会話でルールが無視されるようになったら CLAUDE.md が長すぎるサイン。削る。強調を増やしても逆効果。

---

## 強度ラダー（Strength Ladder）

ルールの確実性を4段階で表す。新しいモデル（Opus 4.7+）は指示をより文字通りに解釈するため、過激な強調は不要。

| 強度 | 用途 | 例 |
|---|---|---|
| `NEVER` / `禁止` | 違反=壊れる・セキュリティ問題 | `NEVER commit .env files` |
| `必ず` / `常に` | コアフロー・例外なし | `必ず table-driven test で書く` |
| `推奨` / `prefer` | ベストプラクティス・例外あり | `推奨: named export` |
| `consider` / `可能なら` | オプション | `型を明示するとよい` |

ほとんどのルールは `推奨` レベルで十分。`NEVER` / `CRITICAL` を乱用すると読まれなくなる。

---

## 指示の具体性（Testability）

良いルールは「守られているか」が判定できる。

```
❌ 悪い（曖昧）
"テストを書くこと"
"きれいなコードを書く"

✅ 良い（テスト可能）
"テストは test.each を使ったテーブル駆動で書く"
"`as` キャストは禁止。`satisfies` か型ガードで代替する"
```

ルールに WHY を添えるとモデルがエッジケースで正しく一般化できる。
```
# WHY なし → エッジケースで判断できない
"export default 禁止"

# WHY あり → モデルが例外を適切に判断できる
"export default 禁止（named export 統一でツリーシェイキングと補完を安定させる）。
 例外: Next.js App Router の page.tsx / layout.tsx のみ"
```

---

## 禁止と推奨のペア原則

「何をする」だけ書くと「いつしないか」が曖昧になる。セットで書く。

```
# ❌ 片側だけ
"Read ツールでファイルを読む"

# ✅ ペア
"ファイル読み込みは Read ツールを使う。cat / head / tail の Bash は使わない"
```

---

## 禁止ルールが効かないときは上流の処方を疑う
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

LLM が問題行動（テンプレ質問・定型語尾・余計な前置きなど）を繰り返すとき、禁止ルールを追加するのは悪手。append-only でルールが増えるほどコンテキストが膨らみ、全体の指示追従度が落ちる。

正しい順序は次のとおり。

1. **上流に処方（指示）があるか先に grep する**: 「ちなみに〜と聞いてください」「○○のトーンで」のような明示指示が別セクションに残っていることが多い。下流の禁止は上流の処方に勝てない。
2. **処方を削除 or 情報文に書き換える**: 「○○を聞いてください」→「○○の件数は N 件です」のように、行動指示ではなく状態の事実だけ伝える。残りの行動は `<response_rules>` 側に任せる。
3. **どうしても禁止が必要なときだけペアで追加**: ペア原則（上記）に従う。

```
# ❌ append-only 禁止
<response_rules>
- 属性質問（仕事・学業）を毎回つけない
- 「ちなみに〜ぽめ？」を多用しない
- ...（無限に増えていく）
</response_rules>

# ✅ 上流の処方を撤去
# Before: <cold_start>
#   ユーザーの基本情報を1つだけ聞いてください。
#   「ちなみに〜ぽめ？」のトーンで...
# </cold_start>
# After: <cold_start>
#   保存済み事実は N 件と少ない。投稿内容そのものに集中する。
# </cold_start>
```

判定ヒント: 出力に同じテンプレ語尾／質問が頻出するなら、必ずどこかにその語尾／質問の処方そのものが書かれている。「禁止しても効かない」のではなく「処方が勝っている」と読み替える。

---

## ツール一覧は「排他に読まれる」ことを前提に書く
<!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

複数ツールの説明を「使い分け」「When/When NOT」形式で並べると、LLM は排他的に解釈する（1 投稿で 1 ツールしか呼ばない）。両方呼んでよい組み合わせは、構造と文面の両方で明示する必要がある。

```
# ❌ 排他に読まれる
ツールの使い分け:
- save_fact: 「これからも使える事実」を保存
- save_episode: 投稿そのものを時系列ログとして保存

# ✅ 排他でないことを明示
ツールの使い分け（**save_fact と save_episode は排他ではない。1つの投稿で両方呼んでよい**）:
- save_episode: 内容がある投稿はほぼ常に呼ぶ
- save_fact: 「これからも使える事実」が明らかになるときは、save_episode に**加えて**呼ぶ
```

補助テクニックは次のとおり。
- **判定の合言葉**: 「3 か月後の AI がこの事実を知っていてほしいか？」のような単一基準を 1 行添えると判断がぶれにくい
- **共起例を 1 件示す**: 「来月から新プロジェクト → episode（緊張の報告）+ fact（予定）の両方」
- **ペアの順序**: 「常に呼ぶもの」→「条件付きで加算するもの」の順で並べる（包含関係を文章構造で示す）

---

## Few-Shot 例の書き方

抽象的な説明100語より具体例1件の方が効果的。`<example>` タグで囲むと文脈から分離できる。

- **数**: 3〜5件が最適。多すぎるとコンテキストを圧迫
- **構成**: ポジティブ例（OK）+ ネガティブ例（NG）をセットで
- **具体性**: 変数名・値まで書く（プレースホルダー禁止）

```markdown
<examples>
<!-- ✅ 良い例 -->
export const VARIABLE_TYPES = ["text", "number", "date"] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

<!-- ❌ 悪い例 -->
export type VariableType = "text" | "number" | "date";
const VARIABLE_TYPES: readonly VariableType[] = ["text", "number", "date"];
</examples>
```

---

## 長いドキュメント → データ先・指示後

20K トークン以上のコンテキスト（コードベース + ドキュメント混在）では、データを先、指示を後に置く。

```
❌ 悪い順序
[指示・ルール] → [大量のコード・ドキュメント] → [クエリ]
                   ↑ ルールが中間に埋もれる

✅ 良い順序
[データ・コード・ドキュメント] → [指示・ルール] → [クエリ]
                                   ↑ ルールが末尾優位に
```

SKILL.md の `!cat ~/.claude/docs/xxx.md` でドキュメントを先にロードし、手順（Step 1, 2...）を後に置く構造はこの原則に沿っている。

---

## XML タグで構造を分離（API 直叩き専用）

API でプロンプトを文字列として組み立てるとき、データ・指示・例が混在する箇所を `<document>`・`<instructions>`・`<examples>` で囲むと境界が明確になる。

SKILL.md や docs では Markdown 見出し + コードブロックが同じ役割を果たしているため不要。

### system prompt と user message のフォーマットを揃える

system prompt 側を `<persona>...</persona>` `<glossary>...</glossary>` のように XML 構造化したなら、user message 側の入力データも XML タグで囲むこと（例: `<transcript>...</transcript>`）。

```
// ❌ system は XML 構造化、user message だけ和文括弧
system: "<persona>...</persona>\n<glossary>...</glossary>"
user:   "【文字起こし】\n${transcript}"

// ✅ 一貫した XML 構造
system: "<persona>...</persona>\n<glossary>...</glossary>"
user:   "<transcript>\n${transcript}\n</transcript>"
```

理由: LLM は「prompt 指示」と「入力データ」を区別する手がかりとして XML タグの境界を使う。片方だけ XML 化すると一貫性が崩れ、LLM が入力データの始点・終点を取り違える可能性が増える。agent / chain 設計時に system 側の構造化に意識が向きがちで、user content 側の構造化が抜け落ちやすい。レビュー時に必ず両方を確認する。
<!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

---

## Role 指定（ペルソナ）

1〜3文で具体的に。バックストーリー・お世辞は不要（トークンの無駄）。

```
# ❌ 無駄なペルソナ
"あなたは10年の経験を持つシニアエンジニアで、優れたコードを書くことに情熱を持っています..."

# ✅ 効果的なペルソナ
"あなたはコーディネーター。issue を読んで実装方針を決め、サブエージェントに委譲する。"
```

スキルで `context: fork` + `agent: general-purpose` + `model: sonnet` の組み合わせにペルソナ指定を1文添えるだけで集中力が変わる。

---

## CLAUDE.md 含めるべき / 除くべき

| 含める | 除く |
|---|---|
| コードから推測できない規約（ブランチ命名等） | 標準的な慣習（Claude が既知） |
| テストランナー・ビルドコマンド | 頻繁に変わる情報 |
| アーキテクチャ上の決定（なぜその技術か） | ファイルごとのコードベース解説 |
| 環境変数・セットアップの見落としやすい点 | チュートリアル・詳細な API ドキュメント |
| プロジェクト固有の絶対制約 | 自明なこと（"クリーンなコードを書く"） |

**テスト**: 「この行を削除したら Claude がミスをするか？」→ しないなら削除。

---

## コンテキスト管理とオンデマンドロード

- **毎セッション必要な情報** → CLAUDE.md に直接記載
- **特定タスクでのみ必要** → SKILL.md に `!cat ~/.claude/docs/xxx.md`（runtime embed）
- **参照だけ必要** → プレーンなパス文字列（`~/.claude/docs/xxx.md`）

`@~/.claude/docs/xxx.md` はアンチパターン（毎セッション全文埋め込み）。`!cat` に変える。

推奨バジェットは次のとおり。
- CLAUDE.md のカスタム記述: 1,500〜6,000 トークン
- 利用可能な instruction スロット: 約100〜150件（残りはツール定義が消費）

---

## `<system-reminder>` による中間リフレッシュ

長い会話でルールが薄れてきたと感じたら、ツール結果や user turn に `<system-reminder>` を挿入して重要ルールをリフレッシュする。Claude Code は自動的にこれを使っている。

スキル内で「重要な制約を会話中に再確認させたい」場合の参考パターン。
```
> **Reminder**: ファイル編集は Edit ツールのみ使用。cat/sed 禁止。
```

---

## AI 関数の shortcut と AI パスの出力一貫性

関数が「条件を満たさない → 固定文字列を返す」ショートカットと「AI で生成する」本流の2パスを持つとき、両パスの出力の観察可能な性質（言語・フォーマット・トーン）は一致させる。

観客が固定（例: 日本語チームの開発者）なら、AI パスで入力の言語に追従させてはいけない。ショートカットは固定・本流は動的になり、同じ関数が呼び出し条件によって異なる性質の文字列を返す。

```
// ❌ 非一貫（ショートカットは日本語固定、AI パスは入力言語に追従）
if (isEmpty) return '変更はありません。'  // 日本語
return ai.generate({ language: detectFrom(projectOverview) })  // 可変

// ✅ 一貫（両パス共に観客の言語で固定）
if (isEmpty) return '変更はありません。'  // 日本語
return ai.generate({ system: '...日本語で書く...' })  // 日本語固定
```

見落としやすい理由: 2つのパスは実装上離れた場所に書かれており、戻り値の型（`string`）は同じなので型検査では検出されない。並べて比較するまで気づきにくい。

判断基準: 観客が固定なら出力言語を固定する。多言語対応が本当に必要な場合でも、ショートカットが固定言語を返す限り本流も同じ言語に揃える（さもなければ observable な inconsistency が生まれる）。
<!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 参考資料

- [Prompt engineering overview — Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Claude 4 best practices — Anthropic](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Claude Code best practices — Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Writing Agent System Prompts — mynameisfeng.com](https://www.mynameisfeng.com/blog/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code)
- [Lost in the Middle — arXiv 2510.10276](https://arxiv.org/pdf/2510.10276)
