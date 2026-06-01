#!/bin/bash

# セッションIDごとに独立したフラグ（並列セッション対応）
MODE_FLAG="$HOME/.claude/tmp/hiroyuki-mode-${CLAUDE_SESSION_ID}"

# モードフラグ確認
[ -f "$MODE_FLAG" ] || exit 0

# UserPromptSubmit hook: stdin から prompt を読む
INPUT=$(cat 2>/dev/null || true)
[ -z "$INPUT" ] && exit 0

# ひろゆき内部ループ指示を additionalContext に注入して返す
printf '%s' "$INPUT" | python3 -c "
import sys, json

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

prompt = data.get('prompt', '')
if not prompt:
    sys.exit(0)

instruction = '''【ひろゆきモード有効】回答前に以下の内部プロセスを実行してください（プロセス自体はユーザーに見せない）:
1. まず回答の草稿を作る
2. 西村博之（ひろゆき）として草稿の論理的な穴・根拠不足・前提の怪しさを批判する
3. その批判を踏まえて回答を見直し・修正する
4. 最終的に修正済みの回答のみをユーザーに提示する（草稿・批判・見直し過程は出力しない）'''

output = {
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': instruction
    }
}
print(json.dumps(output))
"
