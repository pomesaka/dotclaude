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

- **フィルタが「効かない」バグはまずバックエンドの稼働バイナリを確認する**: JJ/git worktree のマルチワークスペース環境では、別ワークスペースの古いバイナリ（コード生成前・再起動前）が同じポートで動いていることがある。フロント側フィルタ実装を掘り下げる前に「どのバイナリがポートを握っているか」「最新 gen 済みか」を先に確認する。確認手順: `lsof -i :8080` でプロセスを特定し、バイナリのビルド日時またはプロセスの起動時刻を見る。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->

- **`slog` に `err.Error()` を渡すのは NG**: `slog.Error("msg", "error", err.Error())` は `error` 値を文字列化してから渡しており、structured logging の利点（型情報・後続 sink でのフィールド抽出）を失う。`slog` は `error` インターフェースをそのまま受け取れるので `"error", err` と渡す。同一ファイル内で混在すると reviewer が複数ラウンドにわたって指摘してくることが多い。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **テストで value 型 Tx の nil チェックは field 代入できない**: `repository.Tx` の実装が `fakeTx struct{}` のような値型の場合、`d.tx = nil` はコンパイルエラーになる（nil は interface にしか代入できない）。nil チェックを検証したいときは `NewXxxUsecase(nil, ...)` と直接 typed nil をコンストラクタに渡す必要がある。テーブル駆動テストで他の nil ケースと構造を揃えるには `if name == "tx nil"` の特殊分岐が必要で、その理由をコメントに明記すること。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **Tx モック + repo モックの組み合わせでテストする場合、Tx がエラーを返しても repo mock の return を設定していると後続 Call が失敗する**: `firstCallFailTx` のように「最初の Transaction だけ失敗、以降は fn を実行」というフェイクを作るとき、`jobRepo.CreateReturn.Error` を別途設定すると 2 回目以降の `fn` 内でも失敗してしまう。Tx レベルで失敗させる場合は repo mock の return を触らない（default = nil error のまま）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->

- **`FindBySystemID` / `FindByXxx` が `*T` を返す場合、error = nil でも nil チェックが必要**: `src, err := repo.FindBySystemID(...)` が `nil, nil` を返す（行が存在しない）ケースがある。`if err != nil` ガードだけでは不十分で、直後に `if src == nil` を追加しないとデリファレンス時にパニックする。best-effort 関数（エラーを飲む関数）でも同様。データ整合性を前提に nil チェックを省いた実装がレビューで繰り返し指摘される。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->

- **テーブル駆動テストで「出力に含まれないこと」も検証する**: 条件分岐で status に応じて出力が切り替わる関数（例: done/failed で異なるメッセージ）のテストでは、`wantContains` で正の確認をするだけでなく `wantNotContains` で否定確認も行う。例: failed ケースで `summary` が無視されることを `!strings.Contains(got, *summary)` で明示的にアサート。条件の符号が反転しても正の確認だけでは通過してしまうことがある。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
