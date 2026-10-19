---
name: setup-docs
description: プロジェクトのドキュメント体制を整備する。
when_to_use: 「ドキュメント体制を整えて」「docs の構成を作りたい」「CLAUDE.md にドキュメントのルールを追加して」と言われたとき。
allowed-tools: Read, Glob, Bash(jj git remote list), Bash(ls *), Bash(fd *), Bash(rg *), Write, Edit, AskUserQuestion
model: sonnet
---

# setup-docs: ドキュメント体制の整備

プロジェクトの文書を読み、読み手が要る文書へたどり着ける入口（`## Documentation Map`）を 1 か所に作る。何をどこに書くかは以下に従う。

!`cat ~/.claude/docs/documentation-practices.md`

---

## Step 0: 既存の構造を読む

- `jj git remote list` でリポジトリ名を確かめる
- `./README.md`、`./CLAUDE.md`、`./AGENTS.md`、`./docs/README.md` があれば Read する
- `fd -e md . docs` で文書の一覧を取り、各文書が誰のどの作業のためのものかを調べる
- 文書が説明している機能のコードも確かめる。文書があることを、実装が終わった証拠にしない
- すでに入口（`## Documentation Map` や目次）があれば、それを直す方針で進める。同じ入口を別の場所に作らない

---

## Step 1: 入口の草案を作る

入口に載せるのは、次の 3 種類の文書へのリンクだけにする。

- コードを読む前に要る概念と、責務の境界
- 製品上の約束（利用者や外部に約束している振る舞い）
- 開発と運用の手順

全ファイルの一覧は作らない。文書を足すたびに一覧の更新が要り、更新が漏れると入口と実際の文書が食い違うからだ。数本のリンクで足りるなら表にしなくてよい。

「変更 → 更新する文書」の対応は、横断の約束、製品上の約束、運用の手順が変わったときの分だけを書く。1 つの実装に閉じた変更はコード、コメント、テストが受け持つので、API や export を足しただけで文書の更新を求める行は書かない。

新しい文書を作るよう提案するのは、読み手と用途が具体的に言えて、既存の文書に足すのでは足りないときだけにする。

---

## Step 2: 確かめる

次を自分で決められないときだけ、AskUserQuestion で聞く。

- **書き込み先**: `CLAUDE.md` と `docs/README.md` の両方があり、どちらに置くか決められない
- **文書の目的**: 既存の文書が何のためのものか分からない
- **削除してよいか**: 古く見える文書が、まだ誰かに使われているか分からない

---

## Step 3: 書き込む

書き込み先は次の順で決める。

1. `./docs/README.md` がある → そこに書く
2. `./CLAUDE.md` がある → そこに書く
3. どちらも無い → `./CLAUDE.md` を作る

`CLAUDE.md` と `AGENTS.md` の両方があるなら、入口は片方に書き、もう片方からリンクする。

```markdown
## Documentation Map

`/setup-docs` で作り直せる。

- 概念と責務の境界: docs/overview.md
- 運用の手順: docs/runbook/

### 変更 → ドキュメント更新

| 変更の種類 | 更新する文書 |
|---|---|
| 料金の計算規則を変えた | docs/billing.md |
```

---

## Step 4: 完了報告

書き込み先、載せたリンク、削除や統合を提案した文書を短く報告する。`docs-reviewer` を使いたいなら `/kickoff-review-team` を実行するよう案内する。

---

## Gotchas

- **`Documentation Map` の見出しを変えない**: `docs/technical-writing.md` と `docs-reviewer` が、この見出しの「変更 → ドキュメント更新」の表を読んで、文書の更新漏れを確かめる
- **入口を整えるために文書を増やさない**: 文書が足りないように見えても、まず既存の文書とコードコメントで足りるかを確かめる
