---
name: curate-docs
description: ~/.claude/docs/ とスキルの健全性を監査し、肥大化・重複・古い記述・@-embed などの問題を検出して整理する。
when_to_use: 「docs を整理して」「スキルを整理して」「ドキュメントの健全性を確認して」「docs が大きくなってきた」「重複を見て」と言われたとき。
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash(fd *), Bash(wc *), Bash(rg *)
model: sonnet
---

# curate-docs

`~/.claude/docs/` と `~/.claude/skills/` の健全性を `llm-memory-management.md` の知見に基づいて監査・整理する。

理論的背景は以下を参照。

!`cat ~/.claude/docs/llm-memory-management.md`

プロンプト品質の基準（NG/OK ペア・強度ラダー・テスタビリティ）は以下を参照。

!`cat ~/.claude/docs/prompt-engineering.md`

何をどこに書くか（コードコメントと文書の置き分け、同じ規則を 1 か所に書くこと）は以下を参照。

!`cat ~/.claude/docs/documentation-practices.md`

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
rg -c 'importance:' ~/.claude/docs/
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
rg --files-without-match 'Gotchas' ~/.claude/skills/*/SKILL.md
```

**1-g. 中身の監査**

1-a〜1-f は形の検査で、中身の問題は拾えない。長いファイルと、同じ語が多く出るファイルから順に読み、`documentation-practices.md` の基準で次を探す。

- 同じ規則が複数の箇所に書かれている（片方だけ直されて食い違う）
- コードや型の逐語訳、関数・ファイルの網羅表、どこにでもある解説
- 実装が終わった計画（Design Doc など）が残っている。まだ決まっていない計画と、いま有効な規則が混ざっている
- リンク切れ、互いに矛盾する指示

---

### Step 2: 監査レポートの出力

以下の形式で報告する。

```
## curate-docs 監査レポート

### 🔴 Critical（今すぐ対処すべき）
- CLAUDE.md の @-embed: `@~/.claude/docs/xxx.md` → 毎セッション全文埋め込み
- 互いに矛盾する指示: ...

### 🟡 Warning（近いうちに対処）
- 30 行超で TL;DR なし: ...
- importance メタデータ未設定（mentions tracking できていない）: ...
- 同じ規則が複数の箇所にある: ...（どちらに寄せるか）
- 実装が終わった計画、コードの逐語訳: ...
- docs ファイルで 200 行超: ...（読む目的で分けられるか）

### 🟢 Info（把握だけ）
- SKILL.md で Gotchas なし: ...（知見が蓄積できていない）
- design-md/ 合計行数: N 行（frontend-design スキル経由でオンデマンドロード推奨）

### ✅ 問題なし
- ...
```

#### mentions カウンターの解釈

`<!-- importance: ... | mentions: N -->` コメントがある場合、以下の判断基準を適用する。

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

`importance` の目安を以下に示す。
- `critical`: 違反すると壊れる/セキュリティ問題になるルール
- `high`: 何度も引っかかった・re スキルで複数回記録されたもの
- `medium`: 知っておくべきが違反しても致命的でないもの
- `low`: 参考程度

#### 4-d. 大きなファイルの分割

200 行超のファイルは、読む目的が節ごとに違うときだけ分割する。読む目的が 1 つなら、分けると読み手が両方を開くことになるので、分けずに TL;DR を整える。実際の分割はユーザーの承認後に実行する。

1. **分割軸を決める**: 「いつ開くか」の観点でグループを作る（概念理解 / リソース定義 / CI/CD 設定 など）
2. **TL;DR に相互参照を追加**: 元ファイルの TL;DR 末尾に `詳細 → xxx.md` を追記する
3. **新ファイルにも TL;DR を付ける**: 各ファイルが独立して意味をなすようにする

#### 4-e. 具体的記述の抽象化

同じトピックに関する複数の具体的な Gotchas / 注意点は、原則でまとめてコンパクトにできる。

**抽象化の判断基準**:
- 同じ根本原因を持つ具体例が 3 件以上 → 1 つの原則として書き直す
- 実装固有の詳細（変数名・ARN 文字列・バージョン番号）が主役になっている → 抽象化が足りないサイン
- 「なぜそうなるか」が原則に書けていれば、具体例は 1〜2 件あれば十分

**例（Before/After）**:
```
# Before（具体3件）
- ecs:DescribeServices は Resource: * 必須
- ecr:GetAuthorizationToken は Resource: * 必須
- s3:ListAllMyBuckets は Resource: * 必須

# After（原則1件 + 例示）
- **アカウントレベル API は Resource: "*" 必須**:
  ecs:DescribeServices・ecr:GetAuthorizationToken 等の account-level API は ARN スコープ指定不可
```

抽象化するほど LLM にとって有用な情報密度が上がる（同じ行数でより多くのパターンをカバーできる）。

#### 4-f. 重複の統合と、要らない記述の削除

同じ規則が複数の箇所にあれば、読み手が最初に開く 1 か所に本文を残し、ほかはリンクにする。コードの逐語訳と、実装が終わった計画は消す。1 つの実装に閉じた理由を文書から移すときは、移す先のコードと既存のコメントを読み、同じコメントを足さない。経緯は Git に残るので、消した内容の履歴を別の文書に書かない。

---

## Gotchas

- **design-md/ は別扱い**: `design-md/` 配下の5ファイルは `frontend-design` スキルがオンデマンドで読む設計。一括ロードされているわけではないため Critical にしない
- **CLAUDE.md への書き戻しは慎重に**: @-embed 除去後の文言がコンテキストとして機能するか Read で確認してから Edit する
- **importance: critical は少数精鋭に**: すべてを critical にすると意味がなくなる。本当に違反したときに壊れるものだけ
- **`rg` に `-r` を付けない。`-r` は再帰ではなく「置換」**: `rg -rL 'Gotchas'` は「一致しないファイルの一覧」ではなく、`Gotchas` を `L` に置き換えて全件を表示する（エラーにならないので、全スキルに Gotchas が無いように見える）。一致しないファイルは `--files-without-match`、件数は `-c` で出す。`rg` は既定で再帰する。CLAUDE.md は行数ではなく文字数（`wc -m`）で測る。1 項目が 1 行に入っているので、行数は 300 未満でも中身は数万文字ある（2026-10-07 の監査で 284 行・38,365 文字）
  <!-- importance: high | mentions: 1 | first-seen: 2026-10 -->
- **短くするために、横断の約束と外部の制約を消さない**: 行数を減らすこと自体は目的ではない。消す前に「これを消すと、誰が、どの判断で困るか」を答え、答えられたものは残す
- **mentions カウントは手動**: 自動追跡の仕組みはないため、`re` スキル実行時に手動でインクリメントする運用になる。この限界を踏まえて提案する
