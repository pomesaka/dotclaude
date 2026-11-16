# Go レビュー観点

> **TL;DR**: Go コードのレビュー観点と Gotchas。禁止: `interface{}` / 冗長エラープレフィックス。推奨: exported 上・early return・構造体改行。Gotchas: LSP は参考程度（`go test`/`task lint` が正）・GORM struct は generic 制約に使えない・`slog` に `err.Error()` 渡し禁止・`FindByXxx` は nil, nil チェック必須。

プロジェクト固有の規約（CLAUDE.md等）に加え、以下の観点でレビューする。

## 禁止パターン

- `interface{}` → `any` を使うこと（Go 1.18+）
- エラーメッセージの冗長プレフィックス: `"failed to ~~~"` 禁止。簡潔に `"find user: %w"` 形式で

## 推奨パターン

- exported を上、unexported を下に配置（ファイルは上から読むため、公開APIを先に）
- ガード節・早期リターンでネストを浅く保つ
- 構造体リテラルはフィールドごとに改行（1行に詰め込まない）

## エラーハンドリング

- エラーは適切な層で変換・ラップする。低レベルのエラーをそのまま上位層に流さない
- `fmt.Errorf("context: %w", err)` でコンテキストを付与する

## Gotchas

- **LSP の interface compatibility エラーは古い情報を参照している場合がある**: コード生成後（`task gen`・`task be:gen`）に LSP が更新前のモックシグネチャを参照し「missing method」などを誤報する。Go はコンパイル単位が明確なため、LSP 診断は参考程度に扱い、`go test ./...` または `task lint` の出力を正とすること。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

- **GORM generated struct を generic 型パラメータにする場合、インターフェース制約を使えない**: GORM gen が生成する struct は `(*XxxTable) TableName() string` とポインタレシーバで実装する。そのため `type tabler interface { TableName() string }` を定義しても value 型の `XxxTable` は制約を満たせずコンパイルエラーになる。対処: 型パラメータを `[T any]` にし、「T は GORM generated struct であること」をコメント（godoc）に明記する。コンパイル時の保護を諦め、実行時テストで検証する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

- **抽象化への移行時は private helper 関数も rg で全件洗い出す**: public メソッドを新しい抽象に置き換えても、同じパターンを持つ private ヘルパー関数（例: `v2ResolveSchemaHistoryByIdentity`）が残ることがある。移行前に `rg '<旧パターン>' .` で全ファイルを横断検索し、対象を網羅してから修正を始めること。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

- **enum バリデーションは生のキャストではなく `ParseXxx()` を使う**: `go:generate string_enum` など自動生成 enum は `ParseXxx(s string) (Xxx, error)` を生成する。OpenAPI でバリデーション済みでも `value.JobStatus(s)` のような生キャストは使わないこと。バリデーションロジックが分散し、「型の生成を一箇所に集約する」原則が崩れる。対処: ハンドラ層で `status, err := value.ParseJobStatus(s); if err != nil { ... }` と明示的にパースする。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->

- **フィルタが「効かない」バグはまずバックエンドの稼働バイナリを確認する**: JJ/git worktree のマルチワークスペース環境では、別ワークスペースの古いバイナリ（コード生成前・再起動前）が同じポートで動いていることがある。フロント側フィルタ実装を詳しく調べる前に「どのバイナリがポートを使っているか」「最新 gen 済みか」を先に確認する。確認手順: `lsof -i :8080` でプロセスを特定し、バイナリのビルド日時またはプロセスの起動時刻を見る。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

- **`slog` に `err.Error()` を渡すのは NG**: `slog.Error("msg", "error", err.Error())` は `error` 値を文字列化してから渡しており、structured logging の利点（型情報・後続 sink でのフィールド抽出）を失う。`slog` は `error` インターフェースをそのまま受け取れるので `"error", err` と渡す。同一ファイル内で混在すると reviewer が複数ラウンドにわたって指摘してくることが多い。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **テストで value 型 Tx の nil チェックは field 代入できない**: `repository.Tx` の実装が `fakeTx struct{}` のような値型の場合、`d.tx = nil` はコンパイルエラーになる（nil は interface にしか代入できない）。nil チェックを検証したいときは `NewXxxUsecase(nil, ...)` と直接 typed nil をコンストラクタに渡す必要がある。テーブル駆動テストで他の nil ケースと構造を揃えるには `if name == "tx nil"` の特殊分岐が必要で、その理由をコメントに明記すること。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **Tx モック + repo モックの組み合わせでテストする場合、Tx がエラーを返しても repo mock の return を設定していると後続 Call が失敗する**: `firstCallFailTx` のように「最初の Transaction だけ失敗、以降は fn を実行」というフェイクを作るとき、`jobRepo.CreateReturn.Error` を別途設定すると 2 回目以降の `fn` 内でも失敗してしまう。Tx レベルで失敗させる場合は repo mock の return を触らない（default = nil error のまま）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **テスト用 fake を新規定義する前にパッケージ内の既存 fake を `rg 'struct\{\}' <pkg dir>` / `rg -i 'fake' <pkg dir>` で確認する**: Go のテストヘルパーはパッケージスコープ共有なので、別テストファイル（例: `start_analyze_pr_webhook_test.go` の `fakeTx`）に同目的の fake が既にあることが多い。確認せず `txFake` 等を新規定義すると同一パッケージに重複型が生まれ、レビューで DRY 違反として指摘される。実例: ある案件の PR で `retry_analyze_test.go` の `txFake` が既存 `fakeTx` と重複 → 削除して再利用（2026-07）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

- **`FindBySystemID` / `FindByXxx` が `*T` を返す場合、error = nil でも nil チェックが必要**: `src, err := repo.FindBySystemID(...)` が `nil, nil` を返す（行が存在しない）ケースがある。`if err != nil` ガードだけでは不十分で、直後に `if src == nil` を追加しないとデリファレンス時にパニックする。best-effort 関数（エラーを飲む関数）でも同様。データ整合性を前提に nil チェックを省いた実装がレビューで繰り返し指摘される。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **テーブル駆動テストで「出力に含まれないこと」も検証する**: 条件分岐で status に応じて出力が切り替わる関数（例: done/failed で異なるメッセージ）のテストでは、`wantContains` で正の確認をするだけでなく `wantNotContains` で否定確認も行う。例: failed ケースで `summary` が無視されることを `!strings.Contains(got, *summary)` で明示的にアサート。条件の符号が反転しても正の確認だけでは通過してしまうことがある。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **巨大 payload の JSON decode は `io.ReadAll` + `json.Unmarshal` でなく jsonv2 `json.UnmarshalRead(r, &v)` で streaming する**: S3 body・HTTP response・大きいファイル等を `io.ReadAll` で一旦バイト列にしてから `json.Unmarshal` すると payload 全体をメモリに載せる。jsonv2 (`encoding/json/v2`) の `UnmarshalRead(io.Reader, any)` は Reader から直接 token を消費するので peak memory が下がる。判断基準:「この payload が数十 MB オーダーになりうるか？」YES なら streaming にする。判定ロジックが要る場合（envelope vs raw のような複数 format 分岐）は `bufio.Reader.Peek` + `jsontext.NewDecoder` で先頭トークンだけ覗いて振り分けるが、format を 1 つに絞れるなら分岐ごと削るほうが常に単純（→ CLAUDE.md 「リファクタ時に既存 fallback を機械的に維持しない」）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

- **`task lint` / `go vet` が「no space left on device」で落ちたら `~/Library/Caches/go-build` を疑う。`go clean -cache` で解消する**: Go build cache は上限なしで成長し（実測 52GB・ディスク 97% 到達）、コンパイル自体が書き込みエラーで失敗する。コードの問題と誤認して個別 package のエラーを追い始めると時間がかかってしまう。`df -h` でディスク残量 → `du -sh ~/Library/Caches/go-build` でキャッシュサイズを確認し、`go clean -cache` で一括削除する（次回ビルドが遅くなる以外の副作用なし）。実例: ある案件の PR の lint 検証中に発生（2026-07）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

- **golangci-lint が自分の変更と無関係なファイル（特に別ワークスペースの生成ファイル）のエラーで落ちたらキャッシュ汚染を疑う。`golangci-lint cache clean` で解消する**: golangci-lint のキャッシュはワークスペース（git worktree / jj workspace）間で共有され、削除済み・存在しない別ワークスペースの生成ファイルを参照したまま exit 201 で落ちることがある。`go vet` が通っているのに lint だけ落ちる・エラーのパスが自分のワークスペース外、が切り分けサイン。`go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint cache clean` 後に再実行する。実例: ある案件の PR の lint 検証中に別ワークスペース `shoko-94e0` の生成ファイル参照で失敗（2026-08）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-08 -->

- **custom error 型を「返す側」と「`errors.As` で分類する側」で値/ポインタを揃える。ずれるとコンパイルは通り、分類だけが気づかないうちに外れる**: 分類が `errors.As(err, &target)` / `errors.AsType[*DomainError]` のようにポインタ型を target にしているとき、`return &DomainError{...}` は一致するが `return DomainError{...}`（値）は一致しない（`Error()` がポインタレシーバなら値型はそもそも `error` を満たさないが、値レシーバだと両方 `error` を満たしてしまいコンパイルが通る）。結果、意図した種別に分類されず「予期せぬエラー」扱いで 500 になる等の気づきにくい誤動作になる。判断基準:「このパッケージの分類ヘルパーは `*T` と `T` のどちらを target にしているか」を実装で確認し、生成側を揃える。同一ファイル内に値返しと ポインタ返しが混在していたら片方はほぼバグ（`rg 'return .*\bDomainError\{' <pkg>` で棚卸し）。レビュアーに指摘されても鵜呑みにせず、使い捨てのテストで実際に `errors.As` を走らせて挙動を実測してから直す（言語仕様の断言は一次情報で確認する）。実例: ある案件の PR で handler の値返し `domain.DomainError{...}` が認証エラーとして分類されていなかった（2026-07）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->

- **port（interface）の引数を DTO 構造体に切り出す判断は「引数の数」でなく「同型引数の隣接」で下し、DTO は interface と同じパッケージに置く**: 強い signal は同じ型の引数が並ぶこと（例: `parent, secondParent *system_id.SystemID` + `createdBy *system_id.SystemID`）。位置を取り違えてもコンパイルも invariant バリデーションも通り、エラーの出ないデータ破損になる（親の順序が気づかないうちに入れ替わる等）。構造体ならフィールド名で結線が強制される。配置: Go の interface satisfaction は同一型を要求するため、DTO は port と同じパッケージに定義し実装側はそれを直接参照する（実装が port パッケージの型を使うのは普通で「依存の逆流」ではない）。実装側パッケージに置くと import が逆転して循環する。層ごとに別 DTO + adapter は変換境界（wire ↔ domain 等）向けで interface/implementation 関係では過剰。`type X = pkg.X` の alias で橋渡しもしない（Go では alias は移行の道具。Google Go Style Guide より）。実例: ある案件の PR `CommitLog.Append` の `AppendInput`（2026-07）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->

- **assert を go-cmp（`cmp.Diff`）へ一括変換するとき、ポインタ同一性が仕様になっている assert を巻き込まない**: `cmp.Diff` は deep equal なので、`got != wantPtr` のような同一性比較を機械的に置き換えると assert が弱くなることがある。特に fixture 同士の内容が同一のとき（例: 「適用後に読み直した spec」と「取り込み元 spec」が同内容）、deep equal では「どのインスタンスが渡ったか」を区別できず、テストが常に通る形骸になる。判断基準:「この assert はインスタンスの同一性（=どこから来た値か）を検証しているか、値の等価性を検証しているか」。前者は `!=` のまま残し、WHY をコメントに書く。逆に有効なのは①同型フィールドが多い入力構造体の複数 if → want 構造体 1 個との `cmp.Diff`、②複数の書き込みカウンタ → 観測用の小構造体に束ねてゼロ値比較（エラー経路の「書き込みなし」が 1 行になる）、③順序が契約でない ID 集合は `cmpopts.SortSlices` + `cmpopts.EquateEmpty` で集合比較にする（順序だけの flake を防ぎつつ nil/空 slice を同一視）、④fake の記録引数を 1 構造体（`forkArgs` 等）に束ねると N 連 if が cmp.Diff 1 発になる（interface 型フィールドも動的型一致 + deref で比較されるので手書き equal ヘルパー不要）。副産物: want 構造体との丸ごと比較はゼロ値フィールド（merge でない Append の SecondParent nil 等）も pin するので field-by-field より強い。一括変換の最後に `equalXxxPtr` 系ヘルパーの残骸を rg で棚卸しする（未使用でも lint が拾わないことがある）。実例: ある案件の PR `branch_service_merge_test.go` ほか 3 テストファイル（2026-07）。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-07 -->

- **`go test` の既定タイムアウトは 10 分。DB を張る重いパッケージでは「テストの失敗」でなく打ち切りとして出る**: `panic: test timed out after 10m0s` はスタックトレースを伴うので落ちたテストのバグに見えるが、実体は「まだ走っていた」だけのことがある。判断: パニックの本文が `test timed out` かを読み、該当パッケージが DB/コンテナを使うなら `-timeout 40m` を付けて再実行してから原因を判断する。個別のテストを疑って詳しく調べる前にこれを確認する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-08 -->

- **不変条件の検査を上流の choke point へ移すと、その検査が新たに読む依存を握っていないテストが「遠く」で落ちる。生成 mock の未設定メソッドは失敗せず zero value を返すためである**: 検査点を前倒しすると呼び出しグラフが変わり、それまでその依存に触れていなかったテストも通るようになる。生成 mock は未設定でも `(nil, nil)` を返して成功するので、テストの結果からは「その依存を stub していない」ことが分からず、nil デリファレンスか「期待と違うエラー種別」として検査点から離れた場所で落ちる。対処: 検査を移動する PR では、移動先が読む依存（entity 取得等）を全テストの fixture に明示的に足す。失敗メッセージが検査と無関係に見えても mock の既定値を先に疑う。関連: 上記「`FindByXxx` は error=nil でも nil チェックが要る」の、テスト側での現れ方。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-08 -->

- **DB tx（`tx.Transaction` / `db.WithContext(ctx).Transaction`）の中で外部 I/O を呼ばない。HTTP・S3・comment API 等は post-tx に出す**: tx 内で `httpClient.Do` / `s3.GetObject` / `s3.DeleteObject` / GitHub PR comment 更新等を行うと、network latency の間 DB の行ロック（`SELECT ... FOR UPDATE` や書き込みロック）を保持し続け、同一行を触る他 tx が待たされる。判断基準:「この呼び出しは network を経由するか？ 経由するなら tx の中で本当に必要か？」原則 tx は「DB 状態の atomic な遷移」だけを含める。ベストエフォート系（後始末系・通知系）は tx 抜けた後で `if err := ...; err != nil { slog.Warn(...) }` で失敗を握って先へ進む。判定に困る例: tx 内で GetObject して decode → apply の場合、apply 自体を tx で保護したいなら「先に GetObject + decode を tx 外で終わらせ、reconciled state を保持して tx に入り書き込みだけ tx 内で行う」に組み替える。実例: analyze-spec 完了処理で tx 内の `DeleteObject`（一時 object 削除）と GitHub PR comment 更新を post-tx へ移した（PR #2587 Round 2 reviewer 指摘）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
