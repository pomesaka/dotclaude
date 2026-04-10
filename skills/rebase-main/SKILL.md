---
name: rebase-main
description: jj git fetchしてmainにrebaseする。コンフリクト発生時は解消し、PRがあればupdate-prを呼ぶ。/rebase-main で呼び出す。
disable-model-invocation: true
allowed-tools: Bash(jj *), Bash(gh *), Bash(bun *), Read, Glob, Skill
model: sonnet
---

# Rebase on Main

現在の作業リビジョンをリモートの最新mainにリベースする。
コンフリクト発生時は解消し、PRが紐づいていれば `/update-pr` でPRを更新する。

## 手順

### 1. 現在の状態を確認

```bash
jj log --limit 5
```

作業中のリビジョンのルートを特定する。
- リビジョンが1つだけ（main直上）なら `@` がルート
- 複数リビジョンのチェーン（例: A→B→@）なら、mainから分岐した最初のリビジョンがルート

### 2. fetch & rebase

```bash
jj git fetch
jj rebase -s <ルートrev> -d main
```

### 3. コンフリクト確認・解消

```bash
jj log --limit 5  # conflict マークの有無を確認
```

コンフリクトがある場合:

```bash
jj resolve  # 対話的に解消できない場合は手動で修正
```

手動修正が必要な場合:
1. `jj diff` でコンフリクトマーカーのあるファイルを特定
2. ファイルを読み込み、コンフリクトマーカーを解消
3. 解消後、`jj status` でコンフリクトが残っていないことを確認

### 4. 動作検証

rebase後にビルド・型チェック・lintが通ることを確認する。
検証コマンドはプロジェクトの `CLAUDE.md` や `package.json` を参照して判断する。
失敗した場合はここで修正すること。

### 5. PR更新（該当する場合のみ）

現在のブックマークにPRが紐づいているか確認する:

```bash
jj bookmark list  # ブックマーク名を確認
gh pr list --head <bookmark名> --json number,title
```

PRが存在する場合は `/update-pr` スキルを呼び出してPRを更新する。
PRが存在しない場合はここで完了。
