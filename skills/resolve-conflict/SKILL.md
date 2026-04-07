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

### 3. コンフリクト解決用のmerge commitを作成

feature branchを第1親、mainを第2親にしてmerge commitを作成する。
**第1親をfeature branchにすることが重要**（first-parentをたどるツールがfeature branchの履歴を辿れる）。

```bash
jj new <bookmark> main -m 'merge main into <bookmark>'
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

### 7. bookmarkを前に進めてpush

`@` はfeature bookmarkの子孫なので `--allow-backwards` 不要。
merge commitはfeature tipの子孫なのでforce pushも不要（fast-forward）。

```bash
jj bookmark set <bookmark> -r @
jj git push --bookmark <bookmark>
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
- `--allow-backwards` は使わない（過去のコミット履歴が失われる）
- force pushは使わない（merge commitはfeature tipの子孫なのでfast-forwardになる）
