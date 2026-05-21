# プロンプトエンジニアリング — CLAUDE.md・スキル設計への適用

> **TL;DR**: 重要ルールは先頭と末尾に（U字注意曲線）。指示はテスト可能な具体形で書く。禁止と推奨は必ずペアで。長いドキュメントはデータ先・指示後。強度ラダーで確実性を制御する。

---

## U字注意曲線（Lost in the Middle）

モデルの注意はプロンプトの**先頭と末尾**に集中し、中間は30%以上精度が落ちる。

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

ルールに **WHY** を添えるとモデルがエッジケースで正しく一般化できる:
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

20K トークン以上のコンテキスト（コードベース + ドキュメント混在）では：

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
| 環境変数・セットアップの落とし穴 | チュートリアル・詳細な API ドキュメント |
| プロジェクト固有の絶対制約 | 自明なこと（"クリーンなコードを書く"） |

**テスト**: 「この行を削除したら Claude がミスをするか？」→ しないなら削除。

---

## コンテキスト管理とオンデマンドロード

- **毎セッション必要な情報** → CLAUDE.md に直接記載
- **特定タスクでのみ必要** → SKILL.md に `!cat ~/.claude/docs/xxx.md`（runtime embed）
- **参照だけ必要** → プレーンなパス文字列（`~/.claude/docs/xxx.md`）

`@~/.claude/docs/xxx.md` は **アンチパターン**（毎セッション全文埋め込み）。`!cat` に変える。

推奨バジェット:
- CLAUDE.md のカスタム記述: 1,500〜6,000 トークン
- 利用可能な instruction スロット: 約100〜150件（残りはツール定義が消費）

---

## `<system-reminder>` による中間リフレッシュ

長い会話でルールが薄れてきたと感じたら、ツール結果や user turn に `<system-reminder>` を挿入して重要ルールをリフレッシュする。Claude Code は自動的にこれを使っている。

スキル内で「重要な制約を会話中に再確認させたい」場合の参考パターン:
```
> **Reminder**: ファイル編集は Edit ツールのみ使用。cat/sed 禁止。
```

---

## 参考資料

- [Prompt engineering overview — Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Claude 4 best practices — Anthropic](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Claude Code best practices — Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Writing Agent System Prompts — mynameisfeng.com](https://www.mynameisfeng.com/blog/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code)
- [Lost in the Middle — arXiv 2510.10276](https://arxiv.org/pdf/2510.10276)
