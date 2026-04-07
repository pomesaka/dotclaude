---
name: use-design
description: プロジェクトルートにDESIGN.mdを配置する。awesome-design-mdコレクションから選択するか、カスタム指定も可能。「DESIGN.mdを適用して」「LinearのデザインでUIを作りたい」と言われたときに使う。
allowed-tools: Read, Write, Bash(ls *), Bash(cp *)
---

# DESIGN.md をプロジェクトに適用する

`~/.claude/docs/design-md/` に保存済みのDESIGN.mdをプロジェクトルートにコピーする。

## 利用可能なデザインスタイル

!`ls ~/.claude/docs/design-md/ 2>/dev/null | sed 's/\.md$//'`

## 手順

1. ユーザーが指定したスタイル（または引数）を確認する
2. 対応するファイルが `~/.claude/docs/design-md/<style>.md` に存在するか確認
3. `./DESIGN.md` としてコピーする
4. コピー後、適用したスタイルの概要（テーマ・カラー・タイポグラフィ）を1段落で要約して報告する

## 使い方

```
/use-design linear
/use-design vercel
/use-design notion
/use-design stripe
/use-design claude
```

引数なしで呼ばれた場合は、利用可能なスタイル一覧を表示してユーザーに選択を促す。

## 現在のDESIGN.md

既に `./DESIGN.md` が存在する場合は、上書き前に確認を取ること。
