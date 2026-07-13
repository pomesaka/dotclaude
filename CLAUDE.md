> **TL;DR**: jj / fd / rg を使う。コミットは指示があるまでしない。`~/.claude/*` の編集は実体パス `~/github.com/pomesaka/dotclaude/...` 経由。コメントは「コードが原理的に語れない情報」だけ書き、断言する前提は一次情報で検証する。`as` キャスト禁止・テストは table driven。2 箇所以上で共有される導出は 1 関数に集約。質問は `AskUserQuestion`。
>
> 各原則の実例・亜種チェーンは `archive/CLAUDE.md-2026-07-29.md`（および `-2026-07-02.md`）に退避済み。live doc は原則と判断基準のみを持つ。

## 応答スタイル

- 選択肢を提示してユーザーが選んだとき、その選択に問題があれば選ばれた後でも指摘する。「いい選択ですね」で終わらない
- 前提が間違っている質問は、まず前提を訂正してから答える
- 不確かなことは「〜のはず」を省かず明記する。知らないことは知らないという
- 長期的に筋の悪い選択（「楽だから」「今は動くから」）には理由を添えて代替を示す
- **「？」と「！」で実装への移行を切り替える**: 「？」（「〜はどう思います？」等）は意見・議論を求めるシグナル — すぐ実装せず疑問に答えて議論する。「！」（「〜して！」等）は合意済みとみなし確認を挟まず実行してよい
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## Interaction Rules

- ユーザーへの質問は極力 `AskUserQuestion` ツールを使う

## CLI Tools

- Jujutsu (jj): Git の代わりに jj を使用
- fd: find の代わりに fd を使用
- rg (ripgrep): grep の代わりに rg を使用
- portless: ローカル開発サーバーを `https://<appname>.localhost` で起動する（mise 管理: `npm:portless`）。アプリディレクトリで `mise exec -- portless`。初回はローカル CA を生成して HTTPS 化（sudo 昇格）、jj ワークスペースではブランチ名がサブドメインに付く。詳細は `/portless`

## Bash Commands

Shell operator（`&&`/`||`/`;`/`|`）を含む複合コマンドは**パーミッションプロンプトを誘発するため避ける**。フォールバック（`cmd1 || cmd2`）も使わず、正しいコマンドを1つ決めて実行する。パイプ（`|`）は `rg`/`jq` など read-only フィルタのみ可。`cd /path && cmd` の代替策は `~/.claude/docs/bash-tips.md` 参照。

## Version Control (Jujutsu)

コミット操作（`jj commit`, `jj new` 等）は、ユーザーから明示的に指示があるか `/jjcommit` などのスキルが呼ばれるまで自律的に実行しない。ファイルの編集のみ行い、コミットはユーザーに任せる。コマンドリファレンス: `~/.claude/docs/jj.md`

### ブランチ命名（PR 作成時）

- **`release/` prefix のブランチを自律的に作成しない**: `release/adachi` のような「main への promote 対象になる trunk ブランチ」専用の prefix。feature / fix の PR で使うと trunk と混同され、branch protection ruleset や dev CI trigger に予期せず干渉する。明示指示された場合のみ作成可
  - **Why**: ためた変更を main へ promote する PR **のみ** が `release/` prefix を持つ
  - **How to apply**: 通常の PR は `feat/<app>-...` / `fix/` / `docs/` / `chore/` / `hotfix/` から選ぶ。changelog + version bump は `docs/` か `chore/`、base は `release/adachi`。詳細は各プロジェクトの branch-strategy.md 参照

## ~/.claude の管理

`~/.claude/skills/`、`~/.claude/commands/`、`~/.claude/agents/`、`~/.claude/rules/` はシンボリックリンクで、実体は `~/github.com/pomesaka/dotclaude/` にある。

**編集時は必ず実体パス `~/github.com/pomesaka/dotclaude/...` 経由で行う**。`~/.claude/...` パスで Edit/Write すると auto-mode classifier が「self-modification of agent configuration」として block する（classifier は symlink を resolve しない）。対象: `CLAUDE.md` / `skills/` / `commands/` / `agents/` / `rules/` / `docs/` すべて。

## Tmp Directory

- `~/.claude/tmp/` を一時ファイル（作業ログ・調査中のエラーログ等）の保存場所として使用

## Frontend Implementation

フロントエンド（HTML/CSS/JS/React/Next.js）実装ではデザイン品質を意識する。

- プロジェクトルートに `DESIGN.md` があれば最優先のデザイン基準として読み込む
- ない場合は `~/.claude/docs/design-md/` のコレクション（linear / vercel / notion / stripe / claude）から `/use-design` で適用
- AI が生成しがちな「Inter フォント・紫グラデーション・cookie-cutter レイアウト」は避け、意図的な美学を持つ UI を目指す

デザイン原則の詳細: `~/.claude/skills/frontend-design/SKILL.md`

## ユビキタス言語・用語集

プロジェクトに `docs/glossary.md`（または同等の用語集）がある場合、それは**非エンジニア（顧客・現場担当者）とコードベースをつなぐ共通言語**であり最重要ドキュメントのひとつ。

- **取捨の基準は「その語を現場の人が製品について話すときに口にするか？」**。用語集を domain 層の型カタログにしない（肥大化すると本当に共有すべき業務語が plumbing 型の海に埋もれる）
- **載せるのは業務概念だけ**: エンティティ・値オブジェクト・利用者が知覚する業務状態。対応する core 型には所在（型名・ファイル）を軽いポインタとして併記してよい
- **載せない（実装 plumbing）**: `*Store`/`*Client`/`*Provider`/`*Config`/`*Deps`/`*Agent`系/`*Input`/`*Result`/`*Usage`/`*Event`/hooks/`*View`/Server Action/CQRS 関数/認可ガード/定数/lifecycle ジョブ基盤/インフラ型。置き場は architecture/conventions/コードコメント
- **型名・変数名・ファイル名はここに準拠する**。用語集にない業務概念を実装で勝手に命名しない
- **新しいドメイン概念（業務語）を定義したら用語集に追記する**（plumbing 型は追記しない）。実装だけが先行してはいけない
- レビューループでも新しいドメイン**概念**の追加を確認したら `[要更新]` として指摘する（plumbing 型の登録漏れは対象外）

## Coding Policy

### コメント

- ドキュメント: 外部から使用される可能性があるものには必ずドキュメントを記載
- **コメントの基本原則: コードが原理的に語れない情報だけを書く — 宛先は「このコードを変更しようとしている未来の読者」**。コードは WHAT / HOW を自分で語れるので、出番はコードから読み取れないものに限る:
  - ① **WHY / WHY NOT**（設計判断）
  - ② **コードの外にある制約**: 外部 API の癖・業務/法的要件・パフォーマンス根拠などリポジトリ内を読んでも辿り着けない事実
  - ③ **意図的な非対称・例外の表明**: 「A はやるのに B はやらない」は意図かバグか読者に判別できない
  - ④ **罠の警告**: 「一見こう直したくなるが、それをやると X が壊れる」— 将来のリファクタラーへの地雷マップ
  - **書かないもの**: WHAT の翻訳（コードと二重管理になり腐る）／レビュアー向けの弁明（PR 説明に書く。マージ後は雑音）
  - **間違ったコメントはコメント無しより有害**: 読者はコードは疑ってもコメントは信じる
- **コメントの寿命を区別する**: 恒久コメント（WHY/制約/罠）はコードが生きる限り有効に保つ。時限コメント（deferral）は発行時点で失効条件が決まっており、必ず**機械的に検索可能なマーカー**を持たせて失効時に消す（Working Rules の deferral マーカー規約）。コメント管理の漏れはほぼ時限コメントの寿命管理漏れで起きる
- 設計判断・分岐・非対称な扱いには **WHY と WHY NOT を両方**書く。WHY だけだと「やり残し / バグ」と区別がつかない。自明なロジックにはコメント不要
- **WHY コメントに書く前提は一次情報で検証してから書く**: 憶測の WHY は「確認済み」として後続実装の根拠に再利用され障害を再生産する。挙動を断言する WHY は公式ドキュメント・型エラー誘発・実行結果で検証する。「未検証だが現状許容する」も同じ違反（読者は判断済みと解釈する）。**検証対象は自分の断言に限らない** — 上流コミットの JSDoc・引用する規約節名・repository の Update 実装も一次情報ではない。NG: `// WHY X: library Y がそうする`／OK: `// WHY X: library Y vN.M で動作確認`。亜種 6 件: `archive/CLAUDE.md-2026-07-02.md#1-why-comment-verification`・`archive/CLAUDE.md-2026-07-29.md#1-why-comment-verification-variants`
  <!-- importance: high | mentions: 14 | first-seen: 2026-06 -->
  - **別リポジトリのローカル clone は一次情報ではない — `gh api repos/<owner>/<repo>/contents/<path>` でリモート実体を読む**: `~/github.com/<org>/<repo>/` の clone は同期状態が不明で、commit を 1 つも持たない壊れたスナップショットのことすらある（実例: ADeT-AI の clone が全ファイル untracked・`git log` が空で、送信フィールド名が実体と違って見えた）。判断基準: 「この clone が今の main と一致している保証はどこにあるか？」無ければリモートを読む。**前提が崩れたように見えたときこそ疑う** — 他の既知の事実（その値を必須にしている API が動いている等）と矛盾したら、まず情報源の健全性を確認する。
  - **他リポジトリの挙動を根拠にする WHY には、参照元パスと確認時点を書く**: 自分は検証していても、そのコメントを読む人はこのリポジトリ内から検証できず「未検証の断定」と区別がつかない（実際レビューでポリシー違反として差し戻された）。NG: `// WHY 64 桁: ADeT-AI は 48 文字の値を送るため`／OK: `// WHY 64 桁: ADeT-AI src/analyze-spec/shared/setup.ts の catch 節・2026-07-29 時点の main で確認`。
- **WHY は「採用した設計」の視点から書く**: 案 A を検討 → 却下 → 案 B を実装、の流れで A の WHY を「なぜこうしたか」として書くと、読者は「A が実装されている」と誤解する。実装した B の視点から `WHY B:` と `WHY NOT A:` を書く。詳細: `archive/CLAUDE.md-2026-07-29.md#3-adopted-design-perspective`
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **「削除・撤去の歴史語り」コメントを残さない — 歴史は git/PR が語る**: 「X は issue NNN で削除した」「旧 Y は統合され廃止」のような**過去の変更を説明するコメント**を残さない。残すのは①現在の挙動の WHY / WHY NOT ②`TODO(#NNN)` だけ。判断基準: 「このコメントは削除されたコードが存在しなかったとしても意味が通るか？」NO なら削除。**テーブル統合・機能統合の PR は特に出やすい**。PR 前に `rg '旧 |統合した|統合された|廃止' <変更ファイル>` で棚卸しする。詳細: `archive/CLAUDE.md-2026-07-29.md#5-history-narration-comments`
  <!-- importance: high | mentions: 2 | first-seen: 2026-07 -->
- **PR スコープ内で書いた deferral placeholder は実装後に全件消す**: 「後続 issue で〜」「追加予定」「TODO(#NNN)」を今 PR で解決したのに残すケースが多い。JSDoc / line comment / block comment / issue ファイルの Devlog を問わず対象。レビュー前に `rg '#\d+ で削除|#\d+ で追加|追加予定|後続 issue|TODO\(#\d+\)' <変更ファイル>` で確認。Devlog は過去エントリを書き換えず「YYYY-MM-DD: 上記方針を撤回し本 PR で実装した」と追記して訂正する（日誌の時系列を壊さない）。詳細: `archive/CLAUDE.md-2026-07-29.md#2-placeholder-cleanup`
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **同一 PR 内でドキュメント文言が食い違ったら、揃える前に「どちらが実装の実態か」をコードで確かめる**: その矛盾は**仕様と実装が既に乖離しているサイン**のことがある（新しい文は実装を、古い文は仕様を読んで書かれるため、差がそのまま乖離の位置を指す）。対処: ①仕様（ブリーフ・ADR）と実装記述を分ける ②コードで事実を確定 ③**仕様側を正として残し**乖離は `FIXME:` でコードに刻む ④実装記述側は中立表現へ。「文言の不統一」として消すと乖離が文書から消えて誰も気づけなくなる。詳細: `archive/CLAUDE.md-2026-07-29.md#4-doc-conflict-is-drift-signal`
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

### 実装

- **ツールが所有する生成物ファイルは手書きしない — 必ずツールのコマンドで生成する**: lockfile・migration journal/snapshot・チェックサム等を手で書くと暗黙の不変条件（タイムスタンプ単調増加・snapshot チェーン整合・ハッシュ一致）を破り、**エラーでなく無音の故障**（migration の無音スキップ等）になる。一部だけ手書きも同罪。**現在時刻・epoch も頭で計算せず `date +%s` で取得する**。詳細: `archive/CLAUDE.md-2026-07-29.md#6-tool-owned-generated-files`
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **TypeScript: `as` キャストは禁止**。空配列は `[] satisfies T[]` か `const arr: T[] = []`。全除去チェックは `rg ' as [^a-z ]'`（`as [A-Z]` では `as 1 | 2 | 3` のような数値 literal union を取りこぼす。`as const` はこのパターンに引っかからない）。ただし `{ items: [] }` のような contextual typing は `as` が無いので `satisfies` 不要 — reviewer の指摘は実コードを Read して判断する。詳細: `archive/CLAUDE.md-2026-07-29.md#7-as-cast-alternatives`
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **分岐の書き分け**: 単一変数の値による分岐は `switch`（網羅性・exhaustive check と相性が良い）。全 case が return するだけなら `const MAP = {...} as const; return MAP[key];` の Record lookup。複数の独立した boolean ファクトに優先順位を付けて 1 つ選ぶケースは switch では表現できず `if + early return` の連鎖。詳細と亜種: `archive/CLAUDE.md-2026-07-02.md#3-switch-vs-record-vs-if`
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **2 箇所以上で共有される導出は 1 関数に集約する — インライン構築を散らさない**: 合成キー文字列・補正計算式・boolean 判定述語・ドメイン状態 → 表示分類の射影がすべて対象。散らすと規則変更時に片側だけ変わる**サイレントな不整合**（誤カウント・「バッジは値引きなのに不一致フィルタに出る」等）を生む。判断基準: 「この導出は 2 箇所以上で行われているか？」YES なら関数化。**関数を定義した後に別ファイルでインライン構築が新たに生まれる**ので、PR レビュー時に全箇所を確認する。実例チェーン: `archive/CLAUDE.md-2026-07-29.md#8-shared-derivation-consolidation`
  <!-- importance: medium | mentions: 5 | first-seen: 2026-06 -->
- **ユーザー入力 ID の帰属検証（テナント/プロジェクト = IDOR 対策）は「呼び出し経路ごと」でなく「その ID が内容に到達する絞り点」に置く**: 入口ごとに書くと**追加された経路で書き忘れる**（漏れが「意図的な例外」に見え発見が遅れる）。ID が実体に解決される 1 箇所（`materializeCommit(tenantID, id)` 等）に寄せ、関数の契約として WHY に明記する。判断基準: 「この ID を実体に解決している関数は何個か？」複数なら**まず解決関数を集約してから**検証を置く。応答は NotFound に倒す（Forbidden は他テナントでの存在を漏らす）。上記「1 箇所に寄せる」と同型だが代償が権限境界の突破なので優先度が高い。詳細: `archive/CLAUDE.md-2026-07-29.md#9-idor-single-choke-point`
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **抽出する前に、より宣言的な形と既存の担い手を確認する — 過剰な間接化を避ける**: ① mutable な local 変数（`let` / 再代入 `var`）は「より宣言的に書けないか」の signal だが即「関数抽出」に逃げない。まず `map/filter/reduce`・三項演算子・switch 式で消せないか試し、残ったら「2 箇所以上で使われるか」で判断する（ループカウンタ・state machine は例外）。② コンポーネントの pure 層を新設する前に、既存の `XxxPanel` が既に presenter を担っていないか確認する（担っていれば中間層は冗長 + 1 ファイル 2 export 規約違反）。**ユーザーが明示指示していても、重複・規約違反に気づいたら実装前に指摘する**。詳細: `archive/CLAUDE.md-2026-07-29.md#10-avoid-premature-extraction`
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **リファクタで既存の fallback / defensive パスを機械的に維持しない**: 制約が変わる書き換え（streaming 化・API 変更等）では「元々あったから維持する」と無自覚に持ち越しがちだが、新しい制約下で維持しようとすると複雑度が丸ごと乗る（rewind が効かないので先頭 peek で format 判定、等）。着手前に「この防御パスは今も要件か？」を user に確認するか `git log` で追加時の PR を辿る。要件でなければ丸ごと削るのが常に単純。詳細: `archive/CLAUDE.md-2026-07-29.md#11-refactor-inherited-fallbacks`
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **LLM 呼び出しコードの rename 凍結境界は「model が実際に読む文字列か」で引く — ファイル単位で凍結しない**: prompt 本文・出力スキーマの wire フィールド名（zod の key・`.describe()` 文言）・user message 文言は model に届くため凍結（触るなら eval 再走とセットの独立 issue）。同じファイル内でも model に送信されない TS 識別子（型名・schema 変数名・関数名・定数名）は通常の rename 対象。判断基準: 「この文字列はリクエスト/レスポンスとして model に届くか？」詳細: `archive/CLAUDE.md-2026-07-29.md#12-llm-rename-freeze-boundary`
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## Testing Policy

- テストはできるだけ **table driven test** で書く（Go: `t.Run` + スライス、Bun/Jest: `test.each`）。個別の `test(...)` はテーブル化できない固有のセットアップが必要なケースに限る
- **`test.each` は「同じ構造・複数ケース」の共通化に限る**: 条件分岐フラグ（`needsSegments`・`shouldThrow` 等）を行に入れて `if (flag)` で assertion を切り替えると意図が不明瞭になる。1 行しかない `test.each` も `test()` に変換する。判断: 「全行で assertion コードが同一構造か」YES なら table、NO なら分割。`shouldThrow` は同 PR 内の複数ファイルに再発しやすいので `rg "shouldThrow" <変更した *.test.ts>` で横断確認。詳細: `archive/CLAUDE.md-2026-07-02.md#2-test-each-uniformity`
  <!-- importance: medium | mentions: 5 | first-seen: 2026-06 -->
- **同一契約を 2 実装が満たすとき（TS 関数 ↔ SQL migration の hash / normalize、サービス間の wire payload キー名）、固定値を pin する test を書く**: 片方だけ変わっても typecheck が**通ってしまう**ため、コンパイラは契約の破壊を検出できず silent failure になる。対処: table-driven で「入力 → 事前計算した hex / キー名込みの body」を pin して assert。hash 対象外の列は `@ts-expect-error` で型レベルに担保する。判断基準: 「同じ関数の 2 実装が pipeline のどこかで交わるか」「そのキーは wire に出るか」。検証法: 旧名へ一時的に戻してテストが落ちるか確認する。詳細: `archive/CLAUDE.md-2026-07-29.md#14-cross-implementation-contract-pin`
  <!-- importance: medium | mentions: 2 | first-seen: 2026-07 -->
- **多段ステージ処理のテストは「このケースはどのステージで確定するか」を入力データで明示的にコントロールする**: 上流ステージが先に確定するデータを使うと目的のステージに到達しないままテストが通る。フィクスチャに「なぜこのデータは上流をスルーするか」の WHY を書き、意図したステージで確定していることを（`joinBasis` 等のフィールドで）assert する。詳細: `archive/CLAUDE.md-2026-07-29.md#13-multi-stage-test-control`
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **環境変数で条件付きスキップされるテスト群（`LOCAL_DB=true` 等）は「通っている」ではなく「誰も走らせていない」— 初めて走らせた失敗を自分の変更のせいだと決めつけない**: CI にも載らないため、テスト自体もテスト基盤も壊れたまま何ヶ月も緑に見える。自分の変更の検証のために初めて起動したとき、無関係な既存の破損（別 PR が足したバリデーション必須化にフィクスチャが追従していない・SQL ローダの素朴な `;` 分割がコメント中の `;` で文を切る 等）が一斉に噴き出す。手順: ①失敗が自分の変更由来かを「変更前 revision でも落ちるか」で切り分ける ②自分の検証を通すのに不可欠な基盤側の破損だけ同 PR で直し、回帰テストを添える ③残りは直さず PR 本文の「既知の問題（本 PR では未対応）」に書いて可視化する（黙って直すとスコープが膨らみ、黙って放置すると再び不可視に戻る）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## Context Management

- context が 60% を超えたら新しいタスクを始めない
- `/compact` は必ずヒント付きで実行する（例: `/compact focus on X, drop Y`）
- autocompact に自動発火させない — 発火タイミングは intelligence が最低の状態
- tool call の詳細ではなく結論だけ必要なら subagent に投げる（Agent ツール、`context: fork`）
- `/rewind` 前に「summarize from here」を依頼して引き継ぎメモを生成する

## サブエージェント委譲（速度最適化）

委譲は自動的に速くならない。速くなるのは以下の形のときだけ:

- **独立タスクの並列実行**（最大の効果）: 互いに依存しない作業は複数の Agent を**1メッセージで同時起動**する。逐次で投げると並列の意味がない
- **メイン context の軽量化**: ファイルダンプの多い探索・調査は subagent に投げて**結論だけ**受け取る。長いセッションほど効く
- **機械的作業のスループット**: lint/typecheck 修正・一括変換など判断の少ない作業は `model: "sonnet"`（単純な収集は `"haiku"`）を指定する。**指定しないと親モデルを継承する**ので速度メリットが出ない

**逆に遅くなるケース**: 逐次依存する短いタスク。spawn オーバーヘッド + コンテキストのゼロからの再発見コストで、メインで直接やるより遅い。

- **サブエージェントの「完了報告」は作業ツリーの実 diff で必ず検証する**: 委譲先がさらに再委譲し、実体を持たないまま「実装完了」と報告するケースを実測（メインの無関係な編集を自分の成果と誤認する）。対処: ①`jj st` / `jj diff` で「期待したファイルに期待した変更があるか」を自分で確認 ②typecheck/test も自分で走らせる ③再 spawn 時は「他エージェントへの委譲禁止・あなた自身が Read/Edit/Write/Bash で直接実装すること」を明示する。詳細: `archive/CLAUDE.md-2026-07-29.md#15-subagent-completion-verification`
  <!-- importance: high | mentions: 2 | first-seen: 2026-07 -->
  - **「やらかしたが自分で直した」という自己申告も検証対象**: read-only 想定のレビュアーが `jj new main` で `main` に空コミットを作り「`jj abandon` で戻した」と報告してきた実例。直した**つもり**で残骸があると、次の push まで誰も気づかない。対処: `jj log -r 'main | @ | @-'` で当該 revision が origin と一致しているかを自分で確認する。

## Claude Code Hooks 設計規約

- **`PostToolUse:Edit` で auto-fixer（biome / `eslint --fix`）を走らせない — `Stop` hook に集約する**: 中間 Edit の「変数を定義したが使用箇所はまだ」状態を fixer が誤検知し `_prefix` リネーム・未使用 import 削除を行い、次の Edit で `Cannot find name 'X'` になる。`--unsafe` を外しても safe fix で import が消える。ターン終了時なら使用箇所も揃っている。未使用検出を持つ fixer すべてに当てはまる。詳細: `archive/CLAUDE.md-2026-07-02.md#6-biome-post-edit-hook`
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
- **hook のトリガーは「何が変わったか」でなく「何が欠けているか」で選ぶ**: 変更検知（`FileChanged` で lockfile 監視等）は一見筋が良いが外れることが多い — worktree 並列開発で欠けているのは node_modules であって lockfile は**変更されていない**ため永遠に発火しない。「このイベントは、私が困っている状態のときに実際に発火するか？」を実ワークフローに当てる。**イベント名から挙動を推測しない**（`Setup` は通常のセッション開始で発火しない・`WorktreeCreate` は通知でなく作成処理そのものの置き換え）— 採用前に公式ドキュメントで発火条件を確認する。`SessionStart` の stdout はコンテキストに注入されるので副作用目的なら `> /dev/null`。発火確認方法（`hook_success` レコード）含む詳細: `archive/CLAUDE.md-2026-07-29.md#16-hook-trigger-selection`
  <!-- importance: high | mentions: 2 | first-seen: 2026-07 -->
- **自動実行される hook に追跡ファイルを書き換えさせない — 「静かに壊れる」より「うるさく失敗する」を選ぶ**: hook はユーザーが見ていないところで走るため、生成物（lockfile 等）を書き換えると「作った覚えのない変更」がコミットに混入する。`bun install` でなく `bun install --frozen-lockfile`（npm なら `ci`）。判断基準: 「この hook は追跡ファイルを変更しうるか？」YES なら変更しない版を探す。関連: 上記「ツールが所有する生成物ファイルは手書きしない」と対
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

## スキル（SKILL.md）設計規約

- **`allowed-tools` とスキル内指示ツールを一致させる**: 本文で「Write で保存する」「Edit で修正する」と指示するなら `allowed-tools` に追加する。無いと実行時にブロックされる。新しいスキルを書くたびに本文を通読して使うツールをリストアップする
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

## Working Rules

- コミット粒度: 適切な粒度で作業内容をコミット
- workspace/xxx/ は JJ ワークスペース（git worktree 相当）で、リポジトリの独立した作業コピー
  - workspace/xxx/ 配下のファイルのみ参照・編集可能（リポジトリルートや他の workspace は禁止）
  - jj コマンド・`gh pr create` も workspace/xxx/ 内で実行すればその workspace の revision に対して操作される
- ドキュメントを書く際にトラブルシューティングの章を書くのは、ユーザーから指示がない限り禁止
- 修正案がいくつかあるとき、一番楽なものではなく長期的に一番筋のいい選択を取る
- 認証・認可・ORM・バリデーション・ジョブ基盤など横断的な関心事を自前設計する前に、採用済みライブラリ/フレームワークに同等機能がないか公式ドキュメントで調査する。自前を選ぶ場合もその判断に根拠を持つ
- **PM セッションは issue のステータスを更新しない**: 「着手できそう」「もう終わった」と判断しても `status`（open → in-progress → done）を変更しない。更新は**着手した実装セッション**の責務。PM が変更すると実装セッション側が意図せず差し戻すか上書きする事故が起きる
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **deferral マーカーは 2 種類に統一する**（2026-07-13 noah PR #328 で確立。旧ルールの「FIXME 全面禁止」を改訂）:
  - `TODO(#NNN): <要約>` — 対応 issue が存在する deferral。`rg "TODO\(#"` / `gh issue view N` で「コード ↔ issue ↔ PR」を辿れる状態にする
  - `FIXME: <やること>` — **対応が必要だが issue 未起票**。「何をすべきか」を actionable に書く（制約の説明だけで済ませない）。`rg "FIXME"` が未起票の要対応の棚卸しリストになる。起票したら `TODO(#NNN)` に昇格
  - **番号なし `TODO`・「別 issue 候補に残す」「後続 issue で対応」のような曖昧な言及は禁止** — 「起票した気」になるが検索アンカーがなく実質先送り
  - **番号のない issue 帰属コメント（`(issue で導入・YYYY-MM)` 等）も禁止** — attribution は git blame / PR で辿れる
  - フォローアップは現 PR に ①`issues/NNN-*.md` 新規作成 + ②`TODO(#NNN)` コメントを同一コミットで含めるのが第一候補（詳細: `archive/CLAUDE.md-2026-07-02.md#4-todo-issue-linkage`）。起票判断を保留するものだけ FIXME に残す
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
- **引き継ぎドキュメント（handoff・compaction summary・親セッションの指示）は書かれた時点のスナップショット — 着手時と push 前の 2 回、実際のコードに当て直す**: 並行 PR が main にマージされると前提が動く。「衝突を避けるためこの引数を struct 化してから列を足す」のような**回避指示は、回避対象がマージされた瞬間に意味が変わる**（rebase して初めて衝突が現実化する / 逆に不要になる）。「このコメントを消す」のような指示も、対象がまだ存在せず**rebase 後に初めて出現する**ことがある（指示が書かれたのは相手 PR のレビュー中で、マージされて初めてこちらに降りてくるため）。手順: ①着手時に指示の前提が今の main で成り立つか確認 ②push 前に `jj rebase -r @ -d main` してから指示を読み直し、消すはずのものが出現していないか / 残すはずのマーカー（`TODO(#NNN)`）を巻き添えにしていないかを確認する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **「機能 X の動線を消して」は、UI のトグル/リンクを消す作業ではない — まず「X のデフォルト値がどう決まるか」を読んでから撤去スコープを決める**: エントリポイントだけ外すと**デフォルトが X 側に倒れる条件を持つユーザーは X に閉じ込められる**（切り替え手段だけ失う）。しかも「動線が消えた」ように見えレビューでも気づかれにくい。手順: ①初期状態を決めるもの（localStorage・cookie・feature flag・エンティティのフラグ）を読む ②「常に X でない側に倒れる」と保証できるならトグル削除だけでよい ③保証できないなら分岐そのものを撤去して一本化する。「しばらく使わない」なら到達不能コードは腐るので③、復元は git 履歴に委ねる。詳細: `archive/CLAUDE.md-2026-07-29.md#17-entrypoint-removal-scope`
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **削除・撤去 PR は 3 方向を棚卸しする**（typecheck・lint は通るので機械的検出に頼れない）。**「不変条件を強めて既存の分岐を到達不能にする PR」も同じ棚卸しが要る** — 消えるのはコードでなく**エラーケース**なので `rg` で追える識別子が無く、grep すべきは「そのエラーが起きる条件を説明した日本語」（「〜できない（400）」「一度も〜していない場合は」等）になる。**「概念の定義を置き換える PR」（保存値 → 毎回算出、単一親 → DAG 等）も同型**で、消えるのは*等式*（「A = B」「A は B から辿れる」）— 実装は新定義で動くのに旧等式を述べた記述（doc comment・設計ドキュメント・ADR 本文・列コメント）が全て残り、しかも一発では見つからない。実装完了時点で **旧等式の両辺の語を `rg "<旧概念>|<言い換え>" backend/ docs/`** で一括検索して潰す（分けて出すと同じ趣旨の「要更新」がレビューで何ラウンドにも分散する — 実例: ADeT PR #2655 で「fork commit = merge base」の残骸が 5 ラウンドに渡って出た）:
  - **前方向（消したものを誰が呼ぶか）**: `rg "<パス>"` / `rg "<関数名>" docs/ apps/ packages/` で呼び出し側 component・test に加え **docs のサンプル・コメント参照**まで特定し同 PR で更新する。別 PR に分けると runtime エラー（404 / 500）の窓が開く
  - **逆方向（消したコードが唯一の消費者だった共有 API）**: 撤去した機能**だけ**が読んでいた hook / 関数の返り値・引数は dead surface として残る（typecheck は「返しているが誰も読まない」を通す）。同じ理屈で、**その機能の制約を回避するために歪んでいた実装も元に戻せる** — 撤去 PR は「その機能のせいで払っていたコストの回収」までがスコープ
  - **文書方向（概念を前提に書かれた記述）**: ドメイン概念を撤去すると ADR の cross-reference・兄弟 issue の前提が陳腐化する。`rg "<概念名>|<関連語>" docs/ issues/` で検索し、ADR は NOTE 追記・issue は Devlog に「前提変更」エントリで追従させる。**検索範囲に「業務語の用語集（GLOSSARY 等）」と「API スキーマの description」を必ず含める** — 前者は不変条件を業務語で言い直しているので技術ドキュメントと同時に腐り、後者は生成物経由で FE/BE 両方に配られる。エラーコードを前提にした UI 文言（`switch (code)` の分岐）は**到達不能な case として残る**ので `rg "<エラーコード>" frontend/` も回す
  - 詳細と実例: `archive/CLAUDE.md-2026-07-29.md#18-removal-inventory`
  <!-- importance: high | mentions: 8 | first-seen: 2026-06 -->
- **ADR と実装が乖離したとき: 実装を ADR に合わせるより ADR に追記する（本文は書き換えない）**: コードが真実であり ADR は意思決定の記録なので、コードを ADR に合わせて複雑化するより ADR をコードの実態に追従させる。書き方は 3 パターン:
  - **実装が別の形に着地した** → 当該判断セクション末尾に「### 実装メモ」で「実際の着地モデル・なぜそうなったか・どういう条件なら元の設計に戻すべきか」を追記
  - **決定済みだがコード未追従の rename・仕様** → 現行実装を正とする本文に混ぜず「決定済み・未追従（issue NNN）」セクションへ分離し、コードが追従した PR で本文へ昇格
  - **歴史記述が後続 issue で無効化された** → 本文を書き換えず「NOTE: issue NNN で撤廃済み — 本項は当時の記録」を添える（書き換えると意思決定の記録が壊れ、放置すると「現在も有効」と誤読される。NOTE が両立させる）
  - 詳細と実例: `archive/CLAUDE.md-2026-07-29.md#19-adr-drift`
  <!-- importance: medium | mentions: 4 | first-seen: 2026-06 -->
- **デザイン要件ドキュメント（デザイナーブリーフ）は「現状の説明」でなく「正しい仕様の定義」として書く**: あるべき仕様を定義するフレームで書き、現行実装が乖離していれば「作り直し対象」と明示する。特に ①状態変化は「削除される N 件」でなく「到達不能になる版」等の到達性で表現 ②将来実装の操作の引き継ぎ範囲（HEAD のみ / Current も含む等）を必ず明記する（UI の初期状態・空状態が定まる）。詳細: `archive/CLAUDE.md-2026-07-02.md#5-design-brief-spec-first`
  <!-- importance: high | mentions: 2 | first-seen: 2026-06 -->

---

## 重要ルール再掲

長い会話で薄れやすいものを 3 つ:

1. **コミットは指示があるまでしない** — 編集のみ行い、`jj commit` / `jj new` はユーザーに任せる
2. **断言する前に一次情報で検証する** — WHY コメントも、ユーザーへの回答も。未検証なら「未検証」と言う（「〜のはず」を省かない）
3. **`~/.claude/*` の編集は実体パス `~/github.com/pomesaka/dotclaude/...` 経由** — symlink 経由だと classifier に block される
