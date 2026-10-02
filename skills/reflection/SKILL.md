---
name: reflection
description: LLM が毎回読むドキュメントを圧縮する。具体例チェーンを上位原則に統合し、元の実例は archive に退避する。
when_to_use: 「CLAUDE.md が肥大化してきた」「gotcha が多すぎる」「conventions.md を整理して」「亜種が増えすぎ」「原則にまとめて」「上位に昇格させたい」「具体例をコンパクトにしたい」「context を圧縮したい」と言われたとき。単一ファイルの機械的な体裁監査は /curate-docs、単発の Gotcha 追記は /gotcha を使う。このスキルは**LLM が読むトークン数を減らすことを主目的**にした能動的な圧縮フェーズ。
argument-hint: [primary-doc-path]
allowed-tools: Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(cat *), Bash(wc *), Bash(rg *), Bash(fd *), Bash(ls *), Bash(mkdir *), Bash(date *)
model: opus
---

# reflection

## 主目的: context 圧縮

LLM が毎回読み込むドキュメント（`CLAUDE.md`・プロジェクトの `conventions.md` 等）は、蓄積された具体例チェーンで肥大化しやすい。**トークン単価あたりの情報量を上げること**（= 少ないトークンで同じ判断が可能な状態にすること）がこのスキルの主目的。

**副目的**: その過程で得られる抽象化・原則の発見・archive による人間の trace 可能性。

### 立ち位置

- **/curate-docs**: 横断監査（サイズ・TL;DR・@-embed・重複検出）。受動的な健全性チェック
- **/gotcha**: 単発の失敗談追記。具体例を 1 件足すだけ
- **このスキル**: 蓄積された具体例チェーンを **live doc から抽出 → 原則に統合 → 元の実例は archive に退避** し、LLM が読むトークン数を実効的に減らす

### アーキテクチャ: Progressive Disclosure

```
[live doc] CLAUDE.md 等 ─ LLM が毎セッション読む・原則のみ・薄く保つ
     │
     │ 各原則の末尾に「詳細は archive/<basename>-YYYY-MM-DD.md#N-<slug>」
     ▼
[archive] archive/CLAUDE.md-2026-07-02.md
         ─ 1 reflection run = 1 ファイル・複数原則をセクション分けで格納
         ─ 人間が grep で trace 可能・LLM は必要時のみ Read
```

**live doc に残すもの**: 原則本文 + WHY + archive の該当セクションへの 1 行リンク
**archive に退避するもの**: 統合前の具体例チェーン全文（亜種・実例・issue 番号・行番号）

**1 archive = 1 reflection run**: 同時に圧縮した複数原則は 1 ファイルに集約し、`## N. <slug>` のセクションで区切る。ファイル名を per-slug に分散させると archive ディレクトリが乱雑になり trace 性が下がる。

### 理論的背景

Stanford の Generative Agents 論文 (Park et al. 2023) の Reflection 機構（大量メモリから 3 つの高レベル問い → retrieve → evidence 付き insight 合成）をプロンプト技法として借用する。ただし論文の目的は「エージェントの未来行動のための洞察」で、このスキルの目的は「読むトークン数を減らす context 圧縮」なので、**問い立ての基準は「salience」でなく「compression opportunity（どこに冗長性があるか）」** で読み替える。

---

## フロー

### Phase 1: 対象範囲の決定

引数 `$ARGUMENTS` があればそれを primary target にする。なければ以下をデフォルト対象とする。

- `~/.claude/CLAUDE.md`
- `~/.claude/docs/*.md`（`design-md/` 配下は除外）
- `~/.claude/skills/*/SKILL.md`

**read frequency の確認**: 対象ファイルが「毎セッション読まれる」（CLAUDE.md 等）か「必要時のみ Read される」（`docs/*.md` の一部）かを把握する。**圧縮の投資対効果は「読み込み頻度 × 削減量」で決まる**ため、頻度の高いファイルほど圧縮の優先度が高い。

**related docs のスキャン**: primary target を Read し、参照・兄弟ファイルを related 候補として抽出。**AskUserQuestion で対象範囲を確認する**（除外オプションを提示）。

### Phase 2: 圧縮対象ブロックの抽出（2 レイヤーで列挙）

対象ドキュメントを走査し、**2 レイヤー** でブロックを列挙する。

**レイヤー L（Local / 節内圧縮）**:
- 同一節内に「亜種:」「実例:」「補足:」が 3 件以上並んでいる
- 単一節が長文（100 語超）で、抽象原則の short WHY で置換可能

**レイヤー X（Cross-section / 節間 meta-pattern）** ← **必須で必ず 1 パス実行する**:
- **異なる節が同じ根本原因を扱っている**（例: 「合成キー集約」「as キャスト全除去」「Route 削除時の呼び出し側検索」「TODO(#NNN) 掃除」がすべて「PR スコープ横断で rg 全件確認」という meta-rule に集約可能）
- **同一 lifecycle の起票側と掃除側が別節に散らばっている**（例: 「起票時の TODO(#NNN) セット push」と「JSDoc 後続 issue コメント掃除」は同じ placeholder lifecycle の両端）
- 複数節に「〜のときは rg で全件確認」「〜を PR で横断チェック」など類似の操作が繰り返し登場している

各ブロックに内部 ID を振る: `[E1]`, `[E2]`, ...（レイヤー L / X の区別も併記: `[E3-X]` など）。この ID は永続化しない。

**300 行超のファイル** は Read の窓を分割し、見出し + 各ブロックの先頭 3-5 行だけを抽出。全文はまだコンテキストに載せない。

**レイヤー X の優先度**: X で複数節を meta-rule に統合できる場合、統合された節は L の対象から外して X 経由で archive 送りにする（同じ節を 2 度圧縮しないため）。**Phase 3-4 は必ず X → L の順で処理する**。

### Phase 3: 圧縮機会の問い立て（2 レイヤーで問う）

抽出したブロックに対して **2 種類の問い** を必ず立てる。X → L の順で処理する。

**X 問い（Cross-section meta-pattern・必須で 2-3 問）**:

> Given the block summaries above, what are the **2-3 cross-section meta-patterns** where multiple sections share a common root cause or lifecycle, and could be consolidated into a single higher-order principle?
> Focus on:
> - 複数節が同じ「操作」を繰り返し推奨している（rg 全件確認・PR 横断チェック・drift 検出など）
> - 複数節が同じ lifecycle の異なるフェーズ（起票 / 掃除 / 検証）を扱っている
> - 表層は別の技術トピックだが、深層で同一の失敗モードを扱っている

**期待される問いの例（CLAUDE.md 対象）**:
- 「複数節に散らばる『PR スコープ横断 rg 全件確認』は 1 つの meta-rule に集約できるか？（合成キー / as キャスト / TODO / Route 削除 / shouldThrow が該当）」
- 「『TODO(#NNN) セット push』と『JSDoc 後続 issue コメント掃除』は同じ placeholder lifecycle の両端なので統合できるか？」

**L 問い（Local compression・X で扱わなかった残りに対して 3 問）**:

> Given the remaining blocks not covered by X, what are the **3 most compressible local patterns** to reduce redundant tokens?
> Focus on:
> - Repeating 亜種 chains within a single section
> - Verbose specific examples that a short WHY-first principle could replace

**期待される問いの例**:
- 「『WHY コメントは検証してから書く』の 4 亜種は 1 つの原則 + archive 退避で圧縮できるか？」

問いはユーザーに提示せず内部で使う（提示するとユーザーの負担が増える）。

### Phase 4: 統合原則の合成（X → L の順）

**Step 1: X（meta-pattern）から先に合成する**。これで複数節が消えるため、L の対象が減る。

各 X 問いについて、以下を行う。

1. **retrieve**: 該当ブロック（3-8 件、複数節にまたがる）を選ぶ
2. **本文読み込み**: 選ばれたブロックのみ Read
3. **meta-rule 合成**: 次の形式で出力（**種別を X と明記**）

```
種別: X（cross-section meta-rule）
meta-rule: <WHY-first で書かれた 1-2 文の higher-order principle>
統合対象: [E3-X], [E4-X], [E5-X]（内部 ID・複数節）
現在の合計行数: N 行（各節の合計）/ 統合後の live doc 行数: M 行 / 削減: X 行
昇格先候補: <read-frequency の高い順に。通常は primary-doc の目立つ位置>
書き戻し方針: 統合対象の N 節すべてを archive に退避し、live doc は meta-rule 1 節 + archive リンクに置換
```

**Step 2: L（local）を X で扱わなかったブロックに対して合成する**

各 L 問いについて、以下を行う。

1. **retrieve**: 該当ブロック（3-8 件、通常は同一節内）を選ぶ
2. **本文読み込み**: 選ばれたブロックのみ Read
3. **統合原則の合成**: 次の形式で出力（**種別を L と明記**）

```
種別: L（local compression）
原則: <WHY-first で書かれた 1-2 文の short principle>
統合対象: [E1-L], [E2-L]（内部 ID・同一節内）
現在の合計行数: N 行 / 統合後の live doc 行数: M 行 / 削減: X 行
昇格先候補: <read-frequency の高い順に>
```

### Phase 5: 昇格先の確認

各原則について AskUserQuestion で以下を確認する。

```
質問: この原則をどこに置きますか？
選択肢:
- CLAUDE.md の該当セクション（毎セッション読まれる・最高頻度）
- conventions.md の該当セクション（プロジェクト作業時のみ・中頻度）
- docs/xxx.md の新規節（オンデマンド・低頻度）
- 却下（この抽象は採用しない）
```

**判断基準**: 「この原則を live doc に置いたときの `トークン増加 × 読み込み頻度` と、archive 退避で得られる `トークン削減 × 読み込み頻度` の差引がプラスか」。プラスなら昇格、マイナスなら再検討。

### Phase 6: 圧縮実行

ユーザーが承認した原則について以下を実行する。

#### 6-a. archive ファイルへの退避（archive-split の原則のみ）

書き戻し方針が **archive-split**（原則だけ残して、亜種・issue 番号・再現条件といった unique 情報を live doc から出す）の原則についてのみ、元の具体例チェーンを **1 ファイルに集約して** archive に退避する（1 reflection run = 1 archive ファイル）。**inline-merge**（統合後も unique 情報が live doc に残る・消えるのは重複や矛盾の片割れだけ）の原則は archive 不要。6-a をスキップして 6-b へ（区別の詳細は Gotchas 参照）。run 内の全原則が inline-merge なら archive ファイル自体を作らない。

**archive パス**: `<primary-doc の親ディレクトリ>/archive/<元のファイル名>-YYYY-MM-DD.md`

例:
- `~/.claude/CLAUDE.md` を圧縮 → `~/.claude/archive/CLAUDE.md-2026-07-02.md`
- `~/github.com/Accel-Hack/noah/docs/apps/conventions.md` を圧縮 → `~/github.com/Accel-Hack/noah/docs/apps/archive/conventions.md-2026-07-02.md`

同日に複数回実行する場合は `-01`, `-02` サフィックスで区別（レアケース）。

`YYYY-MM-DD` は `date +%Y-%m-%d` で取得（頭で計算しない。CLAUDE.md の「ツール所有ファイル」規約参照）。

**archive ファイルの構造**:

```markdown
# <primary-doc-basename> 圧縮 archive (YYYY-MM-DD)

**退避元**: <primary-doc-path>
**退避日**: YYYY-MM-DD
**圧縮 run で扱った原則数**: N

---

## 1. <slug1>

**live doc の対応原則**: 「<原則タイトル>」（<元の章名>）

### 元の具体例チェーン

（統合前の亜種・実例・issue 番号・行番号を全文保存）

---

## 2. <slug2>

...
```

`slug` は各原則の要旨を kebab-case で 3-5 語（`why-comment-verification` / `switch-vs-record-vs-if` 等）。live doc からのリンクは `archive/<basename>-YYYY-MM-DD.md#N-<slug>` の形式（`N` はセクション番号、Markdown アンカーは `N-<slug>` のように prefix number 付きで自動生成される）。

**archive ディレクトリの symlink**: primary-doc がシンボリックリンク経由でアクセスされている場合（`~/.claude/CLAUDE.md` → `~/github.com/pomesaka/dotclaude/CLAUDE.md` 等）、archive も同じ親ディレクトリに symlink を張って相対リンクを解決可能にする（初回のみ `ln -s <実体>/archive <symlink 親>/archive`）。

#### 6-b. live doc の圧縮

元の具体例チェーンを削除し、**原則 + archive リンクの 1 行** に置換する。

```markdown
- **<原則タイトル>**: <WHY-first の短い本文（1-3 文）>。詳細と実例は `archive/<元のファイル名>-YYYY-MM-DD.md#N-<slug>` を参照。
  <!-- importance: high | mentions: N | first-seen: YYYY-MM -->
```

**live doc からは削除する**:
- 「亜種:」「実例:」「補足:」チェーン全文
- issue 番号・PR 番号・行番号による位置参照
- 具体的な変数名・ファイル名を主役にした長文

**live doc に残す**:
- 原則本文（WHY 含む）
- archive への 1 行リンク
- importance メタデータ（`mentions` は統合した件数の合計に更新）

#### 6-c. 圧縮メトリクスの提示

書き戻しの diff を提示する前に、**必ず** 以下を出力する。

```
## 圧縮メトリクス

対象ファイル: <primary-doc-path>
Before: N 行 / 推定 M トークン
After:  N' 行 / 推定 M' トークン
削減:   ΔN 行 / ΔM トークン（X% 削減）

archive 生成:
- archive/<元のファイル名>-YYYY-MM-DD.md（S 行 / N 原則を集約）
```

トークン数の推定は「行数 × 平均トークン/行」で概算する（正確値でなくてよい・削減効果の桁を示せば十分）。

#### 6-d. ユーザー承認

メトリクスと diff を提示し、承認後に書き戻す。承認前に自動で書き戻しはしない。

---

## 判断基準

### 圧縮すべき / しないの境界

**圧縮する**:
- 同一根本原因の実例が 3 件以上並んでいる
- 「亜種:」「実例:」「補足:」が単一ルールの下で 3 段以上ネストしている
- 複数節・複数ファイルで同じパターンが繰り返し言及されている
- 単一の gotcha でも 100 語超で、原則 + archive で 30 語に圧縮できる見込みがある

**圧縮しない**:
- ADR / 設計判断記録（具体こそ意思決定の根拠）
- コマンドリファレンス（jj.md 等）
- ハウツー・手順書
- 単発の gotcha で短文（既に圧縮済み）
- **原則化すると WHY が失われるケース**（具体こそが情報源になっている）

### 原則の質のセルフチェック

書き戻し前に自問する。

- **WHY を含んでいるか？** WHY 抜きの抽象は「やり残し / バグ」と区別がつかない（CLAUDE.md 規約より）
- **原則だけを読んだ将来の LLM/自分が、archive を Read せずに判断できるか？** できないなら原則が薄すぎるサイン。補強するか、そもそも圧縮に向かないと判断する
- **既存の上位原則で既にカバーされていないか？** 重複を作ると情報密度が下がる（圧縮の逆効果）

---

## Gotchas

- **X（cross-section）を先に実行しないと L で消費した節を再度消せない**: Phase 4 で L から先に合成すると、複数節が個別に「原則 + archive」化される。その後 X で meta-rule に集約しようとしても、元の節は既に消えているので統合できない。**必ず X → L の順**。X で meta-rule に統合された節は L の対象から外す。
- **X の meta-rule が既存 L 原則の上位互換になっているか確認する**: X の meta-rule は「複数節の共通原則」なので、既に個別に書かれている L 原則がその子集合になっているケースがある。この場合、既存 L 原則は削除して meta-rule に一本化する（重複を残すと情報密度が下がる）。
- **X 統合の判断基準**: 「表層のトピックが違っても、深層の失敗モード（rg 全件確認をサボる・placeholder を掃除しない・drift 検出をサボる など）が同一か？」YES なら X 候補、NO なら L 候補。曖昧なら **AskUserQuestion で「これは同じ根本原因ですか？」を必ず聞く**（LLM 単独で無理に横断化すると各文脈のニュアンスが消える）。
- **入力を全部一気に投げない**: 元論文が 100 メモリに限定しているのには理由がある。conventions.md（2596 行）+ CLAUDE.md（数百行）を一括で LLM に渡すと 3 問が総花的になり圧縮機会が見えなくなる。Phase 2 で「見出し + ブロック先頭数行」だけ抽出し、Phase 4 で本文を Read する。
- **live doc から具体例を全消しできない、というルールを持たない**: 過去の設計では「代表例 1-2 件は残す」としていたが、これは圧縮の上限を作る。archive に退避するのでトレーサビリティは保たれる。**live doc は原則のみ、実例は archive に集約** が原則。
- **archive が必要なのは archive-split のみ。inline-merge は archive 不要**: archive の存在意義は「live doc から消えた **unique 情報**（亜種・issue 番号・再現条件）の trace 可能性」。**archive-split** = 原則 1 行だけ残して実例チェーンを外に出す → unique 情報が live doc から消えるので archive 必須。**inline-merge** = 統合後も WHY・issue 参照・再現条件が live doc に残る編集 → 消えるのは重複コピー・矛盾の片割れ・NG コードの逆写しなど定義上の冗長物なので、archive するとそれ自体が矛盾（冗長物の保管庫になる）。履歴は VCS に任せる。**この区別の規律**: inline-merge と呼べる条件は「unique 情報が live doc に残っていること」。それを満たさない削除をしたくなったら、それは inline-merge ではなく archive-split を選ぶ（2026-07 の docs/ 圧縮 run で境界が曖昧なまま実行し、後追い archive を作りかけて撤回した実例）。
- **archive リンクを絶対パスで書かない**: `archive/<元のファイル名>-YYYY-MM-DD.md#N-<slug>` の相対パス表記にする（primary-doc と同じディレクトリの archive/ を指す）。絶対パスにするとリポジトリ移動時に壊れる。
- **primary-doc が symlink 経由でアクセスされる場合、archive も symlink で辿れるようにする。初回セットアップを忘れると相対リンクが解決しない**: `~/.claude/CLAUDE.md` のように primary-doc が実体（例: `~/github.com/pomesaka/dotclaude/CLAUDE.md`）への symlink 経由で読まれるとき、live doc 内の相対リンク `archive/xxx.md` は「symlink 経由で読んだ場合の解決先」（`~/.claude/archive/xxx.md`）を指す。archive 実体を `<実体リポジトリ>/archive/` に置いただけでは symlink 側から解決できない。初回だけ `ln -s <実体>/archive <symlink 親>/archive` を実行して、両方のパスから同じ archive を辿れるようにする。2 回目以降の run では既存 symlink を使うので不要。
- **archive は 1 reflection run = 1 ファイルに集約する**: 原則ごとに別ファイルにすると archive ディレクトリが乱雑になり、後から「あの月に何を圧縮したか」を追いにくい。1 run で処理した複数原則は 1 ファイル内でセクション分けする。同日再実行時は `-01`, `-02` サフィックスで区別。
- **read frequency が低いファイルを無理に圧縮しない**: `docs/*.md` の一部はオンデマンド Read なので、圧縮の ROI が低い。CLAUDE.md（毎セッション）を最優先、conventions.md（プロジェクト作業時）を次点にする。
- **横断原則を強引に作らない**: 「app 間 drift 検出」のような真の横断原則は存在するが、無理に横断化すると各文脈の重要な違いが消える。3 件揃っても「別ドメインで偶然形が似ているだけ」なら却下する。
- **却下も成果**: Phase 5 で「却下」を選ばれた場合、元ブロックは触らない。圧縮候補として検討したが根拠が弱い情報は次回スキル実行時の参考になる。
- **evidence 内部 ID (`[E1]` 等) を永続化しない**: スキル実行内での識別子。archive にも live doc にも書かない（後続の reflection 実行で番号が衝突する）。archive では退避元の元文脈が「issue 258」のような自然な参照で書かれているのでそれで十分。
- **`YYYY-MM` は `date +%Y-%m` で取得する**: 頭で計算するとタイムゾーン・年を取り違える。CLAUDE.md の「ツール所有ファイル」規約と同じ理由。
