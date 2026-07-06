---
name: update-pr
description: 既存 PR にコードを push してタイトル・ボディを更新する。
when_to_use: 「PR を更新して」「PRの説明を直して」「変更を push して PR を更新して」と言われたとき。新規 PR 作成は create-pr を使う。
argument-hint: "[PR番号]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(mise *), Read, Glob
model: sonnet
---

# Update Pull Request

既存のPRを最新の変更で更新する。PR番号は `$ARGUMENTS` で指定、未指定時は現在のブックマークに紐づくPRを自動検出する。

## 手順

### 1. 対象PRの特定

```bash
# 引数指定時
gh pr view <PR番号> --json number,title,headRefName,baseRefName

# 未指定時: 現在のブックマークからPRを探す
jj bookmark list  # 現在のブックマークを確認
gh pr list --head <bookmark名> --json number,title
```

### 2. 変更内容の確認

```bash
# baseブランチとのdiff全体
jj diffu -r '<base branch>..@'

# 前回pushからの差分（何が変わったか把握するため）
jj log -r '<bookmark名>@origin..@'
```

### 3. WHYを会話ヒストリーから収集

**最重要。** diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する:

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **今回の更新で変わった点**: 前回PRからの追加・修正内容
- **アウトカム**: このPRがマージされたら何ができるようになるか（ユーザー目線 / 開発者目線）。「結局これマージしたら何できるんだっけ？」に1行で答えられるレベル

### 4. 振り返り

`re` スキルを呼び出す（Skill ツール使用）。
push 前に呼ぶことで、まだ記憶が新鮮な状態で学びを記録できる。

**PR が issue に紐づくなら、`re`（docs への記録）とは別に issue ファイルの `## Devlog` も更新する。** `re` は docs/CLAUDE.md にしか書かないため、これを省くと「PR を `/update-pr` でフォローアップするたびに issue の Devlog が置き去り」になる（フルの impl-issue-noah 経由でしか Devlog が書かれない）。今回のフォローアップで変わった点を `### 実装内容` / `### 設計判断`（**計画＝設計節からの逸脱を含む**）/ `### レビューで指摘・修正した点` / `### 困ったこと・ハマったこと` に追記する。`## Devlog` が無ければ新設する。

### 5. 動作検証

PR更新前に変更の正しさを確認する。検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はプッシュ前に修正すること。

- ビルド・型チェック
- Linter/Formatter
- 必要に応じてテスト

### 6. プッシュ

既存ブックマークの更新なので `--bookmark` で明示的に指定する。

```bash
jj git push --bookmark <bookmark名>
```

### 7. PR更新

既存のPRタイトル・ボディを最新の変更内容に合わせて更新する。
ボディは create-pr と同じフォーマットで全体を書き直す。

PRボディの「動作検証」セクションには、レビュアーが**手元で再現・確認できる具体的な手順**を書く。

**動作検証の書き方:**

- **前提条件**: 環境変数・外部サービスの設定手順（具体的に）
- **セットアップ**: 準備コマンド
- **静的検証**: 型チェック・lint等のコマンドと期待結果
- **動作確認**: ステップバイステップで「何をしたら何が起きるか」
- **確認ポイント**: 正常系・エラー系で何を確認すべきか

**`gh pr edit` は更新後のPR URLを stdout に出力する。これをユーザーに提示する。**

```bash
PR_URL=$(gh pr edit <PR番号> --title '更新後のタイトル' --body "$(cat <<'EOF'
issue: #<番号>（PR が解決する issue。無ければ「なし（経緯を1行で）」）
related: #<番号>, #<番号>（参考になる関連 issue / PR。無ければ省略可）

## 背景・動機
なぜこの変更が必要だったか。課題や問題の説明。

## 概要
何をしたか・なぜそのアプローチを選んだか。設計に触れる場合は概念レベルに止める（ファイル名・関数名の列挙は diff を見れば分かるので書かない）。

## アウトカム
このPRがマージされると何ができるようになるか。時間が経って見返したときに「結局何ができるんだっけ」が一目で分かるように書く。

- **ユーザー目線**: 利用者から見て何が変わるか（できなかったことができる / 操作が変わる / 表示が変わる）。内部向け変更でユーザー影響がないなら「影響なし（内部変更のみ）」と書く
- **開発者目線**: 後続の開発で何ができるようになるか（呼べるようになるAPI/関数、書けるようになるテスト、依存できる新しい抽象、踏める次のステップ）

## 動作検証

### 前提条件
必要な環境変数・外部サービスの設定手順

### 静的検証
```bash
コマンド   # 期待結果
```

### 動作確認手順
1. 具体的なステップ → 期待される結果

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)")
echo "$PR_URL"
```

## Gotchas

- **push を飛ばして `gh pr edit` を先に実行するミス**: ステップ6の `jj git push` をスキップしてステップ7の PR 更新を先に実行してしまうことがある。PR の URL が返ってきた時点でコードが push されておらず、ユーザーが気づくまで分からない。対処: PR 更新コマンドを実行する前に必ず `jj bookmark list` で `@origin` との差分（`ahead by N commits`）がないことを確認すること。
- **PR ボディの冒頭に `issue:` / `related:` を必ず載せる**: PR に直接対応する issue があれば `issue: #N`、参考になる関連 issue/PR があれば `related: #N, #M` を概要の一番上に書く。対応 issue が無い場合は `issue: なし（起点を1行で）` と明示する。理由: 数ヶ月後に PR を遡るとき、issue リンクが無いと「なぜこの変更があったか」を会話ログから掘り起こす必要があり追跡コストが高い。`gh issue view` で背景を即座に辿れる状態にする。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **ブックマーク・PRが存在しない場合は create-pr フロー**: ステップ1で `jj bookmark list` にブックマークがなく `gh pr list` にも該当PRが存在しない場合、実質的には新規PR作成になる。この場合は `create-pr` スキルの手順に切り替える（ブックマーク名を作業内容から命名 → `jj bookmark create <name> -r @` → `jj git push --bookmark <name>` → `gh pr create`）。`update-pr` と `create-pr` の区別は「既存PRがあるか」で判断する。bookmark 作成は `jj git push --bookmark <name>` で自動 create されることもあるが、`jj bookmark create` で先に明示的に作ると `jj log` でブランチを追跡しやすい。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **`--body "$(cat file)"` は file が無いと PR body を空文字で上書きする — `--body-file` を使う**: `cat` が失敗するとコマンド置換が空文字に展開され、`gh pr edit` は「空 body への更新」として成功してしまう（既存 body が消える）。`gh pr edit <N> --body-file /path/to/body.txt` ならファイル不在で gh 自体がエラーになり、消失事故が起きない（`gh pr create` も同様）。実例: body を `~/.claude/tmp/` に保存したのに `/tmp/` を参照して PR #98 の body を一時的に全消去した。body 更新後は `gh pr view <N> --json body --jq '.body | length'` で非ゼロ確認を癖にする。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **実機検証のエビデンス（スクショ・録画・実行ログ）が手元にあれば PR に含める**: /verify 等で動作検証した結果のスクリーンショットが /tmp 等に残っている場合、`upload-screenshots` スキル（ドラフトリリースのアセット方式）でアップロードし、PR ボディの「動作検証」セクションに `![説明](URL)` で埋め込む。画像の下に「何を確認した画像か」の注記（観測ポイント）を添える。レビュアーが手元で再現しなくても検証結果を確認できる状態にするのが目的。テキストの検証結果（レスポンスボディ・カウント等）も同セクションに書く。
  <!-- importance: high | mentions: 1 | first-seen: 2026-06 -->
- **stacked PR の upstream が squash merge されると downstream がローカルで conflict する**: jj の stacked PR（A → B の順でマージ予定）で upstream A が squash merge されると、GitHub は downstream B の base を自動的に main に更新する。しかしローカルの bookmark B は A のコミットを親として持つため、`jj git fetch` 後に `@` が conflict 状態になる。対処: `jj rebase -b <downstream-bookmark> -d main` でリベースし、A 由来の空コミット（変更なし）が残ったら `jj abandon <empty-change-id>` で除去。その後 `jj git push --bookmark <downstream-bookmark> --force` で push する（force push は conflict 解消のため）。実例: PR #152 が PR #148 の squash merge 後に conflict → 上記手順で解消。**conflict を避けるより先に気づいた場合（fetch 前）**: `jj rebase -s <stack-root> -d main`（スタック全体）で直接リベースすれば conflict は起きず、upstream コミットが `(empty)` として現れるだけ。`jj abandon <empty-rev>` で除去後、`--force` push する。実例: PR #154 で PR #153 が main にマージ済みの状態で fetch 前にリベース → conflict なし・#153 コミットが empty → abandon で解消。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **リベース後は `--from <bookmark>@origin` の diff が巨大になる — push 前の diff チェックは `--from main` で行う**: リベース後は `<bookmark>@origin` が旧ベース（リベース前の main コミット）を指したまま。`jj diff --from <bookmark>@origin --to <bookmark> --stat` は「リベース後に main が進んだ分の変更」を全部含む巨大な diff になり「push される変更」とはかけ離れる。PR が実際に追加するものは `jj diffu --from main --to <bookmark> --stat` で確認する（`main` が新しい真のベース）。`@origin` diff は「push した後に amend が入っていないか」の用途だけに使う。実例: PR #154 リベース後に `--from @origin` が 34 ファイル差分→ `--from main` で正しく 19 ファイルを確認。再発: PR #208 rebase で `--from @origin` が 103 ファイル（c856c45a → 960e1c0e の main 変化を含む）→ `--from main` で 24 ファイルに絞り込み。再発: ADeT PR #2511（CONFLICTING 状態のPRを check-pr 経由で発見し rebase で解消）でも同様に `--from main --stat` でスコープ確認。
  <!-- importance: medium | mentions: 3 | first-seen: 2026-06 -->
- **jj は push 後に作った無関係な編集を bookmark コミットへ無音で amend する — push 前に `jj diff --from <bookmark>@origin --to @` で差分を必ず確認する**: jj では `@`（作業コピー）が bookmark コミットと同一 change のことが多く、PR を push した後に作ったファイル（フォローアップ issue・調査メモ・別 concern の doc 編集など）が**同じコミットに吸い込まれる**。`jj st` は「変更あり」としか見えず、それが feature PR のコミットに入っていることに気づきにくい。次に push すると feature PR に無関係なファイルが混ざる（または content 同一でも timestamp だけ変わって CI が無駄に再走する）。対処: push 前に `jj diff --from <bookmark>@origin --to @ --stat` で「push される中身」を直接見る。PR に属さないファイルがあれば `jj new`（空の子コミットを作る → bookmark は親に残る）→ `jj squash --from @- --into @ <該当パス>`（無関係ファイルを子へ落とす）で分離し、`jj diff --from <bookmark>@origin --to <bookmark>` が空であることを確認してから扱う。content 同一（timestamp だけ差分）なら push 自体を省く判断もする。実例: PR #124 で、push 後に起票したフォローアップ issue 5 件＋CLAUDE.md 編集がモック PR のコミットに amend されており、上記手順で子コミットへ分離した。再発: PR #120（issue 052）で、push 後に作ったフォローアップ issue 107/108 が研究配線コミットに amend されていたのを `--stat` で検出。子コミットへ分離した結果 PR コミットが origin と byte 一致したため、その時点では push 不要と判断（後で `re` の conventions.md 更新を PR コミットに squash した分だけ push した）。3 回目: PR #278 push 後にサブエージェントへ委譲した次 issue（972）の実装が 966 の PR コミットに amend されていた → 子コミット分離で解消（2026-07）。**亜種: 分離時の `jj squash --from @- --into @ <path>` は「push 済みコミットが元々追加したファイル」も path 指定すると丸ごと子へ移す**（origin にあるファイル追加が bookmark コミットから消え、origin との diff が「ファイル削除」になる）。push 後の増分だけ動かしたい場合は、①該当 path を squash で子へ移す → ②`jj restore --from <bookmark>@origin --to <bookmark-rev> -- <path>` で bookmark 側を origin 状態に戻す → ③子コミット（working copy）で増分（status 変更等）を再適用する、の 3 段で分離する。実例: issues/972 ファイル（966 PR で新規追加済み・push 後に status のみ変更）の分離（2026-07）。**④分離後の子を stacked PR として push する前に、必ず `jj rebase -r <child> -d '<bookmark>@origin'` で origin の実コミットに載せ替える**: squash/restore は内容を origin と一致（diff 0 files）させてもコミット自体を書き換える（ハッシュが変わる）。子が「書き換え版」を親にしたまま push すると、GitHub は head が base branch head を含まないと判定し、同一ファイルの add/add・同一行変更として **PR が CONFLICTING になる**（diff 0 でも起きる — 内容でなく履歴の問題）。rebase 後はローカル bookmark を `jj bookmark set <bookmark> -r <origin-commit> --allow-backwards` で origin 版に揃え、divergent になった書き換え版を `jj abandon` する。実例: PR #279（stacked・base: issue-966）が CONFLICTING → rebase + abandon + 再 push で MERGEABLE に解消（2026-07）。**予防策（分離手順自体を不要にする）: push 済み bookmark の上で次の作業（サブエージェント委譲・次 issue 実装）を始める前に `jj new -m '<次の作業の description>'` で子コミットを先に切る** — amend が構造的に起きず squash/restore/rebase の 3 点セットが丸ごと不要になる。実例: issue 973 で委譲前に `jj new` して amend ゼロで完走（2026-07）。
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
- **ローカルブックマークが `<bookmark>*`（origin と異なるコミットを指す）場合、`jj diffu --from main --to <bookmark> --stat` でスコープを確認してから push する**: `jj log` で `fix/258*`（`*` 付き）は「ローカルが origin より先に進んでいる」ことを意味するが、その先のコミットが別 concern の作業（他の PR や issue ファイル群）を含む可能性がある。`--from main` の diff が PR タイトルのスコープを大幅に超えていたら、正しいコミットに bookmark を戻す: `jj bookmark set --allow-backwards -r <clean-rev>`（`--allow-backwards` がないと「先に進んでいる bookmark を戻す」として拒否される）。実例: PR #208 rebase 後に `fix/258*` が kzpymvwr（issues 259-271・feat/265 相当の minutes コンポーネント変更を含む）を指しており、`--from main --stat` で発覚 → `jj bookmark set --allow-backwards -r wrlmyzrt` で wrlmyzrt（元の fix/258 PR コミット）に戻した。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
- **`/verify` 後はワークスペース固有のファイル変更（`.env.local`・`compose.override.yaml` のポート等）を PR に含めない — `jj restore --from <bookmark>@origin -- <path>` で @origin に戻す**: `/verify` スキルでローカル環境を起動すると `.env.local`・`compose.override.yaml` の接続ポートやURL がワークスペース固有の値に書き換わることがある。これを放置したまま `jj diff --from <bookmark>@origin --to @ --stat` を確認せずに push すると、PR にワークスペース固有のポート番号が混入する。対処: push 前に `--stat` でファイルリストを確認し、PR スコープ外のファイルは `jj restore --from <bookmark>@origin -- <path>` で元に戻してから diff が 0 になることを確認する。実例: issue 954/955 verify 後に compose.override.yaml が 15434→15449 に書き換わっており、restore で元の ports に戻した（PR #249）。再発: issue 966 verify 後に compose.override.yaml のポート + Docker ネットワーク再利用設定が残っており restore で除去（PR #278）。
  <!-- importance: medium | mentions: 2 | first-seen: 2026-06 -->
- **`@` が PR bookmark より上にある状態で特定ファイルだけ PR に追加したい場合は `jj squash --from @ --into <bookmark> <paths>`**: `@` が PR bookmark commit の孫以降（extra work が間に挟まる状態）にいるとき、`jj git push` すると PR に無関係なファイルが混ざる。特定ファイルだけを PR commit に取り込むには `jj squash --from @ --into <bookmark-name> path/to/file.ts` で対象ファイルのみを squash する。jj は隣接していない commit 間でも squash できる。squash 後に `jj diffu --from main --to <bookmark> -- <paths>` で取り込まれたか確認してから push する。実例: PR #208 の fix/258 bookmark（wrlmyzrt）が `@` の祖父にいる状態で mapper.ts / mapper.test.ts / stats.test.ts の3ファイルだけを squash で取り込み、kzpymvwr（issues 259-271 相当）は残したまま push した。
  <!-- importance: medium | mentions: 1 | first-seen: 2026-06 -->
