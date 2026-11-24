---
name: explain-inline
description: explainの説明を、出す先を「会話の中」に決めて作る。中身の決め方はexplainと同じ。
when_to_use: 「会話の中で説明して」「richで見せて」「さっと図で見せて」と言われたとき。出す先を決めずに頼まれたときは explain を使う。
argument-hint: "[説明してほしいこと]"
allowed-tools: Read, Grep, Glob, mcp__rich__show, Bash(jj *), Bash(gh *), Bash(rg *), Bash(fd *)
---

# explain-inline

`explain`の入口の1つ。出す先を「会話の中」に決めてある。

何を説明するか、読み手の前提、説明の順番は、下の`explain`の手順で決める。「出す先を選ぶ」の節は飛ばす。描き方は、その下の`rich.md`に従い、`mcp__rich__show`は`where: "inline"`で呼ぶ。

このファイルに説明の決まりは書かない。直すときは`explain`の側を直す。

## explainの手順（スキルを読み込んだ時点で取得した）

!`cat ~/.claude/skills/explain/SKILL.md`

## richでの描き方（スキルを読み込んだ時点で取得した）

!`cat ~/.claude/skills/explain/references/rich.md`
