---
name: re
description: /summarize で生成した引き継ぎメモを読み込み、作業を再開する。
when_to_use: 「re」「再開して」「引き継ぎを読んで」「handoff を読んで」と言われたとき。
allowed-tools: Read
---

# Re (Resume)

`~/.claude/tmp/handoff.md` を読み込み、前のセッションの続きから即座に作業を再開する。

## 手順

### Step 1: 引き継ぎメモの読み込み

Read ツールで `~/.claude/tmp/handoff.md` を読み込む。

ファイルが存在しない場合は「handoff.md が見つかりません。先に /summarize を実行してください。」と伝えて終了する。

### Step 2: 状況の把握と再開宣言

読み込んだメモから以下を把握し、ユーザーに現状を簡潔に伝える:

- **Goal**: 何を達成しようとしているか
- **Progress**: どこまで進んでいたか
- **Next Steps**: 次にやること（チェックリストの未完了項目）

出力フォーマット:

```
## 再開します

**Goal**: {goal}
**Progress**: {progress}

**Next**: {最初の未完了タスク}

続けます。
```

### Step 3: 作業の継続

Next Steps の先頭タスクから作業を開始する。ユーザーの確認を待たずに着手してよい。

---

## Gotchas

- **handoff.md は上書き**: 複数セッション分を保持したい場合、ユーザーに `/summarize` でタイムスタンプ付きファイル名を使うよう提案する。
- **メインコンテキストで実行する**: `context: fork` にするとファイルは読めるが作業継続ができない。
