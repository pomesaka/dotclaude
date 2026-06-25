---
name: reflection
description: ドキュメント内の具体例集積から共通原則を抽出し、evidence 番号付きで上位ポリシーに昇格させる。
when_to_use: 「CLAUDE.md が肥大化してきた」「gotcha が多すぎる」「conventions.md を整理して」「亜種が増えすぎ」「原則にまとめて」「上位に昇格させたい」「具体例をコンパクトにしたい」と言われたとき。単一ファイルの機械的な体裁監査は /curate-docs、単発の Gotcha 追記は /gotcha を使う。このスキルは**複数の具体例からより抽象的な原則を合成する**能動的な圧縮フェーズ。
argument-hint: [primary-doc-path]
allowed-tools: Read, Edit, Write, Grep, Glob, AskUserQuestion, Bash(cat *), Bash(wc *), Bash(rg *), Bash(fd *), Bash(ls *)
model: opus
---

# reflection

## 立ち位置

- **/curate-docs**: 横断監査（サイズ・TL;DR・@-embed・重複検出）— 受動的な健全性チェック
- **/gotcha**: 単発の失敗談追記 — 具体例を 1 件足すだけ
- **このスキル**: 蓄積された具体例チェーンを走査し、**同じ根本原因の実例が 3 件以上並んでいる箇所を検出 → 上位原則に抽象化 → evidence 番号付きで昇格** させる能動的な圧縮フェーズ

理論的背景は Stanford の Generative Agents 論文 (Park et al. 2023) の Reflection 機構:

1. 大量のメモリを LLM に渡し「3 つの高レベルな問い」を立てさせる
2. 各問いに関連するメモリを retrieve する
3. `原則 (because of E3, E7, E12)` の形式で evidence 番号付きの洞察を合成する
4. 洞察を memory stream に書き戻す（再帰的にさらに反省可能）

このスキルは (1)-(4) をドキュメント整理に適用したもの。**evidence 番号を残すことで、抽象化後も具体例への逆引きが保たれ**、抽象が誤っていた場合の検証が可能になる。

---

## フロー

### Phase 1: 対象範囲の決定

引数 `$ARGUMENTS` があればそれを primary target にする。なければ以下をデフォルト対象とする:

- `~/.claude/CLAUDE.md`
- `~/.claude/docs/*.md`（`design-md/` 配下は除外）
- `~/.claude/skills/*/SKILL.md`

**related docs のスキャン**: primary target を Read し、以下を related 候補として抽出:

- `@` や相対パスで参照している他の md ファイル
- 同一ディレクトリ配下の兄弟 md ファイル（`docs/apps/*.md` など）
- primary target 内で言及されているスキル・ドキュメント名

related 候補が見つかったら **AskUserQuestion で対象範囲を確認する**:

```
質問: 以下を対象にします。除外したいものはありますか？
選択肢:
- 全部そのままでいい（推奨）
- primary target のみに絞る（related を除外）
- 一部だけ除外する（どれを除外か指定）
```

### Phase 2: 圧縮対象ブロックの抽出（evidence 番号付け）

対象ドキュメント全体を走査し、以下のいずれかに該当するブロックを列挙する:

- 同一節内に「亜種:」「実例:」「補足:」が 3 件以上並んでいる
- 同じ根本原因（as キャスト・drift 検出・barrel 禁止など）を扱う複数の節
- Gotchas セクション内に類似落とし穴が集積している

各ブロックに **stable な evidence ID** を振る: `[E1]`, `[E2]`, ...

出力例:

```
[E1] CLAUDE.md L142-158「WHY コメントは実機で検証」の亜種チェーン（5 件）
[E2] CLAUDE.md L201-215「as キャスト全除去チェックのパターン」
[E3] conventions.md L920「app 間 drift 検出（access-guard）」
[E4] conventions.md L1552「app 間 drift 検出（transpilePackages）」
[E5] conventions.md L2304「app 間 drift 検出（env schema）」
...
```

**300 行を超える対象**は Read の窓を分割する。全文をコンテキストに載せず、見出し + 各ブロックの先頭 3-5 行だけを抽出して次フェーズに渡す（Phase 3 の粗い問い立てには本文の細部は不要）。

### Phase 3: 粗い問い立て（Pass 1）

抽出したブロック一覧 + 見出しだけを LLM に渡し（自己プロンプトとして次のように問う）:

> Given only the block summaries above, what are the **3 most salient high-level questions** we can answer about the recurring patterns in these documents?

例えば conventions.md + CLAUDE.md を対象にした場合、期待される問い:

- 「app 間で同形に保つべき構造（drift 検出）のパターンは何か？」
- 「LLM に対する『検証してから断言せよ』ルールの適用範囲は？」
- 「barrel / インライン構築 など『複数箇所に散らばると腐る』パターンの共通原則は？」

粗い問いなので、この時点では本文の細部を読んでいなくてよい。**問い自体をユーザーに提示せず、内部的な骨組みとして使う**（提示するとユーザーの負担が増える）。

### Phase 4: 問いごとの retrieve + insight 合成（Pass 2）

各問いについて:

1. **retrieve**: 該当しそうな evidence ブロックを 3-8 件選ぶ（多すぎると salience が薄まる）
2. **本文読み込み**: 選ばれたブロックのみ本文を Read する（この時点で初めて詳細が必要）
3. **insight 合成**: LLM に次のように問う:

> What 3-5 high-level insights can you infer from the above statements?
> Format: `原則 (because of [E1], [E5], [E7])`

出力例:

```
原則: 「複数の app で同形に保つ必要があるファイルは typecheck では drift 検出できない。
     いずれかを変更したら全 app の同名ファイルを突き合わせる」
evidence: [E3], [E4], [E5]
昇格先候補: CLAUDE.md の Working Rules（グローバル横断規約）
```

### Phase 5: 昇格先の確認

各 insight について AskUserQuestion で以下を確認:

```
質問: この原則をどこに昇格しますか？
選択肢:
- CLAUDE.md の該当セクション（推奨: グローバル横断規約なら Working Rules 等）
- conventions.md の該当セクション（プロジェクト固有規約）
- 新規ファイル（例: docs/drift-detection.md）
- 却下（この抽象は採用しない）
```

**却下も正当な選択肢**として提示すること。無理に昇格すると具体例のニュアンスが失われる場合がある。

### Phase 6: 書き戻し

ユーザーが承認した insight について:

1. **昇格先に原則を追加**: evidence 番号は昇格後に **代表例 1-2 件の要約 + 元ファイル位置への参照**（`実例: conventions.md 節 J L920 / 節 Q L1552`）に置換する。evidence 番号（`[E3]` 等）はスキル実行中の内部識別子なので永続化しない。
2. **元ブロックの整理**: 元の亜種チェーンから **代表例 1-2 件だけ残して他は削除**（完全削除でなく「昇格先へ」の pointer を残す）
3. **importance メタデータ更新**: 昇格先の原則には `<!-- importance: high | mentions: N | first-seen: YYYY-MM -->` を追加（N は統合した evidence の件数）

書き戻し前に diff を提示してユーザー承認を得る。承認なしでの書き戻しは行わない。

---

## 判断基準

### 抽象化すべき / しないの境界

**抽象化する:**
- 同一根本原因の実例が 3 件以上並んでいる（判断基準は curate-docs 4-e と同じ）
- 「亜種:」「実例:」「補足:」が単一ルールの下で 3 段以上ネストしている
- 複数節・複数ファイルにまたがって同じパターンが繰り返し言及されている

**抽象化しない:**
- ADR / 設計判断記録（具体こそ価値がある。抽象化すると意思決定の根拠が失われる）
- コマンドリファレンス（jj.md 等）(参照用途)
- ハウツー・手順書（具体的であることが価値）
- 単発の gotcha（3 件未満は個別具体で残す）

### insight の質のセルフチェック

書き戻し前に以下を自問:

- **この原則は「なぜそうなるか（WHY）」を含んでいるか？** WHY 抜きの抽象は「やり残し / バグ」と区別がつかない（CLAUDE.md 規約より）
- **evidence 逆引きしたら本当に全 evidence が原則で説明できるか？** できない evidence があれば原則が粗すぎるサイン
- **既存の上位原則で既にカバーされていないか？** 重複を作ると memory 全体の情報密度が下がる

---

## Gotchas

- **入力を全部一気に投げない**: 元論文が 100 メモリに限定しているのには理由がある。conventions.md（2596 行）+ CLAUDE.md（数百行）を一括で LLM に渡すと 3 問が総花的になり salience が消える。Phase 2 で「見出し + ブロック先頭数行」だけ抽出し、Phase 4 で問いごとに本文を Read するのが必須。
- **evidence 番号を永続化しない**: `[E1]` 等はスキル実行内での内部識別子。書き戻す原則には「元ファイル L920」のような**位置ベースの参照**に置換すること。番号を残すと後続の reflection 実行で衝突する。
- **横断原則を強引に作らない**: 「app 間 drift 検出」のような真の横断原則は存在するが、無理に横断化すると各文脈の重要な違いが消える。3 件揃っても「別ドメインで偶然形が似ているだけ」なら却下する。
- **却下も成果**: Phase 5 で「却下」を選ばれた場合、それも成果として記録する（元ブロックは触らない）。「抽象化候補としては挙がったが根拠が弱い」情報は次回スキル実行時の参考になる。
- **書き戻し先の混在に注意**: グローバル規約（CLAUDE.md）とプロジェクト固有規約（conventions.md）を混ぜて昇格させると再利用性が下がる。「この原則は全プロジェクトで真か？」を必ず問うてから CLAUDE.md に上げる。
- **元の具体例を全消ししない**: 代表例 1-2 件は元ファイルに残す。全消しすると「抽象は覚えているが具体の記憶がない」状態になり、境界ケース判断で困る。
