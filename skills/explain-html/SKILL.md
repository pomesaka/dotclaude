---
name: explain-html
description: explainの説明を、出す先を「ブラウザのページ」に決めて作る。中身の決め方はexplainと同じ。
when_to_use: 「HTMLで説明して」「ブラウザで見せて」「ページにまとめて」と言われたとき。出す先を決めずに頼まれたときは explain を使う。
argument-hint: "[説明してほしいこと]"
allowed-tools: Read, Grep, Glob, Write, Edit, Skill, Bash(jj *), Bash(gh *), Bash(rg *), Bash(fd *), Bash(open *), Bash("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" *)
---

# explain-html

`explain`の入口の1つ。出す先を「ブラウザのページ」に決めてある。

何を説明するか、読み手の前提、説明の順番は、下の`explain`の手順で決める。「出す先を選ぶ」の節は飛ばす。描き方は、その下の`html.md`に従う。

このファイルに説明の決まりは書かない。直すときは`explain`の側を直す。

## explainの手順（スキルを読み込んだ時点で取得した）

!`cat ~/.claude/skills/explain/SKILL.md`

## ブラウザのページの描き方（スキルを読み込んだ時点で取得した）

!`cat ~/.claude/skills/explain/references/html.md`
