---
name: improve-week
description: 週末に、サブスクリプションの週の枠の余りを使って、dotclaude の改善と、話題の道具や手法の試しを、予算（既定は週 95%）に達するまで進め、達したら区切って報告する。
argument-hint: "[予算の%（既定 95）]"
disable-model-invocation: true
allowed-tools:
  - mcp__budget__set_budget
  - mcp__budget__read_budget
  - mcp__budget__clear_budget
  - mcp__questions__add_question
  - mcp__questions__follow_session
  - mcp__questions__unfollow_session
  - Skill
  - Agent
  - SendMessage
  - ListAgents
  - Read
  - Write
  - Edit
  - Bash(bun ~/.claude/skills/improve-week/metrics.ts:*)
  - Bash(bun ~/.claude/skills/improve-week/agents.ts:*)
  - Bash(bun ~/.claude/skills/curate-docs/usage.ts:*)
  - Bash(bun ~/.claude/skills/session-timeline/timeline.ts:*)
  - Bash(bun ~/.claude/skills/find-repeats/count.ts:*)
  - Bash(/Users/pomesaka/.local/bin/claude-deck *)
  - Bash(jj *)
  - Bash(date *)
---

# improve-week

pomesakaのサブスクリプションの週の枠は、使い切らずに余っている。その余りで、pomesakaが席を外しているあいだに、dotclaudeの改善と、話題の道具や手法の試しを進める。予算に達したら、きりのいい所で区切り、報告して止まる。

## 予算を置く

`read_budget`でいまの枠の値を読み、`set_budget`で予算を置く。閾値は`$ARGUMENTS`の数（無ければ95）、枠は`seven_day`。予算はbudgetのModが持ち、どのセッションが測っても、週の使用率が閾値に達するとこのセッションに「[budget] 予算（週 95%）に達した…」の文が届く。

枠の値は、そのセッションのAPIの応答が届いてから入るので、最初の`read_budget`では`rateLimits`が空のことがある（2026-11-28に`claude -p`で確かめた）。空なら、もう一度読んでから置く。すでに閾値を越えていて置けなければ、何もせずにそう報告して終える。報告の冒頭に、始めたときの使用率と`resetsAt`を書く。

## 進める順

次の6段を順に進める。各段は既にあるスキルやスクリプトを使い、分かったこと、入れたもの、残したことを、段ごとに報告のファイルへ書き足してから次に進む。予算の知らせがいつ届いても、そこまでの報告が残っているようにするためだ。

1. **ベストプラクティスとの差分**: `check-best-practices`を呼ぶ
2. **docsとスキルの整理**: `curate-docs`を呼ぶ。直した後はevalsで確かめる（`curate-docs`の本文にある手順）
3. **メトリクスから性能を直す所を探す**: `bun ~/.claude/skills/improve-week/metrics.ts --days 7`で、Gengar（手元のPrometheusとLoki）から、トークン、スキルごとと道具ごとの所要時間、失敗の数、所要時間の長いセッションを読む。ready が返らなければ、この段を飛ばして報告に書く。目立つセッションは`session-timeline`で工程を見て、余分な呼び出しや飛ばした工程を探す。繰り返している手順は`find-repeats`で数える。指標と属性の名前は`~/github.com/pomesaka/Gengar/docs/otel-metrics-reference.md`にあり、スクリプトに無い問いはそこのPromQLとLogQLの例から組む
4. **切り出せる仕事を探す**: `bun ~/.claude/skills/improve-week/agents.ts --days 14 <書き出し先.tsv>`で、エージェントの型ごとの件数と、general-purposeへの依頼の一覧を出す。似た依頼が繰り返されていれば、スキルかエージェントの定義に切り出す候補にする
5. **使っていないスキル、まとめた方がいいスキルを探す**: `bun ~/.claude/skills/curate-docs/usage.ts --days 60 --exclude-session <このセッションのID>`で数える。IDは、`claude-deck list`で自分の行（`id`が環境変数`CLAUDE_DECK_SESSION_ID`の行）の`claude_session_id`にある。0回のものを消す候補にする前の確かめ方は、`curate-docs`の本文にある
6. **話題の道具や手法を試す**: 残りの予算で、`research`のエージェントに、Claude Codeとエージェントの開発でいま話題になっている道具や手法を調べさせ、`~/github.com/pomesaka/sandbox`で試す

段の中で見つけた直しは、pomesakaに聞かずに決めてよい。ただし、消す、作りの向きを変えるような、後から戻しにくい直しは入れず、`add_question`で保留に残して先へ進む。pomesakaは席を外しているので、`AskUserQuestion`で止まると予算が使われずに終わる。

## 実装は別のセッションに頼む

直しの実装は、このセッションで書かず、`claude-deck new --prompt -`で新しいセッションを立てて頼む。依頼の文には、目的、対象のファイル、守る決まり（`~/.claude/CLAUDE.md`の手順）、「結果はSendMessageで返す。jj commitまでして、pushはしない」を書く。立てたら`follow_session`で相手の保留をこちらのpaneに並べる。`claude -p`は使わない。claude-deckの一覧に出ず、pomesakaが後から追えないためだ。

報告が届いたら、相手のコミットを`jj diff -r <change id>`で読む。ワークスペースは同じリポジトリなので、相手のコミットはここからも見える。よければ`jj rebase -r <change id> -d @-`でこのセッションの作業コピーの下に移し、入れたchange idを報告に書く。入れなかったものは理由を書く。pushとmainへの移動はpomesakaに任せる。報告を受けた後は`claude-deck list`の`hints`を見て、`context_full`なら`claude-deck clear`してから次を頼む。終わった相手は`unfollow_session`で外す。閉じるのはpomesakaに任せる。

## ブログのネタを残す

分かったことと試したことのうち、記事になりそうなものは`~/github.com/pomesaka/pomex.dev/ideas/`に残す。書き方、置き方、コミットとpushの決まりは、その`ideas/README.md`にあるので、書く前に読んで従う。仕事や顧客を特定できる情報は書かない。

## 予算に達したら

「[budget] 予算…に達した」の文が届いたら、いま進めている作業を区切る。頼んだセッションには、きりのいい所でコミットして報告するようSendMessageで伝え、届いた報告まで読む。新しい段には入らない。

報告は`~/.claude/tmp/improve-week/<日付>.md`（日付は`date +%F`）に書き、最後の返答にも要点を書く。

- 始めたときと終えたときの使用率、`resetsAt`
- 段ごとに、したこと、入れたもの（どのchange idに入れたか）、残したこと。飛ばした段はその理由
- 頼んだセッションの`name`と状態
- 残した保留の番号、ideasに書いたファイル

予算の知らせが届かないまま6段を終えたら、`clear_budget`で予算を外してから報告する。
