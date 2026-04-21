---
name: rebase-main
description: jj git fetchしてmainにrebaseする。コンフリクト発生時は解消し、PRがあればupdate-prを呼ぶ。/rebase-main で呼び出す。
disable-model-invocation: true
allowed-tools: Bash(jj *), Bash(gh *), Read, Edit, Glob, Skill
model: sonnet
---

# Rebase on Main

現在の作業リビジョンをリモートの最新mainにリベースする。
コンフリクト発生時は解消し、PRが紐づいていれば `/update-pr` でPRを更新する。

## 初期状態（インライン実行済み）

!`jj git fetch && jj log --limit 10`

## 手順

### 1. ルートリビジョンを特定してリベース

上のログ出力を読んで、mainから分岐した最初のリビジョン（ルート）を特定する。
- リビジョンが1つだけ（main直上）なら `@` がルート
- 複数リビジョンのチェーン（例: A→B→@）なら、mainから分岐した最初のリビジョンがルート

```bash
jj rebase -s <ルートrev> -d main
```

### 2. コンフリクト確認・解消

```bash
jj log --limit 5  # conflict マークの有無を確認
```

コンフリクトがある場合:
1. `jj diff` でコンフリクトマーカーのあるファイルを特定
2. ファイルを読み込み、コンフリクトマーカーを手動で解消
3. 解消後、`jj status` でコンフリクトが残っていないことを確認

### 3. PR更新（該当する場合のみ）

現在のブックマークにPRが紐づいているか確認する:

```bash
jj bookmark list
gh pr list --head <bookmark名> --json number,title
```

PRが存在する場合は `/update-pr` スキルを呼び出してPRを更新する。
PRが存在しない場合はここで完了。

## Gotchas

- **コンフリクト後の squash**: `jj squash` で resolution commit をコンフリクト commit に統合する。その後 `jj log` で確認。
