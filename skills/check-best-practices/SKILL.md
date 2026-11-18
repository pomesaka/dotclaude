---
name: check-best-practices
description: Claude Code のベストプラクティスリポジトリを調査し、dotclaude 環境との差分を分析して改善提案を行う。
when_to_use: 「ベストプラクティス確認して」「dotclaudeを改善したい」と言われたとき。
allowed-tools: Read, WebFetch(domain:platform.claude.com), WebFetch(domain:code.claude.com), WebFetch(domain:claude.dev), Bash(bash ~/.claude/skills/check-best-practices/fetch.sh), Bash(bash ~/.claude/skills/check-best-practices/env.sh)
context: fork
agent: general-purpose
---

# Claude Codeのベストプラクティスとの比較

## ベストプラクティスのリポジトリ（スキルを読み込んだ時点で取得した）

!`bash ~/.claude/skills/check-best-practices/fetch.sh`

## いまのdotclaudeの環境（スキルを読み込んだ時点で取得した）

!`bash ~/.claude/skills/check-best-practices/env.sh`

---

## 目的

いまのdotclaudeの環境に、取り込む値打ちのある改善があるかを調べて、提案する。

## 比べる基準

基準にするのは、Anthropicの公式の文書だ。`~/.claude/docs/prompt-engineering.md`を読み、末尾の「出典」に挙げてある4つ（プロンプトの全般の指針、モデルごとの指針、Claude Codeのベストプラクティス、`CLAUDE.md`と`rules/`の読み込まれ方）を`WebFetch`で取って読む。`prompt-engineering.md`は、この出典を利用者の環境に当てはめてまとめた文書なので、出典が`prompt-engineering.md`より新しくなっていれば、その差も報告する。

Claude Codeのチームのブログ（https://claude.dev/blog/）も基準に入れる。一覧を読み、前回の確認の後に出た記事の本文を読む。前回がいつか分からなければ、利用者に聞く。本文を読んだ記事と、一覧の題しか見ていない記事は、報告で分けて書く。

上のリポジトリは、基準でなく、取り込めるパターンを探す材料として読む。第三者がまとめたもので、古いモデルを前提にした勧めが混ざっている。次のような勧めは、公式の文書と食い違うので採らない。

- `CLAUDE.md`の行数の目標や、文脈の残量が何%になったらcompactする、といった数値の基準
- 重要な規則を強い語で書く、先頭と末尾で繰り返す、という勧め
- スキルに`Gotchas`の節を前もって用意する、という勧め
- 検証や徹底の念押し、既定でサブエージェントに任せる、という勧め

リポジトリの勧めが公式の文書に無く、食い違ってもいないときは、利用者の環境でどんな間違いが減るかを言えるものだけを提案する。

## 見るところ

- `CLAUDE.md`と、そこから`@`で読む文書に、モデルがコードを読めば分かること、特定の作業でだけ要ること、hookや権限の設定で強制するほうがよいことが書かれていないか
- スキルの`description`と`when_to_use`が、何をするかと、どんなときに使うかを伝えているか。副作用のあるスキルが`disable-model-invocation: true`になっているか。判断の要るスキルが`model:`で小さいモデルに固定されていないか
- 公式の文書にあって、この環境でまだ使っていない機能（`rules/`の`paths:`、スキルに閉じたhook、サブエージェントの`tools:`の制限など）のうち、いまの文書やスキルの間違いを減らせるもの

上に取得した環境は、`CLAUDE.md`の本文、スキルのfrontmatter、`docs/`の一覧だけだ。中身を見ないと判断できないときは、`~/.claude/docs/`や`~/.claude/skills/`のファイルをReadする。

## 報告

```
## ベストプラクティスとの比較の結果

### いまの環境
- スキルの数: N
- 毎回読まれる文書: CLAUDE.md と、@ で読む <文書の一覧>

### 取り込めるもの（手間が小さい）
1. ...

### 検討するもの（手間がかかる）
1. ...

### 採らなかった勧め
- <勧め>（出どころ） → <採らない理由>

### 既にできているもの
- ...

### 出典とprompt-engineering.mdの差
- ...
```

提案ごとに、出どころ（公式の文書の名前か、リポジトリのファイル）、取り込むとどんな間違いが減るか、どのファイルをどう変えるかを書く。どのファイルをどう変えるかを言えない提案は、載せない。

スキル、コマンド、エージェント、手順を作る、足すという提案は、載せる前に、公式の文書の機能の一覧（組み込みのスキルとコマンドを含む）で、同じ名前か同じ役目のものを探す。あれば、作る提案でなく、その機能を使う提案に変える。組み込みの機能を作り直す提案は、利用者が公式の文書を調べ直すまで誤りに気づかれない。

$ARGUMENTS
