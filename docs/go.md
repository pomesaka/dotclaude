# Goで踏んだ罠と、この利用者の書き方

> **TL;DR**: Goを書くときとレビューするときに読む。一般的な作法は書かず、利用者の選択と、実際に間違えた点だけを置く。

整理する前の版は`archive/2026-11-16/docs/go.md`にある。

## 書き方の選択

- エラーメッセージに`"failed to ~"`を付けない。`"find user: %w"`の形で短く書く（ラップが重なると`failed to`が並ぶだけになる）
- exportedを上、unexportedを下に置く。ファイルは上から読むので、公開APIを先に見せる
- 構造体リテラルは、フィールドごとに改行する
- `slog`には`"error", err`と`error`のまま渡す。`err.Error()`で文字列にすると、後段で型と項目を取り出せなくなる

## 型と設計

- **GORMが生成したstructを型パラメータにするとき、interfaceの制約は使えない**: GORM genのstructは`(*XxxTable) TableName() string`とポインタレシーバで実装するので、`interface { TableName() string }`を定義しても値型の`XxxTable`は制約を満たせない。型パラメータは`[T any]`にし、「TはGORMが生成したstruct」とgodocに書いて、実行時のテストで確かめる。

- **enumの検証は、生のキャストでなく`ParseXxx()`を使う**: `go:generate string_enum`などが生成するenumには`ParseXxx(s string) (Xxx, error)`がある。OpenAPIで検証済みでも`value.JobStatus(s)`と書かず、ハンドラ層で`value.ParseJobStatus(s)`を呼ぶ。生のキャストを許すと、検証の場所が散らばる。

- **`FindByXxx`が`*T`を返すとき、`err == nil`でも`nil`を確かめる**: 行が無いと`nil, nil`を返す実装がある。`if err != nil`の直後に`if src == nil`を置かないと、デリファレンスでパニックする。エラーを握りつぶすbest-effortの関数でも同じ。

- **custom errorを返す側と、`errors.As`で分類する側で、値とポインタを揃える**: 分類が`*DomainError`を目標にしているとき、`return DomainError{...}`（値）は一致しない。`Error()`が値レシーバだと両方が`error`を満たすので、コンパイルは通り、分類だけが外れて「予期しないエラー」の500になる。分類のヘルパーがどちらを目標にしているかを実装で読み、`rg 'return .*\bDomainError\{' <pkg>`で返す側を揃える。

- **port（interface）の引数を構造体にまとめるかは、引数の数でなく、同じ型の引数が隣り合うかで決める**: `parent, secondParent *system_id.SystemID`のように同じ型が並ぶと、位置を取り違えてもコンパイルも検証も通り、データが壊れる。構造体ならフィールド名で結ばれる。構造体はinterfaceと同じパッケージに置く（実装の側に置くとimportが循環する）。

- **数十MBになりうるpayloadのJSONは、`io.ReadAll`と`json.Unmarshal`でなく、jsonv2の`json.UnmarshalRead(r, &v)`で読む**: `encoding/json/v2`の`UnmarshalRead`は`io.Reader`から直接読むので、payloadの全体をメモリに載せずに済む。

- **DBのtx（`tx.Transaction`、`db.WithContext(ctx).Transaction`）の中で、外部I/Oを呼ばない**: txの中でHTTP、S3、GitHubのAPIを呼ぶと、ネットワークの待ち時間のあいだ行ロックを持ち続け、同じ行を触るほかのtxが待たされる。txには「DBの状態の遷移」だけを入れる。読み取りと復号はtxの前に済ませ、後始末や通知はtxを抜けた後に、失敗を`slog.Warn`で記録して先へ進む。後始末をtxの外へ出したときは、再配信された通知が消えたリソースを読みに行かないかも見る（`coding-policy.md`の「外部のシステムとつなぐ実装」）。

- **抽象へ移すときは、privateのヘルパーも`rg '<旧パターン>' .`で洗い出す**: publicのメソッドを置き換えても、同じパターンを持つprivateのヘルパーが残ることがある。

## テスト

- **テスト用のfakeを足す前に、同じパッケージに同じ目的のfakeが無いかを`rg -i 'fake' <pkg dir>`で探す**: Goのテストヘルパーはパッケージで共有されるので、別のテストファイルに既にあることが多い。

- **検査を上流へ移した変更で、離れた場所のテストが落ちたら、生成mockの既定値を先に疑う**: 生成mockは、設定していないメソッドが失敗せずzero value（`nil, nil`）を返す。検査が新しく読む依存をstubしていないテストは、nilのデリファレンスか「期待と違うエラーの種別」として、検査から離れた場所で落ちる。検査を移す変更では、移した先が読む依存を、全テストのfixtureに足す。

- **assertを`cmp.Diff`へまとめて置き換えるとき、ポインタの同一性を見ている`!=`は残す**: fixtureどうしの中身が同じだと、deep equalでは「どのインスタンスが渡ったか」を区別できず、テストが常に通る。残した`!=`には理由をコメントで書く。

- **状態で出力が切り替わる関数は、「出力に含まれないこと」も見る**: `wantContains`だけだと、条件の符号が逆になっても通ることがある。

## 道具と環境

- **コード生成（`task gen`、`task be:gen`）の後、LSPのinterfaceの互換性エラーは古いことがある**: LSPが更新前のmockのシグネチャを見て「missing method」と誤って報告する。`go test ./...`か`task lint`の出力で判断する。

- **`task lint`や`go vet`が自分の変更と無関係な理由で落ちたら、キャッシュを先に見る**: `no space left on device`なら`go clean -cache`（`~/Library/Caches/go-build`は上限なしで増え、52GBになったことがある）。別のワークスペースの生成ファイルを指すエラーなら`go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint cache clean`（golangci-lintのキャッシュは、jjのワークスペースの間で共有される）。

- **`go test`の既定のタイムアウトは10分**: `panic: test timed out after 10m0s`はスタックトレースが付くのでテストの不具合に見えるが、まだ走っていただけのことがある。DBやコンテナを使うパッケージなら、`-timeout 40m`を付けて流し直してから原因を考える。

- **フィルタが「効かない」ときは、どのバイナリがポートを使っているかを先に見る**: jjのワークスペースを複数使っていると、別のワークスペースの古いバイナリ（コード生成の前、再起動の前）が同じポートで動いていることがある。`lsof -i :8080`でプロセスを特定し、起動した時刻を見る。
