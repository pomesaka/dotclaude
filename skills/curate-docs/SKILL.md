---
name: curate-docs
description: ~/.claude/docs/ とスキルの健全性を監査し、肥大化・重複・@-embed などの問題を検出して整理する。
when_to_use: 「docs を整理して」「スキルを整理して」「ドキュメントの健全性を確認して」「docs が大きくなってきた」「重複を見て」と言われたとき。
allowed-tools: Read, Edit, Write, Bash(fd *), Bash(wc *), Bash(rg *)
model: sonnet
---

# curate-docs

`~/.claude/docs/` と `~/.claude/skills/` の健全性を `llm-memory-management.md` の知見に基づいて監査・整理する。

理論的背景は以下を参照:

!`cat ~/.claude/docs/llm-memory-management.md`

---

## フロー

### Step 1: スキャン

以下をすべて並行して収集する。

**1-a. docs/ のファイルサイズ**

```
wc -l ~/.claude/docs/*.md
```

`design-md/` 配下は別集計。

**1-b. TL;DR の有無**

各ファイル先頭20行に `TL;DR`・`## まとめ`・`> ` (blockquote) のいずれかがあるかを確認。

```
rg -l 'TL;DR|^> ' ~/.claude/docs/
```

**1-c. importance メタデータの有無**

```
rg -rn 'importance:' ~/.claude/docs/
```

**1-d. CLAUDE.md の @-embed パターン**

```
rg '@~/.claude/docs/' ~/.claude/CLAUDE.md
```

**1-e. スキルの SKILL.md サイズ**

```
wc -l ~/.claude/skills/*/SKILL.md
```

**1-f. スキルの Gotchas セクション有無**

```
rg -rL 'Gotchas' ~/.claude/skills/*/SKILL.md
```

---

### Step 2: 監査レポートの出力

以下の形式で報告する。

```
## curate-docs 監査レポート

### 🔴 Critical（今すぐ対処すべき）
- CLAUDE.md の @-embed: `@~/.claude/docs/xxx.md` → 毎セッション全文埋め込み
- docs ファイルで 200 行超: ...

### 🟡 Warning（近いうちに対処）
- 30〜200 行で TL;DR なし: ...
- importance メタデータ未設定（mentions tracking できていない）: ...

### 🟢 Info（把握だけ）
- SKILL.md で Gotchas なし: ...（知見が蓄積できていない）
- design-md/ 合計行数: N 行（frontend-design スキル経由でオンデマンドロード推奨）

### ✅ 問題なし
- ...
```

#### mentions カウンターの解釈

`<!-- importance: ... | mentions: N -->` コメントがある場合、以下の判断基準を適用する:

| mentions | 推奨アクション |
|---------|--------------|
| >= 3 | CLAUDE.md またはスキルのコアルールに昇格を検討 |
| 1 かつ 作成から 3 ヶ月超 | アーカイブ候補として提示 |
| なし | importance メタデータ追加を提案 |

---

### Step 3: アクションの選択

レポートを出力したあと、AskUserQuestion で対応方針を確認する。

**選択肢の例:**
- Critical をすべて修正する
- 特定のファイルだけ修正する（ファイル名を指定）
- TL;DR を一括追加する
- 今は確認だけ（何もしない）

---

### Step 4: 修正実行

ユーザーの選択に基づいて以下を実行する。

#### 4-a. @-embed の除去

`CLAUDE.md` 内の `@~/.claude/docs/xxx.md` を、ファイルパスの文字列参照（`docs/xxx.md` のような plain text）に書き換える。

**Before:**
```
コマンドリファレンス: `@~/.claude/docs/jj.md`
```

**After:**
```
コマンドリファレンス: `~/.claude/docs/jj.md`（必要時に Read）
```

#### 4-b. TL;DR の追加

対象ファイルを読み込み、内容を3〜5行で要約した TL;DR を先頭に追加する。

```markdown
> **TL;DR**: [ここに3〜5行の要約]
```

Lost in the Middle 対策として、LLM が先頭を読んだだけで要旨を把握できるようにする。

#### 4-c. importance メタデータの追加

各セクションの見出し直下に以下を追加する（まだない場合のみ）。

```markdown
<!-- importance: medium | mentions: 1 | first-seen: YYYY-MM -->
```

`importance` の目安:
- `critical`: 違反すると壊れる/セキュリティ問題になるルール
- `high`: 何度も引っかかった・re スキルで複数回記録されたもの
- `medium`: 知っておくべきが違反しても致命的でないもの
- `low`: 参考程度

#### 4-d. 大きなファイルの分割提案

200 行超のファイルは、主要セクション構成を提示して分割案をユーザーに提案する。実際の分割はユーザーの承認後に実行する。

---

## Gotchas

- **design-md/ は別扱い**: `design-md/` 配下の5ファイルは `frontend-design` スキルがオンデマンドで読む設計。一括ロードされているわけではないため Critical にしない
- **CLAUDE.md への書き戻しは慎重に**: @-embed 除去後の文言がコンテキストとして機能するか Read で確認してから Edit する
- **importance: critical は少数精鋭に**: すべてを critical にすると意味がなくなる。本当に違反したときに壊れるものだけ
- **mentions カウントは手動**: 自動追跡の仕組みはないため、`re` スキル実行時に手動でインクリメントする運用になる。この限界を踏まえて提案する
