---
name: hiroyuki
description: ひろゆきモードの ON/OFF を切り替える。ON 中は Claude の全回答に自動で批判的反論が付く。
when_to_use: 「ひろゆきモード」「批判的モード」「反論モード」「全肯定やめて」と言われたとき。
disable-model-invocation: true
allowed-tools: Bash(touch *), Bash(rm *), Bash(test *)
---

# ひろゆきモード トグル

`~/.claude/tmp/hiroyuki-mode-${CLAUDE_SESSION_ID}` フラグファイルの有無で ON/OFF を切り替える。セッション ID をキーにしているため並列セッション間で干渉しない。

UserPromptSubmit hook（settings.json に常時登録済み）がフラグを見てひろゆき指示を
additionalContext に注入するため、**このスキルはフラグファイルの操作だけ**を行う。次の回答から即時有効。

```bash
FLAG="$HOME/.claude/tmp/hiroyuki-mode-${CLAUDE_SESSION_ID}"
if test -f "$FLAG"; then
  rm "$FLAG"
  echo "ひろゆきモード OFF"
else
  touch "$FLAG"
  echo "ひろゆきモード ON（次の回答から有効）"
fi
```

## Gotchas

- **Stop hook の `exit 2` は新ターンを生成しない**: 「stderr が Claude にフィードバックされる」という公式記述はエラー表示のみで、新しい Claude ターンとして処理されない。ひろゆき召喚に Stop hook + exit 2 を使っても何も起きない。UserPromptSubmit hook が正解。
- **UserPromptSubmit hook の stdin キーは `"prompt"`（`"message"` ではない）**: stdin JSON の正しいキー名は `"prompt"`。`"message"` で読もうとすると空文字になって注入が無効になる。
- **stdout の正しい形式は `hookSpecificOutput` 経由**: `{"message": "..."}` を返しても無効。正しくは `{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "..."}}` の形式。
- **`CLAUDE_SESSION_ID` の hook.sh での可用性は未確認**: SKILL.md 実行コンテキストでは使えるが、hook スクリプト内でも展開されるかは公式未記載。空になると全セッション共通フラグになる。
