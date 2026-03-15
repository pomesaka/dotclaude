---
name: resolve-conflict
description: PRまたはbookmark名を受け取り、mainとのコンフリクトを解消してpushする。/resolve-conflict <bookmark> で呼び出す。
disable-model-invocation: true
argument-hint: "<bookmark>"
allowed-tools: Bash(jj *), Bash(gh *), Bash(task *), Read, Edit, Glob, Grep
---

# Resolve Conflict

mainとのコンフリクトを解消してpushする。

## Arguments

- `$ARGUMENTS`: 対象のbookmark名またはPR番号

## 手順

### 1. 引数の解釈

`$ARGUMENTS` がPR番号（数値）の場合、bookmark名を取得する:

```bash
gh pr view $ARGUMENTS --json headRefName -q '.headRefName'
```

bookmark名が直接指定された場合はそのまま使用する。

### 2. ローカルbookmarkの確認と準備

```bash
jj bookmark list
jj git fetch
```

対象bookmarkがローカルにない場合はtrackする:

```bash
jj bookmark track <bookmark>@origin
```

### 3. コンフリクト解決用のrevisionを作成

mainと対象bookmarkを両親に持つマージrevisionを作成する。

```bash
jj new main <bookmark> -m 'resolve conflict'
```

### 4. コンフリクト状況を確認

```bash
jj log -n 10
jj st
```

コンフリクトのあるファイルの内容を確認し、解決方針を立てる。
必要に応じて各親の変更内容を確認:

```bash
jj diff -r main
jj diff -r <bookmark>
```

### 5. コンフリクトを解決

コンフリクトマーカーを含むファイルを編集して解決する。

jjのコンフリクトマーカー形式:
- diff形式: `%%%%%%%` で囲まれたブロック内の `-` 行と `+` 行
- snapshot形式: `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>` で区切られたブロック

解決後に確認:

```bash
jj st
```

### 6. リントチェック

```bash
task lint
```

エラーがあれば修正する。

### 7. mainのみを親とする非マージリビジョンにリライトしてpush

GitHubのPR diffはthree-dot diff（`base...head`）で計算される。
マージコミット（mainを親に持つ）をそのままpushすると、GitHubのmerge-base計算が狂い、mainの変更がPR diffに混入する。
これを回避するため、**マージコミットのツリーを保持しつつ、mainのみを親とする単一親リビジョンに作り直す**。

```bash
# 現在の@はマージコミット（ステップ3で作成したもの）

# Step 1: マージコミットのrevision IDを控える
MERGE_REV=@

# Step 2: mainのみを親とする新リビジョンを作成
jj new main -m 'resolve conflict between main and <bookmark>'

# Step 3: マージコミットのツリーを復元
jj restore --from <MERGE_REVのID>

# Step 4: feature branchの変更のみであることを確認
jj diff --stat  # feature branchのファイルのみが表示されること

# Step 5: bookmarkをセットしてpush
jj bookmark set -r @ <bookmark> --allow-backwards && jj git push
```

### 8. 確認

PR diffにmainの変更が混入していないことを確認する。

```bash
jj log -n 5
gh pr diff <PR番号またはbookmark> --name-only  # feature branchの変更ファイルのみ表示されること
```

## 注意事項

- コンフリクト解決前に必ず両方の変更内容を理解すること
- リントエラーがある場合は必ず修正してからpushすること
- マージコミットを直接PRブランチのheadにすると、GitHubのdiff表示が壊れる。必ずmain単一親リビジョンに作り直すこと
