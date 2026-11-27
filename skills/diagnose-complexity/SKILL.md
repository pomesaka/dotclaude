---
name: diagnose-complexity
description: コードの複雑さの根本原因を分析し、モデル設計のズレに帰着できるか診断する。
when_to_use: 「このコード複雑すぎる」「なぜこんなに分岐が多い」「モデルがズレてる気がする」「分岐の組み合わせ爆発を整理したい」「設計レベルで複雑さを減らしたい」と言われたとき。差分の局所クリーンアップは /simplify、ドメインモデルの設計と記録は model-domain を使う。このスキルは**複雑さホットスポット起点で逆算する diff-非依存の設計診断**。
allowed-tools: Read, Grep, Glob, Bash(cat *), Bash(jj diffu *), Bash(jj diff *), Bash(find *), Bash(fd *), Bash(rg *), Bash(wc *), WebSearch, WebFetch, AskUserQuestion
context: fork
agent: general-purpose
model: opus
---

# 複雑さの根本原因診断

## このスキルの立ち位置

- **このスキル**: 観察された複雑さの集まる所（ホットスポット）から逆算して、既存のモデルのずれを直し、複雑さを減らす
- **/simplify**: `jj diff` の変更行だけを対象にした、再利用と効率の手直し

起点は「複雑さの観察」にする。「モデルが正しいか」から入らない。Claude だけでは、モデルが現実と合うかを判定できないためだ。

## 参考資料

!`cat ~/.claude/docs/domain-design-practices.md 2>/dev/null`
!`cat ~/.claude/docs/code-design.md 2>/dev/null`

---

## 進め方

### Phase 1: 起点の確定

引数（`$ARGUMENTS`）があれば、それを対象にする。無ければ、どこが複雑だと感じているかを `AskUserQuestion` で聞き、次のどれに当たるかを確かめる。

- 特定のファイル・関数・モジュール
- 特定の機能/ユースケース
- 差分（`jj diffu`）の範囲
- 「全体的に重い」(→ さらに絞ってもらう)

「複雑さの起点なしで全コードを見ろ」は受けない。分析が浅くなるためだ。

### Phase 2: 複雑さホットスポットの列挙

対象の範囲を読み、次の複雑さのシグナルを、ファイル:行で挙げる。各シグナルがいくつ、どの程度出ているかを数で書く（「3 か所」「ネスト 4 段」「7 ケースの switch」）。シグナルの強さで、仮説の確からしさが変わるためだ。

#### 構造的シグナル
- 深いネスト（条件分岐 3 段以上）
- 巨大な `switch` / `match` / `if-else if` チェーン
- 多数の boolean フラグ（同一型に 3 つ以上の bool）
- 巨大な引数リスト（4 引数以上 / オプション型が巨大）
- 巨大ファイル・巨大関数（行数）

#### データ形状のシグナル
- `null`/`undefined`/`Optional` の連鎖（`a?.b?.c?.d`）
- 同じ entity に大量の optional フィールド（「あるケースだけ埋まる」が複数並ぶ）
- parallel arrays（`names[i]` と `ages[i]` を index で結ぶ）
- denormalize されたデータをコード内で再 normalize（join 相当を loop で）
- 型 discriminator (`type: "A" | "B"`) による分岐が多箇所に散らばっている

#### 制御フローのシグナル
- N×M の条件分岐（`status === X && role === Y` の組み合わせ）
- 「特殊ケース」branch（「○○のときだけ別処理」が散らばる）
- save/update 前のフラグ調整（`x.flag = true; save(x)` のパターン）
- 同一処理の N 回呼び出し（ループの外で個別に書かれている）
- 「自動同期」処理（entity A を更新したら entity B も更新する手続きが散在）

#### 命名・概念のシグナル
- 同じ概念の別名（`user.name` と `account.userName` と `member.label` が同じものを指す）
- コメントでだけ説明される invariant（「ここでは常に X」が型で表現されていない）
- 単数/複数の混在（`items: Item[] | Item` のような型）
- "Manager" / "Handler" / "Util" / "Helper" のような責務不明な名前

シグナルは仮説を立てるきっかけで、問題の証明ではない。Phase 3 で仮説が立たないもの、Phase 4 で否定されたものは捨てる（ドメインから見て避けられない構造のこともある）。

### Phase 3: 根本原因の仮説生成

各ホットスポットに、次の 4 つのカテゴリから仮説をいくつか立ててから、検証に進む。モデルのずれと決めつけて入ると、過剰抽象のような別の原因にもモデルの修正を当ててしまう。

#### (1) モデル/概念ミスマッチ（最も多い）
型・DB スキーマが業務概念とズレている。3 つのサブタイプがある。

- **A. 誤った統合**: 1 つの型が実は 2 つ以上の概念を混ぜている → **split** が必要
  - 例: 1 つの `status` enum が「業務フェーズ」と「処理状態」の 2 軸を混在
  - 例: `User` の中に「個人ユーザー」と「法人ユーザー」が optional フィールドで同居
- **B. 欠落した分割**: 概念が inline / flag で表現されており、本来 first-class な型であるべき → **extract** が必要
  - 例: 「下書き保存」と「申請」のフラグが、実は別の状態遷移を持つ別 entity
  - 例: 多数の boolean が組み合わさって state machine を形成している
- **C. 関係性の不在**: entity 間の関係が型で表現されておらず、コード側で join/同期している
  - 例: parallel arrays、loop で join 相当を書いている、「自動同期」処理が散在

#### (2) 責務配置ミス
ロジックが本来あるべき型の外に流出している（Anemic Domain Model）。
- 例: バリデーションが service/controller 層に散らばっている
- 例: save 前のフラグ調整 → そこに隠れた domain operation がある

#### (3) 過剰抽象
不要な interface・wrapper・generic で複雑化している。
- 例: 1 つしか実装がない interface
- 例: 使われていない extension point

#### (4) 本質的複雑さ
ドメインそのものが複雑で、これ以上削れない。最後に疑い、(1)(2)(3) でないことを確かめてから結論する。

#### シグナルと仮説の対応表

| シグナル | 第一仮説 | 第二仮説 |
|---|---|---|
| 多数の boolean フラグ | (1-B) 欠落分割: state machine 隠れ | (2) 責務配置 |
| 巨大 switch / N×M 分岐 | (1-A) 誤った統合: 別概念混在 | (2) Polymorphism 機会 |
| 大量の optional フィールド | (1-A) 誤った統合: subtype 隠れ | (1-B) 欠落分割 |
| parallel arrays / loop join | (1-C) 関係性の不在 | — |
| denormalize→再 normalize | (1-C) 関係性の不在 | (1-A) 集約境界誤り |
| 「特殊ケース」branch | (1-B) 例外を概念化していない | (2) 責務配置 |
| save 前フラグ調整 | (2) operation が隠れている | (1-B) 欠落分割 |
| 「自動同期」処理 | (1-C) 集約境界の誤り | (2) 責務配置 |
| 深いネスト | (2) 責務配置 | (4) 本質的複雑さ |
| 同じ概念の別名 | (1-A) Bounded Context 設定の誤り | — |
| 1 実装の interface | (3) 過剰抽象 | — |
| Manager/Util 命名 | (2) 責務配置 | (3) 過剰抽象 |

各仮説に「この仮説が正しければ、このホットスポットの複雑さが消える」という筋書きを書く。消えないなら、仮説として弱い。

### Phase 4: 仮説の検証

いちばん有力な仮説を、次の 4 つの経路で確かめる。

#### 4-A. コードからの暗黙の前提抽出（どの仮説でも行う）

コードから「このコードが成り立つために暗黙に仮定していること」を、コードの言葉のまま抜き出す。

> このコードは「1 つの `Order` は必ず 1 人の `Customer` を持つ」と仮定している（`order.customerId` が non-null として参照されている）。
> しかし `OrderImport` フローでは customer 未確定の order を作成しており、`customerId = null` の row が DB に存在しうる。
> → モデルの仮定とデータの実態が乖離している

#### 4-B. データの実測（仮説が DB の実態に依存する場合）

仮説が DB の実データで決まるとき（「customer 未確定の order が実在するか」「status の組み合わせの分布」など）は、利用者に SQL の実行を頼む。Claude は本番の DB に直接つながない。接続先を取り違えると本番のデータを壊すためだ。次の形で示す。

> 仮説検証のため以下を実行してください:
> ```sql
> SELECT COUNT(*) FROM orders WHERE customer_id IS NULL;
> SELECT status, type, COUNT(*) FROM orders GROUP BY 1, 2;
> -- 期待: 仮説 X なら count = 0、仮説 Y なら count > 0
> ```

利用者の記憶に頼る確認より、データの実測のほうが強い証拠になる。

#### 4-C. 周辺知識のリサーチ

そのドメインに広く使われるモデルの形があるかを `WebSearch` で調べる（「<ドメイン名> domain model」など）。見つけた形はそのまま当てはめず、利用者の業務に固有の事情と突き合わせる。

#### 4-D. ユーザーへのヒアリング（どの仮説でも行う）

`AskUserQuestion` で、コードから抜き出した前提と、現実とのずれを聞く。質問は具体的にする。

- 悪い: 「Order と Customer の関係は正しいですか？」
- 良い: 「現状コードは『1 Order = 1 Customer』を前提にしていますが、Import フローで customer 未確定 order が存在します。これは ①Import 後すぐに customer を確定させる運用 ②customer 不明 order は別 entity（DraftOrder 等）として扱う ③現状の null 許容のまま ④その他、のどれが業務的に正しいですか？」

仮説がいくつかあるなら、選択肢にして示す。

### Phase 5: シンプル化提案

検証で仮説が確定したら、直した後のモデルの素描を示す。

1. **Before**: 現在の型/スキーマと、それが生み出している複雑さ（ホットスポット箇所）
2. **After**: 修正後の型/スキーマと、それで消える複雑さ
3. **将来に耐えるかの突き合わせ**: 直した後のモデルが、対象にしていないほかの既存の複雑さも説明できるか。説明できない所があれば、After のモデルにも別のずれがある。新しい特殊ケースが足されても耐える構造か
4. **移行コスト**: 影響範囲（`rg` で参照箇所数を実測）、DB migration の有無、後方互換が必要か
5. **段階的移行案**: 一気に切り替えられない場合の中間状態（feature flag / shim / 並行運用）

理想の形だけを示すと、コストが高すぎて採用されない。移行できるかまで含めて評価し、コストが見合わないなら、そう書いて局所の修正にとどめる案を出す。

---

## 出力形式

1. **対象範囲**: どこを見たか
2. **複雑さホットスポット**: ファイル:行 + シグナル種別 + 程度（定量）
3. **根本原因の仮説**: カテゴリごとに挙げ、各仮説に「これが正しければ消える複雑さ」と、対応表でのシグナルを添える
4. **検証結果**: コードからの暗黙の前提・データ実測の依頼内容・リサーチした一般知見・ユーザーヒアリング結果
5. **直した後のモデルの素描**: Before / After / 将来に耐えるかの突き合わせ / 移行コスト / 段階的な移行案
6. **判断**: 修正を推奨するか / コスト高で見送るか / 別アプローチ（局所修正）にするか

各セクションで**ファイルパス:行番号**を引用する。

$ARGUMENTS

---

## 参考文献

- **Out of the Tar Pit** (Moseley & Marks, 2006): essential vs accidental complexity の古典。state と control flow が accidental complexity の主因
- **Refactoring Toward Deeper Insight** (Eric Evans, DDD 本第3部): モデルの違和感を概念欠落のシグナルとして読む
- **Event Storming** (Alberto Brandolini): 既存モデルの監査手法としても使える
- **Simple Made Easy** (Rich Hickey, 2011): 複雑さ = 複数概念の braid。decomplecting
- **Tidy First? / Empirical Software Design** (Kent Beck): 構造変更と振る舞い変更の分離
- 留保: 「複雑さ → モデル misalignment」を定量的に実証した研究は弱い。多くは practitioner literature に依拠
