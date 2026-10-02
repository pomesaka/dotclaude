# ドメイン分析・責務駆動設計の手法と実践ガイド

> **TL;DR**: DDD/RDD を使ったドメイン設計の手法ガイド。Bounded Context でモデルの意味境界を引き、Value Object でイミュータブルな概念を表現する。Event Storming・Domain Storytelling で業務フローを可視化してからコードに落とす。アンチパターン: 技術都合でドメインを歪めること・Anemic Domain Model（振る舞いを持たないデータクラス）。

開発時に美しく実用的な設計を行うための手法・マインドセットを整理する。

---

## 目次

1. [Domain-Driven Design（DDD）](#1-domain-driven-designddd)
2. [責務駆動設計（RDD）](#2-責務駆動設計responsibility-driven-design)
3. [Event Storming](#3-event-storming)
4. [Domain Storytelling](#4-domain-storytelling)
5. [ドメイン中心アーキテクチャ](#5-ドメイン中心アーキテクチャ)
6. [関数型ドメインモデリング](#6-関数型ドメインモデリング)
7. [アンチパターン](#7-アンチパターン)
8. [横断モジュールへの入力境界パターン](#8-横断モジュールへの入力境界パターン)
9. [現代の実践的アプローチ](#9-現代の実践的アプローチ2024-2026)
10. [スキルを磨くには](#10-スキルを磨くには)
11. [参考文献・リソース](#11-参考文献リソース)
12. [AI Agent の設計原則](#12-ai-agent-の設計原則llm-backed-関数の責務分離)

---

## 1. Domain-Driven Design（DDD）

Eric Evans が2003年の著書で体系化した手法。ビジネスドメインをソフトウェア設計の中心に据える。

### 戦略的パターン（Strategic Design）

| パターン | 概要 |
|----------|------|
| **Bounded Context** | モデルが一貫した意味を持つ境界。マイクロサービスの境界設計にも直結する |
| **Ubiquitous Language** | 開発者とドメインエキスパートが共有する用語体系。コード内の命名もこれに従う |
| **Context Mapping** | Bounded Context 間の関係性を明示する（後述） |
| **Core Domain Chart** | Evans が2019年に提唱。ドメインを Core / Supporting / Generic に分類し投資優先度を決める |

#### Context Mapping パターン

| パターン | 説明 |
|----------|------|
| **Partnership** | 2つのコンテキストが相互依存。片方の失敗がもう片方の失敗を引き起こす |
| **Shared Kernel** | 両チームが合意した共有モデルのサブセット。小さく保つことが重要 |
| **Anti-Corruption Layer (ACL)** | 下流が上流のモデルを自ドメインの用語に翻訳する隔離層 |
| **Open Host Service** | 上流がプロトコルを公開して複数の下流にサービス提供 |
| **Published Language** | 情報交換用の共通言語（JSON, Protobuf, Avro 等） |
| **Customer/Supplier** | 上流が下流のニーズを考慮して開発 |
| **Conformist** | 下流が上流のモデルにそのまま従う |
| **Separate Ways** | 2つのコンテキスト間に有意な関係がない |
| **Big Ball of Mud** | レガシーな混沌としたシステムとの境界 |

### 戦術的パターン（Tactical Design）

| パターン | 役割 |
|----------|------|
| **Entity** | ID で識別されるオブジェクト。ライフサイクルを持つ |
| **Value Object** | 値で等価判定。Money, Address, DateRange など。不変性がバグを防ぐ |
| **Aggregate** | 整合性の境界単位。Aggregate Root を通じてのみ状態変更 |
| **Domain Service** | Entity/VO に属さないドメインロジック |
| **Repository** | 永続化の抽象。コレクションのようなインターフェースを提供 |
| **Domain Event** | ドメインで起きた事実を表現。システム間連携や監査にも有用 |
| **Factory** | 複雑なオブジェクト生成をカプセル化 |

#### Vaughn Vernon の Aggregate 設計4ルール

1. **真の不変条件を整合性境界でモデリング**: 単一トランザクション内で完全に一貫性を保つ
2. **小さな集約を設計**: 大きなクラスタ集約はパフォーマンスもスケーラビリティも悪い
3. **他の集約は ID で参照**: オブジェクト参照ではなく識別子で参照
4. **境界外では結果整合性を使用**: 集約間のルールはイベント処理やバッチ処理で解決

---

## 2. 責務駆動設計（Responsibility-Driven Design）

Rebecca Wirfs-Brock が提唱。「このオブジェクトは何を知っているか」「何をするか」「誰と協調するか」で設計を考える。

### CRC カード

- **C**lass / **R**esponsibility / **C**ollaboration をインデックスカードに書く
- チームで物理カードを動かしながら設計するワークショップ手法
- 責務の偏り（God Object）を早期に発見できる

### ロールステレオタイプ（Wirfs-Brock の分類）

| ステレオタイプ | 責務 |
|----------------|------|
| **Information Holder** | 情報を保持し提供する |
| **Structurer** | オブジェクト間の関係を維持する |
| **Service Provider** | 処理を実行し結果を返す |
| **Coordinator** | 他オブジェクトに仕事を委譲する |
| **Controller** | 判断を行い他オブジェクトを制御する |
| **Interfacer** | 外部システムとの境界を管理する |

### DDD との補完関係

DDD が「何をモデリングするか」に焦点を当てるのに対し、RDD は「各オブジェクトにどう責務を配分するか」を扱う。両者を組み合わせると、ドメインモデルの粒度と責務配分の両面から設計を検討できる。

---

## 3. Event Storming

Alberto Brandolini が2013年に考案したワークショップ形式。大きな壁にオレンジの付箋（ドメインイベント）を時系列で貼っていく。

### 3段階のレベル

| レベル | 目的 | 参加者 |
|--------|------|--------|
| **Big Picture** | ビジネス全体の俯瞰。ボトルネックや未知の領域の発見 | 全ステークホルダー（10-30名可） |
| **Process Modeling** | 特定プロセスの詳細化。コマンド・アクター・ポリシーを追加 | ドメインエキスパート + 開発者 |
| **Software Design** | Aggregate の境界特定。コードへの橋渡し | 開発者中心 |

### 付箋の色分け（標準的な記法）

| 色 | 要素 |
|----|------|
| オレンジ | Domain Event（「〜された」過去形） |
| 青 | Command（「〜する」命令形） |
| 黄（小） | Actor / User |
| 黄（大） | Aggregate |
| ピンク | External System |
| 赤 | Hot Spot / 問題点 |
| 紫 | Policy（「〜のとき、〜する」） |

### 効果

数時間で数ヶ月分の要件定義に匹敵する共有理解が得られる。サイロ化した組織で特に威力を発揮する。

---

## 4. Domain Storytelling

Stefan Hofer & Henning Schwentner が体系化。ドメインエキスパートが業務の流れを「物語」として語り、ピクトグラムと番号付き矢印で図式化する。

### Event Storming との比較

| 観点 | Event Storming | Domain Storytelling |
|------|---------------|-------------------|
| 形式 | 付箋ワークショップ（カオス的） | 構造化された図 |
| 出発点 | ドメインイベント（過去形） | アクターの行動（物語） |
| 適する場面 | 未知のドメインの探索、全体俯瞰 | 既知の業務フローの可視化、as-is/to-be 分析 |
| スケール | 大人数（10-30名）でも可能 | 少人数（3-7名）向き |
| 成果物 | 付箋の壁写真 → Bounded Context 候補 | ドメインストーリー図 → ユースケース |

**使い分け**: 未開拓のドメインには Event Storming、既存業務の理解と改善には Domain Storytelling が向く。併用も効果的。

---

## 5. ドメイン中心アーキテクチャ

### Hexagonal Architecture（Ports & Adapters）

Alistair Cockburn 提唱。アプリケーションの「内側」（ドメインロジック）と「外側」（インフラ）を Port と Adapter で分離する。

```
         [Web UI]  [CLI]  [Test]
              \      |     /
               Port (入力)
              ┌──────────┐
              │  Domain   │
              │  Logic    │
              └──────────┘
               Port (出力)
              /      |     \
      [PostgreSQL] [Redis] [Mock]
```

### Clean Architecture（Robert C. Martin）

同心円モデル。依存の方向は常に外→内。

```
外 → Frameworks & Drivers
     → Interface Adapters
         → Use Cases (Application)
             → Entities (Domain)   ← 最内部
```

### Onion Architecture（Jeffrey Palermo）

Domain Model → Domain Services → Application Services → Infrastructure の層構成。

### 3つの共通原則

1. **依存性逆転**: ドメインが外部に依存しない。インフラがドメインに依存する
2. **テスタビリティ**: ドメインロジックを外部依存なしにテスト可能
3. **交換可能性**: データベースや UI フレームワークの変更がドメインに影響しない

### usecase 層と domain 層の分担 — 判断は domain・順序は usecase

- **「ビジネスロジック」という言葉自体が 2 つの別物を混ぜている**ことに注意。Clean Architecture ですら usecase 層を "application **business** rules"、domain 層を "enterprise **business** rules" と呼ぶ。「usecase = 業務ロジックの層」という誤解はこの用語の曖昧さから生まれる。業務＝ドメインであり、usecase はその発動制御
  - **ドメインロジック（業務の真実）**: システムを廃止して紙の運用に戻しても残る決まりごと（「解析は同一種別で同時 1 つまで」「manual 起動には必ず起動者がいる」等）
  - **アプリケーションロジック（usecase）**: そのルールを、いつ・どの順で・どの境界（tx）で発動させるか。ソフトウェアという提供形態に固有の関心事
- **リトマス試験 ①**: エラーハンドリング以外の `if` が業務状態で分岐していたら domain への押し下げ候補。順序（A してから B・失敗したら補償 C・ここまでが tx）は usecase の本業だが、判断（この状態なら拒否・この種別ならこの相手）は名前を付けて domain へ
- **リトマス試験 ②**: 「そのルール、ドメインエキスパートに説明できるか / 向こうが訂正してくるか」。現場の人が語れるルールはドメイン、tx やチェック順序の話は usecase
- **usecase に残してよいもの**: tx 境界・認可の呼び出し・port の呼び出し順序・補償/隔離の方針（「片方の失敗は他をブロックしない」「通知は best-effort」。これは「何をするか」でなく「失敗をどう扱うか」なのでオーケストレーションの一部。ただしコメントで方針として明示する）
- **合格基準**: usecase の `Do()` が「番号リストの朗読」として読めるか。godoc の処理フロー番号リストとコードの見た目が乖離している usecase には判断が隠れている
- **系: テストの形も分かれる**。判断が domain に集まっていれば業務ルールは pure な table driven test で書け、usecase テストは「正しい順序で port が呼ばれるか・失敗時に補償されるか」のみになる。業務ルール 1 個の検証にモックを 5 個並べていたら、判断が usecase に漏れているシグナル
- **usecase 層は負債の置き場ではなく負債の計器**: usecase が見にくいとき読むべきシグナルは「domain に概念（語彙）が足りていない」。usecase 層の中でどう並べ替えても解決せず、ドメインのリモデルで語彙を増やすと usecase は自然に小さくなる。「usecase の整理の正解」がその層の中に見つからないのは、正解が層の外（domain の語彙形成）にあるから
- **usecase は 2 種類あると認める**: CRUD 系（薄い・退屈・定型でよい）とワークフロー系（start / complete / webhook 等。下にドメインサービスを持つ資格がある）。1 つのテンプレートで両方を満たそうとするとどちらかで常に不満が出る
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

---

## 6. 関数型ドメインモデリング

Scott Wlaschin の「Domain Modeling Made Functional」が体系化。型システムでドメインを表現する。

### 代数的データ型（ADT）によるモデリング

- **直積型（Product Types）**: 「A かつ B」を表現（レコード、タプル）
- **直和型（Sum Types / Discriminated Unions）**: 「A または B」を表現（選択肢のモデリングに最適）

### Make Illegal States Unrepresentable

型システムでビジネスルールをエンコードし、不正な状態をコンパイル時に排除する。

- `string` ではなく `EmailAddress` 型を使い、ドメインの意図を表現
- **Parse, Don't Validate**: 生の入力を型付けされた値にパースすることで不変条件を確立
- 各関数は入力型から出力型への変換であり、コンパイラが型の整合性を保証

### 検査済みを表す型で「検査の呼び忘れ」を消す

不変条件を「呼び出し経路ごとに if で守る」設計は、経路が増えるたびに書き忘れが生まれ、しかも漏れは実行時にしか現れない。「検査を通った」という事実そのものを値にすると、コンパイラが全経路を保証する。

- 検査関数だけが構築できる型（unexported フィールドを持つ struct 等）を定義し、書き込み API はその型を引数に要求する。検査を通っていない呼び出しはコンパイルできない
- 正当な例外経路は `xxxUnchecked()` のような内部コンストラクタで明示する。例外が grep で全件数えられる状態になり、「意図的な例外」と「書き忘れ」が区別できる
- 判断基準:「この不変条件を守る `if` はいま何箇所にあり、今後増えるか？」増えるなら型に載せる

Parse, Don't Validate の応用（検証の結果を型で運ぶ）を、値の妥当性でなく操作の許可に適用したもの。

### 状態を列で持つか、名前空間から導くか

「この entity は特別扱いか」を bool 列（`is_read_only` 等）で持つと、名前と列は独立に変えられるため食い違った行を実装ミスで作れる。名前が予約された名前空間に属するかで導出すれば、食い違いは原理的に起きない（git が remote-tracking branch を `refs/remotes/` に隔離し、local branch と同居させないのと同型）。

- ただし導出が成立するのは名前空間を予約できるときだけ。人が同じ名前を作れる限り「特別扱いなのに人が作った」行が生まれるので、導出と「作成経路で予約名前空間を拒否する」はセットで初めて成立する
- 判断基準:「その名前を作れる経路は何個か？」1 個ならそこで拒否して導出にする。複数なら先に経路を集約してから導出にする（→ 検査は「ID が実体に解決される 1 箇所」に置く、と同じ形）
- 列を消すと DB を読むだけでは規則が見えなくなるので、名前空間の意味と「誰が予約を保証するか」を列コメント / 型のドキュメントに残す

### 他言語への応用

Go の場合、直和型は interface + 型スイッチ、あるいは sealed interface パターンで近似できる。TypeScript では Discriminated Unions、Rust では enum、Kotlin では sealed class が対応する。

---

## 7. アンチパターン

### 戦略レベル

| アンチパターン | 問題 |
|----------------|------|
| **ドメインエキスパート不在** | 技術者だけでドメインを語り、ビジネス側に相談しない |
| **DDD Lite** | Aggregate/Entity だけ使い戦略設計を無視。最も多いアンチパターン |
| **ユビキタス言語の不統一** | 同じ用語が異なる部分で異なる意味で使用される |
| **技術駆動の分割** | ドメインでなく技術層でサービスを分割する |

### 戦術レベル

| アンチパターン | 問題 |
|----------------|------|
| **Anemic Domain Model** | Entity がデータ保持のみでロジックが Service に流出 |
| **巨大な Aggregate** | 大きくなりすぎ、他の Aggregate への参照を含む |
| **過剰な共通化** | Shared Kernel を広げすぎてコンテキスト間が密結合 |
| **教条的な DDD** | パターンを盲目的に適用し、コンテキストや実際のニーズを無視 |

---

## 8. 横断モジュールへの入力境界パターン

複数のソース（API・GraphQL・Screen など）が異なる形式で同一 aggregator に渡している場合、
修正箇所は aggregator 側ではなく各ソースの境界にある。

### 問題: 非対称入力 aggregator

```
API → { endpointCode → ClientCall[] }   # 生の呼び出し
GraphQL → { typeId → model名[] }        # 伝播済みモデル名
           ↓
aggregator がそれぞれを別扱いして処理
```

症状: 「なぜ source X は対応していないのか？」という非存在への問いが出る。Screen 追加のたびに aggregator に分岐が増える。

### 解: 各ソースが共通型に変換して渡す

```
API → RelationBinding[] { source: ItemRef, target: TargetDescriptor }
GraphQL → RelationBinding[] { source: ItemRef, target: TargetDescriptor }
Screen → RelationBinding[] { source: ItemRef, target: TargetDescriptor }
           ↓
aggregator は一律に target を解決してエッジ化（source 種別不問）
```

`TargetDescriptor` の設計ポイントは次のとおり。
- 生 ClientCall から「Spec 解決に必要なフィールドだけ」を抜く（target 解決に不要な `stack`・`operationType` 等は含めない）
- 伝播由来で生 ClientCall を持たないソースも同じ記述子を直接構築できる
- 「対応しないケース（sdk）」は変換関数が `null` を返す形で表現し、aggregator に持ち込まない

### 見分け方

aggregator の docstring や型定義に「source A のための Map」と「source B のためのフィールド」が並んでいたら境界での正規化が不足している可能性が高い。

### 発展: target 記述子に「解決可能性クラス」を持たせる

境界で正規化した `TargetDescriptor` の kind は「どう解決するか」の宣言そのもの。解決可能性は呼び出し種別ごとに根本的に異なるため第一級にすると aggregator が明確になる。軸は「ターゲットのドメイン固有識別子を consumer が正規化して名指せるか」。

| クラス | 典型例 | 解決手段 |
|--------|--------|---------|
| **Schema-key** | DB（ORM / 生 SQL） | ターゲットの**ドメイン固有識別子**（RDB なら (schema, table name)）で照合。ORM model はその view で、consumer が正規化して名指す |
| **Name** | GraphQL operation | 操作名 ↔ field 名で照合 |
| **Pattern** | HTTP endpoint | URL 文字列 ↔ ルートパターンで近似照合（**不可避**） |
| **External** | SDK 呼び出し | コードベース外 → ローカル spec item に解決しない |

**見落としやすい点: 単一スタック固有の表現をドメイン概念と取り違える。** ターゲット識別子は「いちばん下のドメイン層」で定義せよ（RDB の本質は (schema, table name)、Prisma model はその view にすぎない）。系として「全種別を共有宣言（go-to-definition で到達する Identity）で解ける」誘惑があるが、成立するのは型を共有する単一スタック（Prisma codegen / tRPC 等）だけ。HTTP は `fetch('/api/users/123')` からルート定義への go-to-definition が無く Pattern 照合が本質的に不可避。「全部統一して美しく」で前提が成り立たなくなる。

**判断手順**: ①ターゲットのドメイン固有識別子は何か（RDB なら schema+table、API なら route、GraphQL なら
field 名）をツール非依存で定義する → ② consumer がその識別子を正規化して名指せるか／近似しかできないか
／コードベース外か、で Schema-key / Name / Pattern / External に振り分ける。

---

## 9. 現代の実践的アプローチ（2024-2026）

### 協調的モデリングの組み合わせ

Event Storming / Domain Storytelling / Example Mapping を組み合わせた「モデリング会」が定着。

- **Example Mapping**: BDD の文脈でルール・例・質問を整理するミニワークショップ。Event Storming の補完として使われる
- **Wardley Mapping + DDD + Team Topologies**: Susanne Kaiser が提唱する統合アプローチ
  1. Wardley Map でユーザーニーズ（= 問題ドメイン）を可視化
  2. コンポーネントから Bounded Context を特定
  3. サブドメイン分類を問題空間に適用
  4. Context Mapping で依存関係を設計
  5. Team Topologies でチーム構造を最適化

### DDD とマイクロサービス

Bounded Context はマイクロサービスのサービス境界を定義する最も効果的な手法として広く認識されている。

- 各マイクロサービスは特定のビジネス機能に対応すべき（技術的関心事ではなく）
- ACL を使ってレガシーシステムとの境界を保護しながら段階的にサービスを切り出す

---

## 10. スキルを磨くには

### 実践的な習得法

1. **コードで学ぶ**: 既存コードを「このクラスの責務は何か？」「この境界は正しいか？」と問い直すリファクタリングが最も効果的
2. **モデリング会を開く**: 週1回30分でも、ホワイトボードの前でドメインモデルを議論する習慣
3. **ドメインエキスパートと話す**: ユビキタス言語は会議室で作るものではなく、日常の会話から育てるもの
4. **小さく始める**: 全社導入ではなく、1つの Bounded Context から。まず Value Object を導入するだけでも効果がある
5. **Kata で練習**: "Cargo Shipping"（Evans の例）、"Banking"、"Library" などのドメインで繰り返しモデリング練習
6. **対象ドメインの教科書を読む**: 会計、物流、医療など、ドメインの本を読むことがモデリング力を上げる最短路
7. **Refactoring Toward Deeper Insight**: 最初のモデルは必ず間違っている。使いながら深い洞察を得て繰り返しリファクタリングする

### 問いから手法を選ぶ

```
問い                          → 手法
──────────────────────────────────────────
ビジネスの全体像は？          → Event Storming (Big Picture)
業務フローの詳細は？          → Domain Storytelling / Process Modeling
どこに境界を引く？            → Bounded Context + Context Mapping
各オブジェクトの責務は？      → CRC カード / RDD
不変条件の範囲は？            → Aggregate 設計
ドメインをコードでどう表現？  → Tactical DDD + Hexagonal Architecture
何が Core Domain か？         → Core Domain Chart + Wardley Map
```

---

## 11. 参考文献・リソース

### 必読書

| 書籍 | 著者 | ポイント |
|------|------|----------|
| **Domain-Driven Design** (Blue Book) | Eric Evans | 原典。Part III "Refactoring Toward Deeper Insight" が特に重要 |
| **Implementing Domain-Driven Design** (Red Book) | Vaughn Vernon | 実装寄りの解説 |
| **Domain-Driven Design Distilled** | Vaughn Vernon | DDD 入門書として最適 |
| **Learning Domain-Driven Design** | Vlad Khononov | 最もモダンで実践的な入門書 |
| **Domain Modeling Made Functional** | Scott Wlaschin | 関数型での DDD |
| **Object Design: Roles, Responsibilities, and Collaborations** | Wirfs-Brock & McKean | RDD の教科書 |
| **Introducing EventStorming** | Alberto Brandolini | Leanpub で入手可能 |
| **Domain Storytelling** | Hofer & Schwentner | O'Reilly 刊 |
| **Architecture for Flow** | Susanne Kaiser | DDD + Wardley Mapping + Team Topologies の統合 |

### 日本語リソース

| 書籍・リソース | 著者 | 特徴 |
|----------------|------|------|
| **ドメイン駆動設計入門** | 成瀬允宣 | ボトムアップで解説。日本語 DDD 入門の定番 |
| **ドメイン駆動設計をはじめよう** | Vlad Khononov 著、増田亨・綿引琢磨 訳（2024年） | Learning DDD の日本語訳 |
| **[入門]ドメイン駆動設計** | 増田亨ほか共著（2024年） | Software Design 別冊 |
| **現場で役立つシステム設計の原則** | 増田亨 | ドメインモデルの実践を日本の現場目線で解説 |

### 主要人物（日本）

- **増田亨**: 日本における DDD の第一人者。講演・執筆多数
- **成瀬允宣**: ボトムアップアプローチで日本の DDD 普及に貢献
- **和智右桂**: Evans「Blue Book」日本語訳の翻訳者。ワークショップも開催

### オンラインリソース

- [DDD-Crew Free Learning Resources](https://github.com/ddd-crew/free-ddd-learning-resources)
- [Awesome DDD](https://github.com/heynickc/awesome-ddd)
- [DDD-Crew Context Mapping](https://github.com/ddd-crew/context-mapping)
- [SAP Curated Resources for DDD](https://github.com/SAP/curated-resources-for-domain-driven-design)
- [F# for Fun and Profit](https://fsharpforfunandprofit.com/books/)
- DDD Europe カンファレンス（年次開催）
- DDD-CQRS-ES Discord Server

---

## 12. AI Agent の設計原則（LLM-backed 関数の責務分離）

AI を内部実装に持つ agent を設計する際も、ドメイン責務の分離原則は同様に適用される。

### Agent = 型付き関数

`Agent<I, O>` は外から見れば普通の型付き関数 `(I) => Promise<O>` であるべき。

- **agent の責務**: ①構造化入力からプロンプトを内部生成 ②ツールのデフォルト設定 ③構造化出力
- **プロンプト文字列を外部注入しない**: `config.system: string` のような生プロンプト注入は NG。ドメイン知識が注入文字列に散乱し、agent が中身を持たなくなる
- **ドメイン固有部分は構造化データで渡す**: `serviceKind`, `stack` 等。agent 実装がこれらからプロンプトを内部生成する
- **抽出ルールは出力スキーマが担う**: Valibot スキーマの `v.description` / `picklist` / `tool.description` に書くと `toJsonSchema` 経由で LLM に自動伝播する。プロンプトに書かない

### AI（非決定的）と決定的処理の分離

- **決定的 I/O（ファイル読み込み等）を agent に入れない**: LLM contribution が null になる。ファイル読み込みは service の orchestration 側に置く
- **batch 分割・並列・合成などの orchestration ロジック**も agent ではなく呼び出し側 service が持つ（テスト可能に保つ）
- agent はできるだけ単機能の primitive にする。enumerate も extract も「content → 出力スキーマに沿った構造化出力」という同じ primitive を出力 tool 違いで使う

### 設計判断の WHY を必ず残す

なぜ 2 パス（enumerate → batch extract）にするか等の非自明な設計判断は型定義のそばにコメントで残す。技術的制約（トークン上限等）が設計に影響する場合は因果の chain を省略しない。

### Eval スコアリング: 対応づけキーと評価フィールドの独立性

LLM 抽出の recall-based eval（GT の一部サンプルを抽出結果に greedy マッチング）で、あるフィールド X を対応づけキー（fallback）として使うと、X のスコア採点が trivially true になる（自己確認バイアス）。

- **問題の構造**: fallback キー（例: primary key が null のとき `amount`）でマッチした抽出行は、定義上そのフィールドが GT と一致している（一致したから選ばれた）。その行で `amountMatched += 1` すると「選んだ理由=一致」を再カウントする自己確認になりスコアが水増しされる。
- **対処**: `foundBy[Field]: boolean` フラグを追加し、キーとして使ったフィールドは同一行のスコア採点対象から外す。`productCode` で見つけた行は全フィールドを採点してよい（キーは独立）が、`amount` で見つけた行は `amountMatched` を採点しない。
- **一般原則**: 「このフィールドは対応づけキーとして使っているか？」を全評価フィールドについて確認する。採点対象フィールドとマッチングキーは独立していなければならない。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

---

## 残差・差集合の量は符号を保持したまま計算する — `> 0 ? x : 0` clamp は負の正当値を無音で潰す

「親合計 − Σ割当済み = 残差」のような差集合・残差の計算で、直感的に「残りは 0 以上のはず」と `residual > 0 ? residual : 0`（または `Math.max(0, x)`）で clamp すると、業務上正当な負の値（返品・値引き・赤伝・マイナス計上行）が気づかないうちに 0 になる。runtime エラーにならず、集計は「一致（±0）」に見えるため UI では無症状。保存則（Σ子行 = 親合計）を突き合わせて初めて破れが見える。

- **判断基準**: clamp を書く前に「この量は業務上、負になり得るか？」を問う。金額・数量の差分はほぼ常に YES。
- **原則**: 計算層（集約・クエリ）では符号を保持したまま値を流し、符号の表示規約（`+¥N` / `−¥N` / `±¥0` の記号・色分け）は表示層の 1 関数に一元化する。計算層で clamp すると表示層は「負が存在した」事実自体を知れなくなる。
- **負が本当に不変条件違反の場合**も clamp で隠さず throw / assert で可視化する（clamp は「あり得ない値」を「もっともらしい値」に変換する最悪の対処）。
- **検証**: 保存則を持つ集計（Σ子行 = 親合計 等）は、負の構成要素を含むフィクスチャでテストする。全部正のデータでは clamp バグは検出できない。

実例: noah adachi 請求書照合（PR #333）。未帰属元帳残差の clamp が返品由来の −¥102,113 を 0 にし、一覧の差額が ±¥0（偽の一致）表示になった。ユーザー実データで発覚し、clamp 除去 + 表示層 `signedYen` への符号規約一元化で修正。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

---

## 受け手側の入力検証は「不正が無音で成功する入力」に絞る — うるさく落ちる入力は検証しない

送り手がビジネスロジック（値の生成・解決）を持つ系で、受け手が入力を再検証するとバリデーション責務が両側に散らばる。Postel's law（寛容な受信）に流れる前に、不正入力ごとに「この不正は受け手でどう失敗するか」を分類する。

- **うるさく落ちる**（後続処理が例外・エラーで即座に止まる）→ 受け手では検証しない。検証を足しても得られるのはエラーメッセージの改善だけで、責務の重複コストに見合わない
- **無音で成功する**（処理は通るが契約と違う結果になる）→ 受け手の境界で型強制として落とす。送り手の検証では防げない。送り手のバグ・別の呼び出し元・手動起動がすり抜けるため、意味論を壊す入力は受け手が自衛するしかない

判断基準: 「この不正値を入れたとき、エラーになるか、それとも別の意味で成功してしまうか？」後者だけが受け手の検証対象。検証は文字列形式チェック（型システムで表現できない wire 契約の型強制）に留め、ビジネスルールの再実装はしない。

実例: ADeT-AI analyze-spec の `GIT_COMMIT` pin（PR #741）。ブランチ名を渡すと `git fetch` + DWIM checkout が成功してしまい「先端が解析される」エラーの出ない契約違反になる（課金される解析ジョブが丸ごと無駄になる）ため、40 hex full SHA の形式チェックだけ受け手に置いた。一方 `GIT_DIFF_BASE` は不正なら fetch がうるさく落ちるので検証しない。
  <!-- importance: high | mentions: 1 | first-seen: 2026-08 -->

---

## 核心

> 美しい設計は「パターンの適用」ではなく「ドメインの深い理解」から生まれる。技術的な構造はドメインの構造に従うべきであり、その逆ではない。Evans の言う "Refactoring Toward Deeper Insight"（より深い洞察へのリファクタリング）こそが、実用的かつ美しい設計への道筋。
