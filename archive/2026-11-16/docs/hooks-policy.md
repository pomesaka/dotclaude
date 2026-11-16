# Claude Code の hooks とスキルの設計規約

> **TL;DR**: 未使用検出を持つ fixer は `PostToolUse:Edit` でなく `Stop` hook で走らせる。hook のトリガーは「何が欠けているか」で選び、発火条件は公式ドキュメントで確かめる。自動実行される hook に追跡ファイルを書き換えさせない。

`~/.claude/CLAUDE.md` の「Claude Code Hooks 設計規約」には、各項目の見出し文と判断基準だけがある。ここには WHY・手順・実例を含む全文を置く。気づきの追記と mentions の加算は、このファイルに行う。

- **`PostToolUse:Edit` で auto-fixer（biome / `eslint --fix`）を走らせない。`Stop` hook に集約する**: 中間 Edit の「変数を定義したが使用箇所はまだ」状態を fixer が誤検知し `_prefix` リネーム・未使用 import 削除を行い、次の Edit で `Cannot find name 'X'` になる。`--unsafe` を外しても safe fix で import が消える。ターン終了時なら使用箇所も揃っている。未使用検出を持つ fixer すべてに当てはまる。詳細: `archive/CLAUDE.md-2026-07-02.md#6-biome-post-edit-hook`
  <!-- importance: high | mentions: 3 | first-seen: 2026-06 -->
- **hook のトリガーは「何が変わったか」でなく「何が欠けているか」で選ぶ**: 変更検知（`FileChanged` で lockfile 監視等）は一見筋が良いが外れることが多い。worktree 並列開発で欠けているのは node_modules であって lockfile は変更されていないため永遠に発火しない。「このイベントは、私が困っている状態のときに実際に発火するか？」を実ワークフローに当てる。イベント名から挙動を推測しない（`Setup` は通常のセッション開始で発火しない・`WorktreeCreate` は通知でなく作成処理そのものの置き換え）。採用前に公式ドキュメントで発火条件を確認する。`SessionStart` の stdout はコンテキストに注入されるので副作用目的なら `> /dev/null`。発火確認方法（`hook_success` レコード）含む詳細: `archive/CLAUDE.md-2026-07-29.md#16-hook-trigger-selection`
  <!-- importance: high | mentions: 2 | first-seen: 2026-07 -->
- **自動実行される hook に追跡ファイルを書き換えさせない。「気づかないうちに壊れる」より「はっきり失敗する」を選ぶ**: hook はユーザーが見ていないところで走るため、生成物（lockfile 等）を書き換えると「作った覚えのない変更」がコミットに混入する。`bun install` でなく `bun install --frozen-lockfile`（npm なら `ci`）。判断基準: 「この hook は追跡ファイルを変更しうるか？」YES なら変更しない版を探す。関連: `coding-policy.md` の「ツールが所有する生成物ファイルは手書きしない」と対
  <!-- importance: high | mentions: 1 | first-seen: 2026-07 -->
