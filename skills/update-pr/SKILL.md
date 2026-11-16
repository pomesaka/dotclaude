---
name: update-pr
description: 既存 PR にコードを push してタイトル・ボディを更新する。
when_to_use: 「PR を更新して」「PRの説明を直して」「変更を push して PR を更新して」と言われたとき。新規 PR 作成は create-pr を使う。
argument-hint: "[PR番号]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(mise *), Read, Glob, Write
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

diffからはWHAT/HOWしか読み取れない。WHY（なぜ変えたか）は会話ヒストリーにしかない。
以下を特定する。

- **課題・動機**: 何を解決しようとしていたか
- **設計判断の理由**: なぜこのアプローチか、却下した代替案とその理由
- **今回の更新で変わった点**: 前回PRからの追加・修正内容。本文のどこを書き換えるかを決めるために集める（本文に節としては足さない）
- **アウトカム**: このPRがマージされたら何ができるようになるか（ユーザー目線 / 開発者目線）。「結局これマージしたら何できるんだっけ？」に1行で答えられるレベル

### 4. 振り返り

`re` スキルを呼び出す（Skill ツール使用）。
push 前に呼ぶことで、まだ記憶が新鮮な状態で学びを記録できる。

PR が issue に紐づくなら、`re`（docs への記録）とは別に issue ファイルの `## Devlog` も更新する。`re` は docs/CLAUDE.md にしか書かないため、これを省くと「PR を `/update-pr` でフォローアップするたびに issue の Devlog が置き去り」になる（issue を実装するスキル経由でしか Devlog が書かれない）。今回のフォローアップで変わった点を `### 実装内容` / `### 設計判断`（計画＝設計節からの逸脱を含む）/ `### レビューで指摘・修正した点` / `### 困ったこと・ハマったこと` に追記する。`## Devlog` が無ければ新設する。

### 5. 動作検証

PR更新前に変更の正しさを確認する。検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はプッシュ前に修正する。

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
ボディは create-pr と同じフォーマットで、今の差分の説明として全体を書き直す。「レビューで直した点」のような変更の経緯の節は足さない。pushのたびに節を足すと、今の差分が何をしているのかが読めなくなり、古い節の数字（テストの件数など）も実態とずれるためだ。経緯はコミットとPRのやり取りに残る。

PRボディの「動作検証」セクションには、レビュアーが手元で再現・確認できる具体的な手順を書く。

**動作検証の書き方:**

- **前提条件**: 環境変数・外部サービスの設定手順（具体的に）
- **セットアップ**: 準備コマンド
- **静的検証**: 型チェック・lint等のコマンドと期待結果
- **動作確認**: ステップバイステップで「何をしたら何が起きるか」
- **確認ポイント**: 正常系・エラー系で何を確認すべきか

本文はファイル（`~/.claude/tmp/pr-body-<PR番号>.md`）に書き、`--body-file`で渡す。`--body "$(cat <ファイル>)"`は、ファイルが無いと空の本文で上書きして成功する。`--body-file`なら、ファイルが無いときにghがエラーにするので、本文が消えない。冒頭の`issue:`の行は、数か月後にPRをたどる人が、変更の起点を会話のログなしで読めるように置く。

````markdown
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
1. 具体的なステップ → 期待される結果（すぐ下に、動かして確かめた証拠を置く）

🤖 Generated with [Claude Code](https://claude.ai/code)
````

`gh pr edit` は更新後のPR URLを stdout に出力する。これをユーザーに提示する。

```bash
gh pr edit <PR番号> --title '更新後のタイトル' --body-file ~/.claude/tmp/pr-body-<PR番号>.md
```

## Gotchas

- **pushの前に、pushされる中身を`jj diff --from <bookmark>@origin --to @ --stat`で見る**: jjは作業コピーの編集を、知らせずに同じコミットへ入れる。pushの後に作ったファイルがPRのコミットに混ざっても、`jj st`には「変更あり」としか出ない。PRに属さないファイルがあれば、次のように分けてからpushする。中身がoriginと同じなら、pushしない（タイムスタンプだけが変わり、CIが走り直す）。
  - rebaseの後は`jj diffu --from main --to <bookmark> --stat`で見る。`<bookmark>@origin`は古いbaseを指したままなので、`main`が進んだ分がすべて差分に出る。
  - pushの後に作った別件のファイル（フォローアップのissue、調査のメモ、次の作業の実装）は、子のコミットへ分ける。手順は`~/.claude/docs/jj.md`の「PR を push した後、別件を始める前に `jj new` する」にある。push済みのbookmarkの上で次の作業を始める前に`jj new`を切っておけば、混ざらない。
  - パスを指定した`jj squash --from @- --into @ <path>`は、push済みのコミットが元から足していたファイルも丸ごと子へ移す。pushの後の増分だけを移すときは、squashの後に`jj restore --from <bookmark>@origin --to <bookmark> -- <path>`でbookmarkの側をoriginの状態に戻し、子で増分を当て直す。
  - 分けた子をpushする前に、`jj rebase -r <child> -d '<bookmark>@origin'`でoriginの実コミットへ載せ替える。squashとrestoreは、内容がoriginと同じでもコミットを書き換える。書き換えた版を親にしたまま積むと、差分が0でもPRがCONFLICTINGになる。同じPRの2つ目のコミットとして入れるときも同じで、載せ替えないと1つ目のコミットがforce-pushで差し替わり、CIが走り直してレビュー済みの印が消える。載せ替えた後は`jj bookmark set <bookmark> -r <rev> --allow-backwards`でbookmarkを合わせ、書き換えた版を`jj abandon`する。
  - 環境ごとの設定は、`jj restore --from <bookmark>@origin -- <path>`で戻す。`/verify`でローカルの環境を起動すると、`.env.local`や`compose.override.yaml`のポートがそのワークスペースの値に書き換わることがある。
  - `jj log`でbookmarkに`*`が付いていたら、手元がoriginと違うコミットを指している。その先に別の作業が入っていたら、`jj bookmark set <bookmark> --allow-backwards -r <PRのコミット>`で戻す。`--allow-backwards`が無いと拒否される。
  - `@`がbookmarkより上にあり、間に別の作業があるときは、`jj squash --from @ --into <bookmark> <paths>`でPRに入れるファイルだけを移す。隣り合っていないコミットの間でもsquashできる。
  <!-- mentions: 11 | first-seen: 2026-06 -->
- **push済みのbookmarkに新しいセッションで追記すると、`@`が説明の無い子のコミットになることがある**: push済みのコミットは、jjの既定の設定でimmutableとして扱われるためだ（`jj st`の`Parent commit (@-)`がbookmarkと同じになる）。そのままpushすると、PRに説明の無いコミットが並ぶ。`EDITOR=true jj squash --from @ --into <bookmark名>`でbookmarkのコミットへまとめてからpushする。`-m`は付けない。付けると、bookmarkのコミットの説明が上書きされる。
  <!-- mentions: 1 | first-seen: 2026-09 -->
- **`gh pr edit`の前に、`jj bookmark list`でbookmarkがoriginより先に進んでいない（`ahead by N commits`が出ない）ことを見る**: 手順6のpushを飛ばして本文だけを更新したことがある。PRのURLは返るので、コードがpushされていないことに利用者が気づくまで分からない。
- **本文の書き換えと`gh pr edit`を、1つのコマンドに`;`でつながない**: 本文を直すスクリプトが途中で落ちても、`;`で続けた`gh pr edit`は走り、古い本文が公開される。本文はEditで直し、`gh pr edit`は別の呼び出しにする。更新の後は、`gh pr view <N> --json body --jq .body`を`rg`にかけて、本文が空でないことと、古い記述（日付、件数）が残っていないことを見る。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- **bookmarkもPRも無ければ、`create-pr`の手順に切り替える**: 手順1で`jj bookmark list`にbookmarkが無く、`gh pr list`にもPRが無いなら、新しいPRを作ることになる。`update-pr`と`create-pr`は、既存のPRがあるかどうかで分ける。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- **PRには、動かして確かめた証拠を貼る。手元に無ければ、撮ってからPRを更新する**（利用者の指示）: 手順5を型検査とテストで終わらせず、アプリを起動して、変更が効く画面やエンドポイントまで進む。証拠は「動作確認」の主張のすぐ下に置き、画像ごとに、その画像で何が言えるかを書く。文字で示せる証拠（応答の本文、`diff`の結果、件数）は画像より確かなので、コードブロックで並べる。UIの無い変更（API、CSV、CLI）でも、実際の応答やバイト列を貼る。
  - 画像は`upload-screenshots`のスキルで埋め込む。本文の`![説明](<パス>)`と`--attach`のパスは、同じ絶対パスにする。Bashの`cd`は次の呼び出しに持ち越されず、パスが一致しないと画像は本文の末尾に並ぶだけになる。
  - 本文に引用する文言と数値は、保存した記録（スナップショット、ログ、スクショ）を読み直して写す。検証から時間が空くと、画面の文言を記憶でそれらしい文に置き換えてしまい、レビュアーが再現したときに、検証せずに書いたように見えるためだ。
  - 記録を取った後でコードを直したら、その記録がどの時点のものかを書く。
  - 既存のPRを後から検証したときは、`未検証`と書いた節を実測の結果に差し替える。残すのは、検証していない範囲だけにする。
  <!-- mentions: 3 | first-seen: 2026-06 -->
- **積んだPRの下がマージされたら、上を`main`へ載せ直す**: 下がsquash mergeされると、GitHubは上のbaseを`main`に変える。手元の上のbookmarkは下のコミットを親に持ったままなので、`jj git fetch`の後に`@`が衝突する。`jj rebase -b <上のbookmark> -d main`で載せ直し、空になった下のコミットを`jj abandon`して、`jj git push --bookmark <上のbookmark> --force`でpushする。
  - fetchの前に気づいたら、`jj rebase -s <積みの根> -d main`で載せ直す。衝突は起きず、下のコミットが`(empty)`で残るので、`jj abandon`する。
  - 下がmerge commitでマージされたときは、下のコミットが`main`の祖先になるので、`jj rebase -s <積みの根> -d main`だけで済む。下のbookmarkが手元から消えていたら、マージされている。rebaseの途中でも、pushの前に`jj log -r '<積みの根>-'`が`main`の祖先になっていないかを見る。
  <!-- mentions: 3 | first-seen: 2026-06 -->
- **「`re`はこのセッションで実行済み」を理由に手順4を飛ばす前に、前の`re`の後に新しい作業（追加のpush、設計の判断、つまずいた点）が無いかを会話で見る**: 1つのセッションでpushを重ねると、`re`が前半の作業しか見ていないことがある。圧縮の要約にある「`re`は実行済み」も、全部の作業を見たことを表さない。間に作業があれば、その分だけ`re`を回す。
  <!-- mentions: 1 | first-seen: 2026-07 -->
