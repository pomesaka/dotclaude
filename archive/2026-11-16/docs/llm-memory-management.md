# LLM メモリ・ドキュメント管理

> エージェント実装・プロンプト設計・スキル設計の共通基盤となる知識。  
> ドキュメントが肥大化したとき、抽象化・分割・マージの判断基準として参照する。

---

## 記憶の4層モデル

| 層 | 保存対象 | dotclaude での相当物 |
|----|---------|---------------------|
| **Episodic**（記録） | 何が起きたか・いつ | re スキルのログ、plans/ |
| **Semantic**（意味） | 蒸留した事実・傾向 | docs/ のコアルール |
| **Procedural**（手順） | やり方・ワークフロー | skills/, CLAUDE.md |
| **Working**（作業中） | 今まさに必要な情報 | コンテキストウィンドウ |

Manage サイクルを省略しないこと。Write + Read だけで Manage（圧縮・整理・廃棄）を怠るとノイズが蓄積し、精度が落ちる。

---

## Lost in the Middle 問題

LLM はコンテキストの先頭と末尾に最も注目し、中間の情報は精度が30%以上落ちる（MIT 2025）。

- **推奨チャンクサイズ**: 200〜400トークン（約15〜30行）
- これを超えるドキュメントは分割 or 先頭に TL;DR を置く
- 大きなファイルを丸ごと context に渡すのは逆効果

---

## 重複 = 重要度シグナルの保存

「同じことが何度も出てきた = 重要」という情報は、単純なマージ・削除で消えてしまう。

### 原則

- **Raw 層（Episodic）を削除しない**: Semantic/Summary 層でのみデデュップする
- **頻度を構造として残す**: 重複を消すのではなく、tier 昇格のトリガーにする

### 実装パターン

**1. importance コメント（最もシンプル）**

```markdown
## TypeScript: as キャスト禁止
<!-- importance: critical | mentions: 4 | first-seen: 2025-11 -->
```

`mentions` カウンターが抽象化・マージのプライオリティ判断に使える。

**2. Tier Promotion（Mem0 方式）**  
`mentions >= 3` になったエントリを ephemeral 記録 → docs/ のコアルールに昇格。

**3. Confidence Boosting（Zep/Graphiti 方式）**  
知識グラフで同じ事実が複数エピソードに登場するとエッジの信頼度スコアが上がる。

---

## Progressive Summarization（Forte メソッド）

ドキュメントが育つほど、先頭に TL;DR を追加していく。重要度が上がった内容ほど要約に昇格させる。

| 層 | 操作 |
|----|-----|
| 0 | 元資料（保存） |
| 1 | 切り取った抜粋 |
| 2 | **太字**で重要箇所を強調 |
| 3 | ==ハイライト== でベスト of ベスト |
| 4 | 自分の言葉でエグゼクティブサマリー |

ドキュメント先頭の TL;DR = 層4。これにより「要約 → 詳細」の2段階参照が可能になる。

---

## CLAUDE.md / システムプロンプトの最適構造

```
CLAUDE.md — 300行以下、普遍的ルールのみ
  ↓ @-参照（遅延読み込み）で必要時だけロード
docs/typescript.md   ← TSコードを触るとき
docs/react.md        ← Reactコードを触るとき
settings.json
  rules: パス別スコープルール（該当ディレクトリを読んだときだけ発火）
  hooks: ツールの pre/post ゲート
```

### 遅延ロード vs 即時埋め込み

| 方式 | 効果 |
|------|------|
| `@-embed`（CLAUDE.md 内に書く） | **毎セッション全文埋め込み** → anti-pattern |
| `@-参照`（コード内でパス言及） | **オンデマンドで読む** → 推奨 |
| `settings.json rules` | **パスマッチ時のみ発動** → 最も効率的 |

遅延ロードでコンテキストを最大95%削減できる。

### 含めるべき内容 vs 省くべき内容

| 含める | 省く |
|--------|------|
| Tech stack・ビルドコマンド | スタイルガイド（linter に委ねる） |
| プロジェクトの WHY | タスク固有の指示 |
| 変なコンベンション・gotcha | Claude がデフォルトで正しくやること |
| 失敗パターン（観測済み） | トラブルシューティングセクション |

---

## ドキュメント維持のサイクル

```
re スキル実行（学習を記録）
  ↓ 毎回
既存エントリへの言及 → mentions++
新規エントリ        → mentions: 1 で登録
  ↓ 定期的（月1回程度）
mentions >= 3 → docs/ のコアルールに昇格（Semantic tier）
mentions == 1 かつ 3ヶ月経過 → アーカイブ候補
```

---

## 参考

- [State of AI Agent Memory 2026 — Mem0](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Zep: Temporal Knowledge Graph (Graphiti) — arXiv 2501.13956](https://arxiv.org/html/2501.13956v1)
- [Writing a good CLAUDE.md — HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [CLAUDE.md Best Practices — Arize](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/)
- [Progressive Summarization — Forte Labs](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/)
- [How Claude Code Builds a System Prompt — dbreunig.com](https://www.dbreunig.com/2026/04/04/how-claude-code-builds-a-system-prompt.html)
- [Lost in the Middle — DEV Community](https://dev.to/thousand_miles_ai/the-lost-in-the-middle-problem-why-llms-ignore-the-middle-of-your-context-window-3al2)
