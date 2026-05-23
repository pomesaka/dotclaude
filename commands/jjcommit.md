# Jujutsu Commit Command

`jjcommit` スキルを使って、現在の変更をコミットしてください。

実行時は `skills/jjcommit/SKILL.md` の手順に従ってください。特に以下を守ること:

- `jj diffu` で現在の変更内容を確認する
- diff から読める WHAT/HOW だけでなく、会話履歴から WHY を集める
- WHY を主軸にしたコミットメッセージを作成する
- `jj commit` 実行後、`jj log --limit 2` で確認する

ユーザーが追加の引数を渡した場合は、コミットメッセージ作成時の補足意図として扱ってください。
