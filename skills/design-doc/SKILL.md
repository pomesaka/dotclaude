---
name: design-doc
description: 実装の前にレビューするDesign Docを書く。リポジトリにテンプレート（docs/design/TEMPLATE.md）が無ければ置く。
when_to_use: 「Design Docを書いて」「設計ドキュメントを作って」「実装の前に設計をまとめて」「Design Docのテンプレートを置いて」と言われたとき。
argument-hint: "[題材]"
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash(jj log *), Bash(git rev-parse *), Bash(date *), Bash(rg *), Bash(fd *)
---

# Design Doc

実装をエージェントに任せる前に、仕様、得たい結果、設計を1つの文書にまとめてレビューする。文書は`docs/design/<名前>.md`に書き、そのまま実装するエージェントに渡す。書き捨ての文書で、実装が終わったら、残す情報をほかの文書かコードのコメントに移して消す。どの情報をどこへ移すかは`~/.claude/docs/what-goes-where.md`で決める。

テンプレートはリポジトリの`docs/design/TEMPLATE.md`に置く。このスキルを読めない道具（スマホのチャット、ほかの実装エージェント）からも、同じ形で書けるようにするためだ。

## Step 1: テンプレートを確かめる

`docs/design/TEMPLATE.md`を読む。

- **ある:** それを使う。リポジトリごとに直してあることがあるので、このスキルの`template.md`で上書きしない
- **無い:** `~/.claude/skills/design-doc/template.md`を読み、同じ中身を`docs/design/TEMPLATE.md`に書く

題材が引数にも会話にも無ければ、テンプレートを置いたことを伝えて終わる。

## Step 2: コードを読み、不明点を聞く

題材に関係するコードを読む。設計の節は、既存のファイルや型の名前で書くからだ。

次が会話から分からなければ、`AskUserQuestion`でまとめて聞く。

- 何を解決するか
- 何が確認できれば成功か
- 今回はやらないこと
- 設計で、案が分かれていて決め手の無い点

聞いても決まらない点は、推測で埋めずに「未決の点」に書く。

## Step 3: 書く

`docs/design/<kebab-caseの名前>.md`に、テンプレートの「ここから下を写す」より後ろの形で書く。書き方の決まりは、テンプレートの冒頭にある。

基準のコミットは、読んだコードのコミットを取る。

```bash
# jjのリポジトリ
jj log -r @- --no-graph -T 'commit_id.short() ++ " " ++ committer.timestamp().format("%Y-%m-%d")'
# gitのリポジトリ
git rev-parse --short HEAD
```

未コミットの変更を読んで書いたなら、基準のコミットの行にそう書く。

## Step 4: 伝える

書いたファイルの場所と、「未決の点」に残したものを伝える。文書の中身を、答えで繰り返さない。

## Gotchas

- **作業の手順を書かない:** 「どのファイルをどの順で変えるか」は実装する側が決める。書くのは、目的、得たい結果、設計
- **あとから参照する文書として書かない:** 実装が終わると消える。ほかの文書やコードのコメントから、Design Docへリンクしない
- **「採らなかった案」を省かない:** 決定だけを書くと、実装するエージェントが捨てた案をもう一度思いついて採ることがある
