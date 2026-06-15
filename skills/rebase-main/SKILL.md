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

- **コンフリクト後の squash**: `jj squash -m "..."` で resolution commit をコンフリクト commit に統合する（`-m` を省くと vim が開く）。その後 `jj log` で × が消えたことを確認。複数コミットのチェーンが全部 conflict になるケースは下のGotchaを参照。
- **`@` で直接コンフリクトを解消した場合は squash 不要**: コンフリクトファイルを `@` で直接編集した場合、`jj squash` は「into parent = immutable main」に向かってしまい失敗する。正しくは `jj new <conflict-rev>` → 編集 → `jj squash` の順。ただし `@` 直接編集でも working copy commit として反映されるため、そのまま `jj git push` で問題ない。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-05 -->
- **rebase 後は `bun install` を実行する**: main に新しい依存が追加されていると `typecheck` が `Cannot find module` で失敗する。rebase の直後に `mise exec -- bun install` を実行してから lint/typecheck に進む。**通常の `bun install` が「no changes」と言っても typecheck が `Cannot find module`（解決先が HOME の node_modules に climb する等）で落ちるなら symlink が陳腐化している — `mise exec -- bun install --force` で再生成する**（isolated install の workspace symlink が古いパスを指したまま残るため）。実例: issue 050 rebase 後に `zod`/`react-dom` が解決できず、plain install は no-op、`--force` で解消。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`.next/` が biome の対象に入ると lint が大量エラーになる**: Next.js dev server 起動後に生成される `.next/` ディレクトリが biome に拾われて数万件のエラーになる場合がある。lint 前に `rm -rf apps/*/.next` で削除してから実行すること。
- **`packages/features/package.json` の `exports` フィールドは各フィーチャーブランチが追加するため 2-sided conflict になりやすい**: 解決方法は常に「両方の export エントリを残す」こと。自ブランチのエントリ（例: `"./research": "./src/research/index.ts"`）と main のエントリ（例: `"./document": "./src/document/index.ts"`）を両方保持する。どちらかを捨てると `Cannot find module` エラーが他パッケージで発生する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`docs/apps/conventions.md` の規約セクション文字（W、X…）も 2-sided conflict になりやすい**: 複数のフィーチャーブランチが同じ文字のセクションを追加することがある（例: 両方が「### W.」を追加）。解決方法は「両方残す + リナンバリング」。main 側の W を優先し、自ブランチの W→X、X→Y のように後続にずらす。どちらか一方を捨てると規約の欠落が発生する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **複数コミットのチェーンをリベースすると全中間コミットが conflict になる**: `jj rebase -s <root> -d main` で A→B→C のチェーンをリベースして A が conflict すると、その conflict が伝播して B・C も × 状態になる。working copy `@` でファイルを解消しても、中間コミット自体の × は残るため `jj git push` が拒否される（"Won't push commit since it has conflicts"）。対処: ①`jj squash -m "..."` で working copy 変更をコミット（`-m` で vim を回避）、②`EDITOR=true jj squash --from <top> --into <bottom>` を繰り返して1コミットに集約する。注意: `jj squash -r X --into Y` は無効（`-r` と `--into` は共存不可）、`--from X --into Y` を使う。commit message が両方非空のとき jj は editor を開こうとするため `EDITOR=true` で抑止する。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **semantic conflict（意味的コンフリクト）はマーカー解消後の lint で発覚する**: main が新規追加した関数が、自ブランチで削除したメソッドを呼んでいるケース。テキスト的なコンフリクトマーカーを解消しただけでは気づけない。対処: コンフリクト解消・squash 後に必ず `task be:lint`（または相当する lint コマンド）を実行して意味的エラーを検出する。例: main が `ExportV2` を追加 + `GetHead` を使用、自ブランチが `GetHead` を `ProjectSpecSnapshotRepository` から削除済み → `ExportV2` をブランチベースのロジックに更新が必要。
  <!-- importance: high | mentions: 1 | first-seen: 2026-05 -->
- **`>>>>>>> ends` 以降のコードは「自ブランチのコンテキスト」で、main で削除済みの型/関数を参照していることがある**: コンフリクトブロック外のコードはそのまま自ブランチの内容として残るが、main で既に削除されたリポジトリメソッドや型を参照しているケースがある（例: `APIOverviewSettingRepository` が domain パッケージから削除済みなのにファイル内に残存）。lint の `undefined` エラーが出たら自ブランチ固有の実装が main と乖離していないか確認する。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **`atlas.sum` は 2-sided conflict になりやすい**: 両ブランチが異なるマイグレーションを追加すると、ヘッダーハッシュ行（`h1:...=`）とファイルエントリ行の2箇所で conflict になる。解決: ①両ブランチのエントリをタイムスタンプ順（ファイル名順）にマージしてコンフリクトマーカーを除去、②`task db:migrate:rehash` でヘッダーハッシュを再生成（手動で正しい hash を計算することは不可能なので必須）。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-05 -->
- **広範囲を1ブロックに含む conflict を「一部だけ」Edit で解消すると閉じマーカー（`>>>>>>> ... ends`）が離れた場所に取り残される**: jj の 2-sided conflict は差分が大きいと広範囲（例: 受け入れ基準〜ファイル末尾の Devlog まで）を1つのマーカーブロックにまとめる。冒頭側（`<<<<<<<`〜`+++++++`）だけを Edit で置換すると、ファイル末尾の `>>>>>>> conflict N of M ends` がゴミテキストとして残る。jj は `<<<<<<<` 側が消えてマーカーペアが崩れると「conflict 解消済み」と判断するため `jj st` も警告しない。さらに **`.md` のコンフリクトマーカーは biome/lint が検出しない**ため lint もすり抜け、push 寸前まで気づかない。対処: 解消後に必ず `rg -n '^(<<<<<<<|>>>>>>>|%%%%%%%|\+\+\+\+\+\+\+)'` でマーカー残存をリポジトリ全体スキャンする（lint 通過 ≠ マーカー除去完了）。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **`jj log` の graph で `@` の親を目視で追わない — `jj st` の `Parent commit (@-)` で確定する**: graph の `├─╯` 合流は「@ がその先のコミットと親を共有する兄弟」を意味し、合流行の直上に見えるコミットが @ の親とは限らない。リベース済みか判断するとき graph を目で追うと「main 直上にいる」と誤認しやすい。`jj st`（または `jj log -r @-`）が明示する `Parent commit (@-)` を読めば親が一意に確定する。**「リベース済み」とユーザーに報告する前に `@-` が dest（main の最新コミット）と一致するか確認する。** 実例: issue 057 で @ が #114 の上にあるのに graph 誤読で「#115 にリベース済み」と誤報告し、次ターンで #115 への再リベースが必要になった。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **「自ブランチがファイル削除・main が変更」の 2-sided conflict は `+++++++` セクションが空になる — ファイル削除で解消する**: jj の 2-sided conflict で `+++++++`（自ブランチ）のセクションに内容がない場合、自ブランチの意図は「このファイルを削除した」こと（main が変更したが自ブランチが削除したため空になる）。この場合の正しい解消は **ファイルを `rm` で削除すること**。ファイルを残して main 側の変更を取り込んでしまうと、意図的な削除（例: 孤立 mock ストアの受け入れ基準）が無音で元に戻る。確認方法: `+++++++` と `>>>>>>>` の間に何も行がなければ空 = deletion。今回の事例: `_store/research-store.ts` が自ブランチで削除済みだったが main が内部 import を rename していたため 2-sided conflict になった。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
