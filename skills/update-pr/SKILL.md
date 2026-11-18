---
name: update-pr
description: 既存 PR にコードを push してタイトル・ボディを更新する。
when_to_use: 「PR を更新して」「PRの説明を直して」「変更を push して PR を更新して」と言われたとき。新規 PR 作成は create-pr を使う。
argument-hint: "[PR番号]"
allowed-tools: Bash(jj *), Bash(gh *), Bash(mise *), Bash(${CLAUDE_SKILL_DIR}/../create-pr/pr-push.sh *), Bash(${CLAUDE_SKILL_DIR}/../create-pr/pr-summary.sh *), Read, Glob, Write
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
- **アウトカム**: このPRがマージされたら何ができるようになるか（ユーザー / 開発者 / AI エージェントの目線）。「結局これマージしたら何できるんだっけ？」に1行で答えられるレベル

### 4. 振り返り

`re` スキルを呼び出す（Skill ツール使用）。
push 前に呼ぶことで、まだ記憶が新鮮な状態で学びを記録できる。

### 5. 動作検証

PR更新前に変更の正しさを確認する。検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はプッシュ前に修正する。

- ビルド・型チェック
- Linter/Formatter
- 必要に応じてテスト

### 6. 本文を書いて、push と PR の更新をスクリプトに任せる

既存のPRタイトル・ボディを最新の変更内容に合わせて更新する。
ボディは create-pr と同じフォーマットで、今の差分の説明として全体を書き直す。「レビューで直した点」のような変更の経緯の節は足さない。pushのたびに節を足すと、今の差分が何をしているのかが読めなくなり、古い節の数字（テストの件数など）も実態とずれるためだ。経緯はコミットとPRのやり取りに残る。

本文の並び、テンプレート、各節に書くことは、create-pr の手順 5 にある（`${CLAUDE_SKILL_DIR}/../create-pr/SKILL.md`）。本文はファイル（`~/.claude/tmp/pr-body-<PR番号>.md`）に書き、`--body-file`で渡す。`--body "$(cat <ファイル>)"`は、ファイルが無いと空の本文で上書きして成功する。`--body-file`なら、ファイルが無いときにghがエラーにするので、本文が消えない。

本文を書いたら、push と本文の更新は create-pr の `pr-push.sh` に任せる。origin との差分を出し、中身が同じなら push せず、違えばブックマークを移して push し、`gh pr edit` で直して、本文が空になっていないかを確かめる。最後に PR の URL、ブランチ、CI の状態を出す。WHY: `jj desc → jj git push → gh pr edit` を毎回手で打っていた（find-repeats で 15 セッションに出た、2026-11-18）。下の Gotchas にある「push を飛ばして本文だけ直した」「本文が空になった」も、この中で防ぐ

```bash
${CLAUDE_SKILL_DIR}/../create-pr/pr-push.sh <bookmark名> '更新後のタイトル' ~/.claude/tmp/pr-body-<PR番号>.md
```

出力の 1 行目の URL を利用者に示す。作業を頼んだセッションに報告するときは、`pr-summary.sh <PR 番号>` の出力をそのまま貼り、その上に「何を変えたか」を数行で書く。

## Gotchas

- **pushの前に、pushされる中身を`jj diff --from <bookmark>@origin --to @ --stat`で見る**: jjは作業コピーの編集を、知らせずに同じコミットへ入れる。pushの後に作ったファイルがPRのコミットに混ざっても、`jj st`には「変更あり」としか出ない。PRに属さないファイルがあれば、次のように分けてからpushする。中身がoriginと同じなら、pushしない（タイムスタンプだけが変わり、CIが走り直す）。
  - rebaseの後は`jj diffu --from main --to <bookmark> --stat`で見る（`~/.claude/docs/jj.md`の「差分の基準点を確かめる」）。
  - pushの後に作った別件のファイル（フォローアップのissue、調査のメモ、次の作業の実装）は、子のコミットへ分ける。手順は`~/.claude/docs/jj.md`の「PR を push した後、別件を始める前に `jj new` する」にある。push済みのbookmarkの上で次の作業を始める前に`jj new`を切っておけば、混ざらない。
  - 分ける、戻す、PRに入れるファイルだけを移す、分けた子をoriginの実コミットへ載せ替える、の操作は`~/.claude/docs/jj.md`の「push済みのPRに足す、分ける」にある。分ける前に読む。
  - 環境ごとの設定は、`jj restore --from <bookmark>@origin -- <path>`で戻す。`/verify`でローカルの環境を起動すると、`.env.local`や`compose.override.yaml`のポートがそのワークスペースの値に書き換わることがある。
  <!-- mentions: 11 | first-seen: 2026-06 -->
- **push済みのbookmarkに新しいセッションで追記したら、pushの前に`jj st`で、`@`が説明の無い子のコミットになっていないかを見る**: そのままpushすると、PRに説明の無いコミットが並ぶ。まとめ方は`~/.claude/docs/jj.md`の「push済みのPRに足す、分ける」にある。
  <!-- mentions: 1 | first-seen: 2026-09 -->
- **`gh pr edit`の前に、`jj bookmark list`でbookmarkがoriginより先に進んでいない（`ahead by N commits`が出ない）ことを見る**: 手順6のpushを飛ばして本文だけを更新したことがある。PRのURLは返るので、コードがpushされていないことに利用者が気づくまで分からない。
- **本文の書き換えと`gh pr edit`を、1つのコマンドに`;`でつながない**: 本文を直すスクリプトが途中で落ちても、`;`で続けた`gh pr edit`は走り、古い本文が公開される。本文はEditで直し、`gh pr edit`は別の呼び出しにする。更新の後は、`gh pr view <N> --json body --jq .body`を`rg`にかけて、本文が空でないことと、古い記述（日付、件数）が残っていないことを見る。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- **bookmarkもPRも無ければ、`create-pr`の手順に切り替える**: 手順1で`jj bookmark list`にbookmarkが無く、`gh pr list`にもPRが無いなら、新しいPRを作ることになる。`update-pr`と`create-pr`は、既存のPRがあるかどうかで分ける。
  <!-- mentions: 2 | first-seen: 2026-06 -->
- **PRには、動かして確かめた証拠を貼る。手元に無ければ、撮ってからPRを更新する**（利用者の指示）: 手順5を型検査とテストで終わらせず、アプリを起動して、変更が効く画面やエンドポイントまで進む。証拠は「検証したこと」の主張のすぐ下に置き、画像ごとに、その画像で何が言えるかを書く。文字で示せる証拠（応答の本文、`diff`の結果、件数）は画像より確かなので、コードブロックで並べる。UIの無い変更（API、CSV、CLI）でも、実際の応答やバイト列を貼る。
  - 画像は`upload-screenshots`のスキルで埋め込む。本文の`![説明](<パス>)`と`--attach`のパスは、同じ絶対パスにする。Bashの`cd`は次の呼び出しに持ち越されず、パスが一致しないと画像は本文の末尾に並ぶだけになる。
  - 本文に引用する文言と数値は、保存した記録（スナップショット、ログ、スクショ）を読み直して写す。検証から時間が空くと、画面の文言を記憶でそれらしい文に置き換えてしまい、レビュアーが再現したときに、検証せずに書いたように見えるためだ。
  - 記録を取った後でコードを直したら、その記録がどの時点のものかを書く。
  - 既存のPRを後から検証したときは、`未検証`と書いた節を実測の結果に差し替える。残すのは、検証していない範囲だけにする。
  <!-- mentions: 3 | first-seen: 2026-06 -->
- **積んだPRの下がマージされたら、上を`main`へ載せ直す**: 手順は`~/.claude/docs/jj.md`の「積んだPRの下がマージされたら、上を`main`へ載せ直す」にある。下がsquash mergeかmerge commitかで操作が違う。
  <!-- mentions: 3 | first-seen: 2026-06 -->
- **「`re`はこのセッションで実行済み」を理由に手順4を飛ばす前に、前の`re`の後に新しい作業（追加のpush、設計の判断、つまずいた点）が無いかを会話で見る**: 1つのセッションでpushを重ねると、`re`が前半の作業しか見ていないことがある。圧縮の要約にある「`re`は実行済み」も、全部の作業を見たことを表さない。間に作業があれば、その分だけ`re`を回す。
  <!-- mentions: 1 | first-seen: 2026-07 -->
