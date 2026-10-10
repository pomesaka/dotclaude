---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

TypeScript を編集中。詳細な規約は `~/.claude/docs/typescript.md`、実装中の見落としやすい点・コンパイラ挙動は `~/.claude/docs/typescript-gotchas.md`（どちらも必要時に読む）。

編集時のハード制約リマインダ（出典は CLAUDE.md）。
- `as` キャストは禁止
- テストは `test.each` を使った table driven test で書く
