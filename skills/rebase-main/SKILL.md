---
name: rebase-main
description: jj git fetchしてmainにrebaseする。コンフリクト発生時は解消し、PRがあればupdate-prを呼ぶ。/rebase-main で呼び出す。
disable-model-invocation: true
allowed-tools: Bash(jj *), Bash(gh *), Read, Edit, Glob, Skill
model: sonnet
---

# Rebase on Main

現在の作業リビジョンをリモートの最新mainにリベースする。
コンフリクト発生時は解消し、PRが紐づいていれば `/update-pr` でPRを更新する。

## 初期状態（インライン実行済み）

!`jj git fetch && jj log --limit 10`

## 手順

### 1. ルートリビジョンを特定してリベース

上のログ出力を読んで、mainから分岐した最初のリビジョン（ルート）を特定する。
- リビジョンが1つだけ（main直上）なら `@` がルート
- 複数リビジョンのチェーン（例: A→B→@）なら、mainから分岐した最初のリビジョンがルート

```bash
jj rebase -s <ルートrev> -d main
```

### 2. コンフリクト確認・解消

```bash
jj log --limit 5  # conflict マークの有無を確認
```

コンフリクトがある場合:
1. `jj diff` でコンフリクトマーカーのあるファイルを特定
2. ファイルを読み込み、コンフリクトマーカーを手動で解消
3. 解消後、`jj status` でコンフリクトが残っていないことを確認

### 3. PR更新（該当する場合のみ）

現在のブックマークにPRが紐づいているか確認する:

```bash
jj bookmark list
gh pr list --head <bookmark名> --json number,title
```

PRが存在する場合は `/update-pr` スキルを呼び出してPRを更新する。
PRが存在しない場合はここで完了。

## Gotchas

- **コンフリクト後の squash**: `jj squash -m "..."` で resolution commit をコンフリクト commit に統合する（`-m` を省くと vim が開く）。その後 `jj log` で × が消えたことを確認。複数コミットのチェーンが全部 conflict になるケースは下のGotchaを参照。**`-m` は宛先コミットの description を上書きする**: resolution commit をコンフリクト commit（意味のある description がある）に squash するとき、`jj squash -m "resolution message"` はそのコンフリクト commit の元 description を replacement message で丸ごと置き換える。解消後に `jj desc -r <rev> -m '元の意味ある description...'` で正しい description に戻すこと。description を上書きしたくない場合は `-m` を省いて元の description を vim で確認・保持する（`EDITOR=true jj squash` で editor スキップしつつ元 description を維持する方法は `--message ""` 等では不可）。実例: PR #178 rebase 解消で description が "resolve: migration..." に置き換わり `jj desc` で復元した。再発: PR #192（issue 223）でも同手順で復元。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **`@` で直接コンフリクトを解消した場合は squash 不要**: コンフリクトファイルを `@` で直接編集した場合、`jj squash` は「into parent = immutable main」に向かってしまい失敗する。正しくは `jj new <conflict-rev>` → 編集 → `jj squash` の順。ただし `@` 直接編集でも working copy commit として反映されるため、そのまま `jj git push` で問題ない。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->
- **rebase 後は `bun install` を実行する**: main に新しい依存が追加されていると `typecheck` が `Cannot find module` で失敗する。rebase の直後に `mise exec -- bun install` を実行してから lint/typecheck に進む。**通常の `bun install` が「no changes」と言っても typecheck が `Cannot find module`（解決先が HOME の node_modules に climb する等）で落ちるなら symlink が陳腐化している — `mise exec -- bun install --force` で再生成する**（isolated install の workspace symlink が古いパスを指したまま残るため）。実例: issue 050 rebase 後に `zod`/`react-dom` が解決できず、plain install は no-op、`--force` で解消。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **`.next/` が biome の対象に入ると lint が大量エラーになる**: Next.js dev server 起動後に生成される `.next/` ディレクトリが biome に拾われて数万件のエラーになる場合がある。lint 前に `rm -rf apps/*/.next` で削除してから実行すること。
- **`packages/features/package.json` の `exports` フィールドは各フィーチャーブランチが追加するため 2-sided conflict になりやすい**: 解決方法は常に「両方の export エントリを残す」こと。自ブランチのエントリ（例: `"./research": "./src/research/index.ts"`）と main のエントリ（例: `"./document": "./src/document/index.ts"`）を両方保持する。どちらかを捨てると `Cannot find module` エラーが他パッケージで発生する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`docs/apps/conventions.md` の規約セクション文字（W、X…）も 2-sided conflict になりやすい**: 複数のフィーチャーブランチが同じ文字のセクションを追加することがある（例: 両方が「### W.」を追加）。解決方法は「両方残す + リナンバリング」。main 側の W を優先し、自ブランチの W→X、X→Y のように後続にずらす。どちらか一方を捨てると規約の欠落が発生する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **複数コミットのチェーンをリベースすると全中間コミットが conflict になる**: `jj rebase -s <root> -d main` で A→B→C のチェーンをリベースして A が conflict すると、その conflict が伝播して B・C も × 状態になる。working copy `@` でファイルを解消しても、中間コミット自体の × は残るため `jj git push` が拒否される（"Won't push commit since it has conflicts"）。対処: ①`jj squash -m "..."` で working copy 変更をコミット（`-m` で vim を回避）、②`EDITOR=true jj squash --from <top> --into <bottom>` を繰り返して1コミットに集約する。注意: `jj squash -r X --into Y` は無効（`-r` と `--into` は共存不可）、`--from X --into Y` を使う。commit message が両方非空のとき jj は editor を開こうとするため `EDITOR=true` で抑止する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **semantic conflict（意味的コンフリクト）はマーカー解消後の lint で発覚する**: main が新規追加した関数が、自ブランチで削除したメソッドを呼んでいるケース。テキスト的なコンフリクトマーカーを解消しただけでは気づけない。対処: コンフリクト解消・squash 後に必ず `task be:lint`（または相当する lint コマンド）を実行して意味的エラーを検出する。例: main が `ExportV2` を追加 + `GetHead` を使用、自ブランチが `GetHead` を `ProjectSpecSnapshotRepository` から削除済み → `ExportV2` をブランチベースのロジックに更新が必要。**亜種: lint 通過 ≠ semantic conflict 解消 — テストの実行でのみ発覚するケースがある**。自ブランチがコンストラクタ引数を concrete pointer → interface に変えたとき、main 側の新テストが concrete pointer フィールドのまま注入しているとコンパイルは通る（pointer が interface を実装している）が、nil チェックのテーブルテストが typed-nil（nil pointer を包んだ non-nil interface）で `== nil` を素通りして落ちる。対処: lint 後に main が今回追加したテストファイルを含むパッケージの `go test` まで走らせる。テスト側の修正は deps struct のフィールド型を interface に変える（Go 一般の typed-nil 対策と同じ）。実例: PR #2626 rebase で `retry_message_test.go` の `snapshotSvc *ProjectSpecSnapshotService` → `snapshotStore v2spec.SnapshotStore` 化で解消（2026-07）。亜種: main が config 型に必須フィールドを追加すると、自ブランチが**新規追加した**フィクスチャ（テキスト conflict が出ないファイル）が漏れる — typecheck が捕まえるので rebase 後は必ず typecheck まで回す（ADeT-AI PR #741 rebase・`summaryEnabled`・2026-08）。
  <!-- importance: high | mentions: 3 | first-seen: 2026-05 -->
- **main が「書き込み経路に自動で付く副作用」を導入していたら、自ブランチが追加した経路がその副作用の打ち消しを要るか確認する — lint も既存テストも捕まえない**: main 側が横断的な仕組み（書き込みのたびにフラグを立てる・監査ログを積む・キャッシュを無効化する等）を各経路に埋め込むと、自ブランチが新設した経路にも**自動的に**その副作用が付く。副作用が不要・有害な経路（例: 新ブランチへ内容を流し込む処理は「編集」ではないので未保存フラグを立ててはいけない）では打ち消しの呼び出しが要るが、コンパイルも lint も通り、自分のテストは副作用の存在を知らないので assertion も無い ＝ **無音で仕様が壊れる**。対処: rebase 後に main の差分を「新しく増えた横断的副作用は何か」の観点で読み、自ブランチが追加した書き込み経路それぞれについて「この副作用は正しいか / 打ち消しが要るか」を判断し、判断をテストに固定する（打ち消しの呼び出し回数を assert する）。同時に、**main が追加したテストのうち自ブランチが前提を削除したケースは捨てるか反転させる**（マーカーが出ないので見落としやすい）。実例: ADeT PR #2648 rebase で #2647 の `markBranchSpecDirty` が Fork の `ApplyTarget` にも効き、分岐直後のブランチが dirty になる状態を `ClearDirty` で打ち消した。併せて #2647 の「未保存の変更がある source から分岐すると dirty を引き継ぐ」テストは前提（参照コピー）が消えていたため削除した（2026-07）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
- **大規模 rebase 後の IDE/LSP diagnostics は stale — lint と go test を真実として扱う**: rebase でファイル群が一斉に書き換わると、LSP が「undefined symbol」「mock にメソッドがない」「引数過多」等の誤診断を出し続けることがある（実在する生成済みメソッドを missing と報告する等）。diagnostics に従って「修正」すると正しいコードを壊す。対処: 診断が疑わしければ `rg` で実ファイルを grep して実在を確認し、`task be:lint`（go vet 含む）と `go test` の結果だけを信頼する。実例: PR #2626 rebase で lint・test 全通過後も LSP が undefined を報告し続けた（2026-07）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-07 -->
- **`>>>>>>> ends` 以降のコードは「自ブランチのコンテキスト」で、main で削除済みの型/関数を参照していることがある**: コンフリクトブロック外のコードはそのまま自ブランチの内容として残るが、main で既に削除されたリポジトリメソッドや型を参照しているケースがある（例: `APIOverviewSettingRepository` が domain パッケージから削除済みなのにファイル内に残存）。lint の `undefined` エラーが出たら自ブランチ固有の実装が main と乖離していないか確認する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`atlas.sum` は 2-sided conflict になりやすい**: 両ブランチが異なるマイグレーションを追加すると、ヘッダーハッシュ行（`h1:...=`）とファイルエントリ行の2箇所で conflict になる。解決: ①両ブランチのエントリをタイムスタンプ順（ファイル名順）にマージしてコンフリクトマーカーを除去、②`task db:migrate:rehash` でヘッダーハッシュを再生成（手動で正しい hash を計算することは不可能なので必須）。マージ時に自ブランチ側エントリの per-file hash をそのまま残してよい — rehash が per-file hash の陳腐化（migration ファイルを編集後に rehash し忘れていたケース）も一緒に直す。解消後は `atlas migrate validate` で整合を確認する（実例: PR #2649 rebase で per-file hash が旧値のまま PR に乗っていたのを rehash が修正・2026-07）。
  <!-- importance: medium | mentions: 4 | first-seen: 2026-05 -->
  - **rebase 先の main が「自分より新しいタイムスタンプ」の migration を持ち込んだら、マージして rehash するだけでは足りない — 自分の migration を作り直して最後尾に置く**: `atlas migrate apply` の既定 `--exec-order linear` は「既に適用済みの版より前に挿入されたファイル」を拒否する。main の migration は dev / prod で適用済みなので、その前に自分のファイルが並ぶと**ローカルの `validate` は通るのにデプロイ時の apply だけが落ちる**（validate は sum の整合しか見ない）。判断基準: `ls database/migrations/*.sql | tail -3` で自分のファイルが main のより前に来ていないか。前なら ①自分の migration を `rm` → ②`task db:migrate:rehash` → ③`task db:migrate:generate -- <同じ title>` で現在時刻で再生成する（ファイル名を手で rename しない — sum の per-file hash は連鎖しており手書きで整合させられない）。実例: ADeT PR #2656 rebase で自分の 0729092421 が main の 0729093252 より前になり再生成（2026-08）。
    <!-- importance: high | mentions: 1 | first-seen: 2026-08 -->
- **main が自分と「同じ問題を独立に解いていた」conflict は、両方を活かそうとせず main 版に寄せて自分の版を捨てる**: 並行 PR は同じコードを触るので、同じ動機（位置引数の取り違え防止で引数を struct 化する・同じバグを直す）に独立に到達していることがある。conflict は「差分の衝突」に見えるが実体は**重複した解**で、両側を残そうとすると名前だけ違う双子（`AppendParams` と `AppendInput`・`dropLineComments` と `stripLineComments`）が生まれる。判断基準: 「main 側のコードは、自分の変更が無かったとしても同じ目的を果たすか？」YES なら main 版を採用し、自分側からは**その解に乗る差分だけ**（struct への新フィールド追加など）を移植する。結果として PR は本来の貢献だけに縮み、レビューでも「なぜ 2 つあるのか」を説明せずに済む。実例: ADeT PR #2656 rebase で #2655 が `CommitLog.Append` の struct 化と SQL コメント分割バグ修正の両方を先に入れており、自分の版（`AppendParams` / `dropLineComments` + そのテスト）を捨てて `AppendInput` に `GitCommitHash` を足す形へ寄せた（2026-08）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-08 -->
- **広範囲を1ブロックに含む conflict を「一部だけ」Edit で解消すると閉じマーカー（`>>>>>>> ... ends`）が離れた場所に取り残される**: jj の 2-sided conflict は差分が大きいと広範囲（例: 受け入れ基準〜ファイル末尾の Devlog まで）を1つのマーカーブロックにまとめる。冒頭側（`<<<<<<<`〜`+++++++`）だけを Edit で置換すると、ファイル末尾の `>>>>>>> conflict N of M ends` がゴミテキストとして残る。jj は `<<<<<<<` 側が消えてマーカーペアが崩れると「conflict 解消済み」と判断するため `jj st` も警告しない。さらに **`.md` のコンフリクトマーカーは biome/lint が検出しない**ため lint もすり抜け、push 寸前まで気づかない。対処: 解消後に必ず `rg -n '^(<<<<<<<|>>>>>>>|%%%%%%%|\+\+\+\+\+\+\+)'` でマーカー残存をリポジトリ全体スキャンする（lint 通過 ≠ マーカー除去完了）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`jj log` の graph で `@` の親を目視で追わない — `jj st` の `Parent commit (@-)` で確定する**: graph の `├─╯` 合流は「@ がその先のコミットと親を共有する兄弟」を意味し、合流行の直上に見えるコミットが @ の親とは限らない。リベース済みか判断するとき graph を目で追うと「main 直上にいる」と誤認しやすい。`jj st`（または `jj log -r @-`）が明示する `Parent commit (@-)` を読めば親が一意に確定する。**「リベース済み」とユーザーに報告する前に `@-` が dest（main の最新コミット）と一致するか確認する。** 実例: issue 057 で @ が #114 の上にあるのに graph 誤読で「#115 にリベース済み」と誤報告し、次ターンで #115 への再リベースが必要になった。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **「自ブランチがファイル削除・main が変更」の 2-sided conflict は `+++++++` セクションが空になる — ファイル削除で解消する**: jj の 2-sided conflict で `+++++++`（自ブランチ）のセクションに内容がない場合、自ブランチの意図は「このファイルを削除した」こと（main が変更したが自ブランチが削除したため空になる）。この場合の正しい解消は **ファイルを `rm` で削除すること**。ファイルを残して main 側の変更を取り込んでしまうと、意図的な削除（例: 孤立 mock ストアの受け入れ基準）が無音で元に戻る。確認方法: `+++++++` と `>>>>>>>` の間に何も行がなければ空 = deletion。今回の事例: `_store/research-store.ts` が自ブランチで削除済みだったが main が内部 import を rename していたため 2-sided conflict になった。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **「両ブランチが同一の新規ファイルを追加」した conflict では `%%%%%%%` ブロックの `+` prefix 行が main 版の内容 — 末尾の `++++++` マーカー行を除去して保存する**: 祖先に存在しないファイルを両ブランチが独立して追加すると、jj は `+++++++` スナップショットと `%%%%%%%` diff の2ブロックを生成する。このとき `%%%%%%%` ブロックの全行は `+` prefix（空の祖先から main 版への追加）で main 版の内容を表す。`+` を strip した内容 + `%%%%%%%` ブロックの直後に来る `++++++` マーカー行（自ブランチの版の開始を示す）を除去すると main 版が復元できる。Python での抽出例: `[l[1:] for l in lines if not l.startswith('++++++')]`（`%%%%%%%` と `>>>>>>>` のマーカー行も除く）。migration `_snapshot.json` など大容量バイナリに近いファイルは Read → Write 方式では辛いため、Python で直接 `_journal.json` や conflict ファイルを読み書きするのが現実的。実例: PR #172・PR #178 rebase で `0012_snapshot.json` が両ブランチで追加 → 同手順で解消。なお自ブランチの「次の idx」snapshot（例: 0014_snapshot.json）は「0013_snapshot をベースに Python で追加テーブルを書き足す」必要がある。`drizzle-kit generate --custom` は「直前 snapshot のコピー」しか作らず適用後 schema にならないため、snapshot を手編集してから `--custom` で journal + SQL を生成する（CLAUDE.md「rebase で migration idx が衝突」参照）。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **同一ファイルに複数 conflict がある場合、conflict 1 を Edit 解消した後 PostToolUse フォーマッタがファイルを整形し conflict 2 のマーカー行インデントが変わる — conflict 2 の Edit 前に必ず Read で確認する**: biome 等の formatter は PostToolUse:Edit hook で即座に走るため、conflict 1 の解消 Edit 後にファイル全体を再フォーマットする。その結果 conflict 2 のマーカー行（`<<<<<<<`・`%%%%%%%`・`+++++++`・`>>>>>>>` 等）の前にあるインデントが変わり、次の Edit の `old_string` マッチが失敗する。対処: 複数 conflict がある場合、各 conflict の Edit 前に Read でファイルの現在状態を確認してから `old_string` を組み立てる。実例: PR #192（invoice-months.ts conflict 1 解消後に biome が整形 → conflict 2 の `\\\\\\\` 行インデントが4スペース付きに変わり old_string ミスマッチ）。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **`_journal.json` の conflict 解消では全 idx エントリの連続性を確認する — 中間エントリが消失しやすい**: jj の `%%%%%%%` diff conflict を Edit で解消すると前後の `}` カンマが重複し（`},\n    },`）、直前のエントリ（idx N-1）が消失することがある。drizzle-kit generate が `Unexpected token ... JSON` parse error を出して初めて気づく。対処: `_journal.json` の conflict 解消後は `python3 -c "import json; json.load(open('apps/adachi/drizzle/meta/_journal.json'))"` で JSON を validate し、idx が 0, 1, ... N で欠落なく連続しているか目視確認してから drizzle-kit を実行する。実例: PR #183 rebase で idx 18 エントリが消失（duplicate `},` になっていた）、drizzle-kit generate の parse error で発覚・手動追記で解消。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **conflict マーカー内に `\\\\\\\`（7バックスラッシュ）・Unicode・long string が含まれる場合は Python スクリプトで一括解消する**: Edit の `old_string` は完全一致が必要で、バックスラッシュエスケープの二重変換・Unicode・長い文字列が混在すると old_string ミスマッチが頻発する。対処: Python スクリプトをスクラッチパッドに書いて実行する。①「コンフリクトブロック直前のユニークな日本語コメント行」を start_marker として `content.find(start_marker)` で先頭バイト位置を特定、②`>>>>>>> conflict N of N ends` を end_marker として `content.find(end_marker, start_idx)` で末尾位置を特定、③その間を解消済みコードで置換。`remaining = re.findall(r'<<<<<<< conflict', new_content)` でゼロを確認して終了。この方法はコンフリクトマーカーのテキストを直接マッチする必要がなく、複数 conflict を1ファイル・1回の write で解消できるため PostToolUse フォーマッタ問題も回避できる。実例: PR #192 の invoice-months.ts（4 conflict・9316 字の大規模ブロック）で適用。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **「自ブランチが upstream ブランチ上に積まれていた」場合、upstream が main にマージされると upstream が触ったファイル全件が 2-sided conflict になる — `jj restore --from main -- <paths>` で一括解消する**: 下流ブランチ（issue 233 等）を上流ブランチ（issue 237）の上に積んで開発し、上流が squash merge された後に下流を main にリベースすると、上流が変更したファイルすべてに conflict が発生する。自ブランチは上流の変更をそのまま含むため conflict 内容は「上流版 vs 上流版（main 経由）」とほぼ等しい。この場合 `jj new <conflict-rev>` → `jj restore --from main -- <conflicted-file1> <file2> ...` → `jj squash` の 3 ステップで解消できる。`jj restore` は conflict マーカーを手動で除去する必要がなく、指定したファイルをまるごと main 版に置き換えるため安全で速い。**自ブランチが上流ファイルを独自に変更している場合は使えない**（上流が触ったファイルに自ブランチ固有の変更が乗っているかどうかを事前に `jj diff --from <upstream-bookmark> --to <self-bookmark> -- <paths>` で確認してから使うこと）。実例: feat/233 が feat/237 上に積まれており、237 が main にマージされた後のリベースで auth ファイル 7 件が conflict → `jj restore --from main` で一括解消。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
